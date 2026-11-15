import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  DailyHealthRecord,
  OfflineAppState,
  OfflineStore,
} from '../../../storage/offlineStore.ts';
import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import { OfflineMapCanvas } from '../../map/OfflineMapCanvas.tsx';
import type { OfflineMapPin } from '../../map/types.ts';
import {
  ActionChip,
  Card,
  OfflineBadge,
  PrimaryButton,
  SectionHeader,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  MONO_FONT,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
} from '../../shared/theme/tokens.ts';
import type { ActionRunner } from '../../shared/theme/tokens.ts';
import { formatDistance, formatDurationHm } from './ActivitySleepVitalsSection.tsx';

export interface GpsWorkoutSectionProps {
  watch: BleManagerSnapshot['watch'];
  manager: UltimaBleManager;
  store: OfflineStore;
  storeState: OfflineAppState;
  actions: ActionRunner;
  onStoreChanged: () => void;
}

/** Renders CRREPA 0xB3 GPS workout routes, GPX 1.1 export preview, and offline daily health history. */
export function GpsWorkoutSection({
  watch,
  manager,
  store,
  storeState,
  actions,
  onStoreChanged,
}: GpsWorkoutSectionProps): React.ReactElement {
  const connected = watch.connected;
  const settings = watch.settings;
  const [selectedRouteId, setSelectedRouteId] = React.useState<string | undefined>(undefined);
  const [gpxPreviewText, setGpxPreviewText] = React.useState<string | null>(null);

  const gpsRoutes = watch.gpsRoutes.length > 0 ? watch.gpsRoutes : storeState.gpsRoutes;
  const activeGpsRoute = React.useMemo(
    () =>
      (selectedRouteId ? gpsRoutes.find((r) => r.id === selectedRouteId) : undefined) ??
      gpsRoutes[0] ??
      null,
    [gpsRoutes, selectedRouteId],
  );

  const watchGpsPins = React.useMemo<OfflineMapPin[]>(() => {
    if (!watch.lastKnownLocation) return [];
    return [
      {
        id: 'watch-gps-fix',
        label: watch.name || 'Watch Fix',
        shortTag: 'W',
        lat: watch.lastKnownLocation.lat,
        lng: watch.lastKnownLocation.lng,
        role: 'watch',
        note: watch.lastKnownLocation.note,
        savedAt: watch.lastKnownLocation.savedAt,
      },
    ];
  }, [watch.lastKnownLocation, watch.name]);

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="CRREPA 0xB3 Offline GPS & GPX 1.1"
        title={`Outdoor GPS Workout Routes (${gpsRoutes.length})`}
        subtitle="Pure offline vector trajectory viewer with OpenStreetMap/Strava GPX 1.1 export"
      />
      <Card style={styles.cardGapMd}>
        <View style={styles.actionsWrap}>
          <PrimaryButton
            label={watch.gpsSyncing ? 'Syncing GPS…' : 'Sync GPS Route'}
            tone="cyan"
            compact
            disabled={!connected || watch.gpsSyncing}
            onPress={() =>
              actions.run('Sync Watch GPS Routes (0xB3)', async () => {
                await manager.syncWatchGpsRoutes();
                onStoreChanged();
              })
            }
          />
          <ActionChip
            label="Export GPX"
            tone="emerald"
            active={Boolean(gpxPreviewText)}
            disabled={!activeGpsRoute}
            onPress={() => {
              if (!activeGpsRoute) return;
              setGpxPreviewText(store.exportGpx(activeGpsRoute.id));
            }}
          />
          {gpsRoutes.length > 1 ? (
            <ActionChip
              label="All GPX"
              tone="indigo"
              onPress={() => setGpxPreviewText(store.exportGpx())}
            />
          ) : null}
          <ActionChip
            label="Pin Watch Fix"
            tone="amber"
            disabled={!connected && !activeGpsRoute}
            onPress={() =>
              actions.run('Pin Watch GPS Fix (0xB3 0x04)', async () => {
                await manager.pinLastKnownWatchLocation(
                  activeGpsRoute ? `Watch Fix (${activeGpsRoute.name})` : 'Watch GPS Pin',
                );
                onStoreChanged();
              })
            }
          />
        </View>

        {gpsRoutes.length > 0 ? (
          <View style={styles.routeChipsWrap}>
            {gpsRoutes.map((route) => (
              <ActionChip
                key={route.id}
                label={`${route.name} (${(route.distanceMeters / 1000).toFixed(2)} km)`}
                tone="cyan"
                active={activeGpsRoute?.id === route.id}
                onPress={() => {
                  setSelectedRouteId(route.id);
                  if (gpxPreviewText) setGpxPreviewText(store.exportGpx(route.id));
                }}
              />
            ))}
          </View>
        ) : null}

        <OfflineMapCanvas
          mode="route"
          title={activeGpsRoute ? activeGpsRoute.name : 'Offline GPS Trajectory'}
          routes={gpsRoutes}
          activeRouteId={activeGpsRoute?.id}
          pins={watchGpsPins}
          height={240}
          emptyMessage="Connect Watch and tap Sync GPS Route to pull CRREPA 0xB3 trajectories."
        />

        {gpxPreviewText ? (
          <View style={styles.gpxBox}>
            <View style={styles.cardTopRow}>
              <Text style={TYPOGRAPHY.overline}>
                GPX 1.1 XML ({gpxPreviewText.length} bytes)
              </Text>
              <ActionChip
                label="Close Preview"
                tone="neutral"
                onPress={() => setGpxPreviewText(null)}
              />
            </View>
            <Text selectable style={TYPOGRAPHY.mono}>
              {gpxPreviewText.split('\n').slice(0, 18).join('\n')}
              {gpxPreviewText.split('\n').length > 18 ? '\n…' : ''}
            </Text>
          </View>
        ) : null}
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="OfflineStore Persistence"
        title={`Daily Health History (${storeState.healthHistory.length} days)`}
        subtitle="Stored strictly on-device; exportable as JSON or RFC-4180 CSV in the Inspector tab"
      />
      {storeState.healthHistory.length === 0 ? (
        <Card>
          <Text style={TYPOGRAPHY.caption}>
            No daily health records saved yet. Connect your watch and tap Sync All.
          </Text>
        </Card>
      ) : (
        <View style={styles.historyList}>
          {[...storeState.healthHistory]
            .reverse()
            .map((day: DailyHealthRecord) => (
              <Card key={day.date} style={styles.historyCard}>
                <View style={styles.cardTopRow}>
                  <Text style={TYPOGRAPHY.cardTitle}>{day.date}</Text>
                  <OfflineBadge label={`${day.steps} steps`} compact />
                </View>
                <Text style={styles.historyMono}>
                  Dist {formatDistance(day.distanceMeters, settings.imperialUnits)} ·{' '}
                  {day.caloriesKcal} kcal · Sleep{' '}
                  {formatDurationHm(day.deepSleepMin + day.lightSleepMin + day.remSleepMin)} (D:
                  {day.deepSleepMin}m L:{day.lightSleepMin}m R:{day.remSleepMin}m)
                </Text>
                <Text style={styles.historyMono}>
                  HR {day.restingHr || '—'} bpm · SpO2 {day.spo2Percent || '—'}% · BP{' '}
                  {day.systolicBp ? `${day.systolicBp}/${day.diastolicBp}` : '—'} mmHg · Stress{' '}
                  {day.stressScore || '—'}
                </Text>
              </Card>
            ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  cardGapMd: { gap: SPACING.md },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, alignItems: 'center' },
  routeChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  gpxBox: {
    gap: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.md,
  },
  historyList: { gap: SPACING.sm },
  historyCard: { gap: 6 },
  historyMono: { fontSize: 11, fontFamily: MONO_FONT, color: COLORS.textSecondary },
});
