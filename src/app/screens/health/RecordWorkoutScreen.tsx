import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StackActions, useNavigation } from '@react-navigation/native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { SPORTS, formatClock, formatPace } from '../../../domains/workouts/trackStats.ts';
import type { Sport } from '../../../domains/workouts/trackStats.ts';
import { workoutRecorder } from '../../../domains/workouts/recorder.ts';
import type { RecorderState } from '../../../domains/workouts/recorder.ts';
import { RouteMap } from '../../components/RouteMap.tsx';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, ChoiceTiles, HStack, Muted, RowGroup, Screen, SectionLabel, SwitchRow, useFeedback, useTask } from '../../ui.tsx';

export function useRecorder(): RecorderState {
  const [s, setS] = React.useState(() => workoutRecorder.getState());
  React.useEffect(() => {
    void workoutRecorder.restore().then(() => setS(workoutRecorder.getState()));
    return workoutRecorder.subscribe(setS);
  }, []);
  return s;
}

function useTick(active: boolean): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function BigNumber({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <View style={styles.big}>
      <Text variant="displaySmall" style={styles.onSurface}>
        {value}
      </Text>
      <Muted>{label}</Muted>
    </View>
  );
}

export function RecordWorkoutScreen(): React.ReactElement {
  const { snapshot, store, onStoreChanged } = useApp();
  const navigation = useNavigation();
  const { run, busy } = useTask();
  const { show } = useFeedback();
  const rec = useRecorder();
  // Opened from a deep link or notification there may be nothing underneath.
  const leave = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Workouts');
  };
  const [sport, setSport] = React.useState<Sport>('run');
  const [finishing, setFinishing] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);
  const [name, setName] = React.useState('');
  const now = useTick(rec.status === 'recording');
  const stats = React.useMemo(() => workoutRecorder.stats(), [rec.points]);
  const imperial = snapshot.watch.imperialUnits;

  const elapsed = workoutRecorder.elapsedMs(now) / 1000;
  const km = stats.distanceMeters / 1000;
  const distance = imperial ? (km / 1.609344).toFixed(2) : km.toFixed(2);
  const isRide = rec.sport === 'ride';
  const paceOrSpeed = isRide
    ? stats.speedKmh !== null ? (imperial ? stats.speedKmh / 1.609344 : stats.speedKmh).toFixed(1) : '–'
    : formatPace(stats.paceSecPerKm !== null && imperial ? stats.paceSecPerKm * 1.609344 : stats.paceSecPerKm);
  const toUnit = (kmh: number): number => (imperial ? kmh / 1.609344 : kmh);
  const speedUnit = imperial ? 'mph' : 'km/h';
  const speedNow = rec.status === 'recording' && !rec.autoPaused && rec.speedMps !== null && rec.speedAt !== null && now - rec.speedAt < 8000
    ? toUnit(rec.speedMps * 3.6).toFixed(1)
    : rec.autoPaused ? '0.0' : '–';
  const avgSpeed = stats.speedKmh !== null ? toUnit(stats.speedKmh).toFixed(1) : '–';
  const maxSpeed = stats.maxSpeedKmh !== null ? toUnit(stats.maxSpeedKmh).toFixed(1) : '–';
  const lastHr = [...rec.points].reverse().find((p) => p.heartRateBpm !== undefined)?.heartRateBpm;
  const waiting = rec.status === 'recording' && rec.points.length === 0;

  const finish = (): void => {
    setFinishing(false);
    void run(
      'finish',
      async () => {
        const route = await workoutRecorder.finish(name);
        if (!route) {
          show('Too short to save');
          leave();
          return;
        }
        await store.saveGpsRoute(route);
        onStoreChanged();
        navigation.dispatch(StackActions.replace('WorkoutDetail', { id: route.id }));
      },
      { success: 'Workout saved', failure: 'Couldn’t save the workout' },
    );
  };

  if (rec.status === 'idle') {
    return (
      <Screen>
        <SectionLabel>Choose a sport</SectionLabel>
        <ChoiceTiles options={SPORTS.map((s) => ({ value: s.key, label: s.label, icon: s.icon }))} value={sport} onChange={setSport} columns={2} />
        <RowGroup>
          <SwitchRow
            icon="pause-circle-outline"
            title="Auto-pause"
            subtitle="Stops the clock when you stand still for 10 seconds, and starts it again when you move."
            value={rec.autoPause}
            onValueChange={(v) => void workoutRecorder.setAutoPause(v)}
          />
        </RowGroup>
        <Muted>
          {snapshot.watch.connected
            ? `Uses your phone’s GPS. Your watch starts the same workout, so heart rate is measured live and the watch keeps its own record. Keep the phone with you; you can lock the screen.`
            : 'Uses your phone’s GPS. Connect your watch first to record heart rate too. Keep the phone with you; you can lock the screen.'}
        </Muted>
        <Button
          mode="contained"
          icon="record-circle-outline"
          contentStyle={styles.startContent}
          loading={busy('start')}
          disabled={busy('start')}
          onPress={() => void run('start', () => workoutRecorder.start(sport), { failure: 'Couldn’t start' })}
        >
          Start
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      {rec.foregroundOnly ? (
        <Banner
          tone="amber"
          icon="map-marker-alert-outline"
          text="Location is allowed only while the app is open. To keep tracking with the screen off, set Location to “Allow all the time” for Ultima Open."
        />
      ) : null}
      {rec.autoPaused ? <Banner tone="amber" icon="pause-circle-outline" text="Auto-paused. The clock starts again when you move." /> : null}
      {waiting ? <Banner tone="cyan" icon="crosshairs-gps" text={`Waiting for GPS${rec.accuracy ? ` (±${Math.round(rec.accuracy)} m)` : ''}… stay outside with a clear view of the sky.`} /> : null}

      {snapshot.watch.connected ? (
        <Banner
          tone={snapshot.watch.training.failed ? 'rose' : 'emerald'}
          icon="watch-variant"
          text={
            snapshot.watch.training.failed
              ? 'The watch couldn’t start the workout. Heart rate won’t be recorded.'
              : snapshot.watch.training.active
                ? `Watch is recording too${snapshot.watch.training.paused ? ' (paused)' : ''}${Date.now() - snapshot.watch.training.bpmAt < 15_000 ? ` · ♥ ${snapshot.watch.training.bpm} bpm` : ''}`
                : 'Watch connected'
          }
        />
      ) : null}

      <RouteMap points={rec.points} live height={240} />

      <Card>
        <BigNumber value={formatClock(elapsed)} label={rec.status === 'paused' ? 'Paused' : rec.autoPaused ? 'Auto-paused' : 'Time'} />
        <HStack style={styles.row}>
          <BigNumber value={distance} label={imperial ? 'mi' : 'km'} />
          <BigNumber value={speedNow} label={`${speedUnit} now`} />
        </HStack>
        <HStack style={styles.row}>
          <BigNumber value={paceOrSpeed} label={isRide ? `avg ${speedUnit}` : imperial ? 'avg min/mi' : 'avg min/km'} />
          <BigNumber value={isRide ? maxSpeed : avgSpeed} label={isRide ? `max ${speedUnit}` : `avg ${speedUnit}`} />
        </HStack>
        <HStack style={styles.row}>
          <BigNumber value={`${stats.elevationGain}`} label="m climbed" />
          <BigNumber value={lastHr ? String(lastHr) : '–'} label="bpm" />
        </HStack>
      </Card>

      <HStack style={styles.controls}>
        {rec.status === 'recording' ? (
          <Button mode="contained-tonal" icon="pause" style={styles.flex1} contentStyle={styles.ctl} onPress={() => void run('pause', () => workoutRecorder.pause())}>
            Pause
          </Button>
        ) : (
          <Button mode="contained" icon="play" style={styles.flex1} contentStyle={styles.ctl} onPress={() => void run('resume', () => workoutRecorder.resume(), { failure: 'Couldn’t resume' })}>
            Resume
          </Button>
        )}
        <Button mode="contained" icon="flag-checkered" buttonColor={M3.error} textColor={M3.onError} style={styles.flex1} contentStyle={styles.ctl} loading={busy('finish')} onPress={() => setFinishing(true)}>
          Finish
        </Button>
      </HStack>
      {rec.status === 'paused' ? (
        <Button textColor={M3.error} onPress={() => setDiscarding(true)}>
          Discard workout
        </Button>
      ) : null}

      <Portal>
        <Dialog visible={finishing} onDismiss={() => setFinishing(false)}>
          <Dialog.Title>Save workout</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" label="Name (optional)" value={name} onChangeText={setName} placeholder={`${SPORTS.find((s) => s.key === rec.sport)?.label} · ${new Date().toLocaleDateString()}`} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFinishing(false)}>Keep going</Button>
            <Button onPress={finish}>Save</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={discarding} onDismiss={() => setDiscarding(false)}>
          <Dialog.Title>Discard this workout?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">The route and time recorded so far will be lost.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDiscarding(false)}>Cancel</Button>
            <Button
              textColor={M3.error}
              onPress={() => {
                setDiscarding(false);
                void run('discard', async () => {
                  await workoutRecorder.discard();
                  leave();
                });
              }}
            >
              Discard
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  onSurface: { color: M3.onSurface, fontVariant: ['tabular-nums'] },
  big: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  row: { marginTop: 8 },
  controls: { gap: 12 },
  flex1: { flex: 1 },
  ctl: { height: 56 },
  startContent: { height: 56 },
});
