/**
 * ULTIMA Fit — CRREPA GPS Path Trajectory (`0xB3`) & Movement Workouts (`0x37`)
 *
 * Implements NMEA `DDMM.MMMM * 1e6` sign-magnitude 32-bit LE coordinate codecs,
 * GPS history / trajectory chunk / live location / phone location encoders &
 * decoders (`0xB3`), and 24-byte movement workout records (`0x37`).
 */

import { totalPathDistanceMeters } from '../../../utils/geoMath.ts';
import { CRP_CMD, CRP_GPS_SENTINEL, CRP_GPS_SUBCMD } from './constants.ts';
import {
  buildCrpFrame,
  makeDataView,
  readU16LE,
  readU32LE,
  unwrapCrpPayload,
} from './scanAndFraming.ts';
import {
  decodeCrpWatchTimestamp,
  encodeCrpWatchTimestamp,
} from './timeAndActivity.ts';

export interface CrpGpsHistoryEntry {
  watchTimeSeconds: number;
  timestamp: Date;
}

export interface CrpGpsWaypointInput {
  lat: number;
  lng: number;
  isPause?: boolean;
  isNoSignal?: boolean;
}

export interface CrpGpsWaypoint {
  lat: number;
  lng: number;
  latitude: number;
  longitude: number;
  timestamp: Date;
  timestampMs: number;
  isPause: boolean;
  isNoSignal: boolean;
}

export interface CrpGpsPathInfo {
  workoutTime: Date;
  workoutTimeSeconds: number;
  chunkIndex: number;
  isEndOfPath: boolean;
  points: CrpGpsWaypoint[];
  validPoints: CrpGpsWaypoint[];
  distanceMeters: number;
  durationSec: number;
  paceSecPerKm: number | null;
}

export interface CrpGpsLiveLocation {
  lat: number;
  lng: number;
  latitude: number;
  longitude: number;
  isPause: boolean;
  isNoSignal: boolean;
}

export interface CrpMovementWorkoutRecord {
  startTime: Date;
  endTime: Date;
  startTimeSeconds: number;
  endTimeSeconds: number;
  validTimeSeconds: number;
  workoutType: number;
  steps: number;
  distanceMeters: number;
  caloriesKcal: number;
}

// ---------------------------------------------------------------------------
// Internal NMEA & Sign-Magnitude Helpers
// ---------------------------------------------------------------------------

function toCrpWatchSeconds(workoutTime: number | Date, tzOffsetMinutes?: number): number {
  if (workoutTime instanceof Date) {
    return encodeCrpWatchTimestamp(workoutTime, tzOffsetMinutes);
  }
  return Math.trunc(workoutTime) >>> 0;
}

/** Matches `ByteUtils.parseGps`: 32-bit LE sign-magnitude integer (bit 31 = negative). */
function readCrpSignMagnitudeInt32LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const b3 = bytes[offset + 3]!;
  const magnitude = b0 | (b1 << 8) | (b2 << 16) | ((b3 & 0x7f) << 24);
  return (b3 & 0x80) !== 0 ? -magnitude : magnitude;
}

function writeCrpSignMagnitudeInt32LE(
  bytes: Uint8Array,
  offset: number,
  rawSigned: number,
  forceNegative = false
): void {
  const negative = forceNegative || rawSigned < 0;
  const mag = Math.min(0x7fffffff, Math.abs(Math.trunc(rawSigned)));
  bytes[offset] = mag & 0xff;
  bytes[offset + 1] = (mag >>> 8) & 0xff;
  bytes[offset + 2] = (mag >>> 16) & 0xff;
  bytes[offset + 3] = ((mag >>> 24) & 0x7f) | (negative ? 0x80 : 0x00);
}

/**
 * Converts CRREPA NMEA `DDMM.MMMM * 1e6` integer (`vm8.a`) to decimal degrees
 * rounded to 6 decimal places. Preserves sentinel raw integers `0` and `1`.
 */
function crpNmeaRawToDecimalDegrees(rawSigned: number): number {
  if (rawSigned === 1) {
    return CRP_GPS_SENTINEL.PAUSE;
  }
  if (rawSigned === 0) {
    return CRP_GPS_SENTINEL.NO_SIGNAL;
  }
  const sign = rawSigned < 0 ? -1 : 1;
  const absRaw = Math.abs(rawSigned);
  const degrees = Math.trunc(absRaw / 1_000_000);
  const minutesScaled = absRaw % 1_000_000;
  const decimal = degrees + minutesScaled / 600_000;
  return sign * (Math.round(decimal * 1_000_000) / 1_000_000);
}

