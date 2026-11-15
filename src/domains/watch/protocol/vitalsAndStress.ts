/**
 * ULTIMA Fit — CRREPA Vitals (Heart Rate, Blood Pressure, SpO2) & Stress Codecs
 *
 * Implements single-shot measurements, timing/24h queries, and history decoders
 * for HR (`0x68`/`0x6D`/`0x1F`/`0x35`/`0x36`/`0xB6`/`0xAB`), BP (`0x69`/`0x7E`/`0x3D`/`0xAB`),
 * SpO2 (`0x6B`/`0x7E`/`0x3E`/`0xAB`), and Stress (`0xB9` subcommands `0x01`/`0x11`).
 */

import { CRP_CMD, CRP_HISTORY_DAY, CRP_STRESS_DATE } from './constants.ts';
import { buildCrpFrame, readU32LE } from './scanAndFraming.ts';
import { decodeCrpWatchTimestamp } from './timeAndActivity.ts';

export interface CrpHeartRateSingleInfo {
  bpm: number;
  sensorContact?: boolean;
}

export interface CrpHeartRateHistorySample {
  bpm: number;
  timestamp: Date;
  rawTimestampSeconds: number;
}

export interface CrpHeartRate24hInfo {
  kind: 'timing_5min' | 'continuous_1min' | 'history';
  partIndex: number;
  dayOffset?: number;
  intervalMinutes: number;
  values: number[];
  historySamples?: CrpHeartRateHistorySample[];
}

export interface CrpBloodPressureSample {
  systolic: number;
  diastolic: number;
  timestamp?: Date;
  rawTimestampSeconds?: number;
}

export interface CrpBloodPressureDecoded {
  kind: 'single' | '24h_chunk' | 'history';
  systolic?: number;
  diastolic?: number;
  chunkIndex?: number;
  isLastChunk?: boolean;
  nextChunkCmd?: Uint8Array;
  readings: CrpBloodPressureSample[];
}

export interface CrpSpO2HistorySample {
  spo2: number;
  timestamp: Date;
  rawTimestampSeconds: number;
}

export interface CrpSpO2Decoded {
  kind: 'single' | 'chunk' | 'history';
  spo2?: number;
  chunkIndex?: number;
  values: number[];
  historySamples?: CrpSpO2HistorySample[];
}

export interface CrpStressHistorySample {
  stress: number;
  timestamp: Date;
  rawTimestampSeconds: number;
}

export interface CrpStressDecoded {
  kind: 'timing_30min' | 'history';
  dateType?: number;
  values: number[];
  historySamples?: CrpStressHistorySample[];
}

// ---------------------------------------------------------------------------
// Vitals & Stress Command Encoders
// ---------------------------------------------------------------------------

/** Encodes `0x68` single heart-rate measurement (`0x00` start, `0xFF` stop). */
export function encodeMeasureHeartRate(start: boolean): Uint8Array {
  return buildCrpFrame(CRP_CMD.MEASURE_HEART_RATE, Uint8Array.of(start ? 0x00 : 0xff));
}

/** Encodes `0x6D` dynamic heart-rate measurement (`0x00` start, `0xFF` stop). */
export function encodeDynamicHeartRate(start: boolean): Uint8Array {
  return buildCrpFrame(CRP_CMD.DYNAMIC_HEART_RATE, Uint8Array.of(start ? 0x00 : 0xff));
}

/** Encodes `0x1F` timing heart-rate interval in 5-minute units (`0` disables). */
export function encodeTimingHeartRateInterval(interval5MinUnits: number): Uint8Array {
  const val = interval5MinUnits > 0 ? interval5MinUnits & 0xff : 0x00;
  return buildCrpFrame(CRP_CMD.SET_TIMING_HEART_RATE, Uint8Array.of(val));
}

/** Encodes today's heart-rate query (`mode = 1` timing `0x35 [0x00]`; `mode = 2` 24h `0x36 [0x00]`). */
export function encodeQueryTodayHeartRate(mode: 1 | 2 = 1): Uint8Array {
  const cmd = mode === 2 ? CRP_CMD.QUERY_24H_HEART_RATE : CRP_CMD.QUERY_TIMING_HEART_RATE;
  return buildCrpFrame(cmd, Uint8Array.of(0x00));
}

/** Encodes `0x69` blood pressure measurement (`[0x00, 0x00, 0x00]` start, `[0xFF, 0xFF, 0xFF]` stop). */
export function encodeMeasureBloodPressure(start: boolean): Uint8Array {
  const payload = start ? Uint8Array.of(0x00, 0x00, 0x00) : Uint8Array.of(0xff, 0xff, 0xff);
  return buildCrpFrame(CRP_CMD.MEASURE_BLOOD_PRESSURE, payload);
}

