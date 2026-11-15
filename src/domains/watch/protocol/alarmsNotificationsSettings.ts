/**
 * ULTIMA Fit — CRREPA Alarms, Notifications & Watch Settings Codecs
 *
 * Implements 8-slot legacy (`0x11`/`0x21`) and new-protocol (`0xB9` subcmd `0x05`/`0x15`)
 * alarms, `0x41` notification push + emoji filter + firmware message-type mapping,
 * and watch settings / configuration queries (`0x16..0x2F`, `0x61`, `0x71..0x8E`).
 */

import { CRP_ALARM_REPEAT, CRP_CMD, CRP_MESSAGE_TYPE } from './constants.ts';
import {
  buildCrpFrame,
  concatBytes,
  decodeUtf8,
  encodeUtf8,
  makeDataView,
  readU16BE,
  truncateUtf8ToBytes,
} from './scanAndFraming.ts';

const ALARM_YEAR_BASE = 2015; // 0x7df in zb8/g98
const MAX_TITLE_UTF8_BYTES = 64;
const DEFAULT_PUSH_MAX_UTF8_BYTES = 128;

export interface CrpAlarmInput {
  id: number;
  enabled: boolean;
  hour: number;
  minute: number;
  repeatMask?: number;
  year?: number;
  month?: number;
  day?: number;
  date?: Date;
}

export interface CrpDecodedAlarm {
  id: number;
  enabled: boolean;
  /** `0` = single, `1` = everyday, `2` = weekly bitmask. */
  type: number;
  hour: number;
  minute: number;
  repeatMask: number;
  year?: number;
  month?: number;
  day?: number;
  date?: Date;
}

// ---------------------------------------------------------------------------
// Alarms (0x11 / 0x21 / 0xB9 0x05 & 0x15)
// ---------------------------------------------------------------------------

/** Encodes the 8-byte alarm payload body matching `zb8.c(CRPAlarmInfo)`. */
function encodeCrpAlarmBody(alarm: CrpAlarmInput): Uint8Array {
  const repeatMask = (alarm.repeatMask ?? 0) & 0x7f;
  let type: number;
  let packedDate = 0;

  if (repeatMask === 0) {
    type = 0;
    const refDate = alarm.date ?? new Date();
    const year = alarm.year ?? refDate.getFullYear();
    const month = alarm.month ?? refDate.getMonth() + 1;
    const day = alarm.day ?? refDate.getDate();
    packedDate =
      (((year - ALARM_YEAR_BASE) & 0x0f) << 12) | ((month & 0x0f) << 8) | (day & 0xff);
  } else if (repeatMask === CRP_ALARM_REPEAT.EVERYDAY) {
    type = 1;
  } else {
    type = 2;
  }

  const out = new Uint8Array(8);
  out[0] = alarm.id & 0xff;
  out[1] = alarm.enabled ? 0x01 : 0x00;
  out[2] = type;
  out[3] = alarm.hour & 0xff;
  out[4] = alarm.minute & 0xff;
  out[5] = (packedDate >>> 8) & 0xff;
  out[6] = packedDate & 0xff;
  out[7] = repeatMask;
  return out;
}

/** Encodes `0x11` legacy alarm set command (`zb8.b`). */
export function encodeLegacyAlarm(alarm: CrpAlarmInput): Uint8Array {
  return buildCrpFrame(CRP_CMD.SET_ALARM, encodeCrpAlarmBody(alarm));
}

/** Encodes `0xB9 [0x05, 0x00, ...8B]` new alarm set command (`zb8.a`). */
export function encodeNewAlarm(alarm: CrpAlarmInput): Uint8Array {
  const body = encodeCrpAlarmBody(alarm);
  const payload = new Uint8Array(10);
  payload[0] = 0x05;
  payload[1] = 0x00;
  payload.set(body, 2);
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, payload);
}

/** Encodes `0xB9 [0x15, 0x04]` new-protocol query all alarms (`zb8.c()`). */
export function encodeQueryNewAlarms(): Uint8Array {
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, Uint8Array.of(0x15, 0x04));
}

/** Encodes `0x21` legacy query all alarms. */
export function encodeQueryLegacyAlarms(): Uint8Array {
  return buildCrpFrame(CRP_CMD.QUERY_ALARMS);
}

/** Encodes `0xB9 [0x05, 0x02, id]` delete single new alarm. */
export function encodeDeleteNewAlarm(alarmId: number): Uint8Array {
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, Uint8Array.of(0x05, 0x02, alarmId & 0xff));
}

