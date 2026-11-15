import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptFix, computeTrackStats, formatPace } from '../../src/domains/workouts/trackStats.ts';
import { buildSheetTables } from '../../src/domains/sheets/tables.ts';
import { createDefaultDailyHealthRecord, createDefaultOfflineAppState } from '../../src/storage/offlineStore.ts';
import type { GpsWaypoint } from '../../src/storage/offlineStore.ts';

// ~0.0009° latitude ≈ 100 m. 25 points every 30 s → 2.4 km at 12 min/km... use 100 m / 30 s = 5:00 /km.
function track(n: number, opts: { stepDeg?: number; dtSec?: number; alt?: (i: number) => number; hr?: number; gapAt?: number } = {}): GpsWaypoint[] {
  const t0 = Date.parse('2026-11-15T06:00:00Z');
  let t = t0;
  return Array.from({ length: n }, (_, i) => {
    if (i > 0) t += (opts.dtSec ?? 30) * 1000 + (opts.gapAt === i ? 300_000 : 0);
    return {
      lat: 27.7 + i * (opts.stepDeg ?? 0.0009), lng: 85.3, timestamp: new Date(t).toISOString(),
      ...(opts.alt ? { elevationMeters: opts.alt(i) } : {}), ...(opts.hr ? { heartRateBpm: opts.hr } : {}),
    };
  });
}

test('11.1 track stats: distance, pace, km splits, climb with noise threshold', () => {
  const s = computeTrackStats(track(26, { alt: (i) => 1300 + i * 4 + (i % 2 ? 1 : -1), hr: 150 }));
  assert.ok(Math.abs(s.distanceMeters - 2502) < 15, `distance ${s.distanceMeters}`);
  assert.equal(s.movingSec, 750);
  assert.ok(s.paceSecPerKm! > 295 && s.paceSecPerKm! < 305, `pace ${s.paceSecPerKm}`);
  assert.equal(formatPace(s.paceSecPerKm), '5:00');
  assert.deepEqual(s.splits.map((x) => x.meters), [1000, 1000, 502]);
  assert.ok(Math.abs(s.splits[0]!.movingSec - 300) <= 1);
  assert.equal(s.splits[0]!.avgHeartRate, 150);
  assert.ok(s.elevationGain >= 90 && s.elevationGain <= 100, `gain ${s.elevationGain}`);
  assert.equal(s.elevationLoss, 0, '±1 m jitter is not counted as descent');
  assert.ok(Math.abs(s.maxSpeedKmh! - 12) < 0.3, `max speed ${s.maxSpeedKmh}`);
  // 1 s fixes at ~12 km/h with a 10 s burst at double speed; one GPS jump doesn't set the max.
  const fast = track(60, { dtSec: 1, stepDeg: 0.00003 }).map((p, i, all) => (i >= 20 && i < 30 ? { ...p, lat: all[20]!.lat + (i - 20) * 0.00006 } : i >= 30 ? { ...p, lat: p.lat + 10 * 0.00003 } : p));
  const fs = computeTrackStats(fast);
  assert.ok(fs.maxSpeedKmh! > 22 && fs.maxSpeedKmh! < 25, `burst max ${fs.maxSpeedKmh}`);
  // Flat with ±2 m noise: no climb.
  assert.equal(computeTrackStats(track(20, { alt: (i) => 1300 + (i % 2 ? 2 : -2) })).elevationGain, 0);
});

test('11.2 pauses and GPS filtering', () => {
  const paused = computeTrackStats(track(11, { gapAt: 5 }));
  assert.ok(Math.abs(paused.distanceMeters - 900) < 10, 'the step across the pause adds no distance');
  assert.equal(paused.movingSec, 270);
  assert.equal(paused.elapsedSec, 300 + 300);
  const a = { time: 0, lat: 27.7, lng: 85.3, accuracy: 5 };
  assert.equal(acceptFix(a, { ...a, time: 1000, lat: 27.71 }, 'run'), false, 'teleport rejected');
  assert.equal(acceptFix(a, { ...a, time: 1000, accuracy: 80 }, 'run'), false, 'inaccurate rejected');
  assert.equal(acceptFix(a, { ...a, time: 1000, lat: 27.700005 }, 'run'), false, 'jitter in place rejected');
  assert.equal(acceptFix(a, { ...a, time: 3000, lat: 27.70006 }, 'run'), true, '~7 m step kept');
});

test('11.3 sheet tables: one tab per table with header rows', () => {
  const state = createDefaultOfflineAppState();
  state.healthHistory = [{ ...createDefaultDailyHealthRecord('2026-11-14'), steps: 5000, hrSamples: [0, 0, 70], stepBuckets48: [0, 120] }];
  state.gpsRoutes = [{ id: 'phone-1', name: 'Morning run', activityType: 'outdoor_run', startedAt: '2026-11-15T06:00:00.000Z', endedAt: '2026-11-15T06:12:30.000Z', distanceMeters: 2500, durationSec: 750, caloriesKcal: 0, waypoints: track(26) }];
  const tables = buildSheetTables(state);
  const by = Object.fromEntries(tables.map((t) => [t.title, t.rows]));
  assert.equal(new Set(tables.map((t) => t.title)).size, tables.length);
  assert.deepEqual(by['Daily health']![1]!.slice(0, 2), ['2026-11-14', 5000]);
  assert.deepEqual(by['Steps by half hour']![1], ['2026-11-14', '00:30', 120]);
  assert.deepEqual(by['Heart rate']![1], ['2026-11-14', '00:10', 70]);
  assert.equal(by['Route points']!.length, 27);
  const w = by['Workouts']!;
  assert.equal(w[1]![0], 'phone-1');
  assert.equal(w[1]![w[0]!.indexOf('source')], 'phone');
  assert.equal(w[1]![w[0]!.indexOf('pace_sec_per_km')], 300);
});