/** Inverse of `crpNmeaRawToDecimalDegrees` (`decimal degrees -> DDMM.MMMM * 1e6`). */
function decimalDegreesToCrpNmeaRaw(deg: number): { magnitude: number; negative: boolean } {
  const negative = deg < 0;
  const absDeg = Math.abs(deg);
  let wholeDeg = Math.floor(absDeg);
  let minutesScaled = Math.round((absDeg - wholeDeg) * 60 * 10_000);
  if (minutesScaled >= 600_000) {
    wholeDeg += 1;
    minutesScaled -= 600_000;
  }
  return { magnitude: wholeDeg * 1_000_000 + minutesScaled, negative };
}

function decodeCrpGpsPoint(
  latRaw: number,
  lngRaw: number
): { lat: number; lng: number; isPause: boolean; isNoSignal: boolean } {
  const isPause = latRaw === 1;
  const isNoSignal = latRaw === 0;
  const lat = crpNmeaRawToDecimalDegrees(latRaw);
  const lng = isPause
    ? CRP_GPS_SENTINEL.PAUSE
    : isNoSignal
      ? CRP_GPS_SENTINEL.NO_SIGNAL
      : crpNmeaRawToDecimalDegrees(lngRaw);
  return { lat, lng, isPause, isNoSignal };
}

// ---------------------------------------------------------------------------
// GPS Command & Simulator Response Encoders (0xB3)
// ---------------------------------------------------------------------------

/** Encodes `0xB3 [0x00]` to query the watch's stored GPS workout start timestamps (`ni8`). */
export function encodeQueryGpsHistory(): Uint8Array {
  return buildCrpFrame(CRP_CMD.GPS_PATH, Uint8Array.of(CRP_GPS_SUBCMD.QUERY_HISTORY));
}

/** Encodes `0xB3 [0x01, uint32_LE(timeSec), uint16_LE(chunkIndex)]` (`ni8.a(int, int)`). */
export function encodeQueryGpsPath(
  workoutTime: number | Date,
  chunkIndex = 0,
  tzOffsetMinutes?: number
): Uint8Array {
  const payload = new Uint8Array(7);
  payload[0] = CRP_GPS_SUBCMD.QUERY_PATH;
  const view = makeDataView(payload);
  view.setUint32(1, toCrpWatchSeconds(workoutTime, tzOffsetMinutes), true);
  view.setUint16(5, chunkIndex & 0xffff, true);
  return buildCrpFrame(CRP_CMD.GPS_PATH, payload);
}

/** Encodes `0xB3 [0x02]` to request the watch's current live GPS fix. */
export function encodeQueryGpsLiveLocation(): Uint8Array {
  return buildCrpFrame(CRP_CMD.GPS_PATH, Uint8Array.of(CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION));
}

/** Encodes `0xB3 [0x04, int32_LE(lat * 1e6), int32_LE(lng * 1e6)]` (`ni8.a(double, double)`). */
export function encodeSendLocalLocation(lat: number, lng: number): Uint8Array {
  const payload = new Uint8Array(9);
  payload[0] = CRP_GPS_SUBCMD.SEND_LOCAL_LOCATION;
  const view = makeDataView(payload);
  view.setInt32(1, Math.trunc(lat * 1_000_000), true);
  view.setInt32(5, Math.trunc(lng * 1_000_000), true);
  return buildCrpFrame(CRP_CMD.GPS_PATH, payload);
}

/** Builds a CRREPA `0xB3` subcommand `0x00` GPS history timestamp list frame. */
export function encodeGpsHistoryResponse(
  workoutTimes: readonly (number | Date)[],
  tzOffsetMinutes?: number
): Uint8Array {
  const payload = new Uint8Array(1 + workoutTimes.length * 4);
  payload[0] = CRP_GPS_SUBCMD.QUERY_HISTORY;
  const view = makeDataView(payload);
  for (let i = 0; i < workoutTimes.length; i++) {
    const watchSeconds = toCrpWatchSeconds(workoutTimes[i]!, tzOffsetMinutes);
    view.setUint32(1 + i * 4, watchSeconds, true);
  }
  return buildCrpFrame(CRP_CMD.GPS_PATH, payload);
}

/**
 * Builds a CRREPA `0xB3` subcommand `0x01` GPS path chunk RX frame using exact
 * NMEA `DDMM.MMMM * 1e6` sign-magnitude 32-bit LE waypoint encoding.
 */
