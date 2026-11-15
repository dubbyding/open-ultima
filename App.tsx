import React from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AnimatedSplash } from './src/app/components/AnimatedSplash.tsx';
import { useFonts } from 'expo-font';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './src/app/routes.ts';
import { Banner, FeedbackProvider } from './src/app/ui.tsx';
import { PaperProvider } from 'react-native-paper';

import { UltimaBleManager } from './src/services/bleManager.ts';
import type { BleManagerSnapshot } from './src/services/bleManager.ts';
import { OfflineStore } from './src/storage/offlineStore.ts';
import { ensureBlePermissions } from './src/domains/bluetooth/androidPermissions.ts';
import { AppContext } from './src/app/AppContext.tsx';
import type { AppContextValue } from './src/app/AppContext.tsx';
import { useBackgroundKeepAlive } from './src/app/useBackgroundKeepAlive.ts';
import { AppNavigator } from './src/app/AppNavigator.tsx';
import { navigationTheme, paperTheme } from './src/app/theme.ts';
import { findEarbudsSound } from './src/domains/calls/callRouting.ts';
import { createHealthSync } from './src/domains/healthSync/index.ts';
import { sheetsExporter } from './src/domains/sheets/googleSheets.ts';
import { workoutRecorder } from './src/domains/workouts/recorder.ts';
import { SPORTS } from './src/domains/workouts/trackStats.ts';
import type { HealthSyncManager } from './src/domains/healthSync/index.ts';

interface Services {
  store: OfflineStore;
  manager: UltimaBleManager;
  healthSync: HealthSyncManager;
}

/**
 * Earlier builds shipped a built-in simulator whose virtual devices (ids
 * prefixed `sim-`) were saved like real pairings. Drop them so the app only
 * ever offers to reconnect to real hardware.
 */
async function removeLegacySimulatorDevices(store: OfflineStore): Promise<void> {
  const state = await store.load();
  for (const device of state.pairedDevices) {
    if (device.id.startsWith('sim-')) await store.removePairedDevice(device.id);
  }
}

/** Deep links, e.g. com.nhumark.openultima://vitals or ://health. */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['com.nhumark.openultima://'],
  config: {
    // A link straight to an inner page still puts the Home dashboard underneath it,
    // so Back always lands on Home instead of leaving the app.
    initialRouteName: 'Tabs',
    screens: {
      Tabs: { initialRouteName: 'Home', screens: { Home: 'home', Earbuds: 'earbuds', Health: 'health', Settings: 'settings' } },
      AddDevice: 'add-device',
      Equalizer: 'equalizer',
      TouchControls: 'touch-controls',
      FindEarbuds: 'find-earbuds',
      EarbudsAbout: 'earbuds-about',
      Measure: 'measure/:kind',
      Sleep: 'sleep',
      Activity: 'activity',
      Workouts: 'workouts',
      WatchSettings: 'watch-settings',
      Alarms: 'alarms',
      AlarmEdit: 'alarm-edit',
      WatchNotifications: 'notifications',
      Calls: 'calls',
      HealthApps: 'health-apps',
      GoogleSheets: 'sheets',
      RecordWorkout: 'record',
      WorkoutDetail: 'workout/:id',
      Devices: 'devices',
      Backup: 'backup',
      PacketLog: 'packet-log',
      Database: 'database',
    },
  },
};

