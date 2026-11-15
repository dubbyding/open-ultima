/**
 * ULTIMA Fit — CRREPA (0xFEEA) Protocol Constants & Shared Core Types
 *
 * Pure TypeScript constants and core frame/scan types reverse-engineered from
 * ULTIMA Fit (`com.android.mltcode.paycertificationapi` / `com.crrepa.ble`).
 *
 * Compatible with TypeScript strict mode, Node 24 `--experimental-strip-types`,
 * and React Native / Expo Metro (no `enum`, no `namespace`, no parameter properties).
 */

/** CRREPA 0xFEEA vendor GATT UUIDs and standard Bluetooth SIG UUIDs used by ULTIMA Fit watches. */
export const CRREPA_UUIDS = {
  SERVICE: '0000feea-0000-1000-8000-00805f9b34fb',
  /** Notify/Write command & health payload channel */
  fee1: '0000fee1-0000-1000-8000-00805f9b34fb',
  /** Secondary write / command channel */
  fee2: '0000fee2-0000-1000-8000-00805f9b34fb',
  /** Step / battery / version read & notify channel */
  fee3: '0000fee3-0000-1000-8000-00805f9b34fb',
  /** Auxiliary notification / control channel */
  fee4: '0000fee4-0000-1000-8000-00805f9b34fb',
  /** File / watchface transfer channel */
  fee5: '0000fee5-0000-1000-8000-00805f9b34fb',
  /** Watchface / music / large blob notify channel */
  fee6: '0000fee6-0000-1000-8000-00805f9b34fb',
  /** Extended file / firmware / e-card channel */
  fee7: '0000fee7-0000-1000-8000-00805f9b34fb',
  /** Extended notify / GPS / sport channel */
  fee8: '0000fee8-0000-1000-8000-00805f9b34fb',
  /** Extended data channel */
  fee9: '0000fee9-0000-1000-8000-00805f9b34fb',
  FEE1: '0000fee1-0000-1000-8000-00805f9b34fb',
  FEE2: '0000fee2-0000-1000-8000-00805f9b34fb',
  FEE3: '0000fee3-0000-1000-8000-00805f9b34fb',
  FEE4: '0000fee4-0000-1000-8000-00805f9b34fb',
  FEE5: '0000fee5-0000-1000-8000-00805f9b34fb',
  FEE6: '0000fee6-0000-1000-8000-00805f9b34fb',
  FEE7: '0000fee7-0000-1000-8000-00805f9b34fb',
  FEE8: '0000fee8-0000-1000-8000-00805f9b34fb',
  FEE9: '0000fee9-0000-1000-8000-00805f9b34fb',

  // Standard Bluetooth SIG Services & Characteristics
  DEVICE_INFO_SERVICE: '0000180a-0000-1000-8000-00805f9b34fb',
  FIRMWARE_REVISION: '00002a28-0000-1000-8000-00805f9b34fb',
  MANUFACTURER_NAME: '00002a29-0000-1000-8000-00805f9b34fb',
  MODEL_NUMBER: '00002a24-0000-1000-8000-00805f9b34fb',

  BATTERY_SERVICE: '0000180f-0000-1000-8000-00805f9b34fb',
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',

  HEART_RATE_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb',
  HEART_RATE_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb',

  OTA_SERVICE: '00003802-0000-1000-8000-00805f9b34fb',
  OTA_CONTROL: '00004a02-0000-1000-8000-00805f9b34fb',
} as const;

export type CrrepaUuid = (typeof CRREPA_UUIDS)[keyof typeof CRREPA_UUIDS];

