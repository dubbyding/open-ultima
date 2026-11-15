/**
 * Strava-style numbers from a GPS track: distance, moving time, pace, climb,
 * per-km splits and heart rate. Pure functions so they run the same on the
 * live recording screen, on saved workouts, and in tests.
 */
import { haversineDistanceMeters, isValidGpsCoordinate } from '../map/geoMath.ts';
import type { GpsWaypoint } from '../storage/types.ts';

export type Sport = 'run' | 'walk' | 'ride' | 'hike';

/** `watchType` = the watch's workout byte (ULTIMA Fit GpsTrainingType mapping). */
export const SPORTS: readonly { key: Sport; label: string; icon: string; activityType: string; watchType: number }[] = [
  { key: 'run', label: 'Run', icon: 'run', activityType: 'outdoor_run', watchType: 0x01 },
  { key: 'walk', label: 'Walk', icon: 'walk', activityType: 'outdoor_walk', watchType: 0x00 },
  { key: 'ride', label: 'Ride', icon: 'bike', activityType: 'cycling', watchType: 0x02 },
  { key: 'hike', label: 'Hike', icon: 'hiking', activityType: 'trail_hike', watchType: 0x19 },
];

export function sportOf(activityType: string): Sport {
  const t = activityType.toLowerCase();
  if (t.includes('cycl') || t.includes('bike') || t.includes('ride')) return 'ride';
  if (t.includes('walk')) return 'walk';
  if (t.includes('hik')) return 'hike';
  return 'run';
}

/** A raw fix from the phone's GPS. */
export interface RawFix {
  time: number;
  lat: number;
  lng: number;
  altitude?: number | null;
  accuracy?: number | null;
  speed?: number | null;
}

/** Fixes worse than this are dropped (metres). */
export const MAX_ACCURACY_M = 30;
/** A gap longer than this between points is a pause: no distance or moving time across it. */
export const PAUSE_GAP_SEC = 60;
/** Below this speed the athlete is treated as stopped (m/s). */
const MOVING_SPEED = 0.5;
/** Ignore altitude changes smaller than this when adding up climb (GPS altitude is noisy). */
const CLIMB_THRESHOLD_M = 3;
const MAX_SPEED: Record<Sport, number> = { run: 12, walk: 6, ride: 30, hike: 6 };

/** Auto-pause: below this speed (m/s) counts as stopped… */
export const STOPPED_SPEED: Record<Sport, number> = { run: 0.5, walk: 0.4, ride: 1.0, hike: 0.4 };
/** …for this long before the clock pauses. */
export const AUTO_PAUSE_AFTER_MS = 10_000;
/** Speed is averaged over this window for max speed, so one GPS jump doesn't count. */
const SPEED_WINDOW_SEC = 5;

/**
 * Decides whether a new fix goes into the track: drops inaccurate fixes,
 * teleports (faster than the sport allows) and jitter while standing still.
 */
export function acceptFix(prev: RawFix | null, next: RawFix, sport: Sport): boolean {
  if (!isValidGpsCoordinate(next.lat, next.lng)) return false;
  if (next.accuracy != null && next.accuracy > MAX_ACCURACY_M) return false;
  if (!prev) return true;
  const dt = (next.time - prev.time) / 1000;
  if (dt <= 0) return false;
  const d = haversineDistanceMeters(prev, next);
  if (dt < PAUSE_GAP_SEC && d / dt > MAX_SPEED[sport]) return false;
  // Within the GPS error circle: only keep a point every 10 s so time still advances.
  const jitter = Math.max(3, Math.min(next.accuracy ?? 5, 10));
  return d >= jitter || dt >= 10;
}

export interface Split {
  index: number;
  /** Metres covered in this split (1000 except possibly the last). */
  meters: number;
  movingSec: number;
  elevationChange: number;
  avgHeartRate: number | null;
}

export interface TrackStats {
  distanceMeters: number;
  movingSec: number;
  elapsedSec: number;
  elevationGain: number;
  elevationLoss: number;
  minElevation: number | null;
  maxElevation: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  /** Seconds per km over moving time, null before any distance. */
  paceSecPerKm: number | null;
  /** km/h over moving time. */
  speedKmh: number | null;
  /** Fastest speed held over a few seconds (km/h). */
  maxSpeedKmh: number | null;
  splits: Split[];
  /** [metres from start, smoothed altitude] for an elevation chart. */
  elevationProfile: [number, number][];
}

function smoothAltitudes(values: readonly (number | undefined)[]): (number | undefined)[] {
  return values.map((v, i) => {
    if (v === undefined) return undefined;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(values.length - 1, i + 2); j++) {
      const x = values[j];
      if (x !== undefined) {
        sum += x;
        n++;
      }
    }
    return sum / n;
  });
}

