import React from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { SPORTS, computeTrackStats, formatClock, formatPace, sportOf } from '../../../domains/workouts/trackStats.ts';
import { ElevationChart } from '../../components/ElevationChart.tsx';
import { RouteMap } from '../../components/RouteMap.tsx';
import { useApp } from '../../AppContext.tsx';
import type { RootStackParamList } from '../../routes.ts';
import { Card, EmptyState, HStack, Muted, Screen, SectionLabel, useTask } from '../../ui.tsx';

function Stat({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <View style={styles.stat}>
      <Text variant="titleLarge" style={styles.onSurface}>
        {value}
      </Text>
      <Muted>{label}</Muted>
    </View>
  );
}

export function WorkoutDetailScreen(): React.ReactElement {
  const { params } = useRoute<RouteProp<RootStackParamList, 'WorkoutDetail'>>();
  const navigation = useNavigation();
  const { storeState, store, manager, onStoreChanged, snapshot } = useApp();
  const { run } = useTask();
  const [confirm, setConfirm] = React.useState(false);
  const route = storeState.gpsRoutes.find((r) => r.id === params.id);
  const stats = React.useMemo(() => (route ? computeTrackStats(route.waypoints) : null), [route]);
  const imperial = snapshot.watch.imperialUnits;

  if (!route || !stats) return <Screen><EmptyState icon="map-marker-question-outline" title="Workout not found" /></Screen>;

  const sport = sportOf(route.activityType);
  const meta = SPORTS.find((s) => s.key === sport)!;
  const distanceM = stats.distanceMeters || route.distanceMeters;
  const moving = stats.movingSec || route.durationSec;
  const unitKm = imperial ? 1.609344 : 1;
  const dist = (distanceM / 1000 / unitKm).toFixed(2);
  const pace = distanceM > 0 && moving > 0 ? (moving / (distanceM / 1000)) * unitKm : null;
  const speed = moving > 0 ? (distanceM / moving) * 3.6 / unitKm : null;
  const started = new Date(route.startedAt);
  const fastest = stats.splits.length > 1 ? Math.min(...stats.splits.filter((s) => s.meters >= 1000).map((s) => s.movingSec)) : null;

  return (
    <Screen>
      <View>
        <Text variant="headlineSmall" style={styles.onSurface}>
          {route.name}
        </Text>
        <Muted>
          {`${meta.label} · ${started.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${route.id.startsWith('phone-') ? 'Phone GPS' : 'Watch'}`}
        </Muted>
      </View>

      {route.waypoints.length > 1 ? <RouteMap points={route.waypoints} height={280} /> : null}

      <Card>
        <HStack style={styles.grid}>
          <Stat value={dist} label={imperial ? 'mi' : 'km'} />
          <Stat value={formatClock(moving)} label="Moving time" />
          {sport === 'ride' ? (
            <Stat value={speed !== null ? speed.toFixed(1) : '–'} label={imperial ? 'mph' : 'km/h'} />
          ) : (
            <Stat value={formatPace(pace)} label={imperial ? 'min/mi' : 'min/km'} />
          )}
        </HStack>
        <HStack style={styles.grid}>
          <Stat value={`${route.elevationGainMeters ?? stats.elevationGain}`} label="m climbed" />
          <Stat value={formatClock(stats.elapsedSec || (Date.parse(route.endedAt) - Date.parse(route.startedAt)) / 1000)} label="Elapsed" />
          <Stat value={route.avgHeartRateBpm ? String(route.avgHeartRateBpm) : '–'} label={route.maxHeartRateBpm ? `avg bpm · max ${route.maxHeartRateBpm}` : 'avg bpm'} />
        </HStack>
        <HStack style={styles.grid}>
          <Stat value={speed !== null ? speed.toFixed(1) : '–'} label={`avg ${imperial ? 'mph' : 'km/h'}`} />
          <Stat value={stats.maxSpeedKmh !== null ? (stats.maxSpeedKmh / unitKm).toFixed(1) : '–'} label={`max ${imperial ? 'mph' : 'km/h'}`} />
          <Stat value={formatClock(Math.max(0, (stats.elapsedSec || moving) - moving))} label="Stopped" />
        </HStack>
      </Card>

      {stats.elevationProfile.length > 1 ? (
        <>
          <SectionLabel>Elevation</SectionLabel>
          <Card>
            <ElevationChart profile={stats.elevationProfile} />
            <Muted>From phone GPS altitude; small bumps under 3 m are ignored.</Muted>
          </Card>
        </>
      ) : null}

      {stats.splits.length > 0 && !imperial ? (
        <>
          <SectionLabel>Splits</SectionLabel>
          <Card>
            <HStack style={styles.splitHead}>
              <Text style={[styles.cellKm, styles.muted]}>km</Text>
              <Text style={[styles.cell, styles.muted]}>{sport === 'ride' ? 'km/h' : 'pace'}</Text>
              <Text style={[styles.cell, styles.muted]}>elev</Text>
              <Text style={[styles.cell, styles.muted]}>bpm</Text>
            </HStack>
            {stats.splits.map((s) => {
              const perKm = s.meters > 0 ? s.movingSec / (s.meters / 1000) : null;
              return (
                <HStack key={s.index} style={styles.splitRow}>
                  <Text style={[styles.cellKm, styles.onSurface]}>{s.meters >= 1000 ? s.index : (s.meters / 1000).toFixed(2)}</Text>
                  <Text style={[styles.cell, s.movingSec === fastest ? styles.best : styles.onSurface]}>
                    {sport === 'ride' ? (perKm ? (3600 / perKm).toFixed(1) : '–') : formatPace(perKm)}
                  </Text>
                  <Text style={[styles.cell, styles.onSurface]}>{`${s.elevationChange > 0 ? '+' : ''}${s.elevationChange}`}</Text>
                  <Text style={[styles.cell, styles.onSurface]}>{s.avgHeartRate ?? '–'}</Text>
                </HStack>
              );
            })}
          </Card>
        </>
      ) : null}

      <HStack style={styles.actions}>
        <Button mode="outlined" icon="share-variant" style={styles.flex1} onPress={() => void run('export', () => Share.share({ title: route.name, message: store.exportGpx(route.id) }), { failure: 'Couldn’t export' })}>
          Export GPX
        </Button>
        <Button mode="outlined" icon="delete-outline" textColor={M3.error} style={styles.flex1} onPress={() => setConfirm(true)}>
          Delete
        </Button>
      </HStack>

      <Portal>
        <Dialog visible={confirm} onDismiss={() => setConfirm(false)}>
          <Dialog.Title>Delete this workout?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">It will be removed from this phone. This can’t be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(false)}>Cancel</Button>
            <Button
              textColor={M3.error}
              onPress={() => {
                setConfirm(false);
                void run('delete', async () => {
                  await manager.deleteWatchGpsRoute(route.id);
                  onStoreChanged();
                  if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Workouts');
                }, { success: 'Workout deleted', failure: 'Couldn’t delete' });
              }}
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  onSurface: { color: M3.onSurface, fontVariant: ['tabular-nums'] },
  muted: { color: M3.onSurfaceVariant },
  best: { color: M3.primary, fontWeight: '700' },
  stat: { flex: 1 },
  grid: { marginBottom: 12, alignItems: 'flex-start' },
  splitHead: { paddingBottom: 6 },
  splitRow: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: M3.outlineVariant },
  cellKm: { width: 48 },
  cell: { flex: 1, textAlign: 'right' },
  actions: { gap: 12 },
  flex1: { flex: 1 },
});
