import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Text } from 'react-native-paper';

import { M3 } from '../../domains/shared/theme/tokens.ts';
import type { KeeperLinkStatus } from '../../services/bleManager.ts';
import type { PairedDeviceRecord } from '../../domains/storage/types.ts';
import { useApp } from '../AppContext.tsx';
import {
  Banner,
  Battery,
  Card,
  ChoiceTiles,
  HStack,
  IconBadge,
  Meter,
  Pill,
  Row,
  RowGroup,
  Screen,
  SectionLabel,
  formatNumber,
  timeAgo,
  useTask,
} from '../ui.tsx';
import type { Tone } from '../ui.tsx';

type Kind = 'earbuds' | 'watch';

function latestSaved(devices: readonly PairedDeviceRecord[], kind: Kind): PairedDeviceRecord | null {
  return [...devices].filter((d) => d.kind === kind).sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)[0] ?? null;
}

/** Plain-language connection status shared by both device cards. */
export function linkStatus(link: KeeperLinkStatus, connected: boolean, connecting: boolean): { label: string; tone: Tone } {
  if (connected) return { label: 'Connected', tone: 'emerald' };
  if (connecting || link.state === 'reconnecting') return { label: 'Connecting…', tone: 'cyan' };
  if (link.state === 'waiting') return { label: 'Out of range', tone: 'amber' };
  return { label: 'Not connected', tone: 'neutral' };
}

const NOISE_OPTIONS = [
  { value: 'off', label: 'Off', icon: 'volume-high' },
  { value: 'anc', label: 'Cancel', icon: 'headphones' },
  { value: 'transparency', label: 'Aware', icon: 'ear-hearing' },
] as const;

export function HomeScreen(): React.ReactElement {
  const { snapshot, manager, storeState } = useApp();
  const navigation = useNavigation();
  const { run, busy } = useTask();
  const { earbuds, watch } = snapshot;

  const savedEarbuds = latestSaved(storeState.pairedDevices, 'earbuds');
  const savedWatch = latestSaved(storeState.pairedDevices, 'watch');
  const [refreshing, setRefreshing] = React.useState(false);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await Promise.all([
      watch.connected ? run('sync', () => manager.syncWatchAll(), { failure: 'Couldn’t sync your watch' }) : null,
      earbuds.connected ? run('ebinfo', () => manager.refreshEarbudsInfo(), { failure: 'Couldn’t refresh earbuds' }) : null,
    ]);
    setRefreshing(false);
  };

  const connect = (id: string, kind: Kind): void => {
    void run(`connect-${kind}`, () => manager.connectDevice(id), { failure: `Couldn’t connect your ${kind}` });
  };

  const goalSteps = watch.goalSteps > 0 ? watch.goalSteps : 8000;
  const hr = watch.heartRateBpm > 0 && watch.heartRateBpm < 250 ? watch.heartRateBpm : null;

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      {!snapshot.bleAvailable ? (
        <Banner tone="rose" icon="bluetooth-off" text="Bluetooth is off or not allowed. Turn it on to use your devices." />
      ) : null}

      {/* ---------------- Earbuds ---------------- */}
      {earbuds.connected ? (
        <Card onPress={() => navigation.navigate('Tabs', { screen: 'Earbuds' } as never)} accessibilityLabel="Open earbuds">
          <HStack>
            <IconBadge icon="earbuds" tone="cyan" size={48} />
            <View style={styles.flex1}>
              <Text variant="titleMedium" style={styles.title} numberOfLines={1}>
                {earbuds.name || 'Earbuds'}
              </Text>
              <Pill label="Connected" tone="emerald" />
            </View>
          </HStack>
          <HStack style={styles.batteries}>
            <Battery label="Left" percent={earbuds.leftBattery} charging={earbuds.leftCharging} />
            <Battery label="Right" percent={earbuds.rightBattery} charging={earbuds.rightCharging} />
            <Battery label="Case" percent={earbuds.caseBattery} charging={earbuds.caseCharging} />
          </HStack>
          <Text variant="labelLarge" style={[styles.muted, styles.controlLabel]}>
            Noise control
          </Text>
          <ChoiceTiles
            columns={3}
            options={NOISE_OPTIONS}
            value={earbuds.ancMode}
            onChange={(mode) => void run('anc', () => manager.setEarbudsAncMode(mode), { failure: 'Couldn’t change noise control' })}
          />
        </Card>
      ) : (
        <DeviceSetupCard
          kind="earbuds"
          saved={savedEarbuds}
          status={linkStatus(snapshot.keepAlive.earbuds, false, earbuds.connecting)}
          busy={busy('connect-earbuds') || earbuds.connecting}
          onConnect={(id) => connect(id, 'earbuds')}
          onAdd={() => navigation.navigate('AddDevice')}
        />
      )}

      {/* ---------------- Watch ---------------- */}
      {watch.connected ? (
        <Card onPress={() => navigation.navigate('Tabs', { screen: 'Health' } as never)} accessibilityLabel="Open health">
          <HStack>
            <IconBadge icon="watch-variant" tone="indigo" size={48} />
            <View style={styles.flex1}>
              <Text variant="titleMedium" style={styles.title} numberOfLines={1}>
                {watch.name || 'Watch'}
              </Text>
              <HStack gap={8}>
                <Pill label="Connected" tone="emerald" />
                <Battery percent={watch.batteryPercent} />
              </HStack>
            </View>
          </HStack>
          <View style={styles.stepsBlock}>
            <HStack align="flex-end" gap={6}>
              <Text variant="displaySmall" style={styles.title}>
                {formatNumber(watch.steps)}
              </Text>
              <Text variant="titleMedium" style={[styles.muted, styles.unit]}>
                steps
              </Text>
            </HStack>
            <Meter value={watch.steps / goalSteps} tone="emerald" height={10} />
            <HStack style={styles.stepsMeta}>
              <Text variant="bodyMedium" style={[styles.muted, styles.flex1]}>
                Goal {formatNumber(goalSteps)}
              </Text>
              {hr ? (
                <Text variant="bodyMedium" style={styles.muted}>
                  ♥ {hr} bpm
                </Text>
              ) : null}
            </HStack>
          </View>
          {watch.lastSyncedAt ? (
            <Text variant="bodySmall" style={styles.muted}>
              Updated {timeAgo(watch.lastSyncedAt)}
            </Text>
          ) : null}
        </Card>
      ) : (
        <DeviceSetupCard
          kind="watch"
          saved={savedWatch}
          status={linkStatus(snapshot.keepAlive.watch, false, watch.connecting)}
          busy={busy('connect-watch') || watch.connecting}
          onConnect={(id) => connect(id, 'watch')}
          onAdd={() => navigation.navigate('AddDevice')}
        />
      )}

      {/* ---------------- Shortcuts ---------------- */}
      <SectionLabel>Shortcuts</SectionLabel>
      <RowGroup>
        <Row
          icon="volume-high"
          title="Find my earbuds"
          subtitle={earbuds.connected ? 'Play a sound to locate them' : 'Earbuds not connected'}
          disabled={!earbuds.connected}
          onPress={() => navigation.navigate('FindEarbuds')}
          right="chevron"
        />
        <Row
          icon="watch-vibrate"
          tone="indigo"
          title="Find my watch"
          subtitle={watch.connected ? 'Make your watch vibrate' : 'Watch not connected'}
          disabled={!watch.connected}
          onPress={() => void run('findwatch', () => manager.findWatch(), { success: 'Your watch is vibrating', failure: 'Couldn’t reach your watch' })}
        />
        <Row
          icon="heart-pulse"
          tone="rose"
          title="Measure heart rate"
          subtitle={watch.connected ? 'Takes about 30 seconds' : 'Watch not connected'}
          disabled={!watch.connected}
          onPress={() => navigation.navigate('Measure', { kind: 'hr' })}
          right="chevron"
        />
        <Row
          icon="alarm"
          tone="amber"
          title="Alarms"
          subtitle={describeAlarms(watch.alarms.filter((a) => a.enabled).length)}
          onPress={() => navigation.navigate('Alarms')}
          right="chevron"
        />
        <Row icon="plus" tone="emerald" title="Add a device" onPress={() => navigation.navigate('AddDevice')} right="chevron" />
      </RowGroup>
    </Screen>
  );
}