/** Encodes `0xB9 [0x05, 0x03]` delete all new alarms (`zb8.b()`). */
export function encodeDeleteAllNewAlarms(): Uint8Array {
  return buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, Uint8Array.of(0x05, 0x03));
}

/**
 * Decodes legacy (`0x21`, 8 bytes per alarm from offset `0`) or new (`0xB9` subcmd
 * `0x15`, 3-byte header + 8 bytes per alarm from offset `3`) alarm lists (`g98`).
 */
export function decodeAlarms(
  payload: Uint8Array,
  options?: { isNewProtocol?: boolean }
): CrpDecodedAlarm[] | null {
  if (payload.length < 4) {
    return null;
  }

  const preserveId =
    options?.isNewProtocol ??
    (payload.length > 3 && (payload.length - 3) % 8 === 0 && payload[0] === 0x15);
  const startOffset = preserveId ? 3 : 0;

  if ((payload.length - startOffset) % 8 !== 0) {
    return null;
  }

  const alarms: CrpDecodedAlarm[] = [];
  for (let i = startOffset; i + 7 < payload.length; i += 8) {
    const rawId = payload[i]!;
    const id = preserveId ? rawId : rawId === 0 ? Math.floor(i / 8) : rawId;
    const enabled = payload[i + 1] === 0x01;
    const type = payload[i + 2]!;
    const hour = payload[i + 3]!;
    const minute = payload[i + 4]!;
    const packedDate = readU16BE(payload, i + 5);
    const rawRepeat = payload[i + 7]!;

    let repeatMask = 0;
    let year: number | undefined;
    let month: number | undefined;
    let day: number | undefined;
    let date: Date | undefined;

    if (type === 1) {
      repeatMask = CRP_ALARM_REPEAT.EVERYDAY;
    } else if (type === 0) {
      repeatMask = 0;
      if (packedDate !== 0) {
        year = ((packedDate >>> 12) & 0x0f) + ALARM_YEAR_BASE;
        month = (packedDate >>> 8) & 0x0f;
        day = packedDate & 0xff;
        date = new Date(year, month - 1, day);
      }
    } else {
      repeatMask = rawRepeat;
    }

    alarms.push({
      id,
      enabled,
      type,
      hour,
      minute,
      repeatMask,
      ...(year !== undefined ? { year, month, day, date } : {}),
    });
  }

  return alarms;
}

// ---------------------------------------------------------------------------
// Emoji Filter & Push Notifications (0x41)
// ---------------------------------------------------------------------------

function isBmpEmojiCodePoint(cp: number): boolean {
  if (
    cp === 0x00a9 ||
    cp === 0x00ae ||
    cp === 0x203c ||
    cp === 0x2049 ||
    cp === 0x2122 ||
    cp === 0x2139 ||
    cp === 0x24c2 ||
    cp === 0x2934 ||
    cp === 0x2935 ||
    cp === 0x3030 ||
    cp === 0x303d ||
    cp === 0x3297 ||
    cp === 0x3299
  ) {
    return true;
  }
  return (
    (cp >= 0x2194 && cp <= 0x21aa) ||
    (cp >= 0x231a && cp <= 0x23ff) ||
    (cp >= 0x25aa && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff)
  );
}

/**
 * Mirrors CRREPA `EmojiFilter.filterEmoji`: replaces `U+1F4F9` with
 * `"[Video Camera]"` and collapses emoji/ZWJ sequences into `"[emoji]"`.
 */
export function filterCrpEmoji(input: string): string {
  const chars = Array.from(input);
  let out = '';
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i]!;
    const cp = ch.codePointAt(0)!;

    if (cp === 0x1f4f9) {
      out += '[Video Camera]';
      i += 1;
      if (i < chars.length && chars[i]!.codePointAt(0) === 0xfe0f) {
        i += 1;
      }
      continue;
    }

    const nextCp = i + 1 < chars.length ? chars[i + 1]!.codePointAt(0)! : -1;
    const isKeycap =
      (cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39)) &&
      (nextCp === 0x20e3 ||
        (nextCp === 0xfe0f && i + 2 < chars.length && chars[i + 2]!.codePointAt(0) === 0x20e3));

    const isEmojiStart = cp >= 0x1f000 || isBmpEmojiCodePoint(cp) || isKeycap;

    if (!isEmojiStart) {
      if (cp !== 0xfe0e && cp !== 0xfe0f && cp !== 0x20e3) {
        out += ch;
      }
      i += 1;
      continue;
    }

    // Consume an entire emoji cluster (modifiers, selectors, keycap, ZWJ joins)
    out += '[emoji]';
    i += 1;
    while (i < chars.length) {
      const modCp = chars[i]!.codePointAt(0)!;
      if (
        modCp === 0xfe0e ||
        modCp === 0xfe0f ||
        modCp === 0x20e3 ||
        (modCp >= 0x1f3fb && modCp <= 0x1f3ff) ||
        (cp >= 0x1f1e6 && cp <= 0x1f1ff && modCp >= 0x1f1e6 && modCp <= 0x1f1ff)
      ) {
        i += 1;
        continue;
      }
      if (modCp === 0x200d && i + 1 < chars.length) {
        // Consume ZWJ and the joined emoji base
        i += 2;
        continue;
      }
      break;
    }
  }

  return out;
}