/** Encodes `0x7E` timing blood-pressure enable (`[0x01, enable ? 1 : 0]`). */
export function encodeTimingBp(enable: boolean): Uint8Array {
  return buildCrpFrame(CRP_CMD.TIMING_SPO2_OR_BP, Uint8Array.of(0x01, enable ? 0x01 : 0x00));
}

/** Encodes `0x6B` SpO2 measurement (`[0x00]` start, `[0xFF]` stop). */
export function encodeMeasureSpO2(start: boolean): Uint8Array {
  return buildCrpFrame(CRP_CMD.MEASURE_SPO2, Uint8Array.of(start ? 0x00 : 0xff));
}

/**
 * Encodes `0x7E` timing SpO2 (`lg8.a(int)` 1-byte interval when `interval` is given,
 * or `lg8.b(boolean)` `[0x02, enable ? 1 : 0]` continuous toggle when `interval` is omitted).
 */
export function encodeTimingSpO2(enable: boolean, interval?: number): Uint8Array {
  if (typeof interval === 'number') {
    const val = enable && interval > 0 ? interval & 0xff : 0x00;
    return buildCrpFrame(CRP_CMD.TIMING_SPO2_OR_BP, Uint8Array.of(val));
  }
  return buildCrpFrame(CRP_CMD.TIMING_SPO2_OR_BP, Uint8Array.of(0x02, enable ? 0x01 : 0x00));
}

/** Encodes `0x3E [offset]` 24h SpO2 chunk query (`lg8.c`). */
export function encodeQuery24hSpO2(offset = 0): Uint8Array {
  return buildCrpFrame(CRP_CMD.QUERY_24H_SPO2, Uint8Array.of(offset & 0xff));
}

/** Encodes `0x3D [offset]` 24h blood pressure chunk query (`tg8.a`). */
export function encodeQuery24hBp(offset = 0): Uint8Array {
  return buildCrpFrame(CRP_CMD.QUERY_24H_BP, Uint8Array.of(offset & 0xff));
}

/** Encodes `0xB9` timing stress toggle (`qm8.a(Z)` -> `[0x01, 0x00|0xFF]`). */
export function encodeTimingStress(enable: boolean): Uint8Array {
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, Uint8Array.of(0x01, enable ? 0x00 : 0xff));
}

/** Encodes `0xB9` timing stress query (`qm8.a(CRPStressDate)` -> `[0x11, 0x01, dateType]`). */
export function encodeQueryTimingStress(dateType: number = CRP_STRESS_DATE.TODAY): Uint8Array {
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, Uint8Array.of(0x11, 0x01, dateType & 0xff));
}

/** Encodes `0xB9` history stress query (`qm8.a()` -> `[0x11, 0x02]`). */
export function encodeQueryHistoryStress(): Uint8Array {
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, Uint8Array.of(0x11, 0x02));
}

/** Encodes `0xAB [0x01|0x02|0x00]` history vitals query (BP=`1`, SpO2=`2`, HR=`0`). */
export function encodeQueryHistoryVitals(metric: 'bp' | 'spo2' | 'hr'): Uint8Array {
  const code = metric === 'bp' ? 0x01 : metric === 'spo2' ? 0x02 : 0x00;
  return buildCrpFrame(CRP_CMD.QUERY_HISTORY_VITALS, Uint8Array.of(code));
}

// ---------------------------------------------------------------------------
// Vitals & Stress Payload Decoders
// ---------------------------------------------------------------------------

function clampHr(raw: number): number {
  return raw >= 40 && raw <= 200 ? raw : 0;
}

function clampSpO2(raw: number): number {
  return raw >= 80 && raw <= 100 ? raw : 0;
}

function decodeFiveByteTimedSamples<T>(
  payload: Uint8Array,
  startOffset: number,
  tzOffsetMinutes: number | undefined,
  clamp: (raw: number) => number,
  makeSample: (value: number, timestamp: Date, rawTimestampSeconds: number) => T
): { values: number[]; historySamples: T[] } {
  const historySamples: T[] = [];
  const values: number[] = [];
  for (let i = startOffset; i + 4 < payload.length; i += 5) {
    const value = clamp(payload[i]!);
    const rawTs = readU32LE(payload, i + 1);
    values.push(value);
    historySamples.push(
      makeSample(value, decodeCrpWatchTimestamp(rawTs, tzOffsetMinutes), rawTs)
    );
  }
  return { values, historySamples };
}

