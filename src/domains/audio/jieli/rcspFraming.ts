/**
 * Jieli RCSP `FE DC BA ... EF` packet framing, parsing, and LTV helpers.
 */

import type { JieliOpcode } from '../catalog/index.ts';

/** Standard Jieli RCSP packet framing bytes (`ParseHelper.packSendBasePacket`). */
export const JIELI_PACKET_PREAMBLE = [0xfe, 0xdc, 0xba] as const;
export const JIELI_PACKET_END = 0xef;

/** Flag bits in RCSP packet header byte 3. */
export const JIELI_FLAG_IS_COMMAND = 0x80;
export const JIELI_FLAG_WANTS_RESPONSE = 0x40;

export interface JieliPackPacketOptions {
  isCommand: boolean;
  wantsResponse: boolean;
  opCode: JieliOpcode | number;
  opCodeSn: number;
  /** Response status code (used when `isCommand === false`; defaults to `0`). */
  status?: number;
  /** Extended module opcode (included only when `opCode === 0x01`). */
  xmOpCode?: number;
  paramData?: Uint8Array;
}

export interface JieliRcspPacket {
  isCommand: boolean;
  wantsResponse: boolean;
  flags: number;
  opCode: number;
  opCodeSn: number;
  /** Present on response packets (`!isCommand`). */
  status?: number;
  /** Present when `opCode === 0x01`. */
  xmOpCode?: number;
  paramData: Uint8Array;
}

export interface JieliLtvEntry {
  type: number;
  value: Uint8Array;
}

/**
 * Packs a Jieli RCSP packet matching `com.jieli.bluetooth.tool.ParseHelper.packSendBasePacket`:
 * `[0xFE, 0xDC, 0xBA, flags, opCode, lenHi, lenLo, ...body, 0xEF]`
 */
export function packJieliRcspPacket(opts: JieliPackPacketOptions): Uint8Array {
  const opCode = opts.opCode & 0xff;
  const hasXm = opCode === 0x01;
  const paramData = opts.paramData ?? new Uint8Array(0);
  const flags =
    (opts.isCommand ? JIELI_FLAG_IS_COMMAND : 0) |
    (opts.wantsResponse ? JIELI_FLAG_WANTS_RESPONSE : 0);

  const headerFields: number[] = opts.isCommand
    ? [opts.opCodeSn & 0xff]
    : [(opts.status ?? 0) & 0xff, opts.opCodeSn & 0xff];
  if (hasXm) {
    headerFields.push((opts.xmOpCode ?? 0) & 0xff);
  }

  const bodyLen = headerFields.length + paramData.length;
  const packet = new Uint8Array(7 + bodyLen + 1);
  packet[0] = JIELI_PACKET_PREAMBLE[0];
  packet[1] = JIELI_PACKET_PREAMBLE[1];
  packet[2] = JIELI_PACKET_PREAMBLE[2];
  packet[3] = flags;
  packet[4] = opCode;
  packet[5] = (bodyLen >> 8) & 0xff;
  packet[6] = bodyLen & 0xff;

  let offset = 7;
  for (const byte of headerFields) {
    packet[offset++] = byte;
  }
  packet.set(paramData, offset);
  packet[7 + bodyLen] = JIELI_PACKET_END;
  return packet;
}

/**
 * Parses a complete Jieli RCSP packet matching `com.jieli.bluetooth.tool.handler.RcspPacketParse`.
 * Locates the `[0xFE, 0xDC, 0xBA]` preamble, verifies `0xEF` end byte and body length,
 * and returns `null` if incomplete or malformed.
 */
export function parseJieliRcspPacket(raw: Uint8Array): JieliRcspPacket | null {
  if (raw.length < 8) {
    return null;
  }

  for (let start = 0; start <= raw.length - 8; start++) {
    if (
      raw[start] !== JIELI_PACKET_PREAMBLE[0] ||
      raw[start + 1] !== JIELI_PACKET_PREAMBLE[1] ||
      raw[start + 2] !== JIELI_PACKET_PREAMBLE[2]
    ) {
      continue;
    }

    const flags = raw[start + 3]!;
    const isCommand = (flags & JIELI_FLAG_IS_COMMAND) !== 0;
    const wantsResponse = (flags & JIELI_FLAG_WANTS_RESPONSE) !== 0;
    const opCode = raw[start + 4]!;
    const bodyLen = ((raw[start + 5]! << 8) | raw[start + 6]!) & 0xffff;
    const bodyStart = start + 7;
    const endIndex = bodyStart + bodyLen;

    if (endIndex >= raw.length || raw[endIndex] !== JIELI_PACKET_END) {
      continue;
    }

    const hasXm = opCode === 0x01;
    const minHeaderLen = (isCommand ? 1 : 2) + (hasXm ? 1 : 0);
    if (bodyLen < minHeaderLen) {
      continue;
    }

    let cursor = bodyStart;
    let status: number | undefined;
    if (!isCommand) {
      status = raw[cursor++]!;
    }
    const opCodeSn = raw[cursor++]!;
    let xmOpCode: number | undefined;
    if (hasXm) {
      xmOpCode = raw[cursor++]!;
    }

    const paramData = new Uint8Array(raw.subarray(cursor, endIndex));
    return {
      isCommand,
      wantsResponse,
      flags,
      opCode,
      opCodeSn,
      status,
      xmOpCode,
      paramData,
    };
  }

  return null;
}

/**
 * Encodes a single Jieli LTV/Attr entry (`[value.length + 1, type, ...value]`).
 */
export function packJieliLtv(type: number, value: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + value.length);
  out[0] = (value.length + 1) & 0xff;
  out[1] = type & 0xff;
  out.set(value, 2);
  return out;
}

/**
 * Parses concatenated Jieli LTV entries (`[length, type, ...value]` where `length = value.length + 1`).
 */
export function parseJieliLtvEntries(data: Uint8Array): JieliLtvEntry[] {
  const entries: JieliLtvEntry[] = [];
  let offset = 0;

  while (offset + 2 <= data.length) {
    const len = data[offset]!;
    if (len < 1 || offset + 1 + len > data.length) {
      break;
    }
    const type = data[offset + 1]!;
    const valueLen = len - 1;
    const value = new Uint8Array(data.subarray(offset + 2, offset + 2 + valueLen));
    entries.push({ type, value });
    offset += 1 + len;
  }

  return entries;
}

/** Internal command-packing convenience wrapper for Jieli command encoders. */
export function packJieliCommand(
  opCode: JieliOpcode | number,
  opCodeSn: number,
  paramData: Uint8Array,
  wantsResponse = true,
): Uint8Array {
  return packJieliRcspPacket({
    isCommand: true,
    wantsResponse,
    opCode,
    opCodeSn,
    paramData,
  });
}