/** Translates `CRP_MESSAGE_TYPE` codes for firmware version compatibility (`k78.a`). */
export function mapCrpMessageType(messageType: number, firmwareVersionCode = 161): number {
  if (firmwareVersionCode < 0xa1) {
    if (messageType === CRP_MESSAGE_TYPE.FACEBOOK) return 0x02;
    if (messageType === CRP_MESSAGE_TYPE.TWITTER) return 0x03;
    return messageType & 0xff;
  }
  switch (messageType) {
    case CRP_MESSAGE_TYPE.WHATSAPP:
      return 0x08;
    case CRP_MESSAGE_TYPE.WECHAT_IN:
      return 0x02;
    case CRP_MESSAGE_TYPE.KAKAOTALK:
      return 0x0a;
    case CRP_MESSAGE_TYPE.FACEBOOK:
      return 0x04;
    case CRP_MESSAGE_TYPE.TWITTER:
      return 0x05;
    default:
      return messageType & 0xff;
  }
}

/** Formats title before `:` to at most 64 UTF-8 bytes and strips emojis (`r48.a`). */
function formatCrpNotificationText(rawText: string, maxUtf8Bytes: number): Uint8Array {
  const filtered = filterCrpEmoji(rawText);
  const colonIdx = filtered.indexOf(':');
  let prepared = filtered;
  if (colonIdx > 0) {
    const title = decodeUtf8(truncateUtf8ToBytes(filtered.slice(0, colonIdx), MAX_TITLE_UTF8_BYTES));
    prepared = title + filtered.slice(colonIdx);
  }

  const rawUtf8 = encodeUtf8(prepared);
  if (rawUtf8.length <= maxUtf8Bytes) {
    return rawUtf8;
  }

  const ellipsisBytes = encodeUtf8('\u2026'); // 3 bytes
  if (maxUtf8Bytes <= ellipsisBytes.length) {
    return truncateUtf8ToBytes(prepared, maxUtf8Bytes);
  }
  const truncated = truncateUtf8ToBytes(prepared, maxUtf8Bytes - ellipsisBytes.length);
  return concatBytes([truncated, ellipsisBytes]);
}

/**
 * Encodes `0x41` push notification (`r48.a`): filters emojis, caps title before `:`
 * to 64 UTF-8 bytes, remaps `messageType` via `k78.a`, and truncates UTF-8 safely.
 */
export function encodePushNotification(
  messageType: number,
  text: string,
  maxUtf8Bytes = DEFAULT_PUSH_MAX_UTF8_BYTES,
  firmwareVersionCode = 161
): Uint8Array {
  const mappedType = mapCrpMessageType(messageType, firmwareVersionCode) & 0xff;
  const textBytes = formatCrpNotificationText(text, Math.max(0, maxUtf8Bytes));
  const payload = new Uint8Array(1 + textBytes.length);
  payload[0] = mappedType;
  payload.set(textBytes, 1);
  return buildCrpFrame(CRP_CMD.PUSH_NOTIFICATION, payload);
}

/** Encodes `0x41 [0xFF]` clear-notifications command (`r48.a()`). */
export function encodeClearNotification(): Uint8Array {
  return buildCrpFrame(CRP_CMD.PUSH_NOTIFICATION, Uint8Array.of(0xff));
}

// ---------------------------------------------------------------------------
// Watch Settings & Configuration Queries
// ---------------------------------------------------------------------------

function buildBoolSettingFrame(cmd: number, enable: boolean): Uint8Array {
  return buildCrpFrame(cmd, Uint8Array.of(enable ? 0x01 : 0x00));
}

/** Encodes `0x16` daily goal steps (`gh8.a(int)`, uint32 big-endian). */
export function encodeGoalSteps(steps: number): Uint8Array {
  const payload = new Uint8Array(4);
  makeDataView(payload).setUint32(0, steps >>> 0, false);
  return buildCrpFrame(CRP_CMD.SET_GOAL_STEPS, payload);
}

