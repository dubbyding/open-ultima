/**
 * Default state factories, defensive cloning, deterministic sorting,
 * and strict entity validation/clamping helpers for offline persistence.
 */

import {
  ANC_MODE, CASE_GESTURE, DEVICE_KIND, EARBUD_CHIP, EARBUD_GESTURE, EQ_BAND_COUNT, MAX_WATCH_ALARMS, OFFLINE_STATE_VERSION, VOICE_LANGUAGE,
} from './types.ts';
import type {
  CaseGesture, CaseKeyAction, CustomEqProfile, DailyHealthRecord, EarbudGesture, EarbudKeyFunction,
  EarbudKeyMappings, EarbudPrefs, GpsWaypoint, GpsWorkoutRoute, LastKnownLocation, OfflineAppState,
  PairedDeviceRecord, WatchAlarmRecord, WatchSettings,
} from './types.ts';

export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EARBUD_GESTURES: readonly EarbudGesture[] = [
  EARBUD_GESTURE.SINGLE, EARBUD_GESTURE.DOUBLE, EARBUD_GESTURE.TRIPLE, EARBUD_GESTURE.LONG_PRESS,
];
const CASE_GESTURES: readonly CaseGesture[] = [
  CASE_GESTURE.SINGLE, CASE_GESTURE.DOUBLE, CASE_GESTURE.TRIPLE, CASE_GESTURE.LONG_PRESS, CASE_GESTURE.ROTATION,
];

/** Creates default preferences for a pair of Ultima Link earbuds. */
export function createDefaultEarbudPrefs(): EarbudPrefs {
  return {
    ancMode: ANC_MODE.OFF, ancGain: 0, transparencyGain: 0,
    gameMode: false, spatialAudio: false, ldac: false, inEarDetect: false,
    dualConnect: false, ledOn: true, voiceLanguage: VOICE_LANGUAGE.EN,
    keyMappings: { left: {}, right: {}, caseKeys: {} },
  };
}

/** Creates default settings for an ULTIMA Fit smartwatch. */
export function createDefaultWatchSettings(): WatchSettings {
  return {
    goalSteps: 8000, is24Hour: true, quickView: true, watchFaceId: 1,
    imperialUnits: false, languageId: 0, sedentaryReminder: false,
    drinkReminderPeriod: { enabled: false, startHour: 9, startMinute: 0, endHour: 21, endMinute: 0 },
    hrIntervalMinutes: 0, notificationRules: {},
  };
}

/** Creates a zeroed daily health record for a YYYY-MM-DD date. */
export function createDefaultDailyHealthRecord(date: string): DailyHealthRecord {
  return {
    date, steps: 0, distanceMeters: 0, caloriesKcal: 0,
    deepSleepMin: 0, lightSleepMin: 0, remSleepMin: 0, awakeMin: 0,
    restingHr: 0, hrSamples: [], spo2Percent: 0, systolicBp: 0, diastolicBp: 0, stressScore: 0,
  };
}

