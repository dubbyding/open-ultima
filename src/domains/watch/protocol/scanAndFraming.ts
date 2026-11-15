/**
 * ULTIMA Fit — CRREPA Scan Record, Framing, and Byte/Endian Helpers
 *
 * Implements BLE advertisement scan-record parsing/encoding (`CRPScanRecordParser`),
 * `0xFE 0xEA` command frame building/parsing (`l98` + `z48`), and shared binary/UTF-8
 * primitives used by all CRREPA protocol modules.
 */

import type {
  CrpDecodedFrame,
  CrpScanInfo,
  CrpScanRecordInput,
} from './constants.ts';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

const DEFAULT_FRAME_HEADER_0 = 0xfe;
const DEFAULT_FRAME_HEADER_1 = 0xea;

// ---------------------------------------------------------------------------
// Byte, Endian, and UTF-8 Helpers
// ---------------------------------------------------------------------------

/** Creates a DataView backed by `bytes` respecting its byteOffset and byteLength. */
export function makeDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Reads an unsigned 16-bit little-endian integer at `offset`. */
export function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

/** Reads an unsigned 16-bit big-endian integer at `offset`. */
export function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

/** Reads an unsigned 32-bit little-endian integer at `offset`. */
export function readU32LE(bytes: Uint8Array, offset: number): number {
  return makeDataView(bytes).getUint32(offset, true);
}

/** Matches `ByteUtils.smallBytes2Int`: returns `0` if every byte is `0xff`. */
export function readCrpSmallIntLE(
  bytes: Uint8Array,
  offset: number,
  length: number
): number {
  let allFf = true;
  let value = 0;
  for (let i = 0; i < length; i++) {
    const b = bytes[offset + i]!;
    if (b !== 0xff) {
      allFf = false;
    }
    value += b * 2 ** (8 * i);
  }
  return allFf ? 0 : value;
}

/** Concatenates multiple byte slices into a single contiguous `Uint8Array`. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encodes a JS string as UTF-8 bytes. */
export function encodeUtf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/** Decodes UTF-8 bytes into a JS string. */
export function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/**
 * Truncates `text` cleanly on Unicode codepoint boundaries so the encoded UTF-8
 * byte length fits inside `maxBytes` (without splitting multi-byte sequences).
 */
export function truncateUtf8ToBytes(text: string, maxBytes: number): Uint8Array {
  if (maxBytes <= 0) {
    return new Uint8Array(0);
  }
  const full = textEncoder.encode(text);
  if (full.length <= maxBytes) {
    return full;
  }
  let usedBytes = 0;
  let result = '';
  for (const ch of text) {
    const byteLen = textEncoder.encode(ch).length;
    if (usedBytes + byteLen > maxBytes) {
      break;
    }
    result += ch;
    usedBytes += byteLen;
  }
  return textEncoder.encode(result);
}

// ---------------------------------------------------------------------------
// Scan Record Parser & Encoder (CRPScanRecordParser)
// ---------------------------------------------------------------------------

/**
 * Parses a raw BLE advertisement scan record for CRREPA `0xFEEA` watches.
 * Extracts AD type `0x09` (or fallback `0x08`) local name and AD type `0x16`
 * service data prefixed by `0xEA 0xFE` (`firmwareType`, `platform`, `chipId`,
 * `functionMask`).
 */
export function parseCrpScanRecord(scanRecord: Uint8Array): CrpScanInfo | null {
  if (scanRecord.length === 0) {
    return null;
  }

  let completeName: string | null = null;
  let shortName: string | null = null;
  let serviceData: Uint8Array | null = null;

  let offset = 0;
  while (offset < scanRecord.length) {
    const adLen = scanRecord[offset]!;
    if (adLen === 0) {
      break;
    }
    const end = offset + 1 + adLen;
    if (end > scanRecord.length) {
      break;
    }
    const adType = scanRecord[offset + 1]!;
    const data = scanRecord.subarray(offset + 2, end);

    if (adType === 0x09 && data.length > 0) {
      completeName = textDecoder.decode(data);
    } else if (adType === 0x08 && data.length > 0 && shortName === null) {
      shortName = textDecoder.decode(data);
    } else if (
      adType === 0x16 &&
      data.length >= 8 &&
      data[0] === 0xea &&
      data[1] === 0xfe
    ) {
      serviceData = data;
    }

    offset = end;
  }

  if (serviceData === null) {
    return null;
  }

  const firmwareType = textDecoder
    .decode(serviceData.subarray(2, 5))
    .replace(/\0+$/g, '');
  const platform = serviceData[5]!;
  const chipId = serviceData[6]!;
  const functionMask =
    serviceData.length >= 9
      ? readU16LE(serviceData, 7)
      : serviceData[7]!;

  return {
    name: completeName ?? shortName ?? '',
    firmwareType,
    platform,
    chipId,
    functionMask,
    rawServiceData: new Uint8Array(serviceData),
  };
}

