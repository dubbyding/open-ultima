/**
 * ULTIMA Fit — CRREPA Time Sync, Steps, Sleep & Nap Codecs
 *
 * Implements wall-clock / timezone sync (`0x31` / `0xBB`), daily/history step
 * summaries (`0x33` / `0xB6`, 3-byte and 4-byte LE), 48-slot 30-minute step
 * buckets (`0x59`), sleep transitions (`0x32` / `0x33` / `0xB6`), and naps (`0xBC`).
 */

import { CRP_CMD, CRP_HISTORY_DAY, CRP_SLEEP_STATE } from './constants.ts';
import type {
  CrpNapSegment,
  CrpNapSleepInfo,
  CrpSleepDecodeOptions,
  CrpSleepInfo,
  CrpSleepSegment,
  CrpStepCategoryInfo,
  CrpStepDecodeOptions,
  CrpStepInfo,
  CrpTimeSyncCommands,
} from './constants.ts';
import {
  buildCrpFrame,
  makeDataView,
  readCrpSmallIntLE,
  readU16LE,
} from './scanAndFraming.ts';

const GMT8_OFFSET_SECONDS = 8 * 3600;

function resolveTimezoneOffsetSeconds(date: Date, tzOffsetMinutes?: number): number {
  if (typeof tzOffsetMinutes === 'number' && Number.isFinite(tzOffsetMinutes)) {
    return Math.trunc(tzOffsetMinutes * 60);
  }
  // JS getTimezoneOffset() is minutes *behind* UTC (e.g. UTC+5:45 => -345).
  return Math.trunc(-date.getTimezoneOffset() * 60);
}

/** Inverse of `np8.b()` / exact match to `np8.a(long)`. */
export function decodeCrpWatchTimestamp(watchSeconds: number, tzOffsetMinutes?: number): Date {
  const probe = new Date(watchSeconds * 1000);
  const localOffsetMs = resolveTimezoneOffsetSeconds(probe, tzOffsetMinutes) * 1000;
  const gmt8OffsetMs = GMT8_OFFSET_SECONDS * 1000;
  return new Date(watchSeconds * 1000 - (localOffsetMs - gmt8OffsetMs));
}

/** Inverse of `decodeCrpWatchTimestamp`: encodes `Date` to CRREPA GMT+8-aligned watch seconds. */
export function encodeCrpWatchTimestamp(date: Date, tzOffsetMinutes?: number): number {
  const tzOffsetSeconds = resolveTimezoneOffsetSeconds(date, tzOffsetMinutes);
  const utcSeconds = Math.floor(date.getTime() / 1000);
  return (utcSeconds + tzOffsetSeconds - GMT8_OFFSET_SECONDS) >>> 0;
}

/**
 * Encodes wall-clock time sync (`0x31`) and timezone offset sync (`0xBB`).
 * Matches `np8.b()` & `np8.c()`:
 * - `0x31`: `[uint32_BE(localWallClockAdjustedToGmt8), 0x08]`
 * - `0xBB`: `[0x07, 0x00, int32_LE(tzOffsetSeconds)]` (signed two's complement)
 */
export function encodeTimeSync(date?: Date, tzOffsetMinutes?: number): CrpTimeSyncCommands {
  const now = date ?? new Date();
  const tzOffsetSeconds = resolveTimezoneOffsetSeconds(now, tzOffsetMinutes);
  const crpTimeSeconds = encodeCrpWatchTimestamp(now, tzOffsetMinutes);

  const timePayload = new Uint8Array(5);
  makeDataView(timePayload).setUint32(0, crpTimeSeconds, false);
  timePayload[4] = 0x08;

  const tzPayload = new Uint8Array(6);
  tzPayload[0] = 0x07;
  tzPayload[1] = 0x00;
  makeDataView(tzPayload).setInt32(2, tzOffsetSeconds, true);

  return {
    timeCmd: buildCrpFrame(CRP_CMD.SYNC_TIME, timePayload),
    tzCmd: buildCrpFrame(CRP_CMD.SYNC_TIMEZONE, tzPayload),
  };
}

/**
 * Returns the CRREPA frame sequence to sync today's steps and sleep:
 * `0x32` legacy sleep, `0x33 [0x00]` summary, `0xB6 [0x01, 0x00]` REM sleep,
 * and `0xB6 [0x00, 0x00]` v2 steps.
 */
export function encodeSyncStepsAndSleep(): Uint8Array[] {
  return [
    buildCrpFrame(CRP_CMD.SYNC_SLEEP),
    buildCrpFrame(CRP_CMD.QUERY_HISTORY_DAY, Uint8Array.of(0x00)),
    buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, Uint8Array.of(0x01, 0x00)),
    buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, Uint8Array.of(0x00, 0x00)),
  ];
}