// Keep the native splash until the animated one has drawn (it hides it).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App(): React.ReactElement {
  const [splashDone, setSplashDone] = React.useState(false);
  const [services] = React.useState<Services>(() => {
    const store = new OfflineStore();
    const manager = new UltimaBleManager(store, {
      ensurePermissions: ensureBlePermissions,
      // iOS keeps a timeout-less connect pending and completes it in background;
      // Android retries with backoff while the foreground service keeps JS alive.
      reconnectStrategy: Platform.OS === 'ios' ? 'pending' : 'retry',
      restoreStateIdentifier: 'com.nhumark.openultima.ble',
      ...(findEarbudsSound ? { findSound: findEarbudsSound } : {}),
    });
    return { store, manager, healthSync: createHealthSync(store) };
  });
  const { store, manager, healthSync } = services;
  const [fontsLoaded, fontError] = useFonts(MaterialCommunityIcons.font);
  React.useEffect(() => {
    if (fontError) console.warn('[UltimaUI] icon font failed to load:', fontError.message);
  }, [fontError]);

  const [snapshot, setSnapshot] = React.useState<BleManagerSnapshot>(() => manager.getSnapshot());
  const [storeVersion, setStoreVersion] = React.useState(0);
  const [initError, setInitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const unsubscribe = manager.subscribe((next) => {
      if (!cancelled) setSnapshot(next);
    });
    removeLegacySimulatorDevices(store)
      .then(() => manager.init())
      .then(() => {
        if (!cancelled) {
          setSnapshot(manager.getSnapshot());
          setStoreVersion((v) => v + 1);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setInitError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [manager, store]);

  React.useEffect(() => () => manager.destroy(), [manager]);
  const onStoreChanged = React.useCallback((): void => {
    setStoreVersion((v) => v + 1);
    setSnapshot(manager.getSnapshot());
  }, [manager]);

  // Re-read the store whenever the manager emits or a page mutates it directly.
  const storeState = React.useMemo(
    () => store.getState(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, snapshot, storeVersion],
  );

  const keepAlive = useBackgroundKeepAlive(manager, snapshot);

  // Send new watch data to the health apps the user turned on, at most once a minute.
  const healthKey = `${storeState.healthHistory.map((d) => `${d.date}:${d.steps}:${d.hrSamples.length}:${d.sleepSegments?.length ?? 0}`).join(',')}|${storeState.gpsRoutes.length}`;
  React.useEffect(() => {
    const t = setTimeout(() => void healthSync.syncAll(), 60_000);
    return () => clearTimeout(t);
  }, [healthSync, healthKey]);

  // Same for the Google Sheets copy, covering every table.
  const sheetsKey = `${healthKey}|${storeState.gpsRoutes.map((r) => r.id).join(',')}|${storeState.watchAlarms.length}:${storeState.customEqProfiles.length}:${storeState.pairedDevices.length}|${JSON.stringify(storeState.watchSettings)}|${JSON.stringify(storeState.earbudPrefs).length}`;
  React.useEffect(() => {
    const t = setTimeout(() => {
      void sheetsExporter.load().then(() => {
        if (sheetsExporter.getState().enabled) void sheetsExporter.sync(store.getState()).catch(() => undefined);
      });
    }, 60_000);
    return () => clearTimeout(t);
  }, [sheetsKey, store]);

  // A phone-recorded workout runs on the watch too (start/pause/resume/stop), so the
  // watch measures heart rate live and keeps its own copy of the session.
  React.useEffect(() => {
    let prev = workoutRecorder.getState().status;
    return workoutRecorder.subscribe((s) => {
      if (s.status === prev) return;
      const from = prev;
      prev = s.status;
      const watch = manager.getSnapshot().watch;
      if (!watch.connected) return;
      const send = (p: Promise<void>): void => void p.catch((e: unknown) => console.warn('[Workout] watch', String(e)));
      if (from === 'idle' && s.status === 'recording') {
        send(manager.startWatchWorkout(SPORTS.find((x) => x.key === s.sport)?.watchType ?? 0x01));
      } else if (!watch.training.active) {
        return;
      } else if (s.status === 'paused') send(manager.setWatchWorkoutState('pause'));
      else if (s.status === 'recording') send(manager.setWatchWorkoutState('resume'));
      else if (s.status === 'idle') send(manager.setWatchWorkoutState('stop'));
    });
  }, [manager]);

  // Watch heart rate goes onto the points of a phone-recorded workout.
  const watchBpm = snapshot.watch.connected ? snapshot.watch.heartRate.currentBpm : 0;
  React.useEffect(() => {
    if (watchBpm > 0) workoutRecorder.setHeartRate(watchBpm);
  }, [watchBpm, snapshot.watch.heartRate]);

  const appValue = React.useMemo<AppContextValue>(
    () => ({ snapshot, manager, store, storeState, onStoreChanged, keepAlive, healthSync }),
    [snapshot, manager, store, storeState, onStoreChanged, keepAlive, healthSync],
  );

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <AppContext.Provider value={appValue}>
          <StatusBar style="light" />
          <FeedbackProvider>
          <NavigationContainer theme={navigationTheme} linking={linking}>
            <AppNavigator />
          </NavigationContainer>
          </FeedbackProvider>
          {initError ? <Banner tone="rose" icon="alert-circle-outline" text={`Couldn’t load saved data: ${initError}`} /> : null}
          {splashDone ? null : <AnimatedSplash ready={fontsLoaded || !!fontError} onDone={() => setSplashDone(true)} />}
        </AppContext.Provider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
