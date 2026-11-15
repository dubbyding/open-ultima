import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';

import { M3, getTonePalette } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import type { RootStackParamList, VitalKind } from '../../routes.ts';
import { Banner, Card, HStack, IconBadge, Muted, Screen, SectionLabel, useTask } from '../../ui.tsx';
import type { Tone } from '../../ui.tsx';
import { useSavedWatchId, validBpm, validSpo2 } from './HealthScreen.tsx';

interface VitalMeta {
  icon: string;
  tone: Tone;
  unit: string;
  how: string;
  range: string;
  /** One-shot query (no start/stop). */
  oneShot?: boolean;
}

const META: Record<VitalKind, VitalMeta> = {
  hr: {
    icon: 'heart-pulse',
    tone: 'rose',
    unit: 'bpm',
    how: 'Sit still, keep your watch snug just above the wrist bone, and don’t talk. It takes about 30 seconds.',
    range: 'A typical resting heart rate for adults is 60–100 bpm.',
  },
  spo2: {
    icon: 'water-percent',
    tone: 'cyan',
    unit: '%',
    how: 'Rest your arm on a table, keep your watch snug and stay still. It takes about 30 seconds.',
    range: 'Healthy blood oxygen is usually 95–100%.',
  },
  bp: {
    icon: 'gauge',
    tone: 'indigo',
    unit: 'mmHg',
    how: 'Sit with your arm at heart level and stay still and quiet. It takes about a minute.',
    range: 'Normal blood pressure is below 120/80 mmHg. Watch readings are estimates, not medical measurements.',
  },
  stress: {
    icon: 'head-heart-outline',
    tone: 'amber',
    unit: '',
    how: 'Your watch estimates stress from your heart rhythm. Check it while resting for the most useful reading.',
    range: '0–29 relaxed · 30–59 normal · 60–79 medium · 80–100 high.',
    oneShot: true,
  },
};

function stressLabel(score: number): string {
  if (score < 30) return 'Relaxed';
  if (score < 60) return 'Normal';
  if (score < 80) return 'Medium';
  return 'High';
}

export function MeasureScreen(): React.ReactElement {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Measure'>>();
  const kind: VitalKind = params?.kind ?? 'hr';
  const meta = META[kind];
  const { snapshot, manager } = useApp();
  const { run, busy } = useTask();
  const savedWatchId = useSavedWatchId();
  const watch = snapshot.watch;

  let value: string | null = null;
  let measuring = false;
  let history: number[] = [];
  let caption: string | null = null;
  switch (kind) {
    case 'hr': {
      const v = validBpm(watch.heartRate.currentBpm);
      value = v !== null ? String(v) : null;
      measuring = watch.heartRate.measuring;
      history = watch.heartRate.samples24h.filter((x) => validBpm(x) !== null);
      break;
    }
    case 'spo2': {
      const v = validSpo2(watch.spo2.percent);
      value = v !== null ? String(v) : null;
      measuring = watch.spo2.measuring;
      history = watch.spo2.samples24h.filter((x) => validSpo2(x) !== null);
      break;
    }
    case 'bp': {
      const { systolic, diastolic } = watch.bloodPressure;
      value = systolic > 0 && diastolic > 0 && systolic < 255 ? `${systolic}/${diastolic}` : null;
      measuring = watch.bloodPressure.measuring;
      break;
    }
    case 'stress': {
      const s = watch.stress.score;
      value = s > 0 && s <= 100 ? String(s) : null;
      caption = value !== null ? stressLabel(s) : null;
      history = watch.stress.samples30m.filter((x) => x > 0 && x <= 100);
      measuring = busy('measure');
      break;
    }
  }

  const toggle = (): void => {
    const start = !measuring;
    void run(
      'measure',
      () => {
        switch (kind) {
          case 'hr':
            return manager.measureWatchHeartRate(start);
          case 'spo2':
            return manager.measureWatchSpO2(start);
          case 'bp':
            return manager.measureWatchBloodPressure(start);
          case 'stress':
            return manager.queryWatchStress();
        }
      },
      { failure: start ? 'Couldn’t start the measurement' : 'Couldn’t stop the measurement' },
    );
  };

  const palette = getTonePalette(meta.tone);
  const recent = history.slice(-10).reverse();

  return (
    <Screen>
      {!watch.connected ? (
        <Banner
          tone="amber"
          icon="watch-vibrate-off"
          text="Connect your watch to take a measurement."
          action={savedWatchId && !watch.connecting ? { label: 'Connect', onPress: () => void run('connect', () => manager.connectDevice(savedWatchId), { failure: 'Couldn’t connect' }) } : undefined}
        />
      ) : null}

      <Card>
        <View style={styles.hero}>
          <IconBadge icon={meta.icon} tone={meta.tone} size={64} />
          {measuring ? (
            <View style={styles.measuring}>
              <ActivityIndicator size="large" color={palette.fg} />
              <Text variant="titleMedium" style={styles.onSurface}>
                Measuring…
              </Text>
              <Muted center>Stay still until the result appears.</Muted>
            </View>
          ) : (
            <View style={styles.valueBlock}>
              <HStack gap={6} align="flex-end">
                <Text variant="displayMedium" style={[styles.value, { color: value ? M3.onSurface : M3.onSurfaceVariant }]}>
                  {value ?? '—'}
                </Text>
                {value && meta.unit ? (
                  <Text variant="titleLarge" style={[styles.muted, styles.unit]}>
                    {meta.unit}
                  </Text>
                ) : null}
              </HStack>
              <Muted center>{caption ?? (value ? 'Latest reading' : 'No reading yet')}</Muted>
            </View>
          )}
        </View>
        <Button
          mode={measuring && !meta.oneShot ? 'contained-tonal' : 'contained'}
          icon={measuring && !meta.oneShot ? 'stop' : 'play'}
          onPress={toggle}
          disabled={!watch.connected || (meta.oneShot && measuring)}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          {meta.oneShot ? (measuring ? 'Checking…' : 'Check now') : measuring ? 'Stop' : 'Start measuring'}
        </Button>
      </Card>

      <SectionLabel>How to measure</SectionLabel>
      <Card>
        <Text variant="bodyMedium" style={styles.onSurface}>
          {meta.how}
        </Text>
        <View style={styles.rangeGap}>
          <Muted>{meta.range}</Muted>
        </View>
      </Card>

      {recent.length > 0 ? (
        <>
          <SectionLabel>Earlier today</SectionLabel>
          <Card>
            <View style={styles.history}>
              {recent.map((v, i) => (
                <View key={i} style={[styles.historyChip, { backgroundColor: palette.bg }]}>
                  <Text variant="labelLarge" style={{ color: palette.fg }}>
                    {v}
                    {meta.unit ? ` ${meta.unit}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 16, paddingVertical: 12 },
  measuring: { alignItems: 'center', gap: 8, minHeight: 96, justifyContent: 'center' },
  valueBlock: { alignItems: 'center', minHeight: 96, justifyContent: 'center' },
  value: { fontWeight: '600' },
  unit: { marginBottom: 10 },
  muted: { color: M3.onSurfaceVariant },
  onSurface: { color: M3.onSurface },
  button: { marginTop: 16 },
  buttonContent: { height: 52 },
  rangeGap: { marginTop: 12 },
  history: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  historyChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
});