/** Encodes legacy `0x33 [dayOffset]` history day query (`0` today, `1` yesterday, `2` 2d ago). */
export function encodeQueryHistoryDay(dayOffset: number): Uint8Array {
  return buildCrpFrame(CRP_CMD.QUERY_HISTORY_DAY, Uint8Array.of(dayOffset & 0xff));
}

/** Encodes v2 `0xB6` history day query for steps (`0`), sleep (`1`), or timing HR (`2`). */
export function encodeQueryHistoryDayV2(
  dayOffset: number,
  metric: 'steps' | 'sleep' | 'heartRate'
): Uint8Array {
  if (metric === 'heartRate') {
    return buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, Uint8Array.of(0x02, dayOffset & 0xff, 0x00));
  }
  const typeByte = metric === 'sleep' ? 0x01 : 0x00;
  return buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, Uint8Array.of(typeByte, dayOffset & 0xff));
}

/** Encodes `0x33 [3|4]` legacy sleep history query (`oi8.a`). */
export function encodeQuerySleepHistory(dayOffset: number): Uint8Array {
  const code = dayOffset === CRP_HISTORY_DAY.THE_DAY_BEFORE_YESTERDAY ? 4 : 3;
  return buildCrpFrame(CRP_CMD.QUERY_HISTORY_DAY, Uint8Array.of(code));
}

/** Encodes `0x59` 30-minute step category sync (`0` starts today, `2` starts yesterday). */
export function encodeSyncStepCategory(chunkIndex = 0): Uint8Array {
  return buildCrpFrame(CRP_CMD.QUERY_STEPS_CATEGORY, Uint8Array.of(chunkIndex & 0xff));
}

/**
 * Encodes `0xBC` nap sleep sync (`oi8.a(CRPHistoryDay)`):
 * today (`0`) uses `[0x01, 0x00]`; past days use `[0x01, 0x01, dayOffset]`.
 */
export function encodeSyncNapSleep(dayOffset = 0): Uint8Array {
  return buildCrpFrame(
    CRP_CMD.SYNC_NAP_SLEEP,
    dayOffset === 0 ? Uint8Array.of(0x01, 0x00) : Uint8Array.of(0x01, 0x01, dayOffset & 0xff)
  );
}

/**
 * Decodes CRREPA step summaries matching `nl8.a` (4-byte LE fields with
 * `calories / 10000`, `distance / 100`) and `nl8.b` (3-byte LE fields).
 * Automatically handles optional `0x33 [day]` (`10`/`13` B) and `0xB6 [0x00, day]`
 * (`14`/`18` B) prefixes when `options.format` is `'auto'`.
 */
export function decodeStepInfo(
  payload: Uint8Array,
  options?: CrpStepDecodeOptions
): CrpStepInfo | null {
  if (payload.length < 9) {
    return null;
  }

  let format = options?.format ?? 'auto';
  let body = payload;
  let dayOffset: number | undefined;

  if (format !== '3byte' && (payload.length === 14 || payload.length === 18) && payload[0] === 0x00) {
    dayOffset = payload[1]!;
    body = payload.subarray(2);
    format = '4byte';
  } else if (format !== '4byte' && (payload.length === 10 || payload.length === 13)) {
    dayOffset = payload[0]!;
    body = payload.subarray(1);
    format = '3byte';
  } else if (format === 'auto') {
    if (payload.length === 16) {
      format = '4byte';
    } else if (payload.length === 9) {
      format = '3byte';
    } else if (payload.length === 12) {
      // Disambiguate 12B `nl8.a` (no time) vs 12B `nl8.b` (with time):
      // In `nl8.a`, byte[3] is MSB of uint32 steps and [4..7]/[8..11] hold kcal*10000 and m*100.
      const calProbe = readCrpSmallIntLE(payload, 4, 4);
      const distProbe = readCrpSmallIntLE(payload, 8, 4);
      const hasScaledLowerBytes = payload[4] !== 0 || payload[5] !== 0 || payload[8] !== 0;
      const looksLike4Byte =
        payload[3] === 0 &&
        payload[7] === 0 &&
        payload[11] === 0 &&
        hasScaledLowerBytes &&
        (calProbe === 0 || calProbe >= 10000) &&
        (distProbe === 0 || distProbe >= 100);
      format = looksLike4Byte ? '4byte' : '3byte';
    }
  }

  if (format === '4byte') {
    if (body.length < 12 || body.length % 4 !== 0) {
      return null;
    }
    return {
      steps: readCrpSmallIntLE(body, 0, 4),
      distanceMeters: Math.trunc(readCrpSmallIntLE(body, 8, 4) / 100),
      caloriesKcal: Math.trunc(readCrpSmallIntLE(body, 4, 4) / 10000),
      durationSec: body.length > 12 ? readCrpSmallIntLE(body, 12, 4) : 0,
      ...(dayOffset !== undefined ? { dayOffset } : {}),
      format: '4byte',
    };
  }

  if (body.length < 9 || body.length % 3 !== 0) {
    return null;
  }
  return {
    steps: readCrpSmallIntLE(body, 0, 3),
    distanceMeters: readCrpSmallIntLE(body, 3, 3),
    caloriesKcal: readCrpSmallIntLE(body, 6, 3),
    durationSec: body.length > 9 ? readCrpSmallIntLE(body, 9, 3) : 0,
    ...(dayOffset !== undefined ? { dayOffset } : {}),
    format: '3byte',
  };
}