/** Complete CRREPA 0xFEEA protocol command IDs (byte 4 of every `0xFE 0xEA` frame). */
export const CRP_CMD = {
  SET_ALARM: 0x11,
  SET_DOMINANT_HAND: 0x14,
  SET_GOAL_STEPS: 0x16,
  SET_TIME_SYSTEM: 0x17,
  SET_QUICK_VIEW: 0x18,
  SET_WATCH_FACE: 0x19,
  SET_METRIC_SYSTEM: 0x1a,
  SET_LANGUAGE: 0x1b,
  /** `c98`: Other message notification enable flag (0x00/0x01). */
  SET_OTHER_MESSAGE: 0x1c,
  /** `hh8`: Sedentary reminder toggle (0x00/0x01). */
  SET_SEDENTARY_REMINDER: 0x1d,
  SET_DEVICE_VERSION: 0x1e,
  /** `ol8`: Timing heart-rate interval in 5-minute units (`0` disables). */
  SET_TIMING_HEART_RATE: 0x1f,

  QUERY_ALARMS: 0x21,
  QUERY_WATCH_FACE_LAYOUT_ALT: 0x22,
  QUERY_WATCH_FACE_TIME_STYLE: 0x23,
  QUERY_DOMINANT_HAND: 0x24,
  QUERY_SUPPORTED_FUNCTIONS: 0x25,
  QUERY_GOAL_STEPS: 0x26,
  QUERY_TIME_SYSTEM: 0x27,
  QUERY_QUICK_VIEW: 0x28,
  QUERY_WATCH_FACE: 0x29,
  QUERY_METRIC_SYSTEM: 0x2a,
  QUERY_LANGUAGE: 0x2b,
  QUERY_OTHER_MESSAGE: 0x2c,
  QUERY_SEDENTARY_REMINDER: 0x2d,
  QUERY_DEVICE_VERSION: 0x2e,
  QUERY_TIMING_HEART_RATE_INTERVAL: 0x2f,

  SYNC_TIME: 0x31,
  SYNC_SLEEP: 0x32,
  QUERY_HISTORY_DAY: 0x33,
  MOVEMENT_HEART_RATE: 0x34,
  QUERY_TIMING_HEART_RATE: 0x35,
  QUERY_24H_HEART_RATE: 0x36,
  HEART_RATE_24H_CHUNK: 0x37,

  SPO2_CONTINUATION: 0x3c,
  QUERY_24H_BP: 0x3d,
  QUERY_24H_SPO2: 0x3e,

  PUSH_NOTIFICATION: 0x41,

  QUERY_STEPS_CATEGORY: 0x59,
  QUERY_CALORIES_CATEGORY: 0x5c,
  QUERY_DISTANCE_CATEGORY: 0x5d,

  FIND_WATCH: 0x61,
  /**
   * Start/stop the watch's *training* (dynamic heart-rate) mode — this starts a
   * workout on the watch. Reply payload[0] is the workout type, `0xFF` = stopped.
   * NOT a heart-rate measurement. (Gadgetbridge: CMD_START_STOP_MEASURE_DYNAMIC_RATE = 104)
   */
  DYNAMIC_HEART_RATE: 0x68,
  MEASURE_BLOOD_PRESSURE: 0x69,
  MEASURE_SPO2: 0x6b,
  /** One-shot heart-rate measurement `[0x00]` start / `[0xFF]` stop → reply `[bpm]`. (Gadgetbridge: CMD_TRIGGER_MEASURE_HEARTRATE = 109) */
  MEASURE_HEART_RATE: 0x6d,

  /** `xa8`: Do-Not-Disturb period `[startH, startM, endH, endM]`. */
  SET_DND_PERIOD: 0x71,
  /** `jg8`: Quick-View period `[startH, startM, endH, endM]`. */
  SET_QUICK_VIEW_PERIOD: 0x72,
  /** `rg8`: Sedentary reminder period / interval settings. */
  SET_SEDENTARY_PERIOD: 0x73,
  /** `gd8`: Drink-water reminder settings. */
  SET_DRINK_WATER_REMINDER: 0x77,
  SET_DISPLAY_TIME: 0x7d,
  /** `tg8`/`lg8`: Timing BP (`[0x01, en]`) and Timing SpO2 (`[interval]` or `[0x02, en]`). */
  TIMING_SPO2_OR_BP: 0x7e,

  QUERY_DND_PERIOD: 0x81,
  QUERY_QUICK_VIEW_PERIOD: 0x82,
  QUERY_SEDENTARY_PERIOD: 0x83,
  QUERY_DRINK_WATER_PERIOD: 0x87,
  QUERY_DISPLAY_TIME: 0x8d,
  QUERY_24H_VITALS_STATUS: 0x8e,

  QUERY_HISTORY_VITALS: 0xab,
  /** `ni8`/`vm8`/`z48`: GPS history list (`0x00`), trajectory chunks (`0x01`), live loc (`0x02`), phone loc (`0x04`). */
  GPS_PATH: 0xb3,
  /** `pl8`/`oi8`/`ol8`/`z48`: New-protocol day history (0=steps, 1=REM sleep, 2=timing HR). */
  QUERY_DAY_HISTORY_V2: 0xb6,
  /** Subcommands for new-protocol extensions (0x01/0x11 stress, 0x05/0x15 new alarms, etc.). */
  NEW_PROTOCOL_EXT: 0xb9,
  /** `np8`: Timezone offset sync `[0x07, 0x00, int32_LE(offsetSeconds)]`. */
  SYNC_TIMEZONE: 0xbb,
  /** `oi8`/`dl8`: Nap sleep query & response. */
  SYNC_NAP_SLEEP: 0xbc,
} as const;

