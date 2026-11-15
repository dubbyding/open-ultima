import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BleManagerSnapshot } from '../../../services/bleManager.ts';
import type { PairedDeviceRecord } from '../../../storage/offlineStore.ts';
import type { OfflineMapPin } from '../../map/types.ts';
import {
  ActionChip,
  ActionStatusLine,
  Card,
  Notice,
  OfflineBadge,
  ProgressBar,
  SectionHeader,
} from '../../shared/theme/primitives.tsx';
import {
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  batteryColor,
  hex16,
  useActionRunner,
} from '../../shared/theme/tokens.ts';
import type { ScreenProps } from '../../shared/theme/tokens.ts';
import { AncAndEqSection } from './AncAndEqSection.tsx';
import { FeaturesAndGesturesSection } from './FeaturesAndGesturesSection.tsx';
import { FindMyEarbudsSection } from './FindMyEarbudsSection.tsx';

/** Builds deduplicated radar pins for Left/Right/Case earbuds and saved paired history. */
export function buildEarbudMapPins(
  earbuds: BleManagerSnapshot['earbuds'],
  pairedDevices: readonly PairedDeviceRecord[],
): OfflineMapPin[] {
  const pins: OfflineMapPin[] = [];
  if (earbuds.sideLocations.left) {
    pins.push({
      id: 'earbud-left',
      label: 'Left Earbud (L)',
      shortTag: 'L',
      lat: earbuds.sideLocations.left.lat,
      lng: earbuds.sideLocations.left.lng,
      role: 'left_earbud',
      note: earbuds.sideLocations.left.note,
      savedAt: earbuds.sideLocations.left.savedAt,
    });
  }
  if (earbuds.sideLocations.right) {
    pins.push({
      id: 'earbud-right',
      label: 'Right Earbud (R)',
      shortTag: 'R',
      lat: earbuds.sideLocations.right.lat,
      lng: earbuds.sideLocations.right.lng,
      role: 'right_earbud',
      note: earbuds.sideLocations.right.note,
      savedAt: earbuds.sideLocations.right.savedAt,
    });
  }
  if (earbuds.sideLocations.casePin) {
    pins.push({
      id: 'earbud-case',
      label: 'Charging Case',
      shortTag: 'C',
      lat: earbuds.sideLocations.casePin.lat,
      lng: earbuds.sideLocations.casePin.lng,
      role: 'case',
      note: earbuds.sideLocations.casePin.note,
      savedAt: earbuds.sideLocations.casePin.savedAt,
    });
  }
  for (const dev of pairedDevices) {
    if (!dev.lastKnownLocation || dev.id === earbuds.deviceId) {
      continue;
    }
    const loc = dev.lastKnownLocation;
    const matchesHydratedEarbuds =
      dev.kind === 'earbuds' &&
      ((earbuds.sideLocations.casePin !== null &&
        loc.savedAt === earbuds.sideLocations.casePin.savedAt) ||
        (earbuds.lastKnownLocation !== null &&
          loc.savedAt === earbuds.lastKnownLocation.savedAt));
    if (matchesHydratedEarbuds) {
      continue;
    }
    pins.push({
      id: `history-${dev.id}`,
      label: `${dev.name} (Saved)`,
      shortTag: dev.kind === 'watch' ? 'W' : 'H',
      lat: loc.lat,
      lng: loc.lng,
      role: dev.kind === 'watch' ? 'watch' : 'history',
      note: loc.note,
      savedAt: loc.savedAt,
    });
  }
  return pins;
}

/** Ultima Link Audio Studio tab screen for ANC, 10-band EQ, hardware switches, gestures, and Find-My radar. */
export function AudioStudioScreen({
  snapshot,
  manager,
  store,
  storeState,
  onStoreChanged,
}: ScreenProps): React.ReactElement {
  const actions = useActionRunner();
  const { earbuds } = snapshot;
  const connected = earbuds.connected;

  const earbudMapPins = React.useMemo<OfflineMapPin[]>(
    () => buildEarbudMapPins(earbuds, storeState.pairedDevices),
    [earbuds, storeState.pairedDevices],
  );

  const batteryEntries = [
    { label: 'Left Bud', level: earbuds.battery.left, charging: earbuds.battery.leftCharging },
    { label: 'Right Bud', level: earbuds.battery.right, charging: earbuds.battery.rightCharging },
    { label: 'Charging Case', level: earbuds.battery.case, charging: earbuds.battery.caseCharging },
  ] as const;

  return (
    <ScrollView
      style={SHARED_LAYOUT_STYLES.scroll}
      contentContainerStyle={SHARED_LAYOUT_STYLES.content}
      keyboardShouldPersistTaps="handled"
    >
      <SectionHeader
        overline="Ultima Link Audio Studio"
        title={earbuds.name}
        subtitle={
          connected
            ? `${earbuds.chip ?? 'JL/BT'} chipset · PID ${hex16(earbuds.pid)} · FW ${earbuds.firmwareVersion ?? '—'} · MAC ${earbuds.mac ?? '—'}`
            : 'Connect earbuds from the Hub tab (or use Simulator) to send live protocol frames.'
        }
        right={
          connected ? (
            <ActionChip
              label="Refresh Info"
              compact
              tone="cyan"
              onPress={() =>
                actions.run('Refresh earbuds info', () => manager.refreshEarbudsInfo())
              }
            />
          ) : (
            <OfflineBadge label="Standby" tone="amber" compact />
          )
        }
      />

      <ActionStatusLine status={actions.status} />

      {!connected ? (
        <Notice
          tone="amber"
          text="Earbuds not connected. You can still design and save custom 10-band EQ curves or pin offline Find-My coordinates."
        />
      ) : null}

      <Card style={SHARED_LAYOUT_STYLES.sectionGap} tone={connected ? 'cyan' : undefined}>
        <View style={styles.cardHeaderRow}>
          <Text style={TYPOGRAPHY.cardTitle}>L / R / Case Telemetry</Text>
          <Text style={TYPOGRAPHY.caption}>
            {earbuds.product?.code ?? 'TWS'} · Vol {earbuds.volume}%
          </Text>
        </View>
        <View style={styles.batteryGrid}>
          {batteryEntries.map((b) => (
            <View key={b.label} style={styles.batteryCol}>
              <View style={styles.batteryTopRow}>
                <Text style={TYPOGRAPHY.overline}>{b.label}</Text>
                <Text style={[styles.batteryPercent, { color: batteryColor(b.level) }]}>
                  {b.level}%{b.charging ? ' ⚡' : ''}
                </Text>
              </View>
              <ProgressBar
                progress={b.level / 100}
                tone={b.level <= 20 ? 'amber' : 'emerald'}
                height={8}
              />
            </View>
          ))}
        </View>
      </Card>

      <AncAndEqSection
        earbuds={earbuds}
        manager={manager}
        store={store}
        storeState={storeState}
        actions={actions}
        onStoreChanged={onStoreChanged}
      />
      <FeaturesAndGesturesSection earbuds={earbuds} manager={manager} actions={actions} />
      <FindMyEarbudsSection
        earbuds={earbuds}
        earbudMapPins={earbudMapPins}
        manager={manager}
        actions={actions}
        onStoreChanged={onStoreChanged}
      />
    </ScrollView>
  );
}

export default AudioStudioScreen;

const styles = StyleSheet.create({
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  batteryGrid: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  batteryCol: { flex: 1, gap: 6 },
  batteryTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  batteryPercent: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