/** Creates an empty, valid version-1 OfflineAppState. */
export function createDefaultOfflineAppState(): OfflineAppState {
  return {
    version: OFFLINE_STATE_VERSION, pairedDevices: [], customEqProfiles: [],
    earbudPrefs: {}, healthHistory: [], watchAlarms: [],
    watchSettings: createDefaultWatchSettings(), gpsRoutes: [],
  };
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isFiniteNonNegative = (v: unknown): v is number => isFiniteNumber(v) && v >= 0;
export const isIntInRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
export const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isValidIsoTimestamp = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length >= 10 && Number.isFinite(Date.parse(v));

export function assertSafeKey(key: string, label: string): void {
  if (!isNonEmptyString(key) || UNSAFE_KEYS.has(key)) throw new Error(`Invalid ${label}`);
}

export const failValidation = (errors: string[], msg: string): null => (errors.push(msg), null);

function checkBooleans(raw: Record<string, unknown>, path: string, fields: readonly string[], errors: string[]): boolean {
  for (const f of fields) {
    if (typeof raw[f] !== 'boolean') return (errors.push(`${path}.${f} must be a boolean`), false);
  }
  return true;
}

function checkNonNegs(raw: Record<string, unknown>, path: string, fields: readonly string[], errors: string[]): boolean {
  for (const f of fields) {
    if (!isFiniteNonNegative(raw[f])) return (errors.push(`${path}.${f} must be a non-negative finite number`), false);
  }
  return true;
}

function checkInts(
  raw: Record<string, unknown>, path: string, specs: ReadonlyArray<readonly [string, number, number]>, errors: string[],
): boolean {
  for (const [f, min, max] of specs) {
    if (!isIntInRange(raw[f], min, max)) return (errors.push(`${path}.${f} must be an integer ${min}..${max}`), false);
  }
  return true;
}

function clampOptionalHr(raw: unknown, path: string, errors: string[]): number | undefined | null {
  if (raw === undefined) return undefined;
  if (!isFiniteNumber(raw) || raw < 25 || raw > 250) return failValidation(errors, `${path} must be between 25 and 250`);
  return Math.round(raw);
}

export const cloneLocation = (loc: LastKnownLocation): LastKnownLocation => ({
  lat: loc.lat, lng: loc.lng, note: loc.note, savedAt: loc.savedAt,
});

export const clonePairedDevice = (d: PairedDeviceRecord): PairedDeviceRecord => ({
  id: d.id, name: d.name, kind: d.kind, lastConnectedAt: d.lastConnectedAt,
  ...(d.chip !== undefined ? { chip: d.chip } : {}),
  ...(d.pid !== undefined ? { pid: d.pid } : {}),
  ...(d.mac !== undefined ? { mac: d.mac } : {}),
  ...(d.lastKnownLocation !== undefined ? { lastKnownLocation: cloneLocation(d.lastKnownLocation) } : {}),
});

export const cloneEqProfile = (p: CustomEqProfile): CustomEqProfile => ({
  id: p.id, name: p.name, gains: [...p.gains], createdAt: p.createdAt,
});

function cloneKeyMappings(m: EarbudKeyMappings): EarbudKeyMappings {
  const left: Partial<Record<EarbudGesture, EarbudKeyFunction>> = {};
  const right: Partial<Record<EarbudGesture, EarbudKeyFunction>> = {};
  for (const g of EARBUD_GESTURES) {
    if (m.left[g] !== undefined) left[g] = m.left[g];
    if (m.right[g] !== undefined) right[g] = m.right[g];
  }
  const caseKeys: Partial<Record<CaseGesture, CaseKeyAction>> = {};
  for (const g of CASE_GESTURES) {
    const act = m.caseKeys[g];
    if (act !== undefined) caseKeys[g] = { keyFunction: act.keyFunction, callControl: act.callControl };
  }
  return { left, right, caseKeys };
}

export function cloneEarbudPrefs(p: EarbudPrefs): EarbudPrefs {
  const copy: EarbudPrefs = { ...p, keyMappings: cloneKeyMappings(p.keyMappings) };
  if (copy.customBtName === undefined) delete copy.customBtName;
  return copy;
}

export function cloneHealthRecord(r: DailyHealthRecord): DailyHealthRecord {
  const copy: DailyHealthRecord = { ...r, hrSamples: [...r.hrSamples] };
  if (r.stepBuckets48 !== undefined) copy.stepBuckets48 = [...r.stepBuckets48];
  else delete copy.stepBuckets48;
  return copy;
}

export const cloneWatchAlarm = (a: WatchAlarmRecord): WatchAlarmRecord => ({ ...a });

export function cloneWatchSettings(s: WatchSettings): WatchSettings {
  const sortedRules: Record<number, boolean> = {};
  for (const key of Object.keys(s.notificationRules).map(Number).filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => a - b)) {
    const enabled = s.notificationRules[key];
    if (typeof enabled === 'boolean') sortedRules[key] = enabled;
  }
  return { ...s, drinkReminderPeriod: { ...s.drinkReminderPeriod }, notificationRules: sortedRules };
}