function describeAlarms(on: number): string {
  if (on === 0) return 'No alarms on';
  return on === 1 ? '1 alarm on' : `${on} alarms on`;
}

function DeviceSetupCard({
  kind,
  saved,
  status,
  busy,
  onConnect,
  onAdd,
}: {
  kind: Kind;
  saved: PairedDeviceRecord | null;
  status: { label: string; tone: Tone };
  busy: boolean;
  onConnect: (id: string) => void;
  onAdd: () => void;
}): React.ReactElement {
  const icon = kind === 'earbuds' ? 'earbuds' : 'watch-variant';
  const tone: Tone = kind === 'earbuds' ? 'cyan' : 'indigo';
  if (!saved) {
    return (
      <Card onPress={onAdd} accessibilityLabel={`Add ${kind}`}>
        <HStack>
          <IconBadge icon={icon} tone={tone} size={48} />
          <View style={styles.flex1}>
            <Text variant="titleMedium" style={styles.title}>
              {kind === 'earbuds' ? 'Add your earbuds' : 'Add your watch'}
            </Text>
            <Text variant="bodyMedium" style={styles.muted}>
              {kind === 'earbuds' ? 'Open the case near your phone, then tap here.' : 'Wake your watch near your phone, then tap here.'}
            </Text>
          </View>
        </HStack>
      </Card>
    );
  }
  const last = timeAgo(saved.lastConnectedAt);
  return (
    <Card>
      <HStack>
        <IconBadge icon={icon} tone={tone} size={48} />
        <View style={styles.flex1}>
          <Text variant="titleMedium" style={styles.title} numberOfLines={1}>
            {saved.name}
          </Text>
          <HStack gap={8}>
            <Pill label={status.label} tone={status.tone} />
            {last && !busy ? (
              <Text variant="bodySmall" style={styles.muted}>
                Last seen {last}
              </Text>
            ) : null}
          </HStack>
        </View>
      </HStack>
      <Button
        mode="contained-tonal"
        icon="bluetooth-connect"
        loading={busy}
        disabled={busy}
        onPress={() => onConnect(saved.id)}
        style={styles.connectButton}
        contentStyle={styles.buttonContent}
      >
        {busy ? 'Connecting…' : 'Connect'}
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, gap: 4 },
  title: { color: M3.onSurface },
  muted: { color: M3.onSurfaceVariant },
  batteries: { justifyContent: 'space-between', marginTop: 20, paddingRight: 8 },
  controlLabel: { marginTop: 20, marginBottom: 8 },
  stepsBlock: { marginTop: 16, gap: 8 },
  stepsMeta: { marginTop: 2 },
  unit: { marginBottom: 8 },
  connectButton: { marginTop: 16 },
  buttonContent: { height: 48 },
});