export function encodeGpsPathChunkFrame(input: {
  workoutTime: number | Date;
  chunkIndex: number;
  points: readonly CrpGpsWaypointInput[];
  isEndOfPath?: boolean;
  tzOffsetMinutes?: number;
}): Uint8Array {
  const watchSeconds = toCrpWatchSeconds(input.workoutTime, input.tzOffsetMinutes);
  const chunkField = input.isEndOfPath
    ? CRP_GPS_SENTINEL.END_CHUNK_INDEX
    : input.chunkIndex & 0xffff;
  const payload = new Uint8Array(7 + input.points.length * 8);
  payload[0] = CRP_GPS_SUBCMD.QUERY_PATH;
  const view = makeDataView(payload);
  view.setUint32(1, watchSeconds, true);
  view.setUint16(5, chunkField, true);

  for (let i = 0; i < input.points.length; i++) {
    const pt = input.points[i]!;
    const off = 7 + i * 8;
    if (pt.isNoSignal || (pt.lat === 200 && pt.lng === 200)) {
      writeCrpSignMagnitudeInt32LE(payload, off, 0, false);
      writeCrpSignMagnitudeInt32LE(payload, off + 4, 0, false);
      continue;
    }
    if (pt.isPause || (pt.lat === 0 && pt.lng === 0)) {
      writeCrpSignMagnitudeInt32LE(payload, off, 1, false);
      writeCrpSignMagnitudeInt32LE(payload, off + 4, 1, false);
      continue;
    }
    const latEnc = decimalDegreesToCrpNmeaRaw(pt.lat);
    const lngEnc = decimalDegreesToCrpNmeaRaw(pt.lng);
    writeCrpSignMagnitudeInt32LE(payload, off, latEnc.magnitude, latEnc.negative);
    writeCrpSignMagnitudeInt32LE(payload, off + 4, lngEnc.magnitude, lngEnc.negative);
  }

  return buildCrpFrame(CRP_CMD.GPS_PATH, payload);
}

// ---------------------------------------------------------------------------
// GPS & Movement Workout Decoders (0xB3 & 0x37)
// ---------------------------------------------------------------------------

/**
 * Decodes `0xB3` subcommand `0x00` GPS workout history timestamps (`vm8.d`).
 * Accepts either a full `0xFE 0xEA` frame or its payload.
 */
export function decodeGpsHistoryTimestamps(
  rawOrPayload: Uint8Array,
  tzOffsetMinutes?: number
): CrpGpsHistoryEntry[] {
  const payload = unwrapCrpPayload(rawOrPayload, CRP_CMD.GPS_PATH);
  if (!payload || payload.length < 4) {
    return [];
  }
  const startOffset =
    payload[0] === CRP_GPS_SUBCMD.QUERY_HISTORY && payload.length % 4 === 1 ? 1 : 0;
  const entries: CrpGpsHistoryEntry[] = [];
  for (let i = startOffset; i + 3 < payload.length; i += 4) {
    const watchTimeSeconds = readU32LE(payload, i);
    if (watchTimeSeconds === 0) {
      continue;
    }
    entries.push({
      watchTimeSeconds,
      timestamp: decodeCrpWatchTimestamp(watchTimeSeconds, tzOffsetMinutes),
    });
  }
  return entries;
}

/**
 * Decodes `0xB3` subcommand `0x01` GPS workout trajectory chunks (`vm8.a` & `vy`).
 * Handles subcommand-prefixed (`len % 8 === 7`) and stripped (`len % 8 === 6`) bodies,
 * NMEA conversion, sign-magnitude coordinates, pause/no-signal sentinels, and end markers.
 */
