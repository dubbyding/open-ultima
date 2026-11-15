/**
 * Jieli RCSP command encoders (CustomCmd 0xFF, SetSysInfo 0x08, SearchDev 0x19,
 * SetADVInfo 0xC0, GetADVInfo 0xC1, GetSysInfo 0x07) and custom data decoder.
 */

import { encodeUtf8, toSignedInt8Byte } from '../adv/hexUtils.ts';
import { JIELI_ATTR_AND_FUN, JIELI_OPCODE } from '../catalog/index.ts';
import { packJieliCommand, packJieliLtv } from './rcspFraming.ts';
import type { JieliLtvEntry } from './rcspFraming.ts';

/** Vendor-specific Ultima EQ custom command tag & values sent via `CustomCmd` (`0xFF`). */
export const JIELI_ULTIMA_EQ_TAG = 0x10;
export const JIELI_ULTIMA_EQ_VALUE = {
  SIGNATURE_SOUND: 0x00,
  BALANCE_SOUND: 0x01,
} as const;

export type JieliUltimaEqValue =
  (typeof JIELI_ULTIMA_EQ_VALUE)[keyof typeof JIELI_ULTIMA_EQ_VALUE];

export type JieliUltimaEqPresetName = 'signature' | 'balance';

export interface JieliKeySetting {
  keyNum: number;
  action: number;
  fn: number;
}

export interface JieliLedSetting {
  scene: number;
  effect: number;
}

export interface JieliCustomEqOptions {
  mode: number;
  gains: readonly number[];
  opCodeSn: number;
  /**
   * Uses Jieli dynamic-band EQ format `[mode | 0x80, bandCount, ...gains]`.
   * When `false` (default), encodes fixed 10-band format `[mode, ...10 gains]`.
   */
  dynamic?: boolean;
  /** Optional band count override when `dynamic === true` (defaults to `gains.length`). */
  bandCount?: number;
}

export interface JieliSearchDevOptions {
  opCodeSn: number;
  /** Ring target / search type (defaults to `0`). */
  type?: number;
  /** Operation (`1` = start/ring, `0` = stop; defaults to `1`). */
  op?: number;
  /** Timeout in seconds, 16-bit big-endian (defaults to `0`). */
  timeoutSec?: number;
  /** Ring way (`0` = all, `1` = left, `2` = right; defaults to `0`). */
  way?: number;
  /** Player / audio source flag (defaults to `0`). */
  player?: number;
}

export type JieliCustomDataResult =
  | {
      kind: 'eq_query';
      tag: typeof JIELI_ULTIMA_EQ_TAG;
      raw: Uint8Array;
    }
  | {
      kind: 'eq_preset';
      tag: typeof JIELI_ULTIMA_EQ_TAG;
      preset: JieliUltimaEqPresetName | 'unknown';
      eqValue: number;
      raw: Uint8Array;
    };

function concatLtvChunks(chunks: readonly Uint8Array[], leadingByte?: number): Uint8Array {
  let totalLen = leadingByte !== undefined ? 1 : 0;
  for (const item of chunks) {
    totalLen += item.length;
  }
  const out = new Uint8Array(totalLen);
  let offset = 0;
  if (leadingByte !== undefined) {
    out[offset++] = leadingByte & 0xff;
  }
  for (const item of chunks) {
    out.set(item, offset);
    offset += item.length;
  }
  return out;
}

function encodeJieliAdvSingleByte(type: number, byteValue: number, opCodeSn: number): Uint8Array {
  return encodeJieliSetAdvInfo([{ type, value: new Uint8Array([byteValue & 0xff]) }], opCodeSn);
}

/** Wraps an arbitrary payload in Jieli `CustomCmd` (`0xFF`). */
export function encodeJieliCustomCmd(
  data: Uint8Array,
  opCodeSn: number,
  wantsResponse = true,
): Uint8Array {
  return packJieliCommand(JIELI_OPCODE.EXTRA_CUSTOM, opCodeSn, data, wantsResponse);
}

/** Encodes Ultima EQ query `[0x10]` via Jieli `CustomCmd` (`0xFF`). */
export function encodeJieliUltimaEqQuery(opCodeSn: number): Uint8Array {
  return encodeJieliCustomCmd(new Uint8Array([JIELI_ULTIMA_EQ_TAG]), opCodeSn);
}

/**
 * Encodes Ultima factory EQ preset switch via Jieli `CustomCmd` (`0xFF`):
 * - `'signature'` -> `[0x10, 0x00]` (Signature Sound)
 * - `'balance'` -> `[0x10, 0x01]` (Balance Sound)
 */