/** Encodes `0x17` time format (`0` = 12h, `1` = 24h, matching `np8`). */
export function encodeTimeSystem(is24h: boolean): Uint8Array {
  return buildBoolSettingFrame(CRP_CMD.SET_TIME_SYSTEM, is24h);
}

/** Encodes `0x18` raise-to-wake / quick-view toggle (`wf8`). */
export function encodeQuickView(enable: boolean): Uint8Array {
  return buildBoolSettingFrame(CRP_CMD.SET_QUICK_VIEW, enable);
}

/** Encodes `0x19` watch face slot ID (`m38.sendDisplayWatchFace`). */
export function encodeWatchFace(faceId: number): Uint8Array {
  return buildCrpFrame(CRP_CMD.SET_WATCH_FACE, Uint8Array.of(faceId & 0xff));
}

/** Encodes `0x1A` unit system (`0` = metric, `1` = imperial, matching `eq8`). */
export function encodeMetricSystem(imperial: boolean): Uint8Array {
  return buildBoolSettingFrame(CRP_CMD.SET_METRIC_SYSTEM, imperial);
}

/** Encodes `0x1B` watch language code (`CRP_LANGUAGE`). */
export function encodeWatchLanguage(lang: number): Uint8Array {
  return buildCrpFrame(CRP_CMD.SET_LANGUAGE, Uint8Array.of(lang & 0xff));
}

/** Encodes `0x1C` "other message" notification toggle (`c98`). */
export function encodeOtherMessageReminder(enable: boolean): Uint8Array {
  return buildBoolSettingFrame(CRP_CMD.SET_OTHER_MESSAGE, enable);
}

/** Encodes `0x1D` sedentary reminder toggle (`hh8.a(boolean)`). */
export function encodeSedentaryReminder(enable: boolean): Uint8Array {
  return buildBoolSettingFrame(CRP_CMD.SET_SEDENTARY_REMINDER, enable);
}

/**
 * Encodes 4-byte time-period reminder/DND settings (`0x71` DND / `0x72` QuickView /
 * `0x73` Sedentary period) with `[startH, startM, endH, endM]`.
 */
export function encodePeriodReminder(
  cmd: number,
  startH: number,
  startM: number,
  endH: number,
  endM: number
): Uint8Array {
  return buildCrpFrame(
    cmd,
    Uint8Array.of(startH & 0xff, startM & 0xff, endH & 0xff, endM & 0xff)
  );
}

/** Encodes `0x61` find-watch vibration/ring alert (`m38.findDevice`). */
export function encodeFindWatch(): Uint8Array {
  return buildCrpFrame(CRP_CMD.FIND_WATCH);
}

/** Encodes the standard batch of watch configuration queries (`0x21..0x2F`, `0x81..0x8E`). */
export function encodeQueryAllSettings(): Uint8Array[] {
  return [
    buildCrpFrame(CRP_CMD.QUERY_SUPPORTED_FUNCTIONS),
    buildCrpFrame(CRP_CMD.QUERY_GOAL_STEPS),
    buildCrpFrame(CRP_CMD.QUERY_TIME_SYSTEM),
    buildCrpFrame(CRP_CMD.QUERY_QUICK_VIEW),
    buildCrpFrame(CRP_CMD.QUERY_WATCH_FACE),
    buildCrpFrame(CRP_CMD.QUERY_METRIC_SYSTEM),
    buildCrpFrame(CRP_CMD.QUERY_LANGUAGE),
    buildCrpFrame(CRP_CMD.QUERY_OTHER_MESSAGE),
    buildCrpFrame(CRP_CMD.QUERY_SEDENTARY_REMINDER),
    buildCrpFrame(CRP_CMD.QUERY_DEVICE_VERSION),
    buildCrpFrame(CRP_CMD.QUERY_TIMING_HEART_RATE_INTERVAL),
    buildCrpFrame(CRP_CMD.QUERY_ALARMS),
    buildCrpFrame(CRP_CMD.QUERY_DND_PERIOD),
    buildCrpFrame(CRP_CMD.QUERY_QUICK_VIEW_PERIOD),
    buildCrpFrame(CRP_CMD.QUERY_SEDENTARY_PERIOD),
    buildCrpFrame(CRP_CMD.QUERY_DRINK_WATER_PERIOD),
    buildCrpFrame(CRP_CMD.QUERY_DISPLAY_TIME),
    buildCrpFrame(CRP_CMD.QUERY_24H_VITALS_STATUS, Uint8Array.of(0x01)),
    buildCrpFrame(CRP_CMD.QUERY_24H_VITALS_STATUS, Uint8Array.of(0x02)),
  ];
}