export function decodeGpsPath(
  rawOrPayload: Uint8Array,
  options?: {
    tzOffsetMinutes?: number;
    pointIntervalMs?: number;
    startPointOffset?: number;
  }
): CrpGpsPathInfo | null {
  const payload = unwrapCrpPayload(rawOrPayload, CRP_CMD.GPS_PATH);
  if (!payload || payload.length < 6) {
    return null;
  }

  const hasSubCmdPrefix =
    payload[0] === CRP_GPS_SUBCMD.QUERY_PATH &&
    payload.length >= 7 &&
    (payload.length - 7) % 8 === 0;
  const body = hasSubCmdPrefix ? payload.subarray(1) : payload;
  if (body.length < 6 || (body.length - 6) % 8 !== 0) {
    return null;
  }

  const workoutTimeSeconds = readU32LE(body, 0);
  const chunkIndex = readU16LE(body, 4);
  let isEndOfPath = chunkIndex === CRP_GPS_SENTINEL.END_CHUNK_INDEX;
  const workoutTime = decodeCrpWatchTimestamp(workoutTimeSeconds, options?.tzOffsetMinutes);
  const pointIntervalMs = options?.pointIntervalMs ?? CRP_GPS_SENTINEL.DEFAULT_POINT_INTERVAL_MS;
  const startPointOffset = options?.startPointOffset ?? 0;

  const points: CrpGpsWaypoint[] = [];
  const validPoints: CrpGpsWaypoint[] = [];
  const baseMs = workoutTime.getTime();

  for (let i = 6, idx = 0; i + 7 < body.length; i += 8, idx++) {
    const latRaw = readCrpSignMagnitudeInt32LE(body, i);
    const lngByte0 = body[i + 4]!;
    if (latRaw === 1 && lngByte0 === 0xff) {
      isEndOfPath = true;
      break;
    }

    const lngRaw = readCrpSignMagnitudeInt32LE(body, i + 4);
    const { lat, lng, isPause, isNoSignal } = decodeCrpGpsPoint(latRaw, lngRaw);
    const timestampMs = baseMs + (startPointOffset + idx) * pointIntervalMs;
    const wp: CrpGpsWaypoint = {
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      timestamp: new Date(timestampMs),
      timestampMs,
      isPause,
      isNoSignal,
    };
    points.push(wp);
    if (!isPause && !isNoSignal && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      validPoints.push(wp);
    }
  }

  const distanceMeters = Math.round(totalPathDistanceMeters(validPoints));
  const durationSec =
    points.length > 1
      ? Math.max(1, Math.round(((points.length - 1) * pointIntervalMs) / 1000))
      : points.length === 1
        ? Math.round(pointIntervalMs / 1000)
        : 0;
  const paceSecPerKm =
    distanceMeters >= 10 && durationSec > 0
      ? Math.round(durationSec / (distanceMeters / 1000))
      : null;

  return {
    workoutTime,
    workoutTimeSeconds,
    chunkIndex,
    isEndOfPath,
    points,
    validPoints,
    distanceMeters,
    durationSec,
    paceSecPerKm,
  };
}

/** Decodes `0xB3` subcommand `0x02` live GPS location (`vm8.e`). */
export function decodeGpsLiveLocation(rawOrPayload: Uint8Array): CrpGpsLiveLocation | null {
  const payload = unwrapCrpPayload(rawOrPayload, CRP_CMD.GPS_PATH);
  if (!payload || payload.length < 8) {
    return null;
  }
  const hasSubCmd = payload[0] === CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION && payload.length === 9;
  const body = hasSubCmd ? payload.subarray(1) : payload;
  if (body.length < 8) {
    return null;
  }
  const latRaw = readCrpSignMagnitudeInt32LE(body, 0);
  const lngRaw = readCrpSignMagnitudeInt32LE(body, 4);
  const { lat, lng, isPause, isNoSignal } = decodeCrpGpsPoint(latRaw, lngRaw);
  return { lat, lng, latitude: lat, longitude: lng, isPause, isNoSignal };
}

/**
 * Encodes `0x37` movement workout query (`m38.queryMovementHeartRate` / `z48.H0`).
 * Empty-payload `0x37` requests stored 24-byte `CRPMovementHeartRateInfo` records.
 */
export function encodeQueryMovementWorkouts(): Uint8Array {
  return buildCrpFrame(CRP_CMD.HEART_RATE_24H_CHUNK);
}

/**
 * Decodes `0x37` `CRPMovementHeartRateInfo` 24-byte workout records (`mr8.a` / `z48.H0`):
 * `startTime(u32 LE)`, `endTime(u32 LE)`, `validTime(u16 LE)`, `reserved(1B)`,
 * `type(1B)`, `steps(u32 LE)`, `distanceMeters(u32 LE)`, `calories(u16 LE)`, `reserved(2B)`.
 */
export function decodeMovementWorkouts(
  rawOrPayload: Uint8Array,
  tzOffsetMinutes?: number
): CrpMovementWorkoutRecord[] {
  const payload = unwrapCrpPayload(rawOrPayload, CRP_CMD.HEART_RATE_24H_CHUNK);
  if (!payload || payload.length < 24 || payload.length % 24 !== 0) {
    return [];
  }
  const records: CrpMovementWorkoutRecord[] = [];
  for (let i = 0; i + 23 < payload.length; i += 24) {
    const startTimeSeconds = readU32LE(payload, i);
    const endTimeSeconds = readU32LE(payload, i + 4);
    if (startTimeSeconds === 0 && endTimeSeconds === 0) {
      continue;
    }
    records.push({
      startTime: decodeCrpWatchTimestamp(startTimeSeconds, tzOffsetMinutes),
      endTime: decodeCrpWatchTimestamp(endTimeSeconds, tzOffsetMinutes),
      startTimeSeconds,
      endTimeSeconds,
      validTimeSeconds: readU16LE(payload, i + 8),
      workoutType: payload[i + 11]!,
      steps: readU32LE(payload, i + 12),
      distanceMeters: readU32LE(payload, i + 16),
      caloriesKcal: readU16LE(payload, i + 20),
    });
  }
  return records;
}