function readU16LEArray(bytes: Uint8Array, startOffset: number): number[] {
  const out: number[] = [];
  for (let i = startOffset; i + 1 < bytes.length; i += 2) {
    out.push(readU16LE(bytes, i));
  }
  return out;
}

/**
 * Decodes `0x59` half-hour step buckets (`yl8.smali`).
 * Single chunk: `[chunkIndex, ...uint16_LE]` (`49` B -> 24 buckets + `nextChunkCmd`).
 * Two chunks (`payload`, `secondChunk`) or merged 96B raw payload -> all 48 buckets.
 */
export function decodeStepCategory(
  payload: Uint8Array,
  secondChunk?: Uint8Array
): CrpStepCategoryInfo | null {
  if (payload.length < 3) {
    return null;
  }

  if (secondChunk !== undefined) {
    const first = decodeStepCategory(payload);
    const second = decodeStepCategory(secondChunk);
    if (!first || !second) {
      return null;
    }
    const buckets = new Array<number>(48).fill(0);
    for (let i = 0; i < 24; i++) {
      if (i < first.buckets.length) buckets[i] = first.buckets[i]!;
      if (i < second.buckets.length) buckets[24 + i] = second.buckets[i]!;
    }
    return { dayOffset: first.dayOffset, timeIntervalMinutes: 30, slotStart: 0, buckets, isComplete: true };
  }

  // Raw even-byte payload (e.g. already merged 48 * 2 = 96 bytes)
  if (payload.length % 2 === 0) {
    const buckets = readU16LEArray(payload, 0);
    return { dayOffset: 0, timeIntervalMinutes: 30, slotStart: 0, buckets, isComplete: buckets.length === 48 };
  }

  const chunkIndex = payload[0]!;
  const buckets = readU16LEArray(payload, 1);
  const needsNext = chunkIndex === 0 || chunkIndex === 2;
  return {
    dayOffset: chunkIndex >= 2 ? 1 : 0,
    timeIntervalMinutes: 30,
    chunkIndex,
    slotStart: (chunkIndex % 2) * 24,
    buckets,
    isComplete: !needsNext && buckets.length >= 24,
    ...(needsNext ? { nextChunkCmd: encodeSyncStepCategory(chunkIndex + 1) } : {}),
  };
}

function computeSleepDeltaMinutes(
  startHour: number,
  startMin: number,
  endHour: number,
  endMin: number
): number {
  const adjustedEndHour = startHour > endHour ? endHour + 24 : endHour;
  return (adjustedEndHour - startHour) * 60 + endMin - startMin;
}

function isValidThreeByteSleepStream(bytes: Uint8Array): boolean {
  if (bytes.length < 3 || bytes.length % 3 !== 0) {
    return false;
  }
  for (let i = 0; i < bytes.length; i += 3) {
    const state = bytes[i]!;
    const hour = bytes[i + 1]! % 24;
    const minute = bytes[i + 2]!;
    if (state > 3 || minute >= 60 || hour >= 24) {
      return false;
    }
  }
  return true;
}

/**
 * Decodes CRREPA sleep transition records matching `dl8.a([B)` (2-byte LE packed
 * transitions used by `0xB6`) and `dl8.a([BZ)` (3-byte `[state, hour, min]` used
 * by `0x32` / `0x33`).
 */
