/**
 * Relational SQLite synchronization, hydration, and parameterized query helpers.
 */

import type {
  CustomEqProfile, DailyHealthRecord, DeviceKind, EarbudChip, EarbudPrefs,
  GpsWaypoint, GpsWorkoutRoute, HealthAggregates, OfflineAppState,
  PairedDeviceRecord, WatchAlarmRecord, WatchSettings,
} from '../types.ts';
import { cloneOfflineAppState, createDefaultWatchSettings } from '../validatorsAndDefaults.ts';
import type { SqliteDriver } from './drivers.ts';
import { PREF_KEY_EARBUD_PREFS, PREF_KEY_WATCH_SETTINGS } from './schema.ts';
import type {
  AggregateRow, AppPreferenceRow, CustomEqRow, DailyHealthRow, GpsRouteRow,
  GpsWaypointRow, PairedDeviceRow, TableCountRow, WatchAlarmRow,
} from './schema.ts';

const DAILY_HEALTH_COLS =
  'date, steps, distance_meters, calories_kcal, step_buckets_json, deep_sleep_min, light_sleep_min, rem_sleep_min, awake_min, resting_hr, hr_samples_json, spo2_percent, systolic_bp, diastolic_bp, stress_score';
const GPS_ROUTE_COLS =
  'id, start_time, activity_type, distance_meters, duration_sec, calories_kcal, avg_hr, max_hr, device_id, name, ended_at, elevation_gain_meters';
const GPS_WAYPOINT_COLS =
  'id, route_id, seq_idx, lat, lng, timestamp, hr_bpm, is_paused, elevation_meters';

function parseJsonSafe<T>(jsonText: string | null, fallback: T): T {
  if (typeof jsonText !== 'string' || jsonText.length === 0) return fallback;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return fallback;
  }
}

function parseNumberArray(jsonText: string | null): number[] | undefined {
  if (jsonText === null) return undefined;
  const parsed = parseJsonSafe<unknown>(jsonText, null);
  return Array.isArray(parsed)
    ? parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : undefined;
}

const epochMsToIso = (ms: number): string =>
  Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();

