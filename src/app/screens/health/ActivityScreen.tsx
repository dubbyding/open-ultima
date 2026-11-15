import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { BigStat, Card, HStack, Meter, Muted, Row, RowGroup, Screen, SectionLabel, formatNumber } from '../../ui.tsx';
import { StepChart, formatDistance } from './HealthScreen.tsx';

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function slotLabel(slot: number): string {
  const h = Math.floor(slot / 2);
  const m = slot % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
}

export function ActivityScreen(): React.ReactElement {
  const { snapshot, storeState } = useApp();
  const navigation = useNavigation();
  const watch = snapshot.watch;
  const goal = watch.goalSteps > 0 ? watch.goalSteps : 8000;
  const distance = formatDistance(watch.distanceMeters, watch.imperialUnits);

  const buckets = watch.stepBuckets48;
  const peakIdx = buckets.reduce((best, v, i, arr) => (v > (arr[best] ?? 0) ? i : best), 0);
  const peak = buckets[peakIdx] ?? 0;

  const today = new Date().toISOString().slice(0, 10);
  const week = [...storeState.healthHistory]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 7)
    .map((d) => ({ date: d.date, steps: d.date === today ? Math.max(d.steps, watch.steps) : d.steps }));
  if (!week.some((d) => d.date === today) && watch.steps > 0) week.unshift({ date: today, steps: watch.steps });
  const weekMax = Math.max(goal, ...week.map((d) => d.steps));
  const weekAvg = week.length > 0 ? week.reduce((s, d) => s + d.steps, 0) / week.length : 0;

  return (
    <Screen>
      <Card>
        <Text variant="titleSmall" style={styles.muted}>
          Today
        </Text>
        <BigStat value={formatNumber(watch.steps)} unit="steps" caption={watch.steps >= goal ? 'Goal reached 🎉' : `${formatNumber(goal - watch.steps)} to go`} />
        <View style={styles.gap12}>
          <Meter value={watch.steps / goal} tone={watch.steps >= goal ? 'emerald' : 'cyan'} height={10} />
        </View>
        <HStack gap={24} style={styles.gap16}>
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
      </Card>

      <SectionLabel>Through the day</SectionLabel>
      <Card>
        {buckets.some((v) => v > 0) ? (
          <>
            <StepChart buckets={buckets} height={120} />
            <View style={styles.gap12}>
              <Muted>
                Most active around {slotLabel(peakIdx)} · {formatNumber(peak)} steps in 30 min
              </Muted>
            </View>
          </>
        ) : (
          <Muted>No steps recorded yet today. Pull down on the Health tab to sync your watch.</Muted>
        )}
      </Card>

      {week.length > 0 ? (
        <>
          <SectionLabel>Last 7 days</SectionLabel>
          <Card>
            <View style={styles.week}>
              {week.map((d) => (
                <HStack key={d.date} gap={12}>
                  <Text variant="labelLarge" style={[styles.muted, styles.dayCol]}>
                    {d.date === today ? 'Today' : dayLabel(d.date)}
                  </Text>
                  <View style={styles.flex1}>
                    <Meter value={d.steps / weekMax} tone={d.steps >= goal ? 'emerald' : 'cyan'} height={12} />
                  </View>
                  <Text variant="labelLarge" style={[styles.onSurface, styles.stepsCol]}>
                    {formatNumber(d.steps)}
                  </Text>
                </HStack>
              ))}
            </View>
            <View style={styles.gap12}>
              <Muted>Daily average {formatNumber(weekAvg)} steps</Muted>
            </View>
          </Card>
        </>
      ) : null}

      <RowGroup>
        <Row icon="flag-checkered" tone="emerald" title="Daily step goal" subtitle={`${formatNumber(goal)} steps`} right="chevron" onPress={() => navigation.navigate('WatchSettings')} />
      </RowGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: M3.onSurfaceVariant },
  onSurface: { color: M3.onSurface },
  gap12: { marginTop: 12 },
  gap16: { marginTop: 16 },
  week: { gap: 12 },
  dayCol: { width: 48 },
  stepsCol: { width: 56, textAlign: 'right' },
  flex1: { flex: 1 },
});