export function encodeJieliUltimaEqPreset(
  preset: JieliUltimaEqPresetName,
  opCodeSn: number,
): Uint8Array {
  const value =
    preset === 'signature'
      ? JIELI_ULTIMA_EQ_VALUE.SIGNATURE_SOUND
      : JIELI_ULTIMA_EQ_VALUE.BALANCE_SOUND;
  return encodeJieliCustomCmd(new Uint8Array([JIELI_ULTIMA_EQ_TAG, value]), opCodeSn);
}

/**
 * Encodes `SetSysInfo` (`0x08`) for a specified function and attribute list.
 */
export function encodeJieliSetSysInfo(
  fnType: number,
  attrs: readonly { type: number; data: Uint8Array }[],
  opCodeSn: number,
): Uint8Array {
  const packedAttrs = attrs.map((attr) => packJieliLtv(attr.type, attr.data));
  return packJieliCommand(
    JIELI_OPCODE.SET_SYS_INFO,
    opCodeSn,
    concatLtvChunks(packedAttrs, fnType),
  );
}

/**
 * Encodes 10-band custom EQ over `SetSysInfo` (`0x08`) using `SYS_INFO_FUNCTION_PUBLIC` (`0xFF`)
 * and `SYS_INFO_ATTR_EQ` (`0x04`), matching `CommandBuilder.buildSetEqValueCmd`.
 */
export function encodeJieliCustomEq(options: JieliCustomEqOptions): Uint8Array {
  let attrData: Uint8Array;

  if (options.dynamic) {
    const bandCount = options.bandCount ?? options.gains.length;
    attrData = new Uint8Array(2 + options.gains.length);
    attrData[0] = (options.mode & 0x7f) | 0x80;
    attrData[1] = bandCount & 0xff;
    for (let i = 0; i < options.gains.length; i++) {
      attrData[2 + i] = toSignedInt8Byte(options.gains[i]!);
    }
  } else {
    const bandCount = Math.min(10, options.gains.length);
    attrData = new Uint8Array(1 + 10);
    attrData[0] = options.mode & 0xff;
    for (let i = 0; i < bandCount; i++) {
      attrData[1 + i] = toSignedInt8Byte(options.gains[i]!);
    }
  }

  return encodeJieliSetSysInfo(
    JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_PUBLIC,
    [{ type: JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ, data: attrData }],
    options.opCodeSn,
  );
}

/**
 * Encodes `SearchDev` (`0x19`) 6-byte payload `[type, op, timeoutHi, timeoutLo, way, player]`.
 */
export function encodeJieliSearchDev(options: JieliSearchDevOptions): Uint8Array {
  const timeoutSec = options.timeoutSec ?? 0;
  const paramData = new Uint8Array([
    (options.type ?? 0) & 0xff,
    (options.op ?? 1) & 0xff,
    (timeoutSec >> 8) & 0xff,
    timeoutSec & 0xff,
    (options.way ?? 0) & 0xff,
    (options.player ?? 0) & 0xff,
  ]);
  return packJieliCommand(JIELI_OPCODE.SEARCH_DEVICE, options.opCodeSn, paramData);
}

/**
 * Encodes `SetADVInfo` (`0xC0`) from one or more `[len, advType, ...value]` LTV entries.
 */
export function encodeJieliSetAdvInfo(
  entries: readonly JieliLtvEntry[],
  opCodeSn: number,
): Uint8Array {
  const ltvs = entries.map((entry) => packJieliLtv(entry.type, entry.value));
  return packJieliCommand(JIELI_OPCODE.ADV_SETTINGS, opCodeSn, concatLtvChunks(ltvs));
}

/** Encodes ANC mode change via `SetADVInfo` (`0xC0`, `ADV_TYPE_ANC_MODE_LIST = 0x0A`). */
export function encodeJieliAncMode(mode: number, opCodeSn: number): Uint8Array {
  return encodeJieliAdvSingleByte(JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST, mode, opCodeSn);
}

/** Encodes TWS key mappings via `SetADVInfo` (`0xC0`, `ADV_TYPE_KEY_SETTINGS = 0x02`). */
export function encodeJieliKeySettings(
  keys: readonly JieliKeySetting[],
  opCodeSn: number,
): Uint8Array {
  const value = new Uint8Array(keys.length * 3);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    value[i * 3] = key.keyNum & 0xff;
    value[i * 3 + 1] = key.action & 0xff;
    value[i * 3 + 2] = key.fn & 0xff;
  }
  return encodeJieliSetAdvInfo(
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_KEY_SETTINGS, value }],
    opCodeSn,
  );
}

/** Encodes work mode via `SetADVInfo` (`0xC0`, `ADV_TYPE_WORK_MODE = 0x05`). */
export function encodeJieliWorkMode(mode: number, opCodeSn: number): Uint8Array {
  return encodeJieliAdvSingleByte(JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE, mode, opCodeSn);
}