const isoToEpochMs = (iso: string, fallback: number = 0): number => {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function mapPairedDeviceRow(row: PairedDeviceRow): PairedDeviceRecord {
  const record: PairedDeviceRecord = {
    id: row.id,
    name: row.name,
    kind: row.kind as DeviceKind,
    lastConnectedAt: Number(row.last_connected_at),
  };
  if (row.chip === 'JL' || row.chip === 'BT') record.chip = row.chip as EarbudChip;
  if (row.pid !== null && row.pid !== undefined) record.pid = Number(row.pid);
  if (row.mac !== null && row.mac !== undefined) record.mac = row.mac;
  if (row.lat !== null && row.lat !== undefined && row.lng !== null && row.lng !== undefined) {
    record.lastKnownLocation = {
      lat: Number(row.lat),
      lng: Number(row.lng),
      note: row.loc_note ?? '',
      savedAt: row.loc_saved_at !== null && row.loc_saved_at !== undefined ? Number(row.loc_saved_at) : 0,
    };
  }
  return record;
}

function mapHealthRow(row: DailyHealthRow): DailyHealthRecord {
  const record: DailyHealthRecord = {
    date: row.date,
    steps: Number(row.steps),
    distanceMeters: Number(row.distance_meters),
    caloriesKcal: Number(row.calories_kcal),
    deepSleepMin: Number(row.deep_sleep_min),
    lightSleepMin: Number(row.light_sleep_min),
    remSleepMin: Number(row.rem_sleep_min),
    awakeMin: Number(row.awake_min),
    restingHr: Number(row.resting_hr),
    hrSamples: parseNumberArray(row.hr_samples_json) ?? [],
    spo2Percent: Number(row.spo2_percent),
    systolicBp: Number(row.systolic_bp),
    diastolicBp: Number(row.diastolic_bp),
    stressScore: Number(row.stress_score),
  };
  const stepBuckets = parseNumberArray(row.step_buckets_json);
  if (stepBuckets !== undefined) record.stepBuckets48 = stepBuckets;
  return record;
}

function mapWaypointRow(row: GpsWaypointRow): GpsWaypoint {
  const wp: GpsWaypoint = {
    lat: Number(row.lat),
    lng: Number(row.lng),
    timestamp: epochMsToIso(Number(row.timestamp)),
  };
  if (row.hr_bpm !== null && row.hr_bpm !== undefined) wp.heartRateBpm = Number(row.hr_bpm);
  if (row.elevation_meters !== null && row.elevation_meters !== undefined) {
    wp.elevationMeters = Number(row.elevation_meters);
  }
  return wp;
}

function mapGpsRouteRow(row: GpsRouteRow, waypoints: GpsWaypoint[]): GpsWorkoutRoute {
  const startMs = Number(row.start_time);
  const durationSec = Number(row.duration_sec);
  const startedAt = epochMsToIso(startMs);
  const endedAt =
    row.ended_at !== null && row.ended_at !== undefined
      ? epochMsToIso(Number(row.ended_at))
      : epochMsToIso(startMs + durationSec * 1000);
  const route: GpsWorkoutRoute = {
    id: row.id,
    name: row.name && row.name.trim().length > 0 ? row.name : `${row.activity_type} (${startedAt.slice(0, 10)})`,
    activityType: row.activity_type,
    startedAt,
    endedAt,
    distanceMeters: Number(row.distance_meters),
    durationSec,
    caloriesKcal: Number(row.calories_kcal),
    waypoints,
  };
  if (row.device_id !== null && row.device_id !== undefined) route.deviceId = row.device_id;
  if (row.avg_hr !== null && row.avg_hr !== undefined) route.avgHeartRateBpm = Number(row.avg_hr);
  if (row.max_hr !== null && row.max_hr !== undefined) route.maxHeartRateBpm = Number(row.max_hr);
  if (row.elevation_gain_meters !== null && row.elevation_gain_meters !== undefined) {
    route.elevationGainMeters = Number(row.elevation_gain_meters);
  }
  return route;
}

/** Atomically replaces relational table contents from `state` in one transaction. */
export async function syncAppStateToSqlite(
  driver: SqliteDriver,
  state: OfflineAppState,
): Promise<void> {
  await driver.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
  try {
    for (const table of [
      'gps_waypoints', 'gps_workout_routes', 'paired_devices',
      'custom_eq_profiles', 'daily_health_records', 'watch_alarms', 'app_preferences',
    ]) {
      await driver.run(`DELETE FROM ${table};`);
    }

    for (const dev of state.pairedDevices) {
      await driver.run(
        `INSERT INTO paired_devices (id, name, kind, chip, pid, mac, last_connected_at, lat, lng, loc_note, loc_saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          dev.id, dev.name, dev.kind, dev.chip ?? null, dev.pid ?? null, dev.mac ?? null,
          dev.lastConnectedAt, dev.lastKnownLocation?.lat ?? null, dev.lastKnownLocation?.lng ?? null,
          dev.lastKnownLocation?.note ?? null, dev.lastKnownLocation?.savedAt ?? null,
        ],
      );
    }

    for (const eq of state.customEqProfiles) {
      await driver.run(
        'INSERT INTO custom_eq_profiles (id, name, gains_json, created_at) VALUES (?, ?, ?, ?);',
        [eq.id, eq.name, JSON.stringify(eq.gains), eq.createdAt],
      );
    }

    for (const day of state.healthHistory) {
      await driver.run(
        `INSERT INTO daily_health_records (${DAILY_HEALTH_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          day.date, day.steps, day.distanceMeters, day.caloriesKcal,
          day.stepBuckets48 !== undefined ? JSON.stringify(day.stepBuckets48) : null,
          day.deepSleepMin, day.lightSleepMin, day.remSleepMin, day.awakeMin,
          day.restingHr, JSON.stringify(day.hrSamples), day.spo2Percent,
          day.systolicBp, day.diastolicBp, day.stressScore,
        ],
      );
    }

    for (const route of state.gpsRoutes ?? []) {
      const startMs = isoToEpochMs(route.startedAt);
      const endMs = isoToEpochMs(route.endedAt, startMs + route.durationSec * 1000);
      await driver.run(
        `INSERT INTO gps_workout_routes (${GPS_ROUTE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          route.id, startMs, route.activityType, route.distanceMeters, route.durationSec,
          route.caloriesKcal, route.avgHeartRateBpm ?? null, route.maxHeartRateBpm ?? null,
          route.deviceId ?? null, route.name, endMs, route.elevationGainMeters ?? null,
        ],
      );
      for (let seqIdx = 0; seqIdx < route.waypoints.length; seqIdx++) {
        const wp = route.waypoints[seqIdx]!;
        const isPaused = wp.lat === 0 && wp.lng === 0 ? 1 : 0;
        await driver.run(
          `INSERT INTO gps_waypoints (route_id, seq_idx, lat, lng, timestamp, hr_bpm, is_paused, elevation_meters)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            route.id, seqIdx, wp.lat, wp.lng, isoToEpochMs(wp.timestamp, startMs),
            wp.heartRateBpm ?? null, isPaused, wp.elevationMeters ?? null,
          ],
        );
      }
    }

    for (const alarm of state.watchAlarms) {
      await driver.run(
        `INSERT INTO watch_alarms (id, enabled, hour, minute, repeat_mask, year, month, day, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [alarm.id, alarm.enabled ? 1 : 0, alarm.hour, alarm.minute, alarm.repeatMask, alarm.year, alarm.month, alarm.day, alarm.label],
      );
    }

    await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?);', [
      PREF_KEY_EARBUD_PREFS, JSON.stringify(state.earbudPrefs),
    ]);
    await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?);', [
      PREF_KEY_WATCH_SETTINGS, JSON.stringify(state.watchSettings),
    ]);
    await driver.exec('COMMIT;');
  } catch (err) {
    try {
      await driver.exec('ROLLBACK;');
    } catch {
      // Ignore rollback failure when transaction already aborted.
    }
    throw err;
  }
}

/** Reconstructs `OfflineAppState` from normalized SQLite tables. */
export async function loadAppStateFromSqlite(
  driver: SqliteDriver,
  fallbackState?: OfflineAppState,
): Promise<OfflineAppState> {
  const deviceRows = await driver.all<PairedDeviceRow>(
    'SELECT id, name, kind, chip, pid, mac, last_connected_at, lat, lng, loc_note, loc_saved_at FROM paired_devices ORDER BY last_connected_at DESC, id ASC;',
  );
  const eqRows = await driver.all<CustomEqRow>(
    'SELECT id, name, gains_json, created_at FROM custom_eq_profiles ORDER BY rowid ASC;',
  );
  const healthRows = await driver.all<DailyHealthRow>(
    `SELECT ${DAILY_HEALTH_COLS} FROM daily_health_records ORDER BY date ASC;`,
  );
  const routeRows = await driver.all<GpsRouteRow>(
    `SELECT ${GPS_ROUTE_COLS} FROM gps_workout_routes ORDER BY start_time DESC, id ASC;`,
  );
  const waypointRows = await driver.all<GpsWaypointRow>(
    `SELECT ${GPS_WAYPOINT_COLS} FROM gps_waypoints ORDER BY route_id ASC, seq_idx ASC, id ASC;`,
  );
  const alarmRows = await driver.all<WatchAlarmRow>(
    'SELECT id, enabled, hour, minute, repeat_mask, year, month, day, label FROM watch_alarms ORDER BY id ASC;',
  );
  const prefRows = await driver.all<AppPreferenceRow>('SELECT key, value_json FROM app_preferences;');

  const hasEntities =
    deviceRows.length > 0 || eqRows.length > 0 || healthRows.length > 0 ||
    routeRows.length > 0 || alarmRows.length > 0;
  if (!hasEntities && prefRows.length === 0 && fallbackState) {
    return cloneOfflineAppState(fallbackState);
  }

  const waypointsByRoute = new Map<string, GpsWaypoint[]>();
  for (const wpRow of waypointRows) {
    const mapped = mapWaypointRow(wpRow);
    const list = waypointsByRoute.get(wpRow.route_id);
    if (list) list.push(mapped);
    else waypointsByRoute.set(wpRow.route_id, [mapped]);
  }

  const prefMap = new Map<string, string>(prefRows.map((r) => [r.key, r.value_json]));
  const customEqProfiles: CustomEqProfile[] = eqRows.map((row) => ({
    id: row.id, name: row.name, gains: parseNumberArray(row.gains_json) ?? [], createdAt: Number(row.created_at),
  }));
  const watchAlarms: WatchAlarmRecord[] = alarmRows.map((row) => ({
    id: Number(row.id), enabled: Number(row.enabled) !== 0, hour: Number(row.hour),
    minute: Number(row.minute), repeatMask: Number(row.repeat_mask), year: Number(row.year),
    month: Number(row.month), day: Number(row.day), label: row.label,
  }));

  return {
    version: 1,
    pairedDevices: deviceRows.map(mapPairedDeviceRow),
    customEqProfiles,
    earbudPrefs: parseJsonSafe<Record<string, EarbudPrefs>>(
      prefMap.get(PREF_KEY_EARBUD_PREFS) ?? null,
      fallbackState?.earbudPrefs ?? {},
    ),
    healthHistory: healthRows.map(mapHealthRow),
    watchAlarms,
    watchSettings: parseJsonSafe<WatchSettings>(
      prefMap.get(PREF_KEY_WATCH_SETTINGS) ?? null,
      fallbackState?.watchSettings ?? createDefaultWatchSettings(),
    ),
    gpsRoutes: routeRows.map((row) => mapGpsRouteRow(row, waypointsByRoute.get(row.id) ?? [])),
  };
}

/** Queries daily health records within `[startDate, endDate]` inclusive. */
export async function queryHealthDateRangeFromSqlite(
  driver: SqliteDriver,
  startDate: string,
  endDate: string,
): Promise<DailyHealthRecord[]> {
  const rows = await driver.all<DailyHealthRow>(
    `SELECT ${DAILY_HEALTH_COLS} FROM daily_health_records WHERE date >= ? AND date <= ? ORDER BY date ASC;`,
    [startDate, endDate],
  );
  return rows.map(mapHealthRow);
}

/** Computes health aggregate metrics directly in SQL via COUNT, SUM, and AVG. */
export async function queryHealthAggregatesFromSqlite(
  driver: SqliteDriver,
  startDate?: string,
  endDate?: string,
): Promise<HealthAggregates> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (startDate !== undefined) {
    clauses.push('date >= ?');
    params.push(startDate);
  }
  if (endDate !== undefined) {
    clauses.push('date <= ?');
    params.push(endDate);
  }
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await driver.all<AggregateRow>(
    `SELECT
       COUNT(*) AS daysCount,
       COALESCE(SUM(steps), 0) AS totalSteps,
       COALESCE(AVG(steps), 0) AS avgSteps,
       COALESCE(SUM(calories_kcal), 0) AS totalCaloriesKcal,
       COALESCE(AVG(deep_sleep_min + light_sleep_min + rem_sleep_min), 0) AS avgSleepMin,
       COALESCE(AVG(resting_hr), 0) AS avgRestingHr,
       COALESCE(AVG(spo2_percent), 0) AS avgSpo2Percent,
       COALESCE(AVG(stress_score), 0) AS avgStressScore
     FROM daily_health_records ${whereClause};`,
    params,
  );
  const row = rows[0];
  return {
    daysCount: Number(row?.daysCount ?? 0),
    totalSteps: Number(row?.totalSteps ?? 0),
    avgSteps: Number(row?.avgSteps ?? 0),
    totalCaloriesKcal: Number(row?.totalCaloriesKcal ?? 0),
    avgSleepMin: Number(row?.avgSleepMin ?? 0),
    avgRestingHr: Number(row?.avgRestingHr ?? 0),
    avgSpo2Percent: Number(row?.avgSpo2Percent ?? 0),
    avgStressScore: Number(row?.avgStressScore ?? 0),
  };
}

/** Queries a single GPS workout route together with its ordered waypoints. */
export async function queryGpsRouteWithWaypointsFromSqlite(
  driver: SqliteDriver,
  routeId: string,
): Promise<GpsWorkoutRoute | null> {
  const routeRows = await driver.all<GpsRouteRow>(
    `SELECT ${GPS_ROUTE_COLS} FROM gps_workout_routes WHERE id = ? LIMIT 1;`,
    [routeId],
  );
  if (routeRows.length === 0) return null;
  const wpRows = await driver.all<GpsWaypointRow>(
    `SELECT ${GPS_WAYPOINT_COLS} FROM gps_waypoints WHERE route_id = ? ORDER BY seq_idx ASC, id ASC;`,
    [routeId],
  );
  return mapGpsRouteRow(routeRows[0]!, wpRows.map(mapWaypointRow));
}

/** Returns current row counts for every documented SQLite table. */
export async function getTableRowCountsFromSqlite(
  driver: SqliteDriver,
): Promise<Record<string, number>> {
  const rows = await driver.all<TableCountRow>(`
    SELECT 'kv_store' AS table_name, COUNT(*) AS row_count FROM kv_store
    UNION ALL SELECT 'paired_devices', COUNT(*) FROM paired_devices
    UNION ALL SELECT 'custom_eq_profiles', COUNT(*) FROM custom_eq_profiles
    UNION ALL SELECT 'daily_health_records', COUNT(*) FROM daily_health_records
    UNION ALL SELECT 'gps_workout_routes', COUNT(*) FROM gps_workout_routes
    UNION ALL SELECT 'gps_waypoints', COUNT(*) FROM gps_waypoints
    UNION ALL SELECT 'watch_alarms', COUNT(*) FROM watch_alarms;
  `);
  const counts: Record<string, number> = {
    kv_store: 0, paired_devices: 0, custom_eq_profiles: 0,
    daily_health_records: 0, gps_workout_routes: 0, gps_waypoints: 0, watch_alarms: 0,
  };
  for (const row of rows) {
    if (row.table_name in counts) counts[row.table_name] = Number(row.row_count ?? 0);
  }
  return counts;
}
