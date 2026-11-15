import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import {
  Card,
  PrimaryButton,
  ProgressBar,
  SectionHeader,
  StatPill,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  batteryColor,
} from '../../shared/theme/tokens.ts';
import type { AccentTone, ActionRunner } from '../../shared/theme/tokens.ts';

export interface ActivitySleepVitalsSectionProps {
  watch: BleManagerSnapshot['watch'];
  manager: UltimaBleManager;
  actions: ActionRunner;
}

export function formatDurationHm(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatDistance(meters: number, imperial: boolean): string {
  if (imperial) return `${(meters / 1609.344).toFixed(2)} mi`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/** Renders daily activity goal & 48-slot histogram, sleep architecture, and live biometric triggers. */
export function ActivitySleepVitalsSection({
  watch,
  manager,
  actions,
}: ActivitySleepVitalsSectionProps): React.ReactElement {
  const connected = watch.connected;
  const settings = watch.settings;
  const goalSteps = Math.max(1000, settings.goalSteps || 8000);
  const stepProgress = watch.steps / goalSteps;

  const buckets48: readonly number[] =
    watch.stepBuckets48.length === 48
      ? watch.stepBuckets48
      : Array.from({ length: 48 }, (_, i) => watch.stepBuckets48[i] ?? 0);
  const maxBucket = Math.max(100, ...buckets48);

  const sleepTotal = Math.max(
    1,
    watch.sleep.totalMinutes ||
      watch.sleep.deepMinutes +
        watch.sleep.lightMinutes +
        watch.sleep.remMinutes +
        watch.sleep.awakeMinutes,
  );

  const sleepStages: ReadonlyArray<{
    label: string;
    minutes: number;
    tone: AccentTone;
    pillLabel: string;
  }> = [
    { label: 'Deep', pillLabel: 'Deep Sleep', minutes: watch.sleep.deepMinutes, tone: 'indigo' },
    { label: 'Light', pillLabel: 'Light Sleep', minutes: watch.sleep.lightMinutes, tone: 'cyan' },
    { label: 'REM', pillLabel: 'REM Sleep', minutes: watch.sleep.remMinutes, tone: 'emerald' },
    { label: 'Awake', pillLabel: 'Awake', minutes: watch.sleep.awakeMinutes, tone: 'amber' },
  ];

  const vitalRows: ReadonlyArray<{
    overline: string;
    valueText: string;
    caption: string;
    buttonLabel: string;
    buttonTone: AccentTone;
    onPress: () => void;
  }> = [
    {
      overline: 'Heart Rate (CMD 0x68)',
      valueText: watch.heartRate.currentBpm > 0 ? `${watch.heartRate.currentBpm} BPM` : '— BPM',
      caption: `Resting ${watch.heartRate.restingBpm || '—'} BPM · ${watch.heartRate.samples24h.length} 24h samples`,
      buttonLabel: watch.heartRate.measuring ? 'Stop HR' : 'Measure HR (0x68)',
      buttonTone: watch.heartRate.measuring ? 'amber' : 'rose',
      onPress: () =>
        actions.run('Heart Rate (0x68)', () =>
          manager.measureWatchHeartRate(!watch.heartRate.measuring),
        ),
    },
    {
      overline: 'Blood Oxygen SpO2 (CMD 0x6B)',
      valueText: watch.spo2.percent > 0 ? `${watch.spo2.percent}%` : '— %',
      caption: watch.spo2.measuring
        ? 'Optical SpO2 acquisition active…'
        : 'Spot arterial oxygen saturation',
      buttonLabel: watch.spo2.measuring ? 'Stop SpO2' : 'Measure SpO2 (0x6B)',
      buttonTone: watch.spo2.measuring ? 'amber' : 'cyan',
      onPress: () =>
        actions.run('SpO2 (0x6B)', () => manager.measureWatchSpO2(!watch.spo2.measuring)),
    },
    {
      overline: 'Blood Pressure (CMD 0x69)',
      valueText:
        watch.bloodPressure.systolic > 0
          ? `${watch.bloodPressure.systolic}/${watch.bloodPressure.diastolic} mmHg`
          : '— / — mmHg',
      caption: 'PPG pulse-wave systolic / diastolic estimate',
      buttonLabel: watch.bloodPressure.measuring ? 'Stop BP' : 'Measure BP (0x69)',
      buttonTone: watch.bloodPressure.measuring ? 'amber' : 'indigo',
      onPress: () =>
        actions.run('Blood Pressure (0x69)', () =>
          manager.measureWatchBloodPressure(!watch.bloodPressure.measuring),
        ),
    },
    {
      overline: 'HRV Stress Score (CMD 0xB9)',
      valueText: watch.stress.score > 0 ? `${watch.stress.score} / 100` : '— / 100',
      caption: `${watch.stress.samples30m.length} half-hour HRV stress slots synced`,
      buttonLabel: 'Query Stress (0xB9)',
      buttonTone: 'emerald',
      onPress: () => actions.run('Stress Query (0xB9)', () => manager.queryWatchStress()),
    },
  ];

  return (
    <>
      <Card style={SHARED_LAYOUT_STYLES.sectionGap} tone={connected ? 'indigo' : undefined}>
        <View style={styles.cardTopRow}>
          <View>
            <Text style={TYPOGRAPHY.overline}>Daily Activity vs Goal</Text>
            <Text style={TYPOGRAPHY.metricValue}>
              {watch.steps.toLocaleString()} / {goalSteps.toLocaleString()} steps
            </Text>
          </View>
          <Text style={[styles.batteryBadge, { color: batteryColor(watch.batteryPercent) }]}>
            🔋 {watch.batteryPercent}%
          </Text>
        </View>
        <ProgressBar
          progress={stepProgress}
          tone={stepProgress >= 1 ? 'emerald' : 'cyan'}
          height={10}
          style={styles.goalBar}
        />
        <View style={SHARED_LAYOUT_STYLES.statGrid}>
          <StatPill
            label="Distance"
            value={formatDistance(watch.distanceMeters, settings.imperialUnits)}
            tone="cyan"
          />
          <StatPill label="Calories" value={`${watch.caloriesKcal} kcal`} tone="amber" />
          <StatPill
            label="Goal Progress"
            value={`${Math.round(Math.min(999, stepProgress * 100))}%`}
            tone="emerald"
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <View style={styles.cardTopRow}>
          <Text style={TYPOGRAPHY.overline}>
            48-Slot Half-Hour Step Distribution (00:00 – 23:30)
          </Text>
          <Text style={TYPOGRAPHY.caption}>Peak {maxBucket} steps/30m</Text>
        </View>
        <View style={styles.chartBox}>
          <View style={styles.chartBarsRow}>
            {buckets48.map((val, idx) => {
              const heightPct = (
                val > 0 ? Math.max(10, Math.round((val / maxBucket) * 100)) : 4
              ) as number;
              return (
                <View key={idx} style={styles.chartBarTrack}>
                  <View
                    style={[
                      styles.chartBarFill,
                      {
                        height: `${heightPct}%` as `${number}%`,
                        backgroundColor:
                          val > maxBucket * 0.65
                            ? COLORS.emerald
                            : val > 0
                              ? COLORS.cyan
                              : COLORS.borderStrong,
                      },
                    ]}
                  />
                </View>
              );
            })}
          </View>
          <View style={styles.chartAxisRow}>
            {['00:00', '06:00', '12:00', '18:00', '23:30'].map((t) => (
              <Text key={t} style={TYPOGRAPHY.caption}>
                {t}
              </Text>
            ))}
          </View>
        </View>
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Sleep Architecture (0x53 / 0x67)"
        title={`Total Sleep: ${formatDurationHm(watch.sleep.totalMinutes)}`}
        subtitle={
          watch.sleep.napMinutes > 0
            ? `Includes ${watch.sleep.napMinutes}m daytime nap · ${watch.sleep.segments.length} stages decoded`
            : `${watch.sleep.segments.length} sleep stage segments decoded`
        }
      />
      <Card>
        <View style={SHARED_LAYOUT_STYLES.statGrid}>
          {sleepStages.map((stage) => (
            <StatPill
              key={stage.pillLabel}
              label={stage.pillLabel}
              value={formatDurationHm(stage.minutes)}
              tone={stage.tone}
            />
          ))}
        </View>
        <View style={styles.sleepStageBars}>
          {sleepStages.map((stage) => (
            <View key={stage.label} style={styles.sleepStageRow}>
              <Text style={styles.sleepStageLabel}>{stage.label}</Text>
              <View style={SHARED_LAYOUT_STYLES.flexOne}>
                <ProgressBar progress={stage.minutes / sleepTotal} tone={stage.tone} height={7} />
              </View>
              <Text style={styles.sleepStageMin}>{stage.minutes}m</Text>
            </View>
          ))}
        </View>
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Optical Biometrics"
        title="Live Vitals Triggers"
        subtitle="Direct CRREPA GATT commands: HR 0x68 · SpO2 0x6B · BP 0x69 · Stress 0xB9"
      />
      <Card style={styles.vitalsStack}>
        {vitalRows.map((row, idx) => (
          <React.Fragment key={row.overline}>
            {idx > 0 ? <View style={SHARED_LAYOUT_STYLES.divider} /> : null}
            <View style={styles.vitalRow}>
              <View style={SHARED_LAYOUT_STYLES.flexOne}>
                <Text style={TYPOGRAPHY.overline}>{row.overline}</Text>
                <Text style={TYPOGRAPHY.metricValue}>{row.valueText}</Text>
                <Text style={TYPOGRAPHY.caption}>{row.caption}</Text>
              </View>
              <PrimaryButton
                label={row.buttonLabel}
                tone={row.buttonTone}
                compact
                disabled={!connected}
                onPress={row.onPress}
              />
            </View>
          </React.Fragment>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  batteryBadge: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  goalBar: { marginVertical: SPACING.md },
  chartBox: {
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    backgroundColor: COLORS.surfaceWell,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.xs,
  },
  chartBarsRow: { height: 76, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  chartBarTrack: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  chartBarFill: { width: '100%', borderRadius: 2 },
  chartAxisRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sleepStageBars: { gap: SPACING.sm, marginTop: SPACING.md },
  sleepStageRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  sleepStageLabel: { width: 48, fontSize: 12, color: COLORS.textSecondary },
  sleepStageMin: {
    width: 46,
    textAlign: 'right',
    fontSize: 11,
    fontFamily: TYPOGRAPHY.mono.fontFamily,
    color: COLORS.textPrimary,
  },
  vitalsStack: { gap: SPACING.xs },
  vitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
});