export const cloneGpsRoute = (r: GpsWorkoutRoute): GpsWorkoutRoute => ({
  id: r.id, name: r.name, activityType: r.activityType, startedAt: r.startedAt, endedAt: r.endedAt,
  distanceMeters: r.distanceMeters, durationSec: r.durationSec, caloriesKcal: r.caloriesKcal,
  ...(r.deviceId !== undefined ? { deviceId: r.deviceId } : {}),
  ...(r.avgHeartRateBpm !== undefined ? { avgHeartRateBpm: r.avgHeartRateBpm } : {}),
  ...(r.maxHeartRateBpm !== undefined ? { maxHeartRateBpm: r.maxHeartRateBpm } : {}),
  ...(r.elevationGainMeters !== undefined ? { elevationGainMeters: r.elevationGainMeters } : {}),
  waypoints: r.waypoints.map((wp: GpsWaypoint) => ({
    lat: wp.lat, lng: wp.lng, timestamp: wp.timestamp,
    ...(wp.heartRateBpm !== undefined ? { heartRateBpm: wp.heartRateBpm } : {}),
    ...(wp.elevationMeters !== undefined ? { elevationMeters: wp.elevationMeters } : {}),
  })),
});

export function cloneOfflineAppState(state: OfflineAppState): OfflineAppState {
  const earbudPrefs: Record<string, EarbudPrefs> = {};
  for (const deviceId of Object.keys(state.earbudPrefs).sort()) {
    earbudPrefs[deviceId] = cloneEarbudPrefs(state.earbudPrefs[deviceId]!);
  }
  return {
    version: OFFLINE_STATE_VERSION,
    pairedDevices: state.pairedDevices.map(clonePairedDevice),
    customEqProfiles: state.customEqProfiles.map(cloneEqProfile),
    earbudPrefs,
    healthHistory: state.healthHistory.map(cloneHealthRecord),
    watchAlarms: state.watchAlarms.map(cloneWatchAlarm),
    watchSettings: cloneWatchSettings(state.watchSettings),
    gpsRoutes: (state.gpsRoutes ?? []).map(cloneGpsRoute),
  };
}

export function validateLocation(raw: unknown, path: string, errors: string[]): LastKnownLocation | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!isFiniteNumber(raw.lat) || raw.lat < -90 || raw.lat > 90) return failValidation(errors, `${path}.lat must be a number between -90 and 90`);
  if (!isFiniteNumber(raw.lng) || raw.lng < -180 || raw.lng > 180) return failValidation(errors, `${path}.lng must be a number between -180 and 180`);
  if (typeof raw.note !== 'string') return failValidation(errors, `${path}.note must be a string`);
  if (!isFiniteNumber(raw.savedAt)) return failValidation(errors, `${path}.savedAt must be a finite number`);
  return { lat: raw.lat, lng: raw.lng, note: raw.note, savedAt: raw.savedAt };
}

export function validatePairedDevice(raw: unknown, path: string, errors: string[]): PairedDeviceRecord | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!isNonEmptyString(raw.id) || UNSAFE_KEYS.has(raw.id)) return failValidation(errors, `${path}.id must be a non-empty string`);
  if (typeof raw.name !== 'string') return failValidation(errors, `${path}.name must be a string`);
  if (raw.kind !== DEVICE_KIND.EARBUDS && raw.kind !== DEVICE_KIND.WATCH) return failValidation(errors, `${path}.kind must be 'earbuds' or 'watch'`);
  if (!isFiniteNumber(raw.lastConnectedAt)) return failValidation(errors, `${path}.lastConnectedAt must be a finite number`);
  if (raw.chip !== undefined && raw.chip !== EARBUD_CHIP.JL && raw.chip !== EARBUD_CHIP.BT) return failValidation(errors, `${path}.chip must be 'JL' or 'BT'`);
  if (raw.pid !== undefined && !isIntInRange(raw.pid, 0, 0xffff)) return failValidation(errors, `${path}.pid must be an integer between 0 and 65535`);
  if (raw.mac !== undefined && typeof raw.mac !== 'string') return failValidation(errors, `${path}.mac must be a string`);
  let loc: LastKnownLocation | undefined;
  if (raw.lastKnownLocation !== undefined) {
    const parsed = validateLocation(raw.lastKnownLocation, `${path}.lastKnownLocation`, errors);
    if (!parsed) return null;
    loc = parsed;
  }
  return {
    id: raw.id, name: raw.name, kind: raw.kind, lastConnectedAt: raw.lastConnectedAt,
    ...(raw.chip !== undefined ? { chip: raw.chip } : {}),
    ...(raw.pid !== undefined ? { pid: raw.pid } : {}),
    ...(raw.mac !== undefined ? { mac: raw.mac } : {}),
    ...(loc !== undefined ? { lastKnownLocation: loc } : {}),
  };
}

