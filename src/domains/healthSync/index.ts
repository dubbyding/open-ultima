import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineStore } from '../storage/OfflineStore.ts';
import { appleHealthTarget } from './appleHealth.ts';
import { healthConnectTarget } from './healthConnect.ts';
import { HealthSyncManager } from './HealthSyncManager.ts';
import { setStravaRouteLookup, stravaTarget } from './strava.ts';
import type { HealthTarget } from './types.ts';

export { HealthSyncManager } from './HealthSyncManager.ts';
export type { HealthSyncSnapshot } from './HealthSyncManager.ts';
export type { HealthTarget, HealthTargetId } from './types.ts';
export { openHealthConnectInStore } from './healthConnect.ts';
export { stravaAthleteName, STRAVA_REDIRECT_URI } from './strava.ts';

/** The health apps this phone can send to: Health Connect or Apple Health, plus Strava. */
export function createHealthSync(store: OfflineStore): HealthSyncManager {
  const targets: HealthTarget[] = [
    ...(Platform.OS === 'android' ? [healthConnectTarget] : []),
    ...(Platform.OS === 'ios' ? [appleHealthTarget] : []),
    stravaTarget,
  ];
  setStravaRouteLookup((id) => store.getState().gpsRoutes.find((r) => r.id === id));
  return new HealthSyncManager(targets, AsyncStorage, () => {
    const s = store.getState();
    return { healthHistory: s.healthHistory, gpsRoutes: s.gpsRoutes };
  });
}
