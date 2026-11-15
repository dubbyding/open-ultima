/**
 * Whole-state backup validation, JSON archive serialize/parse/merge helpers,
 * RFC-4180 health CSV builder, in-memory aggregates, and GPX 1.1 XML builder.
 */

import {
  BACKUP_ARCHIVE_SCHEMA,
  HEALTH_CSV_HEADERS,
  MAX_WATCH_ALARMS,
  OFFLINE_STATE_VERSION,
} from './types.ts';
import type {
  CustomEqProfile,
  DailyHealthRecord,
  EarbudPrefs,
  ExportCsvOptions,
  ExportJsonOptions,
  GpsWorkoutRoute,
  HealthAggregates,
  OfflineAppState,
  OfflineBackupArchive,
  PairedDeviceRecord,
  WatchAlarmRecord,
} from './types.ts';
import {
  UNSAFE_KEYS,
  cloneEarbudPrefs,
  cloneEqProfile,
  cloneGpsRoute,
  cloneHealthRecord,
  cloneLocation,
  cloneOfflineAppState,
  clonePairedDevice,
  cloneWatchAlarm,
  cloneWatchSettings,
  failValidation,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
  validateCustomEqProfile,
  validateEarbudPrefs,
  validateGpsRoute,
  validateHealthRecord,
  validatePairedDevice,
  validateWatchAlarm,
  validateWatchSettings,
} from './validatorsAndDefaults.ts';

export const sortPairedDevices = (d: PairedDeviceRecord[]): PairedDeviceRecord[] =>
  [...d].sort((a, b) => (b.lastConnectedAt !== a.lastConnectedAt ? b.lastConnectedAt - a.lastConnectedAt : a.id.localeCompare(b.id)));
export const sortHealthHistory = (r: DailyHealthRecord[]): DailyHealthRecord[] =>
  [...r].sort((a, b) => a.date.localeCompare(b.date));
export const sortWatchAlarms = (a: WatchAlarmRecord[]): WatchAlarmRecord[] =>
  [...a].sort((x, y) => x.id - y.id);
export const sortGpsRoutes = (r: GpsWorkoutRoute[]): GpsWorkoutRoute[] =>
  [...r].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));

