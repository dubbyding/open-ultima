import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  IMPORT_MODE,
  STORAGE_BACKEND_TYPE,
} from '../../../storage/offlineStore.ts';
import type {
  HealthAggregates,
  ImportJsonResult,
  ImportMode,
  OfflineAppState,
  OfflineStore,
  StorageBackendType,
} from '../../../storage/offlineStore.ts';
import { SQLITE_TABLE_NAMES } from '../../../storage/sqliteEngine.ts';
import {
  ActionChip,
  Card,
  Notice,
  OfflineBadge,
  PrimaryButton,
  SectionHeader,
  StatPill,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
} from '../../shared/theme/tokens.ts';
import type { AccentTone, ActionRunner } from '../../shared/theme/tokens.ts';

export interface SqliteAndBackupSectionProps {
  store: OfflineStore;
  storeState: OfflineAppState;
  actions: ActionRunner;
  onStoreChanged: () => void;
}

function storageEngineBadge(backendType: StorageBackendType): {
  label: string;
  tone: AccentTone;
} {
  switch (backendType) {
    case STORAGE_BACKEND_TYPE.EXPO_SQLITE:
      return { label: 'Engine: expo-sqlite', tone: 'emerald' };
    case STORAGE_BACKEND_TYPE.NODE_SQLITE:
      return { label: 'Engine: node:sqlite', tone: 'cyan' };
    case STORAGE_BACKEND_TYPE.ASYNC_STORAGE:
      return { label: 'Engine: AsyncStorage', tone: 'indigo' };
    case STORAGE_BACKEND_TYPE.MEMORY:
    default:
      return { label: 'Engine: In-Memory', tone: 'amber' };
  }
}

