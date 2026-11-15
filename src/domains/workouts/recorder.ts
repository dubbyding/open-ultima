/**
 * Records a workout with the phone's GPS, like Strava's record screen.
 *
 * Location comes from an expo-location background task running as an Android
 * foreground service ("Recording workout" notification), so the track keeps
 * growing with the screen off. The in-progress track is saved every few
 * seconds, so a crash or app kill doesn't lose the workout.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { GpsWaypoint, GpsWorkoutRouteInput } from '../storage/types.ts';
import { AUTO_PAUSE_AFTER_MS, SPORTS, STOPPED_SPEED, acceptFix, computeTrackStats } from './trackStats.ts';
import { haversineDistanceMeters } from '../map/geoMath.ts';
import type { RawFix, Sport, TrackStats } from './trackStats.ts';

export const WORKOUT_LOCATION_TASK = 'ultima-workout-location';
const DRAFT_KEY = 'ultima.workoutDraft.v1';
const AUTO_PAUSE_KEY = 'ultima.workoutAutoPause.v1';
/** Fixes less accurate than this are ignored for speed (metres). */
const SPEED_ACCURACY_M = 50;
/** Heart rate from the watch is attached to points only while this fresh. */
const HR_FRESH_MS = 15_000;

export type RecorderStatus = 'idle' | 'recording' | 'paused';

export interface RecorderState {
  status: RecorderStatus;
  sport: Sport;
  startedAt: number | null;
  /** Time spent recording, excluding pauses. */
  activeMs: number;
  /** When the current recording stretch began (null while paused/idle). */
  resumedAt: number | null;
  points: GpsWaypoint[];
  lastFix: RawFix | null;
  /** Latest accuracy reported by GPS, for the "waiting for GPS" hint. */
  accuracy: number | null;
  /** True when Android only allows location while the app is open. */
  foregroundOnly: boolean;
  /** Current speed (m/s, smoothed) and when it was measured. */
  speedMps: number | null;
  speedAt: number | null;
  /** Pause the clock automatically while standing still. */
  autoPause: boolean;
  /** Recording, but the clock is stopped because the athlete isn't moving. */
  autoPaused: boolean;
  /** When speed first dropped below the stopped threshold. */
  stillSince: number | null;
  /** Previous raw fix (any accuracy filter aside) for speed when GPS doesn't report it. */
  lastRaw: RawFix | null;
}

const initial = (): RecorderState => ({
  status: 'idle', sport: 'run', startedAt: null, activeMs: 0, resumedAt: null, points: [], lastFix: null, accuracy: null, foregroundOnly: false,
  speedMps: null, speedAt: null, autoPause: true, autoPaused: false, stillSince: null, lastRaw: null,
});

class WorkoutRecorder {
  private state: RecorderState = initial();
  private readonly listeners = new Set<(s: RecorderState) => void>();
  private hr: { bpm: number; at: number } | null = null;
  private watchSub: Location.LocationSubscription | null = null;
  private lastDraftSave = 0;
  private restored: Promise<void> | null = null;

  getState(): RecorderState {
    return this.state;
  }