/**
 * Decodes single heart rate payloads (`0x68` / `0x6D` 1-byte BPM or standard
 * Bluetooth GATT `0x2A37` Heart Rate Measurement characteristic).
 */
export function decodeHeartRateSingle(payload: Uint8Array): CrpHeartRateSingleInfo | null {
  if (payload.length === 0) {
    return null;
  }
  if (payload.length === 1) {
    return { bpm: payload[0]! };
  }

  const flags = payload[0]!;
  const is16Bit = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const sensorContact = contactSupported ? (flags & 0x02) !== 0 : undefined;

  if (is16Bit) {
    if (payload.length < 3) {
      return null;
    }
    const bpm = payload[1]! | (payload[2]! << 8);
    return {
      bpm,
      ...(sensorContact !== undefined ? { sensorContact } : {}),
    };
  }

  return {
    bpm: payload[1]!,
    ...(sensorContact !== undefined ? { sensorContact } : {}),
  };
}

/**
 * Decodes 24h / timing / history heart-rate payloads (`bo8`):
 * - `0xAB` history (`[0x00, ..., bpm, uint32_LE_ts, ...]`, stride 5 at offset 2)
 * - `0xB6` v2 timing 5-min (`[0x02, dayOffset, partIndex, ...bpm]`)
 * - `0x35` timing 5-min (`[partIndex, ...bpm]`) or `0x36` / `0x37` 1-min 24h (`[partIndex, ...bpm]`)
 */
export function decodeHeartRate24h(
  payload: Uint8Array,
  options?: { tzOffsetMinutes?: number; kind?: 'timing_5min' | 'continuous_1min' | 'history' }
): CrpHeartRate24hInfo | null {
  if (payload.length < 2) {
    return null;
  }

  const forcedKind = options?.kind;

  if (
    forcedKind === 'history' ||
    (forcedKind === undefined &&
      payload[0] === 0x00 &&
      payload.length >= 7 &&
      (payload.length - 2) % 5 === 0)
  ) {
    const { values, historySamples } = decodeFiveByteTimedSamples(
      payload,
      2,
      options?.tzOffsetMinutes,
      clampHr,
      (bpm, timestamp, rawTimestampSeconds) => ({ bpm, timestamp, rawTimestampSeconds })
    );
    return { kind: 'history', partIndex: 0, intervalMinutes: 0, values, historySamples };
  }

  // `0xB6` timing HR: [0x02, dayOffset, partIndex, ...bpm]
  if (
    payload[0] === 0x02 &&
    payload.length >= 4 &&
    payload[1]! <= CRP_HISTORY_DAY.SIX_DAYS_AGO &&
    forcedKind !== 'continuous_1min'
  ) {
    const dayOffset = payload[1]!;
    const partIndex = payload[2]!;
    const values: number[] = [];
    for (let i = 3; i < payload.length; i++) {
      values.push(clampHr(payload[i]!));
    }
    return { kind: 'timing_5min', partIndex, dayOffset, intervalMinutes: 5, values };
  }

  const partIndex = payload[0]!;
  const values: number[] = [];
  for (let i = 1; i < payload.length; i++) {
    values.push(clampHr(payload[i]!));
  }

  const kind: 'timing_5min' | 'continuous_1min' =
    forcedKind === 'timing_5min' || forcedKind === 'continuous_1min'
      ? forcedKind
      : values.length <= 72 && partIndex >= 4
        ? 'timing_5min'
        : 'continuous_1min';

  return { kind, partIndex, intervalMinutes: kind === 'timing_5min' ? 5 : 1, values };
}

/**
 * Decodes blood pressure payloads (`le8`):
 * single (`[sbp, dbp]` or `[flag, sbp, dbp]`), 24h chunked (`0x3D`),
 * or history records (`0xAB`, offset 2, stride 6: `[sbp, dbp, uint32_LE_ts]`).
 */