export function validateCustomEqProfile(raw: unknown, path: string, errors: string[]): CustomEqProfile | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!isNonEmptyString(raw.id) || UNSAFE_KEYS.has(raw.id)) return failValidation(errors, `${path}.id must be a non-empty string`);
  if (!isNonEmptyString(raw.name)) return failValidation(errors, `${path}.name must be a non-empty string`);
  if (!Array.isArray(raw.gains) || raw.gains.length !== EQ_BAND_COUNT || !raw.gains.every(isFiniteNumber)) {
    return failValidation(errors, `${path}.gains must be an array of ${EQ_BAND_COUNT} finite numbers`);
  }
  if (!isFiniteNumber(raw.createdAt)) return failValidation(errors, `${path}.createdAt must be a finite number`);
  return { id: raw.id, name: raw.name, gains: [...raw.gains], createdAt: raw.createdAt };
}

function validateSideKeyMap(raw: unknown, path: string, errors: string[]): Partial<Record<EarbudGesture, EarbudKeyFunction>> | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  const result: Partial<Record<EarbudGesture, EarbudKeyFunction>> = {};
  for (const key of Object.keys(raw)) {
    if (UNSAFE_KEYS.has(key)) return failValidation(errors, `${path} contains unsafe key`);
    if (!EARBUD_GESTURES.includes(key as EarbudGesture)) return failValidation(errors, `${path}.${key} is not a recognized earbud gesture`);
    const fn = raw[key];
    if (!isIntInRange(fn, 0, 0x09)) return failValidation(errors, `${path}.${key} must be an integer key function 0..9`);
    result[key as EarbudGesture] = fn as EarbudKeyFunction;
  }
  return result;
}

function validateCaseKeyMap(raw: unknown, path: string, errors: string[]): Partial<Record<CaseGesture, CaseKeyAction>> | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  const result: Partial<Record<CaseGesture, CaseKeyAction>> = {};
  for (const key of Object.keys(raw)) {
    if (UNSAFE_KEYS.has(key)) return failValidation(errors, `${path} contains unsafe key`);
    if (!CASE_GESTURES.includes(key as CaseGesture)) return failValidation(errors, `${path}.${key} is not a recognized case gesture`);
    const action = raw[key];
    if (!isPlainObject(action) || !isIntInRange(action.keyFunction, 0, 255) || !isIntInRange(action.callControl, 0, 255)) {
      return failValidation(errors, `${path}.${key} must have integer keyFunction and callControl (0..255)`);
    }
    result[key as CaseGesture] = { keyFunction: action.keyFunction, callControl: action.callControl };
  }
  return result;
}