/**
 * Encodes a synthetic CRREPA BLE scan record containing AD `0x09` local name
 * and AD `0x16` `0xEA 0xFE` service data for simulator / round-trip tests.
 */
export function encodeCrpScanRecord(info: CrpScanRecordInput): Uint8Array {
  const nameBytes = textEncoder.encode(info.name);
  const nameAd = new Uint8Array(2 + nameBytes.length);
  nameAd[0] = 1 + nameBytes.length;
  nameAd[1] = 0x09;
  nameAd.set(nameBytes, 2);

  const fwRaw = textEncoder.encode(info.firmwareType);
  const fw3 = new Uint8Array(3);
  fw3.set(fwRaw.subarray(0, 3));

  // Service data AD: [len(10), 0x16, 0xEA, 0xFE, fw[3], platform, chipId, maskLo, maskHi]
  const serviceAd = new Uint8Array(11);
  serviceAd[0] = 10;
  serviceAd[1] = 0x16;
  serviceAd[2] = 0xea;
  serviceAd[3] = 0xfe;
  serviceAd.set(fw3, 4);
  serviceAd[7] = info.platform & 0xff;
  serviceAd[8] = info.chipId & 0xff;
  serviceAd[9] = info.functionMask & 0xff;
  serviceAd[10] = (info.functionMask >>> 8) & 0xff;

  return concatBytes([nameAd, serviceAd]);
}

// ---------------------------------------------------------------------------
// Frame Builder & Parser (l98 + z48)
// ---------------------------------------------------------------------------

/**
 * Builds a CRREPA command frame (`[0xFE, 0xEA, protoByte, lenLo, cmd, ...payload]`).
 * Matches `l98.a(int cmd, byte[] payload)` using MTU 20 legacy proto `0x10` or
 * standard proto `0x20 + ((totalLen >> 8) & 0x0F)`.
 */
export function buildCrpFrame(
  cmd: number,
  payload?: Uint8Array,
  mtu?: number
): Uint8Array {
  const payloadLen = payload ? payload.length : 0;
  const totalLen = payloadLen + 5;
  const protoByte =
    mtu === 20
      ? 0x10
      : totalLen > 0xff
        ? (0x20 + ((totalLen >>> 8) & 0x0f)) & 0xff
        : 0x20;

  const frame = new Uint8Array(totalLen);
  frame[0] = DEFAULT_FRAME_HEADER_0;
  frame[1] = DEFAULT_FRAME_HEADER_1;
  frame[2] = protoByte;
  frame[3] = totalLen & 0xff;
  frame[4] = cmd & 0xff;
  if (payload && payloadLen > 0) {
    frame.set(payload, 5);
  }
  return frame;
}

/**
 * Parses a CRREPA `0xFE 0xEA` protocol frame. Returns `null` if the header
 * magic bytes or minimum 5-byte length check fail.
 */
export function parseCrpFrame(raw: Uint8Array): CrpDecodedFrame | null {
  if (
    raw.length < 5 ||
    raw[0] !== DEFAULT_FRAME_HEADER_0 ||
    raw[1] !== DEFAULT_FRAME_HEADER_1
  ) {
    return null;
  }

  const protoByte = raw[2]!;
  const lenLo = raw[3]!;
  const cmd = raw[4]!;
  const highBits =
    protoByte >= 0x20 && protoByte <= 0x2f ? (protoByte - 0x20) << 8 : 0;
  let totalLength = highBits | lenLo;
  // In MTU=20 mode (`protoByte === 0x10`), frames >255 bytes only store low byte in raw[3].
  if (
    protoByte === 0x10 &&
    raw.length >= 256 &&
    (raw.length & 0xff) === lenLo
  ) {
    totalLength = raw.length;
  }
  const isComplete = totalLength >= 5 && raw.length >= totalLength;
  const payloadEnd = isComplete ? totalLength : raw.length;

  return {
    cmd,
    protoByte,
    totalLength,
    isComplete,
    payload: raw.slice(5, payloadEnd),
  };
}

/**
 * Accepts either a full `0xFE 0xEA` frame or a raw payload slice, optionally
 * asserting the command ID when a full frame is supplied.
 */
export function unwrapCrpPayload(
  rawOrPayload: Uint8Array,
  expectedCmd?: number
): Uint8Array | null {
  if (
    rawOrPayload.length >= 5 &&
    rawOrPayload[0] === DEFAULT_FRAME_HEADER_0 &&
    rawOrPayload[1] === DEFAULT_FRAME_HEADER_1
  ) {
    const frame = parseCrpFrame(rawOrPayload);
    if (!frame) {
      return null;
    }
    if (expectedCmd !== undefined && frame.cmd !== expectedCmd) {
      return null;
    }
    return frame.payload;
  }
  return rawOrPayload;
}