  subscribe(fn: (s: RecorderState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: Partial<RecorderState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Called by the app whenever the watch reports a heart rate. */
  setHeartRate(bpm: number): void {
    if (bpm >= 30 && bpm <= 240) this.hr = { bpm, at: Date.now() };
  }

  elapsedMs(now = Date.now()): number {
    return this.state.activeMs + (this.state.resumedAt ? now - this.state.resumedAt : 0);
  }

  stats(): TrackStats {
    return computeTrackStats(this.state.points);
  }

  /** Turns auto-pause on/off; remembered for the next workouts. */
  async setAutoPause(on: boolean): Promise<void> {
    if (!on && this.state.autoPaused) this.set({ autoPaused: false, resumedAt: Date.now(), stillSince: null });
    this.set({ autoPause: on, ...(on ? {} : { stillSince: null }) });
    try { await AsyncStorage.setItem(AUTO_PAUSE_KEY, on ? '1' : '0'); } catch { /* best effort */ }
    await this.saveDraft(true);
  }

  /** Brings back a workout that was recording when the app was killed. */
  restore(): Promise<void> {
    this.restored ??= (async () => {
      try {
        const pref = await AsyncStorage.getItem(AUTO_PAUSE_KEY).catch(() => null);
        if (pref !== null && this.state.status === 'idle') this.set({ autoPause: pref === '1' });
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const draft = { ...initial(), autoPause: this.state.autoPause, ...(JSON.parse(raw) as Partial<RecorderState>) } as RecorderState;
        if (draft.status === 'idle' || !draft.startedAt) return;
        const stillTracking = draft.status === 'recording' &&
          (await Location.hasStartedLocationUpdatesAsync(WORKOUT_LOCATION_TASK).catch(() => false));
        if (stillTracking) {
          // The GPS service outlived the app; carry on recording.
          this.set({ ...draft });
          return;
        }
        // Count the time until the kill as recorded; continue paused so the user decides.
        const lastPoint = draft.points[draft.points.length - 1];
        const until = lastPoint ? Date.parse(lastPoint.timestamp) : draft.resumedAt ?? draft.startedAt;
        this.set({ ...draft, status: 'paused', autoPaused: false, stillSince: null, activeMs: draft.activeMs + (draft.resumedAt ? Math.max(0, until - draft.resumedAt) : 0), resumedAt: null });
        await this.stopUpdates();
      } catch {
        // Unreadable draft: nothing to restore.
      }
    })();
    return this.restored;
  }

  private async saveDraft(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastDraftSave < 5000) return;
    this.lastDraftSave = now;
    try {
      if (this.state.status === 'idle') await AsyncStorage.removeItem(DRAFT_KEY);
      else await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(this.state));
    } catch {
      // Draft saving is best effort.
    }
  }

  /** Feeds GPS fixes from the background task or the foreground watcher. */
  ingest(locations: readonly Location.LocationObject[]): void {
    if (this.state.status !== 'recording') return;
    let { lastFix, lastRaw, speedMps, speedAt, autoPaused, stillSince, activeMs, resumedAt } = this.state;
    const { sport, autoPause } = this.state;
    const added: GpsWaypoint[] = [];
    let accuracy = this.state.accuracy;
    for (const loc of locations) {
      const fix: RawFix = {
        time: loc.timestamp, lat: loc.coords.latitude, lng: loc.coords.longitude,
        altitude: loc.coords.altitude, accuracy: loc.coords.accuracy, speed: loc.coords.speed,
      };
      accuracy = fix.accuracy ?? accuracy;
      if (lastRaw && fix.time <= lastRaw.time) continue;

      // Current speed: GPS doppler speed when given, else distance since the previous fix.
      if (fix.accuracy == null || fix.accuracy <= SPEED_ACCURACY_M) {
        let v: number | null = fix.speed != null && fix.speed >= 0 ? fix.speed : null;
        if (v === null && lastRaw) {
          const dt = (fix.time - lastRaw.time) / 1000;
          if (dt > 0 && dt <= 30) v = haversineDistanceMeters(lastRaw, fix) / dt;
        }
        if (v !== null) {
          speedMps = speedMps === null || speedAt === null || fix.time - speedAt > 10_000 ? v : speedMps * 0.6 + v * 0.4;
          speedAt = fix.time;
        }
        lastRaw = fix;
      }

      // Auto-pause: stopped for AUTO_PAUSE_AFTER_MS → clock stops (backdated to when you stopped);
      // moving again → clock restarts.
      if (autoPause && speedMps !== null && speedAt === fix.time) {
        const stopped = speedMps < STOPPED_SPEED[sport];
        if (!autoPaused) {
          if (stopped) {
            stillSince ??= fix.time;
            if (fix.time - stillSince >= AUTO_PAUSE_AFTER_MS && resumedAt !== null) {
              activeMs += Math.max(0, stillSince - resumedAt);
              resumedAt = null;
              autoPaused = true;
            }
          } else stillSince = null;
        } else if (speedMps >= STOPPED_SPEED[sport] * 1.5) {
          autoPaused = false;
          stillSince = null;
          resumedAt = fix.time;
        }
      }
      if (autoPaused) continue;
      if (resumedAt && fix.time < resumedAt - 2000) continue;
      if (!acceptFix(lastFix, fix, sport)) continue;
      lastFix = fix;
      const hr = this.hr && Math.abs(fix.time - this.hr.at) <= HR_FRESH_MS ? this.hr.bpm : undefined;
      added.push({
        lat: fix.lat, lng: fix.lng, timestamp: new Date(fix.time).toISOString(),
        ...(fix.altitude != null && Number.isFinite(fix.altitude) ? { elevationMeters: Math.round(fix.altitude * 10) / 10 } : {}),
        ...(hr !== undefined ? { heartRateBpm: hr } : {}),
      });
    }
    this.set({
      points: added.length > 0 ? [...this.state.points, ...added] : this.state.points,
      lastFix, accuracy, lastRaw, speedMps, speedAt, autoPaused, stillSince, activeMs, resumedAt,
    });
    void this.saveDraft();
  }