export function validateEarbudPrefs(raw: unknown, path: string, errors: string[]): EarbudPrefs | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (raw.ancMode !== ANC_MODE.OFF && raw.ancMode !== ANC_MODE.ANC && raw.ancMode !== ANC_MODE.TRANSPARENCY) {
    return failValidation(errors, `${path}.ancMode must be 'off', 'anc', or 'transparency'`);
  }
  if (!checkNonNegs(raw, path, ['ancGain', 'transparencyGain'], errors)) return null;
  if (!checkBooleans(raw, path, ['gameMode', 'spatialAudio', 'ldac', 'inEarDetect', 'dualConnect', 'ledOn'], errors)) return null;
  if (raw.voiceLanguage !== VOICE_LANGUAGE.EN && raw.voiceLanguage !== VOICE_LANGUAGE.ZH) {
    return failValidation(errors, `${path}.voiceLanguage must be 'en' or 'zh'`);
  }
  if (raw.customBtName !== undefined && typeof raw.customBtName !== 'string') return failValidation(errors, `${path}.customBtName must be a string`);
  if (!isPlainObject(raw.keyMappings)) return failValidation(errors, `${path}.keyMappings must be an object`);
  const left = validateSideKeyMap(raw.keyMappings.left, `${path}.keyMappings.left`, errors);
  const right = validateSideKeyMap(raw.keyMappings.right, `${path}.keyMappings.right`, errors);
  const caseKeys = validateCaseKeyMap(raw.keyMappings.caseKeys, `${path}.keyMappings.caseKeys`, errors);
  if (!left || !right || !caseKeys) return null;
  return {
    ancMode: raw.ancMode, ancGain: raw.ancGain as number, transparencyGain: raw.transparencyGain as number,
    gameMode: raw.gameMode as boolean, spatialAudio: raw.spatialAudio as boolean, ldac: raw.ldac as boolean,
    inEarDetect: raw.inEarDetect as boolean, dualConnect: raw.dualConnect as boolean, ledOn: raw.ledOn as boolean,
    voiceLanguage: raw.voiceLanguage, ...(raw.customBtName !== undefined ? { customBtName: raw.customBtName } : {}),
    keyMappings: { left, right, caseKeys },
  };
}

export function validateHealthRecord(raw: unknown, path: string, errors: string[]): DailyHealthRecord | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!isValidIsoDate(raw.date)) return failValidation(errors, `${path}.date must be a valid YYYY-MM-DD date`);
  const numFields = [
    'steps', 'distanceMeters', 'caloriesKcal', 'deepSleepMin', 'lightSleepMin',
    'remSleepMin', 'awakeMin', 'restingHr', 'spo2Percent', 'systolicBp', 'diastolicBp', 'stressScore',
  ] as const;
  if (!checkNonNegs(raw, path, numFields, errors)) return null;
  if (!Array.isArray(raw.hrSamples) || !raw.hrSamples.every(isFiniteNonNegative)) {
    return failValidation(errors, `${path}.hrSamples must be an array of non-negative finite numbers`);
  }
  let stepBuckets48: number[] | undefined;
  if (raw.stepBuckets48 !== undefined) {
    if (!Array.isArray(raw.stepBuckets48) || raw.stepBuckets48.length > 48 || !raw.stepBuckets48.every(isFiniteNonNegative)) {
      return failValidation(errors, `${path}.stepBuckets48 must be an array of up to 48 non-negative finite numbers`);
    }
    stepBuckets48 = [...raw.stepBuckets48];
  }
  return {
    date: raw.date, steps: raw.steps as number, distanceMeters: raw.distanceMeters as number,
    caloriesKcal: raw.caloriesKcal as number, deepSleepMin: raw.deepSleepMin as number,
    lightSleepMin: raw.lightSleepMin as number, remSleepMin: raw.remSleepMin as number,
    awakeMin: raw.awakeMin as number, restingHr: raw.restingHr as number, hrSamples: [...raw.hrSamples],
    spo2Percent: raw.spo2Percent as number, systolicBp: raw.systolicBp as number,
    diastolicBp: raw.diastolicBp as number, stressScore: raw.stressScore as number,
    ...(stepBuckets48 !== undefined ? { stepBuckets48 } : {}),
  };
}

