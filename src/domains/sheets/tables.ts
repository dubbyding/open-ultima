/**
 * Flattens the app's local data into one table per sheet tab for the Google
 * Sheets export. Pure: the sheet is a one-way copy of these rows.
 */
import type { OfflineAppState } from '../storage/types.ts';
import { HR_SLOT_MINUTES, localDayStart } from '../healthSync/samples.ts';
import { computeTrackStats, sportOf } from '../workouts/trackStats.ts';

export type Cell = string | number | boolean;
export interface SheetTable {
  title: string;
  rows: Cell[][];
}

const iso = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '');
const localTime = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function buildSheetTables(state: OfflineAppState): SheetTable[] {
  const days = [...state.healthHistory].sort((a, b) => a.date.localeCompare(b.date));
  const routes = [...state.gpsRoutes].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const health: SheetTable = {
    title: 'Daily health',
    rows: [
      ['date', 'steps', 'distance_m', 'calories_kcal', 'resting_hr', 'spo2_pct', 'systolic', 'diastolic', 'stress',
        'sleep_deep_min', 'sleep_light_min', 'sleep_rem_min', 'sleep_awake_min'],
      ...days.map((d) => [d.date, d.steps, d.distanceMeters, d.caloriesKcal, d.restingHr, d.spo2Percent, d.systolicBp, d.diastolicBp,
        d.stressScore, d.deepSleepMin, d.lightSleepMin, d.remSleepMin, d.awakeMin]),
    ],
  };

  const steps: SheetTable = {
    title: 'Steps by half hour',
    rows: [['date', 'from', 'steps'], ...days.flatMap((d) =>
      (d.stepBuckets48 ?? []).flatMap((n, i) => (n > 0 ? [[d.date, `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, n]] : [])))],
  };

  const heart: SheetTable = {
    title: 'Heart rate',
    rows: [['date', 'time', 'bpm'], ...days.flatMap((d) => {
      if (d.hrSamples.length > (24 * 60) / HR_SLOT_MINUTES) return [];
      const start = localDayStart(d.date);
      return d.hrSamples.flatMap((bpm, i) =>
        bpm > 0 ? [[d.date, localTime(new Date(start.getTime() + i * HR_SLOT_MINUTES * 60_000)), bpm]] : []);
    })],
  };

  const sleep: SheetTable = {
    title: 'Sleep stages',
    rows: [['date', 'stage', 'start', 'end', 'minutes'], ...days.flatMap((d) =>
      (d.sleepSegments ?? []).map((s) => [d.date, s.stage, s.start, s.end, Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60_000)]))],
  };

  const workouts: SheetTable = {
    title: 'Workouts',
    rows: [
      ['id', 'name', 'sport', 'started_at', 'ended_at', 'distance_m', 'moving_sec', 'elapsed_sec', 'pace_sec_per_km', 'elevation_gain_m',
        'avg_hr', 'max_hr', 'calories_kcal', 'points', 'source'],
      ...routes.map((r) => {
        const st = r.waypoints.length > 1 ? computeTrackStats(r.waypoints) : null;
        const moving = st?.movingSec || r.durationSec;
        return [r.id, r.name, sportOf(r.activityType), r.startedAt, r.endedAt, r.distanceMeters, moving,
          Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000),
          r.distanceMeters > 0 && moving > 0 ? Math.round(moving / (r.distanceMeters / 1000)) : '',
          r.elevationGainMeters ?? st?.elevationGain ?? '', r.avgHeartRateBpm ?? '', r.maxHeartRateBpm ?? '', r.caloriesKcal || '',
          r.waypoints.length, r.id.startsWith('phone-') ? 'phone' : 'watch'];
      }),
    ],
  };

  const points: SheetTable = {
    title: 'Route points',
    rows: [['workout_id', 'time', 'lat', 'lng', 'elevation_m', 'hr'], ...routes.flatMap((r) =>
      r.waypoints.map((w) => [r.id, w.timestamp, w.lat, w.lng, w.elevationMeters ?? '', w.heartRateBpm ?? '']))],
  };

  const alarms: SheetTable = {
    title: 'Alarms',
    rows: [['id', 'label', 'enabled', 'time', 'repeat_mask'], ...state.watchAlarms.map((a) =>
      [a.id, a.label, a.enabled, `${String(a.hour).padStart(2, '0')}:${String(a.minute).padStart(2, '0')}`, a.repeatMask])],
  };

  const devices: SheetTable = {
    title: 'Devices',
    rows: [['id', 'name', 'kind', 'chip', 'mac', 'last_connected', 'last_location'], ...state.pairedDevices.map((d) =>
      [d.id, d.name, d.kind, d.chip ?? '', d.mac ?? '', iso(d.lastConnectedAt),
        d.lastKnownLocation ? `${d.lastKnownLocation.lat.toFixed(5)},${d.lastKnownLocation.lng.toFixed(5)}` : ''])],
  };

  const eq: SheetTable = {
    title: 'EQ presets',
    rows: [['id', 'name', 'created', ...Array.from({ length: 10 }, (_, i) => `band_${i + 1}`)], ...state.customEqProfiles.map((p) =>
      [p.id, p.name, iso(p.createdAt), ...p.gains])],
  };

  const earbuds: SheetTable = {
    title: 'Earbud settings',
    rows: [['device_id', 'setting', 'value'], ...Object.entries(state.earbudPrefs).flatMap(([id, p]) => [
      [id, 'noise_control', p.ancMode], [id, 'low_latency', p.gameMode], [id, 'in_ear_detect', p.inEarDetect],
      [id, 'led', p.ledOn], [id, 'voice_language', p.voiceLanguage], [id, 'name', p.customBtName ?? ''],
      [id, 'key_mappings', JSON.stringify(p.keyMappings)],
    ] as Cell[][])],
  };

  const w = state.watchSettings;
  const watch: SheetTable = {
    title: 'Watch settings',
    rows: [['setting', 'value'],
      ['step_goal', w.goalSteps], ['24_hour_clock', w.is24Hour], ['raise_to_wake', w.quickView], ['watch_face', w.watchFaceId],
      ['imperial_units', w.imperialUnits], ['language_id', w.languageId], ['movement_reminder', w.sedentaryReminder],
      ['all_day_hr_interval_min', w.hrIntervalMinutes], ['drink_reminder', JSON.stringify(w.drinkReminderPeriod)],
      ['notification_rules', JSON.stringify(w.notificationRules)]],
  };

  return [health, steps, heart, sleep, workouts, points, alarms, devices, eq, earbuds, watch];
}
