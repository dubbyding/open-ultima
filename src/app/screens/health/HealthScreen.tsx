import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';

import { M3, getTonePalette } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import {
  Banner,
  BigStat,
  Card,
  EmptyState,
  HStack,
  Meter,
  Muted,
  Row,
  RowGroup,
  Screen,
  SectionLabel,
  StatTile,
  formatMinutes,
  formatNumber,
  timeAgo,
  useTask,
} from '../../ui.tsx';
import type { Tone } from '../../ui.tsx';

// ---------------------------------------------------------------------------
// Shared health helpers (used by the other health screens)
// ---------------------------------------------------------------------------

export function validBpm(bpm: number | null | undefined): number | null {
  return bpm != null && bpm > 0 && bpm < 250 ? Math.round(bpm) : null;
}

export function validSpo2(p: number | null | undefined): number | null {
  return p != null && p > 0 && p <= 100 ? Math.round(p) : null;
}

export function formatDistance(meters: number, imperial: boolean): { value: string; unit: string } {
  if (imperial) return { value: (meters / 1609.344).toFixed(2), unit: 'mi' };
  return { value: (meters / 1000).toFixed(2), unit: 'km' };
}

export const SLEEP_STAGES: readonly { key: 'deep' | 'light' | 'rem' | 'awake'; label: string; tone: Tone }[] = [
  { key: 'deep', label: 'Deep', tone: 'indigo' },
  { key: 'light', label: 'Light', tone: 'cyan' },
  { key: 'rem', label: 'REM', tone: 'emerald' },
  { key: 'awake', label: 'Awake', tone: 'amber' },
];

