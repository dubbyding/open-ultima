import React from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Dialog, IconButton, Portal, Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import type { GpsWorkoutRoute } from '../../../domains/storage/types.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, EmptyState, HStack, IconBadge, Muted, Screen, SectionLabel, formatNumber, useFeedback, useTask } from '../../ui.tsx';
import { formatDistance } from './HealthScreen.tsx';
import { useRecorder } from './RecordWorkoutScreen.tsx';

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function formatStarted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function activityIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('cycl') || t.includes('bike')) return 'bike';
  if (t.includes('walk')) return 'walk';
  if (t.includes('hik')) return 'hiking';
  return 'run';
}

function activityName(route: GpsWorkoutRoute): string {
  const t = route.activityType.trim();
  if (route.name && !/^route|^gps|^crp/i.test(route.name)) return route.name;
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'Workout';
}

export function WorkoutsScreen(): React.ReactElement {
  const { snapshot, manager, store, storeState, onStoreChanged } = useApp();
  const navigation = useNavigation();
  const rec = useRecorder();
  const { run, busy } = useTask();
  const { show } = useFeedback();
  const [pendingDelete, setPendingDelete] = React.useState<GpsWorkoutRoute | null>(null);
  const watch = snapshot.watch;
  const routes = [...storeState.gpsRoutes].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const syncing = busy('sync') || watch.gpsSyncing;

  const sync = (): void => {
    void run(
      'sync',
      async () => {
        const before = watch.gpsRoutes.length;
        await manager.syncWatchGpsRoutes();
        onStoreChanged();
        const after = manager.getSnapshot().watch.gpsRoutes.length;
        show(after > before ? `${after - before} new workout${after - before === 1 ? '' : 's'}` : 'No new workouts on your watch');
      },
      { failure: 'Couldn’t sync workouts' },
    );
  };

  const exportRoute = (route: GpsWorkoutRoute): void => {
    void run('export', () => Share.share({ title: activityName(route), message: store.exportGpx(route.id) }), { failure: 'Couldn’t export' });
  };

  const confirmDelete = (): void => {
    const route = pendingDelete;
    setPendingDelete(null);
    if (!route) return;
    void run(
      'delete',
      async () => {
        await manager.deleteWatchGpsRoute(route.id);
        onStoreChanged();
      },
      { success: 'Workout deleted', failure: 'Couldn’t delete' },
    );
  };

  return (
    <Screen>
      <Button
        mode="contained"
        icon={rec.status === 'idle' ? 'record-circle-outline' : 'map-marker-path'}
        onPress={() => navigation.navigate('RecordWorkout')}
        contentStyle={styles.buttonContent}
      >
        {rec.status === 'idle' ? 'Record a workout' : rec.status === 'paused' ? 'Workout paused — open' : 'Recording — open'}
      </Button>
      <Button mode="outlined" icon="sync" onPress={sync} loading={syncing} disabled={!watch.connected || syncing} contentStyle={styles.buttonContent}>
        {syncing ? 'Syncing…' : watch.connected ? 'Sync from watch' : 'Connect watch to sync its workouts'}
      </Button>

      {routes.length === 0 ? (
        <EmptyState icon="map-marker-path" title="No workouts yet" body="Record one with your phone’s GPS, or sync outdoor workouts from your watch." />
      ) : (
        <>
          <SectionLabel>{`${routes.length} workout${routes.length === 1 ? '' : 's'}`}</SectionLabel>
          {routes.map((r) => {
            const dist = formatDistance(r.distanceMeters, watch.imperialUnits);
            return (
              <Pressable key={r.id} onPress={() => navigation.navigate('WorkoutDetail', { id: r.id })}>
              <Card>
                <HStack align="flex-start">
                  <IconBadge icon={activityIcon(r.activityType)} tone="emerald" />
                  <View style={styles.flex1}>
                    <Text variant="titleMedium" style={styles.onSurface}>
                      {activityName(r)}
                    </Text>
                    <Muted>{formatStarted(r.startedAt)}</Muted>
                  </View>
                  <IconButton icon="share-variant" onPress={() => exportRoute(r)} accessibilityLabel="Export workout" />
                  <IconButton icon="delete-outline" onPress={() => setPendingDelete(r)} accessibilityLabel="Delete workout" />
                </HStack>
                <HStack gap={24} style={styles.stats}>
                  <Stat value={`${dist.value} ${dist.unit}`} label="Distance" />
                  <Stat value={formatDuration(r.durationSec)} label="Time" />
                  {r.caloriesKcal > 0 ? <Stat value={`${formatNumber(r.caloriesKcal)}`} label="kcal" /> : null}
                  {r.avgHeartRateBpm ? <Stat value={`${r.avgHeartRateBpm}`} label="avg bpm" /> : null}
                </HStack>
              </Card>
              </Pressable>
            );
          })}
        </>
      )}

      <Portal>
        <Dialog visible={pendingDelete !== null} onDismiss={() => setPendingDelete(null)}>
          <Dialog.Title>Delete this workout?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">It will be removed from this phone. This can’t be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPendingDelete(null)}>Cancel</Button>
            <Button textColor={M3.error} onPress={confirmDelete}>
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <View>
      <Text variant="titleMedium" style={styles.onSurface}>
        {value}
      </Text>
      <Muted>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  onSurface: { color: M3.onSurface },
  flex1: { flex: 1 },
  stats: { marginTop: 12, flexWrap: 'wrap' },
  buttonContent: { height: 48 },
});