export function validateWatchAlarm(raw: unknown, path: string, errors: string[]): WatchAlarmRecord | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  const specs: ReadonlyArray<readonly [string, number, number]> = [
    ['id', 0, MAX_WATCH_ALARMS - 1], ['hour', 0, 23], ['minute', 0, 59],
    ['repeatMask', 0, 255], ['year', 0, 9999], ['month', 0, 12], ['day', 0, 31],
  ];
  if (!checkInts(raw, path, specs, errors)) return null;
  if (typeof raw.enabled !== 'boolean') return failValidation(errors, `${path}.enabled must be a boolean`);
  if (typeof raw.label !== 'string') return failValidation(errors, `${path}.label must be a string`);
  return {
    id: raw.id as number, enabled: raw.enabled, hour: raw.hour as number, minute: raw.minute as number,
    repeatMask: raw.repeatMask as number, year: raw.year as number, month: raw.month as number,
    day: raw.day as number, label: raw.label,
  };
}

export function validateWatchSettings(raw: unknown, path: string, errors: string[]): WatchSettings | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!checkNonNegs(raw, path, ['goalSteps', 'hrIntervalMinutes'], errors)) return null;
  if (!checkBooleans(raw, path, ['is24Hour', 'quickView', 'imperialUnits', 'sedentaryReminder'], errors)) return null;
  if (!isIntInRange(raw.watchFaceId, 0, 65535)) return failValidation(errors, `${path}.watchFaceId must be a non-negative integer`);
  if (!isIntInRange(raw.languageId, 0, 255)) return failValidation(errors, `${path}.languageId must be an integer 0..255`);
  const drink = raw.drinkReminderPeriod;
  if (
    !isPlainObject(drink) || typeof drink.enabled !== 'boolean' ||
    !isIntInRange(drink.startHour, 0, 23) || !isIntInRange(drink.startMinute, 0, 59) ||
    !isIntInRange(drink.endHour, 0, 23) || !isIntInRange(drink.endMinute, 0, 59)
  ) return failValidation(errors, `${path}.drinkReminderPeriod is invalid`);
  if (!isPlainObject(raw.notificationRules)) return failValidation(errors, `${path}.notificationRules must be an object`);
  const rules: Record<number, boolean> = {};
  for (const key of Object.keys(raw.notificationRules)) {
    if (UNSAFE_KEYS.has(key) || !/^(0|[1-9]\d*)$/.test(key)) return failValidation(errors, `${path}.notificationRules has invalid key '${key}'`);
    const msgType = Number(key), val = raw.notificationRules[key];
    if (!Number.isSafeInteger(msgType) || msgType > 255 || typeof val !== 'boolean') {
      return failValidation(errors, `${path}.notificationRules['${key}'] must map 0..255 to boolean`);
    }
    rules[msgType] = val;
  }
  return cloneWatchSettings({
    goalSteps: raw.goalSteps as number, is24Hour: raw.is24Hour as boolean, quickView: raw.quickView as boolean,
    watchFaceId: raw.watchFaceId, imperialUnits: raw.imperialUnits as boolean, languageId: raw.languageId,
    sedentaryReminder: raw.sedentaryReminder as boolean, hrIntervalMinutes: raw.hrIntervalMinutes as number,
    drinkReminderPeriod: {
      enabled: drink.enabled, startHour: drink.startHour, startMinute: drink.startMinute,
      endHour: drink.endHour, endMinute: drink.endMinute,
    },
    notificationRules: rules,
  });
}

function validateGpsWaypoint(raw: unknown, path: string, errors: string[]): GpsWaypoint | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!isFiniteNumber(raw.lat) || raw.lat < -90 || raw.lat > 90) return failValidation(errors, `${path}.lat must be within [-90, 90]`);
  if (!isFiniteNumber(raw.lng) || raw.lng < -180 || raw.lng > 180) return failValidation(errors, `${path}.lng must be within [-180, 180]`);
  if (!isValidIsoTimestamp(raw.timestamp)) return failValidation(errors, `${path}.timestamp must be a valid ISO timestamp`);
  const heartRateBpm = clampOptionalHr(raw.heartRateBpm, `${path}.heartRateBpm`, errors);
  if (heartRateBpm === null) return null;
  let elevationMeters: number | undefined;
  if (raw.elevationMeters !== undefined) {
    if (!isFiniteNumber(raw.elevationMeters) || raw.elevationMeters < -500 || raw.elevationMeters > 10000) {
      return failValidation(errors, `${path}.elevationMeters must be between -500 and 10000`);
    }
    elevationMeters = Math.round(raw.elevationMeters * 10) / 10;
  }
  return {
    lat: raw.lat, lng: raw.lng, timestamp: new Date(raw.timestamp).toISOString(),
    ...(heartRateBpm !== undefined ? { heartRateBpm } : {}),
    ...(elevationMeters !== undefined ? { elevationMeters } : {}),
  };
}

