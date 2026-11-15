import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import { UltimaBleManager } from './src/services/bleManager.ts';
import type { BleManagerSnapshot } from './src/services/bleManager.ts';
import { OfflineStore } from './src/storage/offlineStore.ts';
import { AudioStudioScreen } from './src/screens/AudioStudioScreen.tsx';
import { DeviceHubScreen } from './src/screens/DeviceHubScreen.tsx';
import { HealthWatchScreen } from './src/screens/HealthWatchScreen.tsx';
import { InspectorBackupScreen } from './src/screens/InspectorBackupScreen.tsx';
import {
  COLORS,
  OfflineBadge,
  RADII,
  SPACING,
  TYPOGRAPHY,
  getTonePalette,
} from './src/theme.ts';
import type { AccentTone } from './src/theme.ts';

type TabKey = 'hub' | 'audio' | 'fit' | 'inspector';

interface TabDefinition {
  key: TabKey;
  label: string;
  glyph: string;
}

const TABS: readonly TabDefinition[] = [
  { key: 'hub', label: 'Hub', glyph: '◎' },
  { key: 'audio', label: 'Audio', glyph: '♫' },
  { key: 'fit', label: 'Fit', glyph: '♥' },
  { key: 'inspector', label: 'Inspector', glyph: '⌗' },
];

interface Services {
  store: OfflineStore;
  manager: UltimaBleManager;
}

interface ConnectionPillProps {
  label: string;
  connected: boolean;
  detail: string;
  tone: AccentTone;
}

function ConnectionPill({
  label,
  connected,
  detail,
  tone,
}: ConnectionPillProps): React.ReactElement {
  const palette = getTonePalette(connected ? tone : 'neutral');
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View style={[styles.pillDot, { backgroundColor: palette.fg }]} />
      <Text style={[styles.pillLabel, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.pillDetail} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function earbudsPillDetail(snapshot: BleManagerSnapshot): string {
  const e = snapshot.earbuds;
  if (e.connected) return `${e.name} · L${e.battery.left} R${e.battery.right}`;
  if (e.connecting) return 'Connecting…';
  return 'Disconnected';
}

function watchPillDetail(snapshot: BleManagerSnapshot): string {
  const w = snapshot.watch;
  if (w.connected) return `${w.name} · ${w.batteryPercent}%`;
  if (w.connecting) return 'Connecting…';
  return 'Disconnected';
}

export default function App(): React.ReactElement {
  const [services] = React.useState<Services>(() => {
    const store = new OfflineStore();
    const manager = new UltimaBleManager(store);
    return { store, manager };
  });
  const { store, manager } = services;

  const [snapshot, setSnapshot] = React.useState<BleManagerSnapshot>(() =>
    manager.getSnapshot(),
  );
  const [storeVersion, setStoreVersion] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState<TabKey>('hub');
  const [initError, setInitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const unsubscribe = manager.subscribe((next) => {
      if (!cancelled) setSnapshot(next);
    });
    manager
      .init()
      .then(() => {
        if (!cancelled) {
          setSnapshot(manager.getSnapshot());
          setStoreVersion((v) => v + 1);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setInitError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [manager]);

  React.useEffect(() => {
    return () => {
      manager.destroy();
    };
  }, [manager]);

  const onStoreChanged = React.useCallback((): void => {
    setStoreVersion((v) => v + 1);
    setSnapshot(manager.getSnapshot());
  }, [manager]);

  // Re-read the store whenever the manager emits or a screen mutates it directly.
  const storeState = React.useMemo(
    () => store.getState(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, snapshot, storeVersion],
  );

  const screenProps = {
    snapshot,
    manager,
    store,
    storeState,
    onStoreChanged,
  };

  let screen: React.ReactElement;
  switch (activeTab) {
    case 'audio':
      screen = <AudioStudioScreen {...screenProps} />;
      break;
    case 'fit':
      screen = <HealthWatchScreen {...screenProps} />;
      break;
    case 'inspector':
      screen = <InspectorBackupScreen {...screenProps} />;
      break;
    case 'hub':
    default:
      screen = <DeviceHubScreen {...screenProps} />;
      break;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.headerTitleBlock}>
              <Text style={TYPOGRAPHY.screenTitle}>Ultima Open</Text>
              <Text style={TYPOGRAPHY.sectionSubtitle}>
                Ultima Link + ULTIMA Fit · no cloud, no account
              </Text>
            </View>
            <OfflineBadge label="Offline-First" compact />
          </View>
          <View style={styles.pillRow}>
            <ConnectionPill
              label="Earbuds"
              connected={snapshot.earbuds.connected}
              detail={earbudsPillDetail(snapshot)}
              tone="cyan"
            />
            <ConnectionPill
              label="Watch"
              connected={snapshot.watch.connected}
              detail={watchPillDetail(snapshot)}
              tone="indigo"
            />
          </View>
          <Text style={styles.modeLine}>
            Mode: {snapshot.mode === 'simulator' ? 'Simulator' : 'Live BLE'}
            {snapshot.initialized ? '' : ' · loading offline store…'}
          </Text>
          {initError ? (
            <Text style={styles.errorLine}>Store init failed: {initError}</Text>
          ) : null}
        </View>

        <View style={styles.body}>{screen}</View>

        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tabItem, active ? styles.tabItemActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.tabGlyph,
                    { color: active ? COLORS.cyan : COLORS.textMuted },
                  ]}
                >
                  {tab.glyph}
                </Text>
                <Text
                  style={[
                    styles.tabLabel,
                    { color: active ? COLORS.cyan : COLORS.textMuted },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.sm,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  headerTitleBlock: {
    flex: 1,
  },
  pillRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pillLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  pillDetail: {
    flex: 1,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  modeLine: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  errorLine: {
    fontSize: 11,
    color: COLORS.rose,
  },
  body: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    gap: 2,
    borderTopWidth: 2,
    borderTopColor: 'transparent',
  },
  tabItemActive: {
    borderTopColor: COLORS.cyan,
  },
  tabGlyph: {
    fontSize: 18,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
});
