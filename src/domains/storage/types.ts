/**
 * Storage domain constants, union types, data models, and option interfaces.
 */

import type { UltimaSqliteDatabase } from './sqlite/UltimaSqliteDatabase.ts';

export const OFFLINE_STATE_VERSION = 1 as const;
export const DEFAULT_STORAGE_KEY = 'ultima_open_offline_state_v1' as const;
export const BACKUP_ARCHIVE_SCHEMA = 'ultima-open-backup' as const;
export const EQ_BAND_COUNT = 10 as const;
export const EQ_FREQUENCIES_HZ = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;
export const MAX_WATCH_ALARMS = 8 as const;

export const DEVICE_KIND = {
  EARBUDS: 'earbuds',
  WATCH: 'watch',
} as const;
export type DeviceKind = (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND];

export const EARBUD_CHIP = {
  JL: 'JL',
  BT: 'BT',
} as const;
export type EarbudChip = (typeof EARBUD_CHIP)[keyof typeof EARBUD_CHIP];

export const ANC_MODE = {
  OFF: 'off',
  ANC: 'anc',
  TRANSPARENCY: 'transparency',
} as const;
export type AncMode = (typeof ANC_MODE)[keyof typeof ANC_MODE];

export const VOICE_LANGUAGE = {
  EN: 'en',
  ZH: 'zh',
} as const;
export type VoiceLanguage =
  (typeof VOICE_LANGUAGE)[keyof typeof VOICE_LANGUAGE];

export const EARBUD_GESTURE = {
  SINGLE: 'single',
  DOUBLE: 'double',
  TRIPLE: 'triple',
  LONG_PRESS: 'longPress',
} as const;
export type EarbudGesture =
  (typeof EARBUD_GESTURE)[keyof typeof EARBUD_GESTURE];

export const CASE_GESTURE = {
  SINGLE: 'single',
  DOUBLE: 'double',
  TRIPLE: 'triple',
  LONG_PRESS: 'longPress',
  ROTATION: 'rotation',
} as const;
export type CaseGesture = (typeof CASE_GESTURE)[keyof typeof CASE_GESTURE];

export const EARBUD_KEY_FUNCTION = {
  NONE: 0x00,
  RECALL: 0x01,
  VOICE_ASSISTANT: 0x02,
  PREVIOUS: 0x03,
  NEXT: 0x04,
  VOLUME_UP: 0x05,
  VOLUME_DOWN: 0x06,
  PLAY_PAUSE: 0x07,
  GAME_MODE: 0x08,
  ANC_MODE: 0x09,
} as const;
export type EarbudKeyFunction =
  (typeof EARBUD_KEY_FUNCTION)[keyof typeof EARBUD_KEY_FUNCTION];

export const HEALTH_CSV_HEADERS = [
  'date',
  'steps',
  'distanceMeters',
  'caloriesKcal',
  'deepSleepMin',
  'lightSleepMin',
  'remSleepMin',
  'awakeMin',
  'restingHr',
  'spo2Percent',
  'systolicBp',
  'diastolicBp',
  'stressScore',
] as const;

export const IMPORT_MODE = {
  MERGE: 'merge',
  REPLACE: 'replace',
} as const;
export type ImportMode = (typeof IMPORT_MODE)[keyof typeof IMPORT_MODE];

/** Asynchronous key-value persistence backend compatible with RN AsyncStorage. */
export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const STORAGE_BACKEND_TYPE = {
  EXPO_SQLITE: 'expo-sqlite',
  NODE_SQLITE: 'node-sqlite',
  ASYNC_STORAGE: 'async-storage',
  MEMORY: 'memory',
} as const;
export type StorageBackendType =
  (typeof STORAGE_BACKEND_TYPE)[keyof typeof STORAGE_BACKEND_TYPE];

export interface StorageEngineInfo {
  backendType: StorageBackendType;
  relationalTablesActive: boolean;
}

export interface HealthAggregates {
  daysCount: number;
  totalSteps: number;
  avgSteps: number;
  totalCaloriesKcal: number;
  avgSleepMin: number;
  avgRestingHr: number;
  avgSpo2Percent: number;
  avgStressScore: number;
}

export interface LastKnownLocation {
  lat: number;
  lng: number;
  note: string;
  savedAt: number;
}

export interface LastKnownLocationInput {
  lat: number;
  lng: number;
  note?: string;
  savedAt?: number;
}

export interface PairedDeviceRecord {
  id: string;
  name: string;
  kind: DeviceKind;
  chip?: EarbudChip;
  pid?: number;
  mac?: string;
  lastConnectedAt: number;
  lastKnownLocation?: LastKnownLocation;
}

export interface CustomEqProfile {
  id: string;
  name: string;
  gains: number[];
  createdAt: number;
}

export interface SaveCustomEqProfileInput {
  id: string;
  name: string;
  gains: number[];
  createdAt?: number;
}

export interface CaseKeyAction {
  keyFunction: number;
  callControl: number;
}