export function validateGpsRoute(raw: unknown, path: string, errors: string[]): GpsWorkoutRoute | null {
  if (!isPlainObject(raw)) return failValidation(errors, `${path} must be an object`);
  if (!isNonEmptyString(raw.id)) return failValidation(errors, `${path}.id must be a non-empty string`);
  assertSafeKey(raw.id, `${path}.id`);
  if (raw.deviceId !== undefined && !isNonEmptyString(raw.deviceId)) return failValidation(errors, `${path}.deviceId must be a non-empty string`);
  if (!isNonEmptyString(raw.activityType)) return failValidation(errors, `${path}.activityType must be a non-empty string`);
  if (!isValidIsoTimestamp(raw.startedAt)) return failValidation(errors, `${path}.startedAt must be a valid ISO timestamp`);
  const normalizedStart = new Date(raw.startedAt).toISOString();
  const rawEndedAt = raw.endedAt ?? normalizedStart;
  if (!isValidIsoTimestamp(rawEndedAt)) return failValidation(errors, `${path}.endedAt must be a valid ISO timestamp`);
  if (!checkNonNegs(raw, path, ['distanceMeters', 'durationSec', 'caloriesKcal'], errors)) return null;
  if (!Array.isArray(raw.waypoints)) return failValidation(errors, `${path}.waypoints must be an array`);
  const waypoints: GpsWaypoint[] = [];
  for (let i = 0; i < raw.waypoints.length; i++) {
    const wp = validateGpsWaypoint(raw.waypoints[i], `${path}.waypoints[${i}]`, errors);
    if (!wp) return null;
    waypoints.push(wp);
  }
  const avgHeartRateBpm = clampOptionalHr(raw.avgHeartRateBpm, `${path}.avgHeartRateBpm`, errors);
  if (avgHeartRateBpm === null) return null;
  const maxHeartRateBpm = clampOptionalHr(raw.maxHeartRateBpm, `${path}.maxHeartRateBpm`, errors);
  if (maxHeartRateBpm === null) return null;
  let elevationGainMeters: number | undefined;
  if (raw.elevationGainMeters !== undefined) {
    if (!isFiniteNonNegative(raw.elevationGainMeters)) return failValidation(errors, `${path}.elevationGainMeters must be non-negative`);
    elevationGainMeters = Math.round(raw.elevationGainMeters * 10) / 10;
  }
  return {
    id: raw.id.trim(),
    ...(isNonEmptyString(raw.deviceId) ? { deviceId: raw.deviceId.trim() } : {}),
    name: isNonEmptyString(raw.name) ? raw.name.trim() : `${raw.activityType.trim()} (${normalizedStart.slice(0, 10)})`,
    activityType: raw.activityType.trim(), startedAt: normalizedStart, endedAt: new Date(rawEndedAt).toISOString(),
    distanceMeters: Math.round(raw.distanceMeters as number), durationSec: Math.round(raw.durationSec as number),
    caloriesKcal: Math.round(raw.caloriesKcal as number),
    ...(avgHeartRateBpm !== undefined ? { avgHeartRateBpm } : {}),
    ...(maxHeartRateBpm !== undefined ? { maxHeartRateBpm } : {}),
    ...(elevationGainMeters !== undefined ? { elevationGainMeters } : {}),
    waypoints,
  };
}