  private async startUpdates(): Promise<void> {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) throw new Error('Allow location so the workout can be tracked.');
    if (!(await Location.hasServicesEnabledAsync())) throw new Error('Turn on Location (GPS) in quick settings.');
    let background = false;
    try {
      background = (await Location.requestBackgroundPermissionsAsync()).granted;
    } catch {
      background = false;
    }
    if (background) {
      await Location.startLocationUpdatesAsync(WORKOUT_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Recording workout',
          notificationBody: 'Ultima Open is tracking your route.',
          notificationColor: '#4DD0E1',
          killServiceOnDestroy: false,
        },
      });
      this.set({ foregroundOnly: false });
    } else {
      // Without "Allow all the time" the track only grows while the app is open.
      this.watchSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (loc) => this.ingest([loc]),
      );
      this.set({ foregroundOnly: true });
    }
  }

  private async stopUpdates(): Promise<void> {
    this.watchSub?.remove();
    this.watchSub = null;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(WORKOUT_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(WORKOUT_LOCATION_TASK);
    } catch {
      // Not running.
    }
  }

  async start(sport: Sport): Promise<void> {
    await this.restore();
    if (this.state.status !== 'idle') throw new Error('A workout is already in progress.');
    const now = Date.now();
    this.set({ ...initial(), autoPause: this.state.autoPause, status: 'recording', sport, startedAt: now, resumedAt: now });
    try {
      await this.startUpdates();
    } catch (err) {
      this.set(initial());
      throw err;
    }
    await this.saveDraft(true);
  }

  async pause(): Promise<void> {
    if (this.state.status !== 'recording') return;
    await this.stopUpdates();
    this.set({ status: 'paused', activeMs: this.elapsedMs(), resumedAt: null, autoPaused: false, stillSince: null, speedMps: null, speedAt: null });
    await this.saveDraft(true);
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return;
    this.set({ status: 'recording', resumedAt: Date.now(), autoPaused: false, stillSince: null, lastRaw: null });
    await this.startUpdates();
    await this.saveDraft(true);
  }

  async discard(): Promise<void> {
    await this.stopUpdates();
    this.set({ ...initial(), autoPause: this.state.autoPause });
    await this.saveDraft(true);
  }

  /** Stops and returns the workout ready for `OfflineStore.saveGpsRoute`, or null if too short. */
  async finish(name: string): Promise<GpsWorkoutRouteInput | null> {
    await this.stopUpdates();
    const s = this.state;
    const elapsed = this.elapsedMs();
    const stats = computeTrackStats(s.points);
    const startedAt = s.startedAt ?? Date.now();
    const sport = SPORTS.find((x) => x.key === s.sport)!;
    this.set({ ...initial(), autoPause: s.autoPause });
    await this.saveDraft(true);
    if (s.points.length < 2 && elapsed < 60_000) return null;
    const endedAt = s.points.length > 0 ? Math.max(Date.parse(s.points[s.points.length - 1]!.timestamp), startedAt + elapsed) : startedAt + elapsed;
    return {
      id: `phone-${startedAt}`,
      name: name.trim() || `${sport.label} · ${new Date(startedAt).toLocaleDateString()}`,
      activityType: sport.activityType,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      distanceMeters: stats.distanceMeters,
      durationSec: Math.round(stats.movingSec > 0 ? stats.movingSec : elapsed / 1000),
      caloriesKcal: 0,
      ...(stats.avgHeartRate !== null ? { avgHeartRateBpm: stats.avgHeartRate } : {}),
      ...(stats.maxHeartRate !== null ? { maxHeartRateBpm: stats.maxHeartRate } : {}),
      elevationGainMeters: stats.elevationGain,
      waypoints: s.points,
    };
  }
}

export const workoutRecorder = new WorkoutRecorder();

// Must be defined at startup (imported from index.ts) so Android can deliver
// locations to the task even when the app was restarted in the background.
TaskManager.defineTask(WORKOUT_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  await workoutRecorder.restore();
  workoutRecorder.ingest(locations);
});
