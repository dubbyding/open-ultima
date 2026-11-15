import test from 'node:test';
import assert from 'node:assert/strict';
import { daySamples, isFinishedDay, localDayStart, workoutSample } from '../../src/domains/healthSync/samples.ts';
import { HealthSyncManager } from '../../src/domains/healthSync/HealthSyncManager.ts';
import type { HealthTarget, WriteContext } from '../../src/domains/healthSync/types.ts';
import { sleepSegmentTimes } from '../../src/domains/bluetooth/controllers/watchController.ts';
import { createDefaultDailyHealthRecord } from '../../src/storage/offlineStore.ts';
import type { DailyHealthRecord, GpsWorkoutRoute } from '../../src/storage/offlineStore.ts';

const day = (over: Partial<DailyHealthRecord>): DailyHealthRecord => ({ ...createDefaultDailyHealthRecord('2026-11-14'), ...over });
const at = (h: number, m = 0): Date => new Date(2026, 10, 15, h, m);

test('10.1 health samples: step buckets, HR slots, clipped to now', () => {
  const buckets = new Array(48).fill(0);
  buckets[16] = 400; // 08:00–08:30
  buckets[47] = 50;  // 23:30–24:00
  const hr = new Array(288).fill(0);
  hr[12] = 62; // 01:00
  hr[100] = 300; // invalid
  const s = daySamples(day({ date: '2026-11-15', steps: 450, stepBuckets48: buckets, hrSamples: hr, restingHr: 55, distanceMeters: 320 }), at(12));
  const steps = s.filter((x) => x.kind === 'steps');
  assert.equal(steps.length, 1, 'future bucket dropped');
  assert.ok(new Date(steps[0]!.start) >= localDayStart('2026-11-15'));
  assert.equal(new Date(steps[0]!.start).getHours(), 8);
  const hrs = s.find((x) => x.kind === 'heartRate');
  assert.ok(hrs && hrs.kind === 'heartRate');
  assert.deepEqual(hrs.samples.map((x) => [new Date(x.time).getHours(), x.bpm]), [[1, 62]]);
  const dist = s.find((x) => x.kind === 'distance');
  assert.ok(dist && new Date(dist.end).getHours() === 12, 'today totals end now');
  assert.equal(isFinishedDay('2026-11-15', at(12)), false);
  assert.equal(isFinishedDay('2026-11-14', at(12)), true);
});

test('10.2 sleep segments get real dates across midnight', () => {
  const segs = sleepSegmentTimes([
    { state: 1, startHour: 23, startMinute: 10, endHour: 0, endMinute: 40, durationMinutes: 90 },
    { state: 2, startHour: 0, startMinute: 40, endHour: 6, endMinute: 30, durationMinutes: 350 },
  ], at(9));
  assert.deepEqual(segs.map((x) => x.stage), ['light', 'deep']);
  assert.equal(new Date(segs[0]!.start).getDate(), 14);
  assert.equal(new Date(segs[0]!.end).getDate(), 15);
  const s = daySamples(day({ date: '2026-11-15', sleepSegments: segs }), at(9)).find((x) => x.kind === 'sleep');
  assert.ok(s && s.kind === 'sleep' && s.stages.length === 2 && s.start === segs[0]!.start && s.end === segs[1]!.end);
});

test('10.3 sync manager sends once, re-sends changes with higher version, Apple-style waits for finished days', async () => {
  const mem = new Map<string, string>();
  const storage = { getItem: async (k: string) => mem.get(k) ?? null, setItem: async (k: string, v: string) => void mem.set(k, v) };
  const writes: { keys: string[]; ctx: WriteContext }[] = [];
  const mk = (id: HealthTarget['id'], finishedDaysOnly: boolean): HealthTarget => ({
    id, name: id, kinds: new Set(['steps', 'distance', 'workout']), finishedDaysOnly,
    availability: async () => ({ ok: true }), isConnected: async () => true, connect: async () => true, disconnect: async () => {},
    write: async (samples, ctx) => { writes.push({ keys: samples.map((x) => x.key), ctx }); return samples.map((x) => x.key); },
  });
  let history = [day({ date: '2026-11-15', steps: 1000 }), day({ date: '2026-11-14', steps: 8000, distanceMeters: 5000 })];
  const route: GpsWorkoutRoute = { id: 'r1', name: 'Run', activityType: 'outdoor_run', startedAt: at(7).toISOString(), endedAt: at(7, 30).toISOString(), distanceMeters: 5000, durationSec: 1800, caloriesKcal: 300, waypoints: [] };
  let now = at(12);
  const m = new HealthSyncManager([mk('healthConnect', false), mk('appleHealth', true)], storage, () => ({ healthHistory: history, gpsRoutes: [route] }), () => now);
  await m.setEnabled('healthConnect', true);
  assert.deepEqual(writes.at(-1)!.keys.sort(), ['distance-2026-11-14', 'steps-2026-11-14', 'steps-2026-11-15', 'workout-r1']);
  assert.equal(await m.sync('healthConnect'), 0, 'nothing new');
  history = [day({ date: '2026-11-15', steps: 1500 }), history[1]!];
  now = at(13);
  assert.equal(await m.sync('healthConnect'), 1);
  const w = writes.at(-1)!;
  assert.deepEqual(w.keys, ['steps-2026-11-15']);
  assert.ok(w.ctx.sentBefore.has('steps-2026-11-15'));
  assert.ok(w.ctx.versions.get('steps-2026-11-15')! > Math.floor(at(12).getTime() / 1000));

  await m.setEnabled('appleHealth', true);
  assert.ok(!writes.at(-1)!.keys.includes('steps-2026-11-15'), 'today not sent to Apple Health');

  // Ledger persists.
  const m2 = new HealthSyncManager([mk('healthConnect', false)], storage, () => ({ healthHistory: history, gpsRoutes: [route] }), () => now);
  assert.equal(await m2.sync('healthConnect'), 0);
  assert.equal(workoutSample({ ...route, endedAt: route.startedAt }), null);
});
