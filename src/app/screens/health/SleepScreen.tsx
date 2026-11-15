import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { M3, getTonePalette } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { BigStat, Card, EmptyState, HStack, IconBadge, Muted, Row, RowGroup, Screen, SectionLabel, formatMinutes } from '../../ui.tsx';
import type { Tone } from '../../ui.tsx';
import { SLEEP_STAGES, SleepStageBar } from './HealthScreen.tsx';

/** Watch sleep state codes → stage tone (0 awake, 1 light, 2 deep, 3 REM). */
function segmentTone(state: number): Tone {
  switch (state) {
    case 1:
      return 'cyan';
    case 2:
      return 'indigo';
    case 3:
      return 'emerald';
    default:
      return 'amber';
  }
}

function clock(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function SleepScreen(): React.ReactElement {
  const { snapshot, storeState } = useApp();
  const sleep = snapshot.watch.sleep;
  const minutes = { deep: sleep.deepMinutes, light: sleep.lightMinutes, rem: sleep.remMinutes, awake: sleep.awakeMinutes };
  const segments = sleep.segments.filter((s) => s.durationMinutes > 0);
  const first = segments[0];
  const last = segments[segments.length - 1];

  const nights = [...storeState.healthHistory]
    .map((d) => ({ date: d.date, total: d.deepSleepMin + d.lightSleepMin + d.remSleepMin, deep: d.deepSleepMin }))
    .filter((n) => n.total > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 14);

  if (sleep.totalMinutes <= 0 && nights.length === 0) {
    return (
      <Screen>
        <EmptyState icon="sleep" title="No sleep data yet" body="Wear your watch to bed. Your sleep will show up here after your watch syncs in the morning." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text variant="titleSmall" style={styles.muted}>
          Last night
        </Text>
        <BigStat value={formatMinutes(sleep.totalMinutes)} caption={first && last ? `${clock(first.startHour, first.startMinute)} – ${clock(last.endHour, last.endMinute)}` : undefined} />
        <View style={styles.gap}>
          <SleepStageBar minutes={minutes} showLegend={false} />
        </View>
      </Card>

      {segments.length > 0 ? (
        <>
          <SectionLabel>Timeline</SectionLabel>
          <Card>
            <View style={styles.timeline}>
              {segments.map((s, i) => (
                <View key={i} style={{ flex: s.durationMinutes, backgroundColor: getTonePalette(segmentTone(s.state)).fg }} />
              ))}
            </View>
            {first && last ? (
              <HStack style={styles.timelineLabels}>
                <Muted>{clock(first.startHour, first.startMinute)}</Muted>
                <View style={styles.flex1} />
                <Muted>{clock(last.endHour, last.endMinute)}</Muted>
              </HStack>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionLabel>Stages</SectionLabel>
      <RowGroup>
        {SLEEP_STAGES.map((st) => {
          const pct = sleep.totalMinutes > 0 ? Math.round((minutes[st.key] / (sleep.totalMinutes + sleep.awakeMinutes)) * 100) : 0;
          return (
            <Row
              key={st.key}
              title={st.label}
              subtitle={`${pct}% of the night`}
              right={
                <HStack gap={8}>
                  <Text variant="titleMedium" style={styles.onSurface}>
                    {formatMinutes(minutes[st.key])}
                  </Text>
                  <View style={[styles.dot, { backgroundColor: getTonePalette(st.tone).fg }]} />
                </HStack>
              }
            />
          );
        })}
      </RowGroup>

      {sleep.napMinutes > 0 ? (
        <Card>
          <HStack>
            <IconBadge icon="weather-sunny" tone="amber" />
            <View style={styles.flex1}>
              <Text variant="bodyLarge" style={styles.onSurface}>
                Naps
              </Text>
              <Muted>{formatMinutes(sleep.napMinutes)} today</Muted>
            </View>
          </HStack>
        </Card>
      ) : null}

      {nights.length > 0 ? (
        <>
          <SectionLabel>Previous nights</SectionLabel>
          <RowGroup>
            {nights.map((n) => (
              <Row key={n.date} title={formatDate(n.date)} subtitle={`Deep ${formatMinutes(n.deep)}`} right={formatMinutes(n.total)} />
            ))}
          </RowGroup>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: M3.onSurfaceVariant },
  onSurface: { color: M3.onSurface },
  gap: { marginTop: 16 },
  timeline: { flexDirection: 'row', height: 40, borderRadius: 8, overflow: 'hidden', gap: 1 },
  timelineLabels: { marginTop: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  flex1: { flex: 1 },
});