export interface EarbudKeyMappings {
  left: Partial<Record<EarbudGesture, EarbudKeyFunction>>;
  right: Partial<Record<EarbudGesture, EarbudKeyFunction>>;
  caseKeys: Partial<Record<CaseGesture, CaseKeyAction>>;
}

export interface EarbudPrefs {
  ancMode: AncMode;
  ancGain: number;
  transparencyGain: number;
  gameMode: boolean;
  spatialAudio: boolean;
  ldac: boolean;
  inEarDetect: boolean;
  dualConnect: boolean;
  ledOn: boolean;
  voiceLanguage: VoiceLanguage;
  customBtName?: string;
  keyMappings: EarbudKeyMappings;
}

export interface EarbudPrefsPatch {
  ancMode?: AncMode;
  ancGain?: number;
  transparencyGain?: number;
  gameMode?: boolean;
  spatialAudio?: boolean;
  ldac?: boolean;
  inEarDetect?: boolean;
  dualConnect?: boolean;
  ledOn?: boolean;
  voiceLanguage?: VoiceLanguage;
  customBtName?: string;
  keyMappings?: {
    left?: Partial<Record<EarbudGesture, EarbudKeyFunction>>;
    right?: Partial<Record<EarbudGesture, EarbudKeyFunction>>;
    caseKeys?: Partial<Record<CaseGesture, CaseKeyAction>>;
  };
}

export interface DailyHealthRecord {
  date: string;
  steps: number;
  distanceMeters: number;
  caloriesKcal: number;
  stepBuckets48?: number[];
  deepSleepMin: number;
  lightSleepMin: number;
  remSleepMin: number;
  awakeMin: number;
  restingHr: number;
  hrSamples: number[];
  spo2Percent: number;
  systolicBp: number;
  diastolicBp: number;
  stressScore: number;
}

export type DailyHealthRecordInput = Pick<DailyHealthRecord, 'date'> &
  Partial<Omit<DailyHealthRecord, 'date'>>;

export interface WatchAlarmRecord {
  id: number;
  enabled: boolean;
  hour: number;
  minute: number;
  repeatMask: number;
  year: number;
  month: number;
  day: number;
  label: string;
}

export interface DrinkReminderPeriod {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface WatchSettings {
  goalSteps: number;
  is24Hour: boolean;
  quickView: boolean;
  watchFaceId: number;
  imperialUnits: boolean;
  languageId: number;
  sedentaryReminder: boolean;
  drinkReminderPeriod: DrinkReminderPeriod;
  hrIntervalMinutes: number;
  notificationRules: Record<number, boolean>;
}

export interface WatchSettingsPatch {
  goalSteps?: number;
  is24Hour?: boolean;
  quickView?: boolean;
  watchFaceId?: number;
  imperialUnits?: boolean;
  languageId?: number;
  sedentaryReminder?: boolean;
  drinkReminderPeriod?: Partial<DrinkReminderPeriod>;
  hrIntervalMinutes?: number;
  notificationRules?: Record<number, boolean>;
}

export interface GpsWaypoint {
  lat: number;
  lng: number;
  timestamp: string;
  heartRateBpm?: number;
  elevationMeters?: number;
}

export interface GpsWorkoutRoute {
  id: string;
  deviceId?: string;
  name: string;
  activityType: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  durationSec: number;
  caloriesKcal: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  elevationGainMeters?: number;
  waypoints: GpsWaypoint[];
}

export interface GpsWorkoutRouteInput {
  id: string;
  deviceId?: string;
  name?: string;
  activityType: string;
  startedAt: string;
  endedAt?: string;
  distanceMeters: number;
  durationSec: number;
  caloriesKcal: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  elevationGainMeters?: number;
  waypoints: GpsWaypoint[];
}

export interface OfflineAppState {
  version: typeof OFFLINE_STATE_VERSION;
  pairedDevices: PairedDeviceRecord[];
  customEqProfiles: CustomEqProfile[];
  earbudPrefs: Record<string, EarbudPrefs>;
  healthHistory: DailyHealthRecord[];
  watchAlarms: WatchAlarmRecord[];
  watchSettings: WatchSettings;
  gpsRoutes: GpsWorkoutRoute[];
}

export interface OfflineBackupArchive {
  schema: typeof BACKUP_ARCHIVE_SCHEMA;
  schemaVersion: typeof OFFLINE_STATE_VERSION;
  version: typeof OFFLINE_STATE_VERSION;
  exportedAt: string;
  state: OfflineAppState;
}

export interface OfflineStoreOptions {
  backend?: StorageBackend;
  storageKey?: string;
  sqliteDb?: UltimaSqliteDatabase;
}

export interface ExportJsonOptions {
  exportedAt?: string | number;
}

export interface ImportJsonOptions {
  mode?: ImportMode;
}

export interface ImportJsonResult {
  ok: boolean;
  errors: string[];
  state: OfflineAppState;
}

export interface ExportCsvOptions {
  lineEnding?: '\r\n' | '\n';
}
