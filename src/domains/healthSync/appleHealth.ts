/**
 * Apple Health (HealthKit) on iPhone via react-native-health. HealthKit
 * samples can't be updated by key, so the sync manager only sends finished
 * days and each workout once.
 */
import { Platform } from 'react-native';
import type { DaySample, WorkoutSample } from './samples.ts';
import type { HealthTarget } from './types.ts';

interface HK {
  isAvailable(cb: (err: unknown, ok: boolean) => void): void;
  initHealthKit(perms: unknown, cb: (err: string | null) => void): void;
  getAuthStatus(perms: unknown, cb: (err: string | null, res: { permissions: { write: number[] } }) => void): void;
  saveSteps(o: unknown, cb: (err: string | null) => void): void;
  saveWalkingRunningDistance(o: unknown, cb: (err: string | null) => void): void;
  saveHeartRateSample(o: unknown, cb: (err: string | null) => void): void;
  saveWorkout(o: unknown, cb: (err: string | null) => void): void;
  Constants: { Permissions: Record<string, string>; Activities: Record<string, string> };
}

let hkModule: HK | null | undefined;
function hk(): HK | null {
  if (hkModule !== undefined) return hkModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hkModule = Platform.OS === 'ios' ? ((require('react-native-health') as { default: HK }).default) : null;
  } catch {
    hkModule = null;
  }
  return hkModule;
}

function perms(m: HK): unknown {
  const P = m.Constants.Permissions;
  return {
    permissions: {
      read: [],
      write: [P.Steps, P.DistanceWalkingRunning, P.HeartRate, P.Workout, P.ActiveEnergyBurned].filter(Boolean),
    },
  };
}

const call = (fn: (cb: (err: string | null) => void) => void): Promise<void> =>
  new Promise((resolve, reject) => fn((err) => (err ? reject(new Error(String(err))) : resolve())));

const ACTIVITY: Record<WorkoutSample['activity'], string> = { run: 'Running', walk: 'Walking', ride: 'Cycling', hike: 'Hiking', other: 'Other' };

export const appleHealthTarget: HealthTarget = {
  id: 'appleHealth',
  name: 'Apple Health',
  kinds: new Set(['steps', 'distance', 'heartRate', 'workout']),
  finishedDaysOnly: true,

  async availability() {
    const m = hk();
    if (!m) return { ok: false, reason: 'Only on iPhone.' };
    const ok = await new Promise<boolean>((r) => m.isAvailable((_e, v) => r(Boolean(v))));
    return ok ? { ok: true } : { ok: false, reason: 'Health isn’t available on this device.' };
  },

  async isConnected() {
    const m = hk();
    if (!m) return false;
    // HealthKit only reveals write (sharing) status; 2 = authorized.
    return new Promise((resolve) =>
      m.getAuthStatus(perms(m), (err, res) => resolve(!err && res.permissions.write.length > 0 && res.permissions.write.every((s) => s === 2))),
    );
  },

  async connect() {
    const m = hk();
    if (!m) return false;
    await call((cb) => m.initHealthKit(perms(m), cb));
    return this.isConnected();
  },

  async disconnect() {
    // Apps can't revoke HealthKit access; the user does it in Settings › Health › Data Access.
  },

  async write(samples) {
    const m = hk();
    if (!m) throw new Error('Apple Health isn’t available.');
    const stored: string[] = [];
    for (const s of samples as readonly (DaySample | WorkoutSample)[]) {
      switch (s.kind) {
        case 'steps':
          await call((cb) => m.saveSteps({ value: s.count, startDate: s.start, endDate: s.end }, cb));
          break;
        case 'distance':
          await call((cb) => m.saveWalkingRunningDistance({ value: s.meters, unit: 'meter', startDate: s.start, endDate: s.end }, cb));
          break;
        case 'heartRate':
          for (const x of s.samples) {
            await call((cb) => m.saveHeartRateSample({ value: x.bpm, unit: 'bpm', startDate: x.time, endDate: x.time }, cb));
          }
          break;
        case 'workout':
          await call((cb) =>
            m.saveWorkout(
              {
                type: m.Constants.Activities[ACTIVITY[s.activity]] ?? ACTIVITY[s.activity],
                startDate: s.start, endDate: s.end,
                energyBurned: s.kcal, energyBurnedUnit: 'calorie',
                distance: s.distanceMeters, distanceUnit: 'meter',
              },
              cb,
            ),
          );
          break;
        default:
          continue;
      }
      stored.push(s.key);
    }
    return stored;
  },
};