export function computeTrackStats(points: readonly GpsWaypoint[]): TrackStats {
  const times = points.map((p) => Date.parse(p.timestamp));
  const alts = smoothAltitudes(points.map((p) => (p.elevationMeters !== undefined && Number.isFinite(p.elevationMeters) ? p.elevationMeters : undefined)));
  let distance = 0;
  let moving = 0;
  let gain = 0;
  let loss = 0;
  let climbRef: number | undefined;
  const splits: Split[] = [];
  let split = { meters: 0, movingSec: 0, startAlt: undefined as number | undefined, hrSum: 0, hrN: 0 };
  const profile: [number, number][] = [];
  const hrs: number[] = [];

  const closeSplit = (endAlt: number | undefined): void => {
    splits.push({
      index: splits.length + 1,
      meters: Math.round(split.meters),
      movingSec: Math.round(split.movingSec),
      elevationChange: split.startAlt !== undefined && endAlt !== undefined ? Math.round(endAlt - split.startAlt) : 0,
      avgHeartRate: split.hrN > 0 ? Math.round(split.hrSum / split.hrN) : null,
    });
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const alt = alts[i];
    if (p.heartRateBpm !== undefined && p.heartRateBpm >= 30 && p.heartRateBpm <= 240) {
      hrs.push(p.heartRateBpm);
      split.hrSum += p.heartRateBpm;
      split.hrN++;
    }
    if (split.startAlt === undefined) split.startAlt = alt;
    if (alt !== undefined) {
      if (climbRef === undefined) climbRef = alt;
      else if (alt - climbRef >= CLIMB_THRESHOLD_M) { gain += alt - climbRef; climbRef = alt; }
      else if (climbRef - alt >= CLIMB_THRESHOLD_M) { loss += climbRef - alt; climbRef = alt; }
    }
    if (i > 0) {
      const dt = (times[i]! - times[i - 1]!) / 1000;
      if (Number.isFinite(dt) && dt > 0 && dt <= PAUSE_GAP_SEC) {
        let d = haversineDistanceMeters(points[i - 1]!, p);
        if (d / dt >= MOVING_SPEED) moving += dt;
        // Spread the step across km boundaries so splits are exact.
        let stepTime = d / dt >= MOVING_SPEED ? dt : 0;
        while (split.meters + d >= 1000) {
          const part = 1000 - split.meters;
          const frac = d > 0 ? part / d : 0;
          split.meters = 1000;
          split.movingSec += stepTime * frac;
          closeSplit(alt);
          distance += part;
          d -= part;
          stepTime -= stepTime * frac;
          split = { meters: 0, movingSec: 0, startAlt: alt, hrSum: 0, hrN: 0 };
        }
        split.meters += d;
        split.movingSec += stepTime;
        distance += d;
      }
    }
    if (alt !== undefined) profile.push([Math.round(distance), Math.round(alt * 10) / 10]);
  }
  if (split.meters >= 50) closeSplit(alts[alts.length - 1]);

  // Max speed: distance over a short window ending at each point, skipping pauses.
  let maxSpeed = 0;
  let j = 0;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dt = (times[i]! - times[i - 1]!) / 1000;
    cum.push(cum[i - 1]! + (dt > 0 && dt <= PAUSE_GAP_SEC ? haversineDistanceMeters(points[i - 1]!, points[i]!) : 0));
  }
  for (let i = 1; i < points.length; i++) {
    if ((times[i]! - times[i - 1]!) / 1000 > PAUSE_GAP_SEC) { j = i; continue; }
    while (j < i - 1 && (times[i]! - times[j + 1]!) / 1000 >= SPEED_WINDOW_SEC) j++;
    const dt = (times[i]! - times[j]!) / 1000;
    if (dt >= SPEED_WINDOW_SEC / 2) maxSpeed = Math.max(maxSpeed, (cum[i]! - cum[j]!) / dt);
  }

  const definedAlts = alts.filter((a): a is number => a !== undefined);
  const elapsed = points.length > 1 ? Math.max(0, (times[times.length - 1]! - times[0]!) / 1000) : 0;
  return {
    distanceMeters: Math.round(distance),
    movingSec: Math.round(moving),
    elapsedSec: Math.round(elapsed),
    elevationGain: Math.round(gain),
    elevationLoss: Math.round(loss),
    minElevation: definedAlts.length > 0 ? Math.round(Math.min(...definedAlts)) : null,
    maxElevation: definedAlts.length > 0 ? Math.round(Math.max(...definedAlts)) : null,
    avgHeartRate: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHeartRate: hrs.length > 0 ? Math.max(...hrs) : null,
    paceSecPerKm: distance >= 10 && moving > 0 ? moving / (distance / 1000) : null,
    speedKmh: moving > 0 ? (distance / moving) * 3.6 : null,
    maxSpeedKmh: maxSpeed > 0 ? Math.round(maxSpeed * 36) / 10 : null,
    splits,
    elevationProfile: downsample(profile, 120),
  };
}

function downsample<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]!);
  out.push(xs[xs.length - 1]!);
  return out;
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