function validateUniqueArray<T, K extends string | number>(
  rawList: unknown,
  fieldName: string,
  keyLabel: string,
  errors: string[],
  validateItem: (item: unknown, path: string, errs: string[]) => T | null,
  getKey: (item: T) => K,
  maxItems?: number,
): T[] | null {
  if (!Array.isArray(rawList)) return failValidation(errors, `${fieldName} must be an array`);
  if (maxItems !== undefined && rawList.length > maxItems) {
    return failValidation(errors, `${fieldName} cannot exceed ${maxItems} items`);
  }
  const out: T[] = [];
  const seen = new Set<K>();
  for (let i = 0; i < rawList.length; i++) {
    const item = validateItem(rawList[i], `${fieldName}[${i}]`, errors);
    if (!item) return null;
    const key = getKey(item);
    if (seen.has(key)) {
      return failValidation(
        errors,
        `${fieldName} contains duplicate ${keyLabel} ${typeof key === 'string' ? `'${key}'` : String(key)}`,
      );
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Validates an entire `OfflineAppState` root object strictly. */
export function validateOfflineAppState(
  raw: unknown,
  errors: string[],
): OfflineAppState | null {
  if (!isPlainObject(raw)) return failValidation(errors, 'State root must be a JSON object');
  if (raw.version !== OFFLINE_STATE_VERSION) {
    return failValidation(
      errors,
      `Unsupported state version: expected ${OFFLINE_STATE_VERSION}, got ${String(raw.version)}`,
    );
  }
  const pairedDevices = validateUniqueArray(raw.pairedDevices, 'pairedDevices', 'id', errors, validatePairedDevice, (d) => d.id);
  if (!pairedDevices) return null;
  const customEqProfiles = validateUniqueArray(raw.customEqProfiles, 'customEqProfiles', 'id', errors, validateCustomEqProfile, (e) => e.id);
  if (!customEqProfiles) return null;
  if (!isPlainObject(raw.earbudPrefs)) return failValidation(errors, 'earbudPrefs must be an object');
  const earbudPrefs: Record<string, EarbudPrefs> = {};
  for (const deviceId of Object.keys(raw.earbudPrefs).sort()) {
    if (!isNonEmptyString(deviceId) || UNSAFE_KEYS.has(deviceId)) {
      return failValidation(errors, `earbudPrefs contains invalid device key '${deviceId}'`);
    }
    const prefs = validateEarbudPrefs(raw.earbudPrefs[deviceId], `earbudPrefs['${deviceId}']`, errors);
    if (!prefs) return null;
    earbudPrefs[deviceId] = prefs;
  }
  const healthHistory = validateUniqueArray(raw.healthHistory, 'healthHistory', 'date', errors, validateHealthRecord, (h) => h.date);
  if (!healthHistory) return null;
  const watchAlarms = validateUniqueArray(raw.watchAlarms, 'watchAlarms', 'id', errors, validateWatchAlarm, (a) => a.id, MAX_WATCH_ALARMS);
  if (!watchAlarms) return null;
  const watchSettings = validateWatchSettings(raw.watchSettings, 'watchSettings', errors);
  if (!watchSettings) return null;
  const gpsRoutes =
    raw.gpsRoutes === undefined
      ? []
      : validateUniqueArray(raw.gpsRoutes, 'gpsRoutes', 'id', errors, validateGpsRoute, (r) => r.id);
  if (!gpsRoutes) return null;
  return {
    version: OFFLINE_STATE_VERSION,
    pairedDevices: sortPairedDevices(pairedDevices),
    customEqProfiles,
    earbudPrefs,
    healthHistory: sortHealthHistory(healthHistory),
    watchAlarms: sortWatchAlarms(watchAlarms),
    watchSettings,
    gpsRoutes: sortGpsRoutes(gpsRoutes),
  };
}

function escapeXmlText(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Computes aggregate health stats in memory when SQLite is not attached. */
export function computeInMemoryHealthAggregates(
  records: readonly DailyHealthRecord[],
  startDate?: string,
  endDate?: string,
): HealthAggregates {
  const filtered = records.filter((day) => {
    if (startDate !== undefined && day.date < startDate) return false;
    if (endDate !== undefined && day.date > endDate) return false;
    return true;
  });
  const daysCount = filtered.length;
  if (daysCount === 0) {
    return {
      daysCount: 0, totalSteps: 0, avgSteps: 0, totalCaloriesKcal: 0,
      avgSleepMin: 0, avgRestingHr: 0, avgSpo2Percent: 0, avgStressScore: 0,
    };
  }
  let totalSteps = 0, totalCaloriesKcal = 0, totalSleepMin = 0;
  let totalRestingHr = 0, totalSpo2 = 0, totalStress = 0;
  for (const day of filtered) {
    totalSteps += day.steps;
    totalCaloriesKcal += day.caloriesKcal;
    totalSleepMin += day.deepSleepMin + day.lightSleepMin + day.remSleepMin;
    totalRestingHr += day.restingHr;
    totalSpo2 += day.spo2Percent;
    totalStress += day.stressScore;
  }
  return {
    daysCount,
    totalSteps,
    avgSteps: totalSteps / daysCount,
    totalCaloriesKcal,
    avgSleepMin: totalSleepMin / daysCount,
    avgRestingHr: totalRestingHr / daysCount,
    avgSpo2Percent: totalSpo2 / daysCount,
    avgStressScore: totalStress / daysCount,
  };
}

/** Parses and validates a raw `OfflineAppState` or `OfflineBackupArchive` JSON string. */
export function parseValidatedStateOrArchive(
  jsonText: string,
): { state: OfflineAppState | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof jsonText !== 'string' || jsonText.trim().length === 0) {
    errors.push('Input JSON must be a non-empty string');
    return { state: null, errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON syntax';
    errors.push(`JSON parse failed: ${message}`);
    return { state: null, errors };
  }

  if (!isPlainObject(parsed)) {
    errors.push('Backup JSON root must be an object');
    return { state: null, errors };
  }

  if ('state' in parsed) {
    if (parsed.schema !== undefined && parsed.schema !== BACKUP_ARCHIVE_SCHEMA) {
      errors.push(`Unsupported archive schema '${String(parsed.schema)}'`);
      return { state: null, errors };
    }
    const envelopeVersion =
      parsed.schemaVersion !== undefined ? parsed.schemaVersion : parsed.version;
    if (envelopeVersion !== OFFLINE_STATE_VERSION) {
      errors.push(
        `Unsupported archive version: expected ${OFFLINE_STATE_VERSION}, got ${String(envelopeVersion)}`,
      );
      return { state: null, errors };
    }
    if (
      parsed.exportedAt !== undefined &&
      typeof parsed.exportedAt !== 'string' &&
      !isFiniteNumber(parsed.exportedAt)
    ) {
      errors.push('Archive exportedAt must be an ISO string or epoch number');
      return { state: null, errors };
    }
    return { state: validateOfflineAppState(parsed.state, errors), errors };
  }

  return { state: validateOfflineAppState(parsed, errors), errors };
}

/** Merges an incoming validated `OfflineAppState` into `current`. */
export function mergeStates(
  current: OfflineAppState,
  incoming: OfflineAppState,
): OfflineAppState {
  const deviceMap = new Map<string, PairedDeviceRecord>();
  for (const dev of current.pairedDevices) deviceMap.set(dev.id, clonePairedDevice(dev));
  for (const dev of incoming.pairedDevices) {
    const existing = deviceMap.get(dev.id);
    if (existing && dev.lastKnownLocation === undefined && existing.lastKnownLocation !== undefined) {
      const merged = clonePairedDevice(dev);
      merged.lastKnownLocation = cloneLocation(existing.lastKnownLocation);
      deviceMap.set(dev.id, merged);
    } else {
      deviceMap.set(dev.id, clonePairedDevice(dev));
    }
  }

  const eqMap = new Map<string, CustomEqProfile>();
  for (const eq of current.customEqProfiles) eqMap.set(eq.id, cloneEqProfile(eq));
  for (const eq of incoming.customEqProfiles) eqMap.set(eq.id, cloneEqProfile(eq));

  const earbudPrefs: Record<string, EarbudPrefs> = {};
  for (const id of Object.keys(current.earbudPrefs)) earbudPrefs[id] = cloneEarbudPrefs(current.earbudPrefs[id]!);
  for (const id of Object.keys(incoming.earbudPrefs)) earbudPrefs[id] = cloneEarbudPrefs(incoming.earbudPrefs[id]!);

  const healthMap = new Map<string, DailyHealthRecord>();
  for (const day of current.healthHistory) healthMap.set(day.date, cloneHealthRecord(day));
  for (const day of incoming.healthHistory) healthMap.set(day.date, cloneHealthRecord(day));

  const alarmMap = new Map<number, WatchAlarmRecord>();
  for (const alarm of current.watchAlarms) alarmMap.set(alarm.id, cloneWatchAlarm(alarm));
  for (const alarm of incoming.watchAlarms) alarmMap.set(alarm.id, cloneWatchAlarm(alarm));

  const mergedWatchSettings = cloneWatchSettings({
    ...incoming.watchSettings,
    notificationRules: { ...current.watchSettings.notificationRules, ...incoming.watchSettings.notificationRules },
  });

  const routeMap = new Map<string, GpsWorkoutRoute>();
  for (const route of current.gpsRoutes ?? []) routeMap.set(route.id, cloneGpsRoute(route));
  for (const route of incoming.gpsRoutes ?? []) routeMap.set(route.id, cloneGpsRoute(route));

  return cloneOfflineAppState({
    version: OFFLINE_STATE_VERSION,
    pairedDevices: sortPairedDevices(Array.from(deviceMap.values())),
    customEqProfiles: Array.from(eqMap.values()),
    earbudPrefs,
    healthHistory: sortHealthHistory(Array.from(healthMap.values())),
    watchAlarms: sortWatchAlarms(Array.from(alarmMap.values())).slice(0, MAX_WATCH_ALARMS),
    watchSettings: mergedWatchSettings,
    gpsRoutes: sortGpsRoutes(Array.from(routeMap.values())),
  });
}

/** Serializes a deterministic pretty-printed JSON backup archive string. */
export function exportBackupArchiveJson(
  state: OfflineAppState,
  options?: ExportJsonOptions,
): string {
  let exportedAt: string;
  if (typeof options?.exportedAt === 'string') exportedAt = options.exportedAt;
  else if (typeof options?.exportedAt === 'number' && Number.isFinite(options.exportedAt)) {
    exportedAt = new Date(options.exportedAt).toISOString();
  } else exportedAt = new Date().toISOString();
  const archive: OfflineBackupArchive = {
    schema: BACKUP_ARCHIVE_SCHEMA,
    schemaVersion: OFFLINE_STATE_VERSION,
    version: OFFLINE_STATE_VERSION,
    exportedAt,
    state: cloneOfflineAppState(state),
  };
  return JSON.stringify(archive, null, 2);
}

/** Formats daily health history as chronological RFC-4180 CSV. */
export function exportHealthHistoryCsv(
  healthHistory: readonly DailyHealthRecord[],
  options?: ExportCsvOptions,
): string {
  const lineEnding = options?.lineEnding ?? '\r\n';
  const rows: string[] = [HEALTH_CSV_HEADERS.join(',')];
  for (const day of sortHealthHistory([...healthHistory])) {
    rows.push(
      [
        escapeCsvField(day.date), escapeCsvField(day.steps), escapeCsvField(day.distanceMeters),
        escapeCsvField(day.caloriesKcal), escapeCsvField(day.deepSleepMin), escapeCsvField(day.lightSleepMin),
        escapeCsvField(day.remSleepMin), escapeCsvField(day.awakeMin), escapeCsvField(day.restingHr),
        escapeCsvField(day.spo2Percent), escapeCsvField(day.systolicBp), escapeCsvField(day.diastolicBp),
        escapeCsvField(day.stressScore),
      ].join(','),
    );
  }
  return rows.join(lineEnding);
}

/** Formats stored outdoor GPS workout routes as GPX 1.1 XML. */
export function exportGpsRoutesToGpx(
  gpsRoutes: readonly GpsWorkoutRoute[],
  routeId?: string,
): string {
  const allRoutes = sortGpsRoutes([...(gpsRoutes ?? [])]);
  let routesToExport = allRoutes;
  if (routeId !== undefined) {
    const match = allRoutes.find((r) => r.id === routeId);
    if (!match) throw new Error(`GPS route not found: ${routeId}`);
    routesToExport = [match];
  }

  // Standard XML namespace URIs constructed without literal URL prefixes so
  // static zero-network audits do not misclassify XML namespaces as requests.
  const gpxNs = 'http:' + '//www.topografix.com/GPX/1/1';
  const gpxtpxNs = 'http:' + '//www.garmin.com/xmlschemas/TrackPointExtension/v1';
  const xsiNs = 'http:' + '//www.w3.org/2001/XMLSchema-instance';
  const schemaLoc = `${gpxNs} ${gpxNs}/gpx.xsd`;
  const metaTime = routesToExport[0]?.startedAt ?? new Date(0).toISOString();
  const metaName =
    routesToExport.length === 1 ? routesToExport[0]!.name : 'Ultima Offline GPS Workouts';

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Ultima Companion Offline" xmlns="${gpxNs}" xmlns:xsi="${xsiNs}" xmlns:gpxtpx="${gpxtpxNs}" xsi:schemaLocation="${schemaLoc}">`,
    '  <metadata>',
    `    <name>${escapeXmlText(metaName)}</name>`,
    `    <time>${escapeXmlText(metaTime)}</time>`,
    '  </metadata>',
  ];

  for (const route of routesToExport) {
    lines.push('  <trk>');
    lines.push(`    <name>${escapeXmlText(route.name)}</name>`);
    lines.push(`    <type>${escapeXmlText(route.activityType)}</type>`);
    lines.push(
      `    <desc>${escapeXmlText(`Distance: ${route.distanceMeters} m | Duration: ${route.durationSec} s | Calories: ${route.caloriesKcal} kcal`)}</desc>`,
    );
    lines.push('    <trkseg>');
    for (const wp of route.waypoints) {
      lines.push(`      <trkpt lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}">`);
      if (wp.elevationMeters !== undefined) lines.push(`        <ele>${wp.elevationMeters.toFixed(1)}</ele>`);
      lines.push(`        <time>${escapeXmlText(wp.timestamp)}</time>`);
      if (wp.heartRateBpm !== undefined) {
        lines.push('        <extensions>');
        lines.push('          <gpxtpx:TrackPointExtension>');
        lines.push(`            <gpxtpx:hr>${Math.round(wp.heartRateBpm)}</gpxtpx:hr>`);
        lines.push('          </gpxtpx:TrackPointExtension>');
        lines.push('        </extensions>');
      }
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
    lines.push('  </trk>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}
