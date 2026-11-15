/**
 * Android Health Connect (Google's health store; Google Fit's replacement).
 * Records carry `clientRecordId` + `clientRecordVersion`, so re-sending a key
 * with a higher version replaces the earlier record instead of duplicating it.
 */
import { Linking, Platform } from 'react-native';
import type { DaySample, WorkoutSample } from './samples.ts';
import type { HealthTarget } from './types.ts';

type HC = typeof import('react-native-health-connect');
let hcModule: HC | null | undefined;
function hc(): HC | null {
  if (hcModule !== undefined) return hcModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hcModule = Platform.OS === 'android' ? (require('react-native-health-connect') as HC) : null;
  } catch {
    hcModule = null;
  }
  return hcModule;
}

const WRITE_TYPES = [
  'Steps', 'Distance', 'ActiveCaloriesBurned', 'HeartRate', 'RestingHeartRate', 'SleepSession', 'ExerciseSession',
] as const;

const SLEEP_STAGE = { awake: 1, light: 4, deep: 5, rem: 6 } as const;
const EXERCISE = { run: 56, walk: 79, ride: 8, hike: 37, other: 0 } as const;
const PREFIX = 'ultima-';

let initialized = false;
async function ready(): Promise<HC> {
  const m = hc();
  if (!m) throw new Error('Health Connect isn’t available on this phone.');
  if (!initialized) {
    initialized = await m.initialize();
    if (!initialized) throw new Error('Couldn’t open Health Connect.');
  }
  return m;
}

function recordType(s: DaySample | WorkoutSample): (typeof WRITE_TYPES)[number] {
  switch (s.kind) {
    case 'steps': return 'Steps';
    case 'distance': return 'Distance';
    case 'calories': return 'ActiveCaloriesBurned';
    case 'heartRate': return 'HeartRate';
    case 'restingHeartRate': return 'RestingHeartRate';
    case 'sleep': return 'SleepSession';
    case 'workout': return 'ExerciseSession';
  }
}

function toRecord(s: DaySample | WorkoutSample, version: number): Record<string, unknown> {
  const metadata = {
    clientRecordId: PREFIX + s.key,
    clientRecordVersion: version,
    recordingMethod: s.kind === 'workout' ? 2 /* active */ : 3 /* automatic */,
    device: { manufacturer: 'Ultima', model: 'Smartwatch', type: 1 /* watch */ },
  };
  switch (s.kind) {
    case 'steps': return { recordType: 'Steps', startTime: s.start, endTime: s.end, count: s.count, metadata };
    case 'distance': return { recordType: 'Distance', startTime: s.start, endTime: s.end, distance: { value: s.meters, unit: 'meters' }, metadata };
    case 'calories': return { recordType: 'ActiveCaloriesBurned', startTime: s.start, endTime: s.end, energy: { value: s.kcal, unit: 'kilocalories' }, metadata };
    case 'heartRate':
      return { recordType: 'HeartRate', startTime: s.start, endTime: s.end, samples: s.samples.map((x) => ({ time: x.time, beatsPerMinute: x.bpm })), metadata };
    case 'restingHeartRate': return { recordType: 'RestingHeartRate', time: s.time, beatsPerMinute: s.bpm, metadata };
    case 'sleep':
      return {
        recordType: 'SleepSession', startTime: s.start, endTime: s.end, title: 'Sleep',
        stages: s.stages.map((x) => ({ startTime: x.start, endTime: x.end, stage: SLEEP_STAGE[x.stage] })), metadata,
      };
    case 'workout':
      return {
        recordType: 'ExerciseSession', startTime: s.start, endTime: s.end, exerciseType: EXERCISE[s.activity], title: s.name,
        ...(s.route.length >= 2
          ? { exerciseRoute: { route: s.route.map((p) => ({ time: p.time, latitude: p.lat, longitude: p.lng, ...(p.altitude !== undefined ? { altitude: { value: p.altitude, unit: 'meters' } } : {}) })) } }
          : {}),
        metadata,
      };
  }
}

export const healthConnectTarget: HealthTarget = {
  id: 'healthConnect',
  name: 'Health Connect',
  kinds: new Set(['steps', 'distance', 'calories', 'heartRate', 'restingHeartRate', 'sleep', 'workout']),
  finishedDaysOnly: false,

  async availability() {
    const m = hc();
    if (!m) return { ok: false, reason: 'Only on Android.' };
    const status = await m.getSdkStatus();
    if (status === m.SdkAvailabilityStatus.SDK_AVAILABLE) return { ok: true };
    if (status === m.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return { ok: false, reason: 'Install or update Health Connect from the Play Store first.', action: 'install' };
    }
    return { ok: false, reason: 'Install Health Connect from the Play Store first.', action: 'install' };
  },

  async isConnected() {
    const m = hc();
    if (!m || !(await this.availability()).ok) return false;
    await ready();
    const granted = await m.getGrantedPermissions();
    return WRITE_TYPES.every((t) => granted.some((g) => 'recordType' in g && g.recordType === t && g.accessType === 'write'));
  },

  async connect() {
    const m = await ready();
    await m.requestPermission([
      ...WRITE_TYPES.map((recordType) => ({ accessType: 'write' as const, recordType })),
      { accessType: 'write', recordType: 'ExerciseRoute' } as never,
    ]);
    return this.isConnected();
  },

  async disconnect() {
    const m = hc();
    if (!m) return;
    await ready();
    await m.revokeAllPermissions();
  },

  async write(samples, { versions, sentBefore }) {
    const m = await ready();
    if (samples.length === 0) return [];
    // A day switching from one whole-day steps record to 30-minute buckets must drop the old one.
    const wholeDaySteps = samples
      .filter((s) => s.kind === 'steps' && /-\d+$/.test(s.key) && sentBefore.has(s.key.replace(/-\d+$/, '')))
      .map((s) => PREFIX + s.key.replace(/-\d+$/, ''));
    if (wholeDaySteps.length > 0) await m.deleteRecordsByUuids('Steps', [], [...new Set(wholeDaySteps)]);

    const stored: string[] = [];
    // Insert in modest batches so one bad record doesn't sink a whole sync.
    for (let i = 0; i < samples.length; i += 50) {
      const batch = samples.slice(i, i + 50);
      const records = batch.map((s) => toRecord(s, versions.get(s.key) ?? 1));
      try {
        await m.insertRecords(records as never);
        stored.push(...batch.map((s) => s.key));
      } catch (err) {
        for (const [j, r] of records.entries()) {
          try {
            await m.insertRecords([r] as never);
            stored.push(batch[j]!.key);
          } catch (single) {
            console.warn('[HealthConnect] skipped', recordType(batch[j]!), batch[j]!.key, String(single));
          }
        }
        if (stored.length === 0) throw err;
      }
    }
    return stored;
  },
};

export function openHealthConnectInStore(): void {
  void Linking.openURL('market://details?id=com.google.android.apps.healthdata');
}