export function decodeBloodPressure(
  payload: Uint8Array,
  options?: { tzOffsetMinutes?: number; kind?: 'single' | '24h_chunk' | 'history' }
): CrpBloodPressureDecoded | null {
  if (payload.length < 2) {
    return null;
  }

  const forcedKind = options?.kind;

  if (
    forcedKind === 'single' ||
    (forcedKind === undefined && (payload.length === 2 || payload.length === 3))
  ) {
    const systolic = payload.length === 2 ? payload[0]! : payload[1]!;
    const diastolic = payload.length === 2 ? payload[1]! : payload[2]!;
    return { kind: 'single', systolic, diastolic, readings: [{ systolic, diastolic }] };
  }

  if (
    forcedKind === 'history' ||
    (forcedKind === undefined &&
      payload.length >= 8 &&
      (payload.length - 2) % 6 === 0 &&
      payload[0] === 0x01)
  ) {
    const readings: CrpBloodPressureSample[] = [];
    for (let i = 2; i + 5 < payload.length; i += 6) {
      const rawTs = readU32LE(payload, i + 2);
      readings.push({
        systolic: payload[i]!,
        diastolic: payload[i + 1]!,
        timestamp: decodeCrpWatchTimestamp(rawTs, options?.tzOffsetMinutes),
        rawTimestampSeconds: rawTs,
      });
    }
    return { kind: 'history', readings };
  }

  const chunkIndex = payload[0]!;
  const readings: CrpBloodPressureSample[] = [];
  for (let i = 1; i + 1 < payload.length; i += 2) {
    readings.push({ systolic: payload[i]!, diastolic: payload[i + 1]! });
  }
  const isLastChunk = chunkIndex >= 0x13;
  return {
    kind: '24h_chunk',
    chunkIndex,
    isLastChunk,
    ...(!isLastChunk ? { nextChunkCmd: encodeQuery24hBp(chunkIndex + 1) } : {}),
    readings,
  };
}

/**
 * Decodes SpO2 payloads (`sd8` & `z48`):
 * single (`[spo2]`), history (`0x02` prefix, stride 5 `[spo2, uint32_LE_ts]`),
 * or timing/24h chunk (`[chunkIndex, ...spo2Values]` clamped `80..100`).
 */
export function decodeSpO2(
  payload: Uint8Array,
  options?: { tzOffsetMinutes?: number; kind?: 'single' | 'chunk' | 'history' }
): CrpSpO2Decoded | null {
  if (payload.length === 0) {
    return null;
  }

  const forcedKind = options?.kind;

  if (forcedKind === 'single' || (forcedKind === undefined && payload.length === 1)) {
    const spo2 = clampSpO2(payload[0]!);
    return { kind: 'single', spo2, values: [spo2] };
  }

  if (
    forcedKind === 'history' ||
    (forcedKind === undefined &&
      payload.length >= 7 &&
      (payload.length - 2) % 5 === 0 &&
      payload[0] === 0x02)
  ) {
    const { values, historySamples } = decodeFiveByteTimedSamples(
      payload,
      2,
      options?.tzOffsetMinutes,
      clampSpO2,
      (spo2, timestamp, rawTimestampSeconds) => ({ spo2, timestamp, rawTimestampSeconds })
    );
    return { kind: 'history', values, historySamples };
  }

  const chunkIndex = payload[0]!;
  const values: number[] = [];
  for (let i = 1; i < payload.length; i++) {
    values.push(clampSpO2(payload[i]!));
  }
  return { kind: 'chunk', chunkIndex, values };
}

/**
 * Decodes `0xB9` stress payloads (`pm8`):
 * history (`payload.length >= 8 && (payload.length - 3) % 5 === 0`, offset 3, stride 5)
 * or timing 30-min intervals (`payload.length >= 50`, `dateType = payload[2]`, values at `3..`).
 */
export function decodeStress(
  payload: Uint8Array,
  options?: { tzOffsetMinutes?: number; kind?: 'timing_30min' | 'history' }
): CrpStressDecoded | null {
  if (payload.length < 4) {
    return null;
  }

  const forcedKind = options?.kind;
  const decodeStressHistory = (): CrpStressDecoded => {
    const { values, historySamples } = decodeFiveByteTimedSamples(
      payload,
      3,
      options?.tzOffsetMinutes,
      (raw) => raw,
      (stress, timestamp, rawTimestampSeconds) => ({ stress, timestamp, rawTimestampSeconds })
    );
    return { kind: 'history', values, historySamples };
  };

  if (
    forcedKind === 'history' ||
    (forcedKind === undefined &&
      payload.length >= 8 &&
      (payload.length - 3) % 5 === 0 &&
      payload[1] === 0x02)
  ) {
    return decodeStressHistory();
  }

  if (forcedKind === 'timing_30min' || payload.length >= 50) {
    const dateType = payload[2]!;
    const values: number[] = [];
    for (let i = 3; i < payload.length; i++) {
      values.push(payload[i]!);
    }
    return { kind: 'timing_30min', dateType, values };
  }

  // Fallback for shorter history stress packets whose length satisfies `% 5 === 3`
  if ((payload.length - 3) % 5 === 0) {
    return decodeStressHistory();
  }

  return null;
}
