import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { STORAGE_BACKEND_TYPE } from '../../../storage/offlineStore.ts';
import type { HealthAggregates, StorageBackendType } from '../../../storage/offlineStore.ts';
import { M3, MONO_FONT } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, HStack, Muted, Pill, Row, RowGroup, Screen, SectionLabel, StatTile, formatMinutes, formatNumber } from '../../ui.tsx';

function engineLabel(t: StorageBackendType): string {
  switch (t) {
    case STORAGE_BACKEND_TYPE.EXPO_SQLITE:
      return 'expo-sqlite';
    case STORAGE_BACKEND_TYPE.NODE_SQLITE:
      return 'node:sqlite';
    case STORAGE_BACKEND_TYPE.ASYNC_STORAGE:
      return 'AsyncStorage';
    default:
      return 'In-memory';
  }
}

/** Developer view of the local database: engine, table sizes, health aggregates. */
export function DatabaseScreen(): React.ReactElement {
  const { store, storeState } = useApp();
  const info = store.getStorageEngineInfo();
  const [counts, setCounts] = React.useState<Record<string, number> | null>(null);
  const [aggs, setAggs] = React.useState<HealthAggregates | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const db = store.getSqliteDb();
        const [c, a] = await Promise.all([db ? db.getTableRowCounts() : Promise.resolve(null), store.queryHealthAggregates()]);
        if (!cancelled) {
          setCounts(c);
          setAggs(a);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, storeState, tick]);

  return (
    <Screen>
      <Card>
        <HStack>
          <View style={styles.flex}>
            <Text variant="titleMedium" style={styles.onSurface}>
              {engineLabel(info.backendType)}
            </Text>
            <Muted>{info.relationalTablesActive ? 'Relational tables active' : 'Key-value fallback'}</Muted>
          </View>
          <Pill label={info.relationalTablesActive ? 'Tables' : 'KV'} tone={info.relationalTablesActive ? 'emerald' : 'neutral'} />
        </HStack>
        <Button mode="contained-tonal" icon="refresh" loading={loading} onPress={() => setTick((t) => t + 1)} style={styles.refresh}>
          Refresh
        </Button>
      </Card>
      {error ? <Banner tone="rose" icon="alert-circle-outline" text={error} /> : null}

      {counts ? (
        <>
          <SectionLabel>Tables</SectionLabel>
          <RowGroup>
            {Object.entries(counts).map(([table, n]) => (
              <Row key={table} title={table} right={<Text style={styles.mono}>{formatNumber(n)}</Text>} />
            ))}
          </RowGroup>
        </>
      ) : null}

      <SectionLabel>Health totals</SectionLabel>
      <HStack gap={8}>
        <StatTile icon="calendar" label="Days logged" value={String(aggs?.daysCount ?? storeState.healthHistory.length)} />
        <StatTile icon="walk" tone="emerald" label="Avg steps" value={formatNumber(aggs?.avgSteps ?? 0)} />
      </HStack>
      <HStack gap={8}>
        <StatTile icon="sleep" tone="indigo" label="Avg sleep" value={formatMinutes(aggs?.avgSleepMin ?? 0)} />
        <StatTile icon="heart-pulse" tone="rose" label="Avg resting HR" value={String(Math.round(aggs?.avgRestingHr ?? 0))} unit="bpm" />
      </HStack>
      <HStack gap={8}>
        <StatTile icon="water-percent" label="Avg SpO₂" value={(aggs?.avgSpo2Percent ?? 0).toFixed(1)} unit="%" />
        <StatTile icon="fire" tone="amber" label="Total calories" value={formatNumber(aggs?.totalCaloriesKcal ?? 0)} unit="kcal" />
      </HStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  onSurface: { color: M3.onSurface },
  refresh: { marginTop: 12, alignSelf: 'flex-start' },
  mono: { fontFamily: MONO_FONT, color: M3.onSurfaceVariant },
});