/** Renders SQLite relational diagnostics, SQL aggregate stats, and offline JSON/CSV backup tools. */
export function SqliteAndBackupSection({
  store,
  storeState,
  actions,
  onStoreChanged,
}: SqliteAndBackupSectionProps): React.ReactElement {
  const [importMode, setImportMode] = React.useState<ImportMode>(IMPORT_MODE.MERGE);
  const [archiveBuffer, setArchiveBuffer] = React.useState<string>('');
  const [csvOutput, setCsvOutput] = React.useState<string>('');
  const [importResult, setImportResult] = React.useState<ImportJsonResult | null>(null);

  const engineInfo = store.getStorageEngineInfo();
  const engineBadge = storageEngineBadge(engineInfo.backendType);
  const [tableCounts, setTableCounts] = React.useState<Record<string, number> | null>(null);
  const [healthAggregates, setHealthAggregates] = React.useState<HealthAggregates | null>(null);
  const [sqlStatsError, setSqlStatsError] = React.useState<string | null>(null);
  const [sqlRefreshTick, setSqlRefreshTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const loadSqlDiagnostics = async (): Promise<void> => {
      try {
        const sqliteDb = store.getSqliteDb();
        const [counts, aggs] = await Promise.all([
          sqliteDb ? sqliteDb.getTableRowCounts() : Promise.resolve(null),
          store.queryHealthAggregates(),
        ]);
        if (!cancelled) {
          setTableCounts(counts);
          setHealthAggregates(aggs);
          setSqlStatsError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setSqlStatsError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void loadSqlDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [store, storeState, sqlRefreshTick]);

  const handleImportJson = (): void => {
    actions.run(`Import JSON (${importMode})`, async () => {
      const result = await store.tryImportJson(archiveBuffer, { mode: importMode });
      setImportResult(result);
      onStoreChanged();
      if (!result.ok) throw new Error(result.errors.join('; ') || 'Validation failed');
    });
  };

  const aggregatePills: ReadonlyArray<{ label: string; value: string; tone: AccentTone }> = [
    {
      label: 'Days Logged',
      value: String(healthAggregates?.daysCount ?? storeState.healthHistory.length),
      tone: 'cyan',
    },
    { label: 'Total Steps', value: String(Math.round(healthAggregates?.totalSteps ?? 0)), tone: 'emerald' },
    { label: 'Avg Steps/Day', value: String(Math.round(healthAggregates?.avgSteps ?? 0)), tone: 'emerald' },
    {
      label: 'Total Calories',
      value: `${Math.round(healthAggregates?.totalCaloriesKcal ?? 0)} kcal`,
      tone: 'amber',
    },
    { label: 'Avg Sleep', value: `${Math.round(healthAggregates?.avgSleepMin ?? 0)} min`, tone: 'indigo' },
    { label: 'Avg Resting HR', value: `${Math.round(healthAggregates?.avgRestingHr ?? 0)} bpm`, tone: 'rose' },
    { label: 'Avg SpO2', value: `${(healthAggregates?.avgSpo2Percent ?? 0).toFixed(1)}%`, tone: 'cyan' },
    { label: 'Avg Stress', value: String(Math.round(healthAggregates?.avgStressScore ?? 0)), tone: 'amber' },
  ];

  const backupCounts: ReadonlyArray<{ label: string; value: number; tone: AccentTone }> = [
    { label: 'Paired Devices', value: storeState.pairedDevices.length, tone: 'cyan' },
    { label: 'Custom EQs', value: storeState.customEqProfiles.length, tone: 'emerald' },
    { label: 'Health Days', value: storeState.healthHistory.length, tone: 'indigo' },
    { label: 'Watch Alarms', value: storeState.watchAlarms.length, tone: 'amber' },
  ];

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Local Relational Database"
        title="SQLite Engine & Relational Tables"
        subtitle={
          engineInfo.relationalTablesActive
            ? 'Normalized SQLite tables, indexes, foreign keys, and SQL aggregates active'
            : 'KV fallback active (SQLite relational tables inactive in this runtime)'
        }
        right={<OfflineBadge label={engineBadge.label} tone={engineBadge.tone} compact />}
      />

      <Card style={styles.backupCard}>
        <View style={styles.filterRow}>
          <View style={styles.badgeWrap}>
            <OfflineBadge
              label={engineInfo.relationalTablesActive ? 'Relational SQLite ✓' : 'KV Fallback'}
              tone={engineInfo.relationalTablesActive ? 'emerald' : 'neutral'}
              compact
            />
            <OfflineBadge label={`${SQLITE_TABLE_NAMES.length} Tables`} tone="cyan" compact />
          </View>
          <PrimaryButton
            label="Refresh SQL"
            tone="cyan"
            compact
            onPress={() => setSqlRefreshTick((t) => t + 1)}
          />
        </View>
        {sqlStatsError ? <Notice tone="rose" text={`SQL query error: ${sqlStatsError}`} /> : null}
        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>Relational SQLite Table Row Counts</Text>
        {tableCounts ? (
          <View style={styles.tableCountGrid}>
            {SQLITE_TABLE_NAMES.map((tableName) => (
              <View key={tableName} style={styles.tableCountCell}>
                <Text style={styles.tableCountName} numberOfLines={1}>
                  {tableName}
                </Text>
                <Text style={styles.tableCountValue}>{tableCounts[tableName] ?? 0}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Notice
            tone="neutral"
            text="SQLite native driver is unavailable in this environment; OfflineStore is running on key-value fallback."
          />
        )}
      </Card>

      <Card style={[styles.backupCard, SHARED_LAYOUT_STYLES.cardGap]}>
        <View style={styles.filterRow}>
          <View style={SHARED_LAYOUT_STYLES.flexOne}>
            <Text style={TYPOGRAPHY.cardTitle}>SQL Health Aggregate Stats</Text>
            <Text style={TYPOGRAPHY.caption}>
              {engineInfo.relationalTablesActive
                ? 'Computed directly via SQL COUNT / SUM / AVG on daily_health_records'
                : 'Computed from in-memory daily health history'}
            </Text>
          </View>
          <OfflineBadge
            label={`${healthAggregates?.daysCount ?? storeState.healthHistory.length} Days`}
            tone="indigo"
            compact
          />
        </View>
        <View style={SHARED_LAYOUT_STYLES.statGrid}>
          {aggregatePills.map((p) => (
            <StatPill key={p.label} label={p.label} value={p.value} tone={p.tone} />
          ))}
        </View>
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="100% Local Data Sovereignty"
        title="Offline Backup & Portability"
        subtitle="Export or restore deterministic JSON archives and RFC-4180 Health CSV files"
        right={<OfflineBadge label="Zero Cloud" compact />}
      />
      <Card style={styles.backupCard}>
        <View style={SHARED_LAYOUT_STYLES.statGrid}>
          {backupCounts.map((b) => (
            <StatPill key={b.label} label={b.label} value={String(b.value)} tone={b.tone} />
          ))}
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>JSON Archive Export & Validated Import</Text>
        <View style={SHARED_LAYOUT_STYLES.chipRow}>
          <ActionChip
            label="Import Mode: Merge"
            active={importMode === IMPORT_MODE.MERGE}
            tone="emerald"
            onPress={() => setImportMode(IMPORT_MODE.MERGE)}
            style={SHARED_LAYOUT_STYLES.flexOne}
          />
          <ActionChip
            label="Import Mode: Replace"
            active={importMode === IMPORT_MODE.REPLACE}
            tone="amber"
            onPress={() => setImportMode(IMPORT_MODE.REPLACE)}
            style={SHARED_LAYOUT_STYLES.flexOne}
          />
        </View>

        <View style={SHARED_LAYOUT_STYLES.rowButtons}>
          <PrimaryButton
            label="Export JSON Archive"
            tone="cyan"
            compact
            onPress={() => {
              setArchiveBuffer(store.exportJson());
              setImportResult(null);
            }}
          />
          <PrimaryButton
            label={`Import JSON (${importMode.toUpperCase()})`}
            tone="emerald"
            compact
            disabled={archiveBuffer.trim().length === 0}
            onPress={handleImportJson}
          />
          <PrimaryButton
            label="Reset Offline Store"
            tone="rose"
            compact
            onPress={() =>
              actions.run('Reset OfflineStore', async () => {
                await store.resetAll();
                onStoreChanged();
              })
            }
          />
        </View>

        <TextInput
          value={archiveBuffer}
          onChangeText={setArchiveBuffer}
          placeholder="Tap 'Export JSON Archive' to inspect state JSON, or paste a backup JSON payload here to validate & import…"
          placeholderTextColor={COLORS.textMuted}
          multiline
          style={[SHARED_LAYOUT_STYLES.textInput, styles.multilineMono]}
        />

        {importResult ? (
          <Notice
            tone={importResult.ok ? 'emerald' : 'rose'}
            text={
              importResult.ok
                ? `Import validated & applied (${importMode} mode): ${importResult.state.pairedDevices.length} devices, ${importResult.state.customEqProfiles.length} EQ curves, ${importResult.state.healthHistory.length} health days.`
                : `Import rejected (${importResult.errors.length} validation error(s)): ${importResult.errors.join(' | ')}`
            }
          />
        ) : null}

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <View style={styles.filterRow}>
          <View style={SHARED_LAYOUT_STYLES.flexOne}>
            <Text style={TYPOGRAPHY.cardTitle}>Export RFC-4180 Health CSV</Text>
            <Text style={TYPOGRAPHY.caption}>
              Chronological daily steps, sleep stages, HR, SpO2, BP, and stress
            </Text>
          </View>
          <PrimaryButton
            label="Generate CSV"
            tone="indigo"
            compact
            onPress={() => setCsvOutput(store.exportHealthCsv())}
          />
        </View>
        {csvOutput.length > 0 ? (
          <View style={styles.csvBox}>
            <Text selectable style={styles.hexDump}>
              {csvOutput}
            </Text>
          </View>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  backupCard: { gap: SPACING.sm },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  badgeWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tableCountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  tableCountCell: {
    flexGrow: 1,
    flexBasis: 135,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  tableCountName: { flex: 1, fontSize: 11, fontFamily: MONO_FONT, color: COLORS.textSecondary },
  tableCountValue: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: MONO_FONT,
    color: COLORS.cyan,
    fontVariant: ['tabular-nums'],
  },
  multilineMono: {
    minHeight: 130,
    fontFamily: MONO_FONT,
    fontSize: 11,
    textAlignVertical: 'top',
    marginTop: SPACING.sm,
  },
  csvBox: {
    padding: SPACING.md,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.xs,
  },
  hexDump: { fontSize: 11, fontFamily: MONO_FONT, color: COLORS.cyan, lineHeight: 16 },
});