export type CrpCmd = (typeof CRP_CMD)[keyof typeof CRP_CMD];

/**
 * Exact `CRPBleMessageType` hex constants from the decompiled SDK.
 * Use `mapCrpMessageType(type, firmwareVersionCode)` before writing on `0x41`.
 */
export const CRP_MESSAGE_TYPE = {
  PHONE: 0x00,
  CALL: 0x00,
  SMS: 0x01,
  WECHAT: 0x02,
  QQ: 0x03,
  WHATSAPP: 0x04,
  WECHAT_IN: 0x05,
  INSTAGRAM: 0x06,
  SKYPE: 0x07,
  KAKAOTALK: 0x08,
  LINE: 0x09,
  EMAIL: 0x0b,
  MESSENGER: 0x0c,
  ZALO: 0x0d,
  TELEGRAM: 0x0e,
  VIBER: 0x0f,
  NATEON: 0x10,
  GMAIL: 0x11,
  CALENDAR_GOOGLE: 0x12,
  DAILYHUNT: 0x13,
  OUTLOOK: 0x14,
  YAHOO: 0x15,
  INSHORTS: 0x16,
  PHONEPE: 0x17,
  GPAY: 0x18,
  PAYTM: 0x19,
  SWIGGY: 0x1a,
  ZOMATO: 0x1b,
  UBER: 0x1c,
  OLA: 0x1d,
  REFLEXAPP: 0x1e,
  SNAPCHAT: 0x1f,
  YTMUSIC: 0x20,
  YOUTUBE: 0x21,
  LINKEDIN: 0x22,
  AMAZON: 0x23,
  FLIPKART: 0x24,
  NETFLIX: 0x25,
  HOTSTAR: 0x26,
  AMAZON_PRIME: 0x27,
  GOOGLE_CHAT: 0x28,
  WYNK: 0x29,
  GOOGLE_DRIVE: 0x2a,
  DUNZO: 0x2b,
  GAANA: 0x2c,
  MISS_CALL: 0x2d,
  WHATSAPP_BUSINESS: 0x2e,
  DINGTALK: 0x2f,
  TIKTOK: 0x30,
  LYFT: 0x31,
  MAIL: 0x32,
  GOOGLEMAPS: 0x33,
  SLACK: 0x34,
  MICROSOFTTEAMS: 0x35,
  MORMAIISMARTWATCHES: 0x36,
  REDDIT: 0x37,
  DISCORD: 0x38,
  CALENDAR_DEFAULT: 0x39,
  GOJEK: 0x3a,
  LARK: 0x3b,
  GRAB: 0x3c,
  SHOPEE: 0x3d,
  TOKOPEDIA: 0x3e,
  THREADS: 0x3f,
  SMARTGOODS: 0x40,
  OTHER: 0x80,
  FACEBOOK: 0x82,
  TWITTER: 0x83,
  TWITTER_X: 0x83,
} as const;

export type CrpMessageType = (typeof CRP_MESSAGE_TYPE)[keyof typeof CRP_MESSAGE_TYPE];

/** Alarm repeat flags (`CRPAlarmInfo`). */
export const CRP_ALARM_REPEAT = {
  SINGLE: 0x00,
  SUNDAY: 0x01,
  MONDAY: 0x02,
  TUESDAY: 0x04,
  WEDNESDAY: 0x08,
  THURSDAY: 0x10,
  FRIDAY: 0x20,
  SATURDAY: 0x40,
  EVERYDAY: 0x7f,
} as const;

/** Sleep segment states (`CRPSleepInfo`). */
export const CRP_SLEEP_STATE = {
  SOBER: 0,
  AWAKE: 0,
  LIGHT: 1,
  RESTFUL: 2,
  DEEP: 2,
  REM: 3,
} as const;

export type CrpSleepState = (typeof CRP_SLEEP_STATE)[keyof typeof CRP_SLEEP_STATE];

/** Watch UI language codes (`CRPDeviceLanguageType`). */
export const CRP_LANGUAGE = {
  ENGLISH: 0x00,
  CHINESE: 0x01,
  JAPANESE: 0x02,
  KOREAN: 0x03,
  GERMAN: 0x04,
  FRENCH: 0x05,
  SPANISH: 0x06,
  ARABIC: 0x07,
  RUSSIAN: 0x08,
  TRADITIONAL: 0x09,
  UKRAINIAN: 0x0a,
  ITALIAN: 0x0b,
  PORTUGUESE: 0x0c,
  DUTCH: 0x0d,
  POLISH: 0x0e,
  SWEDISH: 0x0f,
  FINNISH: 0x10,
  DANISH: 0x11,
  NORWEGIAN: 0x12,
  HUNGARIAN: 0x13,
  CZECH: 0x14,
  BULGARIAN: 0x15,
  ROMANIAN: 0x16,
  SLOVAK: 0x17,
  LATVIAN: 0x18,
} as const;