/** Encodes in-ear wear detection via `SetADVInfo` (`0xC0`, `ADV_TYPE_IN_EAR_CHECK = 0x08`). */
export function encodeJieliInEarDetect(enabled: boolean, opCodeSn: number): Uint8Array {
  return encodeJieliAdvSingleByte(
    JIELI_ATTR_AND_FUN.ADV_TYPE_IN_EAR_CHECK,
    enabled ? 0x01 : 0x00,
    opCodeSn,
  );
}

/** Encodes LED indicator settings via `SetADVInfo` (`0xC0`, `ADV_TYPE_LED_SETTINGS = 0x03`). */
export function encodeJieliLedSettings(
  leds: readonly JieliLedSetting[],
  opCodeSn: number,
): Uint8Array {
  const value = new Uint8Array(leds.length * 2);
  for (let i = 0; i < leds.length; i++) {
    const led = leds[i]!;
    value[i * 2] = led.scene & 0xff;
    value[i * 2 + 1] = led.effect & 0xff;
  }
  return encodeJieliSetAdvInfo(
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_LED_SETTINGS, value }],
    opCodeSn,
  );
}

/** Encodes Bluetooth device name via `SetADVInfo` (`0xC0`, `ADV_TYPE_DEVICE_NAME = 0x01`). */
export function encodeJieliDeviceName(name: string, opCodeSn: number): Uint8Array {
  return encodeJieliSetAdvInfo(
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_DEVICE_NAME, value: encodeUtf8(name) }],
    opCodeSn,
  );
}

/**
 * Encodes prompt language via `SetADVInfo` (`0xC0`, `ADV_TYPE_LANGUAGE = 0x09`).
 * Accepts either a language string (encoded as UTF-8, matching `ParseHelper.parseADVInfo`) or a 1-byte code.
 */
export function encodeJieliLanguage(language: string | number, opCodeSn: number): Uint8Array {
  const value =
    typeof language === 'string'
      ? encodeUtf8(language)
      : new Uint8Array([language & 0xff]);
  return encodeJieliSetAdvInfo(
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_LANGUAGE, value }],
    opCodeSn,
  );
}

/**
 * Encodes `GetADVInfo` (`0xC1`) with a 4-byte big-endian bitmask (defaults to `0xFFFFFFFF`).
 */
export function encodeJieliGetAdvInfo(opCodeSn: number, mask = 0xffffffff): Uint8Array {
  const paramData = new Uint8Array([
    (mask >>> 24) & 0xff,
    (mask >>> 16) & 0xff,
    (mask >>> 8) & 0xff,
    mask & 0xff,
  ]);
  return packJieliCommand(JIELI_OPCODE.ADV_GET_INFO, opCodeSn, paramData);
}

/**
 * Encodes `GetSysInfo` (`0x07`) with `[fnType, mask(BE uint32)]`.
 */
export function encodeJieliGetSysInfo(
  opCodeSn: number,
  mask: number,
  fnType: number = JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_PUBLIC,
): Uint8Array {
  const paramData = new Uint8Array([
    fnType & 0xff,
    (mask >>> 24) & 0xff,
    (mask >>> 16) & 0xff,
    (mask >>> 8) & 0xff,
    mask & 0xff,
  ]);
  return packJieliCommand(JIELI_OPCODE.GET_SYS_INFO, opCodeSn, paramData);
}

/**
 * Decodes Ultima Link `CustomCmd` (`0xFF`) payload data:
 * - `[0x10]` -> EQ preset query
 * - `[0x10, 0x00]` -> Signature Sound
 * - `[0x10, 0x01]` -> Balance Sound
 */
export function parseJieliCustomData(data: Uint8Array): JieliCustomDataResult | null {
  if (data.length < 1 || data[0] !== JIELI_ULTIMA_EQ_TAG) {
    return null;
  }

  const raw = new Uint8Array(data);
  if (data.length === 1) {
    return {
      kind: 'eq_query',
      tag: JIELI_ULTIMA_EQ_TAG,
      raw,
    };
  }

  const eqValue = data[1]!;
  let preset: JieliUltimaEqPresetName | 'unknown' = 'unknown';
  if (eqValue === JIELI_ULTIMA_EQ_VALUE.SIGNATURE_SOUND) {
    preset = 'signature';
  } else if (eqValue === JIELI_ULTIMA_EQ_VALUE.BALANCE_SOUND) {
    preset = 'balance';
  }

  return {
    kind: 'eq_preset',
    tag: JIELI_ULTIMA_EQ_TAG,
    preset,
    eqValue,
    raw,
  };
}
