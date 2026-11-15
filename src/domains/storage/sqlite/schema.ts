/**
 * SQLite schema constants, DDL statements, and relational row shapes.
 */

export const DEFAULT_SQLITE_DB_NAME = 'ultima_open.db' as const;

export const SQLITE_DRIVER_KIND = {
  EXPO_SQLITE: 'expo-sqlite',
  NODE_SQLITE: 'node-sqlite',
  CUSTOM: 'custom',
} as const;
export type SqliteDriverKind =
  (typeof SQLITE_DRIVER_KIND)[keyof typeof SQLITE_DRIVER_KIND];

export const SQLITE_TABLE_NAMES = [
  'kv_store',
  'paired_devices',
  'custom_eq_profiles',
  'daily_health_records',
  'gps_workout_routes',
  'gps_waypoints',
  'watch_alarms',
] as const;
export type SqliteTableName = (typeof SQLITE_TABLE_NAMES)[number];

export const PREF_KEY_EARBUD_PREFS = 'earbud_prefs' as const;
export const PREF_KEY_WATCH_SETTINGS = 'watch_settings' as const;

export const KV_STORE_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export const SQLITE_SCHEMA_DDL = `
  PRAGMA foreign_keys = ON;
  ${KV_STORE_TABLE_DDL}

  CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    chip TEXT,
    pid INTEGER,
    mac TEXT,
    last_connected_at INTEGER NOT NULL,
    lat REAL,
    lng REAL,
    loc_note TEXT,
    loc_saved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS custom_eq_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gains_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_health_records (
    date TEXT PRIMARY KEY,
    steps INTEGER NOT NULL,
    distance_meters INTEGER NOT NULL,
    calories_kcal INTEGER NOT NULL,
    step_buckets_json TEXT,
    deep_sleep_min INTEGER NOT NULL,
    light_sleep_min INTEGER NOT NULL,
    rem_sleep_min INTEGER NOT NULL,
    awake_min INTEGER NOT NULL,
    resting_hr INTEGER NOT NULL,
    hr_samples_json TEXT NOT NULL,
    spo2_percent INTEGER NOT NULL,
    systolic_bp INTEGER NOT NULL,
    diastolic_bp INTEGER NOT NULL,
    stress_score INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_daily_health_date
    ON daily_health_records (date);

  CREATE TABLE IF NOT EXISTS gps_workout_routes (
    id TEXT PRIMARY KEY,
    start_time INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    distance_meters INTEGER NOT NULL,
    duration_sec INTEGER NOT NULL,
    calories_kcal INTEGER NOT NULL,
    avg_hr INTEGER,
    max_hr INTEGER,
    device_id TEXT,
    name TEXT,
    ended_at INTEGER,
    elevation_gain_meters REAL
  );

  CREATE TABLE IF NOT EXISTS gps_waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id TEXT NOT NULL REFERENCES gps_workout_routes(id) ON DELETE CASCADE,
    seq_idx INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    hr_bpm INTEGER,
    is_paused INTEGER NOT NULL DEFAULT 0,
    elevation_meters REAL
  );

  CREATE INDEX IF NOT EXISTS idx_gps_waypoints_route
    ON gps_waypoints (route_id, seq_idx);

  CREATE TABLE IF NOT EXISTS watch_alarms (
    id INTEGER PRIMARY KEY,
    enabled INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    repeat_mask INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    label TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_preferences (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
`;

export interface PairedDeviceRow {
  id: string;
  name: string;
  kind: string;
  chip: string | null;
  pid: number | null;
  mac: string | null;
  last_connected_at: number;
  lat: number | null;
  lng: number | null;
  loc_note: string | null;
  loc_saved_at: number | null;
}

export interface CustomEqRow {
  id: string;
  name: string;
  gains_json: string;
  created_at: number;
}

export interface DailyHealthRow {
  date: string;
  steps: number;
  distance_meters: number;
  calories_kcal: number;
  step_buckets_json: string | null;
  deep_sleep_min: number;
  light_sleep_min: number;
  rem_sleep_min: number;
  awake_min: number;
  resting_hr: number;
  hr_samples_json: string;
  spo2_percent: number;
  systolic_bp: number;
  diastolic_bp: number;
  stress_score: number;
}

export interface GpsRouteRow {
  id: string;
  start_time: number;
  activity_type: string;
  distance_meters: number;
  duration_sec: number;
  calories_kcal: number;
  avg_hr: number | null;
  max_hr: number | null;
  device_id: string | null;
  name: string | null;
  ended_at: number | null;
  elevation_gain_meters: number | null;
}

export interface GpsWaypointRow {
  id: number;
  route_id: string;
  seq_idx: number;
  lat: number;
  lng: number;
  timestamp: number;
  hr_bpm: number | null;
  is_paused: number;
  elevation_meters: number | null;
}

export interface WatchAlarmRow {
  id: number;
  enabled: number;
  hour: number;
  minute: number;
  repeat_mask: number;
  year: number;
  month: number;
  day: number;
  label: string;
}

export interface AppPreferenceRow {
  key: string;
  value_json: string;
}

export interface AggregateRow {
  daysCount: number;
  totalSteps: number;
  avgSteps: number;
  totalCaloriesKcal: number;
  avgSleepMin: number;
  avgRestingHr: number;
  avgSpo2Percent: number;
  avgStressScore: number;
}

export interface TableCountRow {
  table_name: string;
  row_count: number;
}
