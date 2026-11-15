/**
 * Turns the app's stored daily health records and workouts into time-stamped,
 * platform-neutral samples that Health Connect, Apple Health and Strava
 * adapters write. Pure and deterministic so it can be unit tested.
 *
 * Every sample carries a stable `key` (one per thing in the outside app) and a
 * `fingerprint` of its content: the sync ledger re-sends a key only when its
 * fingerprint changes.
 */
import type { DailyHealthRecord, GpsWorkoutRoute, SleepStageName } from '../storage/types.ts';

export interface IntervalSample { key: string; fingerprint: string; start: string; end: string }

export interface StepsSample extends IntervalSample { kind: 'steps'; count: number }
export interface DistanceSample extends IntervalSample { kind: 'distance'; meters: number }
export interface CaloriesSample extends IntervalSample { kind: 'calories'; kcal: number }
export interface HeartRateSeries extends IntervalSample { kind: 'heartRate'; samples: { time: string; bpm: number }[] }
export interface RestingHeartRateSample { kind: 'restingHeartRate'; key: string; fingerprint: string; time: string; bpm: number }
export interface SleepSample extends IntervalSample { kind: 'sleep'; stages: { stage: SleepStageName; start: string; end: string }[] }
export interface WorkoutSample extends IntervalSample {
  kind: 'workout';
  routeId: string;
  name: string;
  activity: WorkoutActivity;
  distanceMeters: number;
  kcal: number;
  durationSec: number;
  route: { time: string; lat: number; lng: number; altitude?: number }[];
}

export type DaySample = StepsSample | DistanceSample | CaloriesSample | HeartRateSeries | RestingHeartRateSample | SleepSample;
export type WorkoutActivity = 'run' | 'walk' | 'ride' | 'hike' | 'other';

/** The watch's all-day heart rate series is one reading per 5-minute slot from midnight. */
export const HR_SLOT_MINUTES = 5;
const MAX_HR_SLOTS = (24 * 60) / HR_SLOT_MINUTES;

export function localDayStart(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function iso(d: Date): string {
  return d.toISOString();
}

/** End of the period the day's totals cover: midnight, or now for today. */
function dayEnd(date: string, now: Date): Date {
  const end = addMinutes(localDayStart(date), 24 * 60);
  return end.getTime() > now.getTime() ? now : end;
}

/** True once the day is over (Apple Health samples can't be edited later, so only finished days go there). */
export function isFinishedDay(date: string, now: Date): boolean {
  return addMinutes(localDayStart(date), 24 * 60).getTime() <= now.getTime();
}

export function daySamples(day: DailyHealthRecord, now: Date): DaySample[] {
  const start = localDayStart(day.date);
  if (start.getTime() >= now.getTime()) return [];
  const end = dayEnd(day.date, now);
  if (end.getTime() - start.getTime() < 60_000) return [];
  const out: DaySample[] = [];
  const whole = { start: iso(start), end: iso(end) };

  // Steps: 30-minute buckets when the watch gave them, else one record for the day.
  const buckets = day.stepBuckets48 ?? [];
  if (buckets.some((n) => n > 0)) {
    buckets.forEach((count, i) => {
      if (count <= 0) return;
      const s = addMinutes(start, i * 30);
      const e = addMinutes(s, 30);
      if (s.getTime() >= now.getTime()) return;
      const clippedEnd = e.getTime() > now.getTime() ? now : e;
      out.push({ kind: 'steps', key: `steps-${day.date}-${i}`, fingerprint: String(count), start: iso(s), end: iso(clippedEnd), count });
    });
  } else if (day.steps > 0) {
    out.push({ kind: 'steps', key: `steps-${day.date}`, fingerprint: String(day.steps), ...whole, count: day.steps });
  }

  if (day.distanceMeters > 0) {
    out.push({ kind: 'distance', key: `distance-${day.date}`, fingerprint: String(day.distanceMeters), ...whole, meters: day.distanceMeters });
  }
  if (day.caloriesKcal > 0) {
    out.push({ kind: 'calories', key: `calories-${day.date}`, fingerprint: String(day.caloriesKcal), ...whole, kcal: day.caloriesKcal });
  }

  if (day.hrSamples.length > 0 && day.hrSamples.length <= MAX_HR_SLOTS) {
    const samples: { time: string; bpm: number }[] = [];
    day.hrSamples.forEach((bpm, i) => {
      if (bpm < 30 || bpm > 240) return;
      const t = addMinutes(start, i * HR_SLOT_MINUTES);
      if (t.getTime() > now.getTime()) return;
      samples.push({ time: iso(t), bpm });
    });
    if (samples.length > 0) {
      out.push({
        kind: 'heartRate', key: `hr-${day.date}`, fingerprint: samples.map((s) => s.bpm).join(','),
        start: samples[0]!.time, end: iso(addMinutes(new Date(samples[samples.length - 1]!.time), 1)), samples,
      });
    }
  }
  if (day.restingHr >= 30 && day.restingHr <= 200) {
    out.push({ kind: 'restingHeartRate', key: `resting-hr-${day.date}`, fingerprint: String(day.restingHr), time: iso(end), bpm: day.restingHr });
  }

  const segs = (day.sleepSegments ?? []).filter((s) => Date.parse(s.end) <= now.getTime());
  if (segs.length > 0) {
    const sorted = [...segs].sort((a, b) => a.start.localeCompare(b.start));
    out.push({
      kind: 'sleep', key: `sleep-${day.date}`,
      fingerprint: sorted.map((s) => `${s.stage}@${s.start}-${s.end}`).join('|'),
      start: sorted[0]!.start, end: sorted.reduce((m, s) => (s.end > m ? s.end : m), sorted[0]!.end),
      stages: sorted.map((s) => ({ ...s })),
    });
  }
  return out;
}

export function workoutActivity(activityType: string): WorkoutActivity {
  const t = activityType.toLowerCase();
  if (t.includes('run')) return 'run';
  if (t.includes('walk')) return 'walk';
  if (t.includes('cycl') || t.includes('bike') || t.includes('ride')) return 'ride';
  if (t.includes('hike')) return 'hike';
  return 'other';
}

export function workoutSample(route: GpsWorkoutRoute): WorkoutSample | null {
  const start = Date.parse(route.startedAt);
  const end = Date.parse(route.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    kind: 'workout', key: `workout-${route.id}`,
    fingerprint: `${route.startedAt}|${route.endedAt}|${route.distanceMeters}|${route.caloriesKcal}|${route.waypoints.length}`,
    start: route.startedAt, end: route.endedAt, routeId: route.id, name: route.name,
    activity: workoutActivity(route.activityType), distanceMeters: route.distanceMeters, kcal: route.caloriesKcal,
    durationSec: route.durationSec,
    route: route.waypoints
      .filter((w) => Number.isFinite(Date.parse(w.timestamp)))
      .map((w) => ({ time: w.timestamp, lat: w.lat, lng: w.lng, ...(w.elevationMeters !== undefined ? { altitude: w.elevationMeters } : {}) })),
  };
}