export function decodeSleepSegments(
  payload: Uint8Array,
  options?: CrpSleepDecodeOptions
): CrpSleepInfo | null {
  if (payload.length < 2) {
    return null;
  }

  let format = options?.format ?? 'auto';
  let body = payload;
  let dayOffset: number | undefined;

  if (options?.cmd === CRP_CMD.QUERY_DAY_HISTORY_V2 || options?.hasPrefix) {
    if (payload[0] === 0x01 && payload.length >= 4) {
      dayOffset = payload[1]!;
      body = payload.subarray(2);
      if (format === 'auto') format = '2byte';
    }
  } else if (options?.cmd === CRP_CMD.QUERY_HISTORY_DAY) {
    if (payload.length >= 4 && (payload.length - 1) % 3 === 0) {
      const code = payload[0]!;
      dayOffset = code === 4 ? 2 : code === 3 ? 1 : code;
      body = payload.subarray(1);
      format = '3byte';
    }
  } else if (format === 'auto') {
    const hasHistoryPrefix =
      payload.length >= 7 &&
      (payload.length - 1) % 3 === 0 &&
      (payload[0] === 0x03 || payload[0] === 0x04) &&
      isValidThreeByteSleepStream(payload.subarray(1));
    if (hasHistoryPrefix) {
      dayOffset = payload[0] === 4 ? 2 : 1;
      body = payload.subarray(1);
      format = '3byte';
    } else if (
      payload.length % 3 === 0 &&
      (payload.length % 2 !== 0 || isValidThreeByteSleepStream(payload))
    ) {
      format = '3byte';
    } else {
      format = '2byte';
    }
  }

  const step = format === '3byte' ? 3 : 2;
  if (body.length % step !== 0 || body.length < step) {
    return null;
  }

  const segments: CrpSleepSegment[] = [];
  const totals = [0, 0, 0, 0];
  let prevState = -1;
  let prevHour = 0;
  let prevMin = 0;

  for (let i = 0; i < body.length; i += step) {
    let state: number;
    let hour: number;
    let minute: number;
    if (step === 2) {
      const packed = readU16LE(body, i);
      state = packed & 0x0f;
      hour = (packed & 0x03f0) >>> 4;
      minute = (packed & 0xfc00) >>> 10;
    } else {
      state = body[i]!;
      hour = body[i + 1]! % 24;
      minute = body[i + 2]!;
    }

    const delta = computeSleepDeltaMinutes(prevHour, prevMin, hour, minute);
    if (delta < 0) {
      continue;
    }

    if (prevState >= 0) {
      segments.push({
        state: prevState,
        startHour: prevHour,
        startMinute: prevMin,
        endHour: hour,
        endMinute: minute,
        durationMinutes: delta,
      });
      if (prevState <= 3) {
        totals[prevState]! += delta;
      }
    }

    prevState = state;
    prevHour = hour;
    prevMin = minute;
  }

  const deepMinutes = totals[CRP_SLEEP_STATE.DEEP]!;
  const lightMinutes = totals[CRP_SLEEP_STATE.LIGHT]!;
  const remMinutes = totals[CRP_SLEEP_STATE.REM]!;

  return {
    format,
    ...(dayOffset !== undefined ? { dayOffset } : {}),
    deepMinutes,
    lightMinutes,
    remMinutes,
    awakeMinutes: totals[CRP_SLEEP_STATE.AWAKE]!,
    totalMinutes: deepMinutes + lightMinutes + remMinutes,
    segments,
  };
}

/**
 * Decodes `0xBC` nap sleep payloads (`dl8.b`). Supports optional 3-byte `[0x01, 0x00, dayOffset]`
 * prefix or raw 6-byte `[startFlag=1, startH, startM, endFlag=0, endH, endM]` tuples.
 */
export function decodeNapSleep(payload: Uint8Array): CrpNapSleepInfo | null {
  if (payload.length < 6) {
    return null;
  }

  let body = payload;
  let dayOffset: number | undefined;
  if (payload.length >= 9 && (payload.length - 3) % 6 === 0 && payload[0] === 0x01 && payload[1] === 0x00) {
    dayOffset = payload[2]!;
    body = payload.subarray(3);
  }
  if (body.length % 6 !== 0) {
    return null;
  }

  const naps: CrpNapSegment[] = [];
  let totalMinutes = 0;

  for (let i = 0; i < body.length; i += 6) {
    if (body[i] !== 0x01 || body[i + 3] !== 0x00) {
      continue;
    }
    const startHour = body[i + 1]!;
    const startMinute = body[i + 2]!;
    const endHour = body[i + 4]!;
    const endMinute = body[i + 5]!;
    const durationMinutes = computeSleepDeltaMinutes(startHour, startMinute, endHour, endMinute);
    if (durationMinutes <= 0) {
      continue;
    }
    totalMinutes += durationMinutes;
    naps.push({ startHour, startMinute, endHour, endMinute, durationMinutes });
  }

  return { ...(dayOffset !== undefined ? { dayOffset } : {}), totalMinutes, naps };
}