export type CrpLanguage = (typeof CRP_LANGUAGE)[keyof typeof CRP_LANGUAGE];

/** Watch MCU platform enum values (`CRPMcuPlatform`). */
export const CRP_MCU_PLATFORM = {
  NONE: 0,
  NORDIC: 1,
  HUNTERSUN: 2,
  REALTEK: 3,
  GOODIX: 4,
  SIFLI: 5,
  JIELI: 6,
  BLUETRUM: 7,
  HISILICON: 8,
} as const;

export type CrpMcuPlatform = (typeof CRP_MCU_PLATFORM)[keyof typeof CRP_MCU_PLATFORM];

/** History day offsets (`CRPHistoryDay`). */
export const CRP_HISTORY_DAY = {
  TODAY: 0,
  YESTERDAY: 1,
  THE_DAY_BEFORE_YESTERDAY: 2,
  THREE_DAYS_AGO: 3,
  FOUR_DAYS_AGO: 4,
  FIVE_DAYS_AGO: 5,
  SIX_DAYS_AGO: 6,
} as const;

export type CrpHistoryDay = (typeof CRP_HISTORY_DAY)[keyof typeof CRP_HISTORY_DAY];

/** Stress date enum (`CRPStressDate`). */
export const CRP_STRESS_DATE = {
  TODAY: 0,
  YESTERDAY: 1,
} as const;

export type CrpStressDate = (typeof CRP_STRESS_DATE)[keyof typeof CRP_STRESS_DATE];

/** Sentinel coordinate values in `CRPGpsPathInfo$Location`. */
export const CRP_GPS_SENTINEL = {
  PAUSE: 0.0,
  NO_SIGNAL: 200.0,
  END_CHUNK_INDEX: 0xffff,
  DEFAULT_POINT_INTERVAL_MS: 2000,
} as const;

/** Subcommand bytes under `CRP_CMD.GPS_PATH` (`0xB3` / `-0x4D`). */
export const CRP_GPS_SUBCMD = {
  QUERY_HISTORY: 0x00,
  QUERY_PATH: 0x01,
  QUERY_LIVE_LOCATION: 0x02,
  SEND_LOCAL_LOCATION: 0x04,
} as const;

// ---------------------------------------------------------------------------
// Shared Core Interfaces
// ---------------------------------------------------------------------------

export interface CrpScanInfo {
  name: string;
  firmwareType: string;
  platform: number;
  chipId: number;
  functionMask: number;
  rawServiceData: Uint8Array;
}

export interface CrpScanRecordInput {
  name: string;
  firmwareType: string;
  platform: number;
  chipId: number;
  functionMask: number;
}

export interface CrpDecodedFrame {
  cmd: number;
  protoByte: number;
  totalLength: number;
  isComplete: boolean;
  payload: Uint8Array;
}

export interface CrpTimeSyncCommands {
  timeCmd: Uint8Array;
  tzCmd: Uint8Array;
}

export interface CrpStepDecodeOptions {
  format?: 'auto' | '3byte' | '4byte';
}

export interface CrpStepInfo {
  steps: number;
  distanceMeters: number;
  caloriesKcal: number;
  durationSec: number;
  dayOffset?: number;
  format: '3byte' | '4byte';
}

export interface CrpStepCategoryInfo {
  dayOffset: number;
  timeIntervalMinutes: number;
  chunkIndex?: number;
  slotStart: number;
  buckets: number[];
  isComplete: boolean;
  nextChunkCmd?: Uint8Array;
}

export interface CrpSleepSegment {
  state: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  durationMinutes: number;
}

export interface CrpSleepDecodeOptions {
  format?: 'auto' | '2byte' | '3byte';
  hasPrefix?: boolean;
  cmd?: number;
}

export interface CrpSleepInfo {
  format: '2byte' | '3byte';
  dayOffset?: number;
  deepMinutes: number;
  lightMinutes: number;
  remMinutes: number;
  awakeMinutes: number;
  totalMinutes: number;
  segments: CrpSleepSegment[];
}

export interface CrpNapSegment {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  durationMinutes: number;
}

export interface CrpNapSleepInfo {
  dayOffset?: number;
  totalMinutes: number;
  naps: CrpNapSegment[];
}