/** Horizontal stacked bar of sleep stages with a legend underneath. */
export function SleepStageBar({
  minutes,
  showLegend = true,
}: {
  minutes: Record<'deep' | 'light' | 'rem' | 'awake', number>;
  showLegend?: boolean;
}): React.ReactElement {
  const total = SLEEP_STAGES.reduce((s, st) => s + Math.max(0, minutes[st.key]), 0);
  return (
    <View style={styles.stageWrap}>
      <View style={styles.stageBar}>
        {total > 0 ? (
          SLEEP_STAGES.map((st) =>
            minutes[st.key] > 0 ? (
              <View key={st.key} style={{ flex: minutes[st.key], backgroundColor: getTonePalette(st.tone).fg }} />
            ) : null,
          )
        ) : (
          <View style={{ flex: 1, backgroundColor: M3.surfaceContainerHighest }} />
        )}
      </View>
      {showLegend ? (
        <View style={styles.legend}>
          {SLEEP_STAGES.map((st) => (
            <HStack key={st.key} gap={6}>
              <View style={[styles.legendDot, { backgroundColor: getTonePalette(st.tone).fg }]} />
              <Text variant="labelMedium" style={styles.muted}>
                {st.label} {formatMinutes(minutes[st.key])}
              </Text>
            </HStack>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 48 half-hour step buckets as simple vertical bars. */
export function StepChart({ buckets, height = 72 }: { buckets: readonly number[]; height?: number }): React.ReactElement {
  const data = Array.from({ length: 48 }, (_, i) => Math.max(0, buckets[i] ?? 0));
  const max = Math.max(1, ...data);
  return (
    <View>
      <View style={[styles.chart, { height }]}>
        {data.map((v, i) => (
          <View key={i} style={styles.chartCol}>
            <View
              style={{
                height: v > 0 ? Math.max(3, (v / max) * height) : 2,
                borderRadius: 2,
                backgroundColor: v > 0 ? M3.primary : M3.surfaceContainerHighest,
              }}
            />
          </View>
        ))}
      </View>
      <View style={styles.chartLabels}>
        {['00', '06', '12', '18', '24'].map((l) => (
          <Text key={l} variant="labelSmall" style={styles.muted}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Saved watch to reconnect to, most recent first. */
export function useSavedWatchId(): string | null {
  const { storeState } = useApp();
  return React.useMemo(() => {
    const watches = storeState.pairedDevices.filter((d) => d.kind === 'watch');
    watches.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
    return watches[0]?.id ?? null;
  }, [storeState.pairedDevices]);
}

// ---------------------------------------------------------------------------

export function HealthScreen(): React.ReactElement {
  const { snapshot, manager } = useApp();
  const navigation = useNavigation();
  const { run, busy } = useTask();
  const savedWatchId = useSavedWatchId();
  const watch = snapshot.watch;

  const hasData =
    watch.steps > 0 ||
    watch.sleep.totalMinutes > 0 ||
    validBpm(watch.heartRate.currentBpm) !== null ||
    watch.stepBuckets48.some((v) => v > 0) ||
    watch.lastSyncedAt !== null;

  const reconnect = (): void => {
    if (savedWatchId) {
      void run('connect', () => manager.connectDevice(savedWatchId), { failure: 'Couldn’t connect to your watch' });
    } else {
      navigation.navigate('AddDevice');
    }
  };

  if (!watch.connected && !hasData) {
    return (
      <Screen>
        <EmptyState
          icon="watch-variant"
          title="Connect your watch"
          body="See your steps, sleep, heart rate and more once your Ultima watch is connected."
          action={{
            label: watch.connecting ? 'Connecting…' : savedWatchId ? 'Reconnect watch' : 'Add a watch',
            icon: savedWatchId ? 'bluetooth-connect' : 'plus',
            onPress: reconnect,
            loading: watch.connecting || busy('connect'),
          }}
          secondary={savedWatchId ? { label: 'Add a different watch', onPress: () => navigation.navigate('AddDevice') } : undefined}
        />
      </Screen>
    );
  }

  const goal = watch.goalSteps > 0 ? watch.goalSteps : 8000;
  const distance = formatDistance(watch.distanceMeters, watch.imperialUnits);
  const bpm = validBpm(watch.heartRate.currentBpm);
  const spo2 = validSpo2(watch.spo2.percent);
  const bp = watch.bloodPressure.systolic > 0 && watch.bloodPressure.diastolic > 0 && watch.bloodPressure.systolic < 255
    ? `${watch.bloodPressure.systolic}/${watch.bloodPressure.diastolic}`
    : null;
  const stress = watch.stress.score > 0 && watch.stress.score <= 100 ? watch.stress.score : null;
  const updated = timeAgo(watch.lastSyncedAt);
  const sleep = watch.sleep;

  return (
    <Screen
      refreshing={busy('sync')}
      onRefresh={watch.connected ? () => void run('sync', () => manager.syncWatchAll(), { failure: 'Couldn’t sync your watch' }) : undefined}
    >
      {!watch.connected ? (
        <Banner
          tone="amber"
          icon="watch-vibrate-off"
          text={watch.connecting ? 'Connecting to your watch…' : `Watch not connected. Showing data from ${updated ?? 'earlier'}.`}
          action={watch.connecting ? undefined : { label: 'Reconnect', onPress: reconnect }}
        />
      ) : updated ? (
        <Muted>Updated {updated} · pull down to sync</Muted>
      ) : null}

      <Card onPress={() => navigation.navigate('Activity')} accessibilityLabel="Today's activity">
        <Text variant="titleSmall" style={styles.muted}>
          Today
        </Text>
        <BigStat value={formatNumber(watch.steps)} unit="steps" caption={`of ${formatNumber(goal)} goal`} />
        <View style={styles.meterGap}>
          <Meter value={watch.steps / goal} tone={watch.steps >= goal ? 'emerald' : 'cyan'} height={10} />
        </View>
        <HStack gap={24} style={styles.subStats}>
          <View>
            <Text variant="titleMedium" style={styles.onSurface}>
              {distance.value} {distance.unit}
            </Text>
            <Muted>Distance</Muted>
          </View>
          <View>
            <Text variant="titleMedium" style={styles.onSurface}>
              {formatNumber(watch.caloriesKcal)} kcal
            </Text>
            <Muted>Calories</Muted>
          </View>
        </HStack>
        {watch.stepBuckets48.some((v) => v > 0) ? (
          <View style={styles.chartGap}>
            <StepChart buckets={watch.stepBuckets48} height={48} />
          </View>
        ) : null}
      </Card>

      <SectionLabel>Vitals</SectionLabel>
      <HStack gap={12} align="stretch">
        <StatTile icon="heart-pulse" tone="rose" value={bpm !== null ? String(bpm) : '—'} unit={bpm !== null ? 'bpm' : undefined} label="Heart rate" onPress={() => navigation.navigate('Measure', { kind: 'hr' })} />
        <StatTile icon="water-percent" tone="cyan" value={spo2 !== null ? String(spo2) : '—'} unit={spo2 !== null ? '%' : undefined} label="Blood oxygen" onPress={() => navigation.navigate('Measure', { kind: 'spo2' })} />
      </HStack>
      <HStack gap={12} align="stretch">
        <StatTile icon="gauge" tone="indigo" value={bp ?? '—'} unit={bp ? 'mmHg' : undefined} label="Blood pressure" onPress={() => navigation.navigate('Measure', { kind: 'bp' })} />
        <StatTile icon="head-heart-outline" tone="amber" value={stress !== null ? String(stress) : '—'} label="Stress" onPress={() => navigation.navigate('Measure', { kind: 'stress' })} />
      </HStack>

      <SectionLabel>Sleep</SectionLabel>
      <Card onPress={() => navigation.navigate('Sleep')} accessibilityLabel="Sleep details">
        {sleep.totalMinutes > 0 ? (
          <>
            <BigStat value={formatMinutes(sleep.totalMinutes)} caption="Last night" />
            <View style={styles.chartGap}>
              <SleepStageBar minutes={{ deep: sleep.deepMinutes, light: sleep.lightMinutes, rem: sleep.remMinutes, awake: sleep.awakeMinutes }} />
            </View>
          </>
        ) : (
          <Muted>No sleep recorded yet. Wear your watch to bed to track your sleep.</Muted>
        )}
      </Card>

      <SectionLabel>More</SectionLabel>
      <RowGroup>
        <Row icon="run" tone="emerald" title="Workouts" subtitle={watch.gpsRoutes.length > 0 ? `${watch.gpsRoutes.length} saved` : 'Outdoor routes from your watch'} right="chevron" onPress={() => navigation.navigate('Workouts')} />
        <Row icon="chart-bar" tone="cyan" title="Activity history" subtitle="Steps over the last week" right="chevron" onPress={() => navigation.navigate('Activity')} />
      </RowGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: M3.onSurfaceVariant },
  onSurface: { color: M3.onSurface },
  meterGap: { marginTop: 12 },
  subStats: { marginTop: 16 },
  chartGap: { marginTop: 16 },
  stageWrap: { gap: 12 },
  stageBar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  chartCol: { flex: 1, justifyContent: 'flex-end' },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
