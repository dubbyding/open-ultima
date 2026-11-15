/**
 * Bluetrum ABMate 5-byte frame encoder and multi-fragment reassembler.
 */

import { BLUETRUM_CMD_TYPE } from '../catalog/index.ts';
import type { BluetrumCmd, BluetrumCmdType } from '../catalog/index.ts';

/**
 * Default maximum fragment payload size (bytes) in Bluetrum FOTA/BLE frames.
 * Matches `RequestHandler` default `maxPayloadSize = 15` (20-byte ATT MTU - 5-byte header).
 */
export const BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE = 15;

export interface BluetrumCommandPayload {
  readonly cmd: BluetrumCmd | number;
  readonly payload: Uint8Array;
}

export interface BluetrumEncodeFrameOptions {
  /** 4-bit rolling sequence number (incremented mod 16 per fragment). */
  seq: number;
  cmd: number;
  /** Defaults to `BLUETRUM_CMD_TYPE.REQUEST` (`1`). */
  cmdType?: BluetrumCmdType | number;
  payload?: Uint8Array;
  /** Maximum payload bytes per fragment (defaults to `15`, valid range `1..255`). */
  maxPayloadSize?: number;
}

export interface BluetrumDecodedFrame {
  seq: number;
  encrypted: boolean;
  cmd: number;
  cmdType: number;
  fragTotal: number;
  payload: Uint8Array;
}

/**
 * Encodes a Bluetrum command payload into one or more fragmented GATT frames
 * matching `com.bluetrum.devicemanager.cmd.RequestHandler`.
 *
 * Frame layout: `[seq & 0x0F, cmd, cmdType, ((fragTotal - 1) << 4) | fragIdx, fragLen, ...fragPayload]`
 */
export function encodeBluetrumFrame(options: BluetrumEncodeFrameOptions): Uint8Array[] {
  const maxPayloadSize = options.maxPayloadSize ?? BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE;
  if (!Number.isInteger(maxPayloadSize) || maxPayloadSize < 1 || maxPayloadSize > 255) {
    throw new RangeError(`maxPayloadSize must be an integer in 1..255, got ${maxPayloadSize}`);
  }

  const cmdType = (options.cmdType ?? BLUETRUM_CMD_TYPE.REQUEST) & 0xff;
  const cmd = options.cmd & 0xff;
  const payload = options.payload ?? new Uint8Array(0);
  const fragTotal = Math.max(1, Math.ceil(payload.length / maxPayloadSize));

  if (fragTotal > 16) {
    throw new RangeError(
      `Payload (${payload.length} B) requires ${fragTotal} fragments, exceeding Bluetrum 4-bit limit of 16`,
    );
  }

  const frames: Uint8Array[] = [];
  for (let fragIdx = 0; fragIdx < fragTotal; fragIdx++) {
    const start = fragIdx * maxPayloadSize;
    const end = Math.min(start + maxPayloadSize, payload.length);
    const chunk = payload.subarray(start, end);

    const frame = new Uint8Array(5 + chunk.length);
    frame[0] = (options.seq + fragIdx) & 0x0f;
    frame[1] = cmd;
    frame[2] = cmdType;
    frame[3] = (((fragTotal - 1) & 0x0f) << 4) | (fragIdx & 0x0f);
    frame[4] = chunk.length & 0xff;
    frame.set(chunk, 5);
    frames.push(frame);
  }
  return frames;
}

/**
 * Convenience helper to frame a command produced by an `encodeBluetrum*` function.
 */
export function encodeBluetrumCommand(
  command: BluetrumCommandPayload,
  seq: number,
  options?: { cmdType?: BluetrumCmdType | number; maxPayloadSize?: number },
): Uint8Array[] {
  return encodeBluetrumFrame({
    seq,
    cmd: command.cmd,
    cmdType: options?.cmdType,
    payload: command.payload,
    maxPayloadSize: options?.maxPayloadSize,
  });
}

/**
 * Stateful single- and multi-fragment reassembler matching Bluetrum `ResponseHandler`.
 */
export class BluetrumFrameReassembler {
  private pendingCmd = -1;
  private pendingCmdType = -1;
  private pendingFragTotal = 0;
  private expectedFragIdx = 0;
  private chunks: Uint8Array[] = [];

  /** Clears any incomplete multi-fragment packet buffered by this reassembler. */
  reset(): void {
    this.pendingCmd = -1;
    this.pendingCmdType = -1;
    this.pendingFragTotal = 0;
    this.expectedFragIdx = 0;
    this.chunks = [];
  }

  /**
   * Pushes one incoming BLE notification packet.
   * Returns the complete decoded frame when all fragments have arrived, or `null` otherwise.
   */
  push(packet: Uint8Array): BluetrumDecodedFrame | null {
    if (packet.length < 5) {
      return null;
    }

    const b0 = packet[0]!;
    const cmd = packet[1]!;
    const cmdType = packet[2]!;
    const fragByte = packet[3]!;
    const fragLen = packet[4]!;

    const seq = b0 & 0x0f;
    const encrypted = (b0 & 0x80) !== 0;
    const fragTotal = ((fragByte >> 4) & 0x0f) + 1;
    const fragIdx = fragByte & 0x0f;

    if (fragIdx >= fragTotal || packet.length < 5 + fragLen) {
      this.reset();
      return null;
    }

    const chunk = new Uint8Array(packet.subarray(5, 5 + fragLen));

    if (fragTotal === 1) {
      this.reset();
      return {
        seq,
        encrypted,
        cmd,
        cmdType,
        fragTotal: 1,
        payload: chunk,
      };
    }

    if (fragIdx === 0) {
      this.pendingCmd = cmd;
      this.pendingCmdType = cmdType;
      this.pendingFragTotal = fragTotal;
      this.expectedFragIdx = 1;
      this.chunks = [chunk];
      return null;
    }

    if (
      this.chunks.length === 0 ||
      cmd !== this.pendingCmd ||
      cmdType !== this.pendingCmdType ||
      fragTotal !== this.pendingFragTotal ||
      fragIdx !== this.expectedFragIdx
    ) {
      this.reset();
      return null;
    }

    this.chunks.push(chunk);
    this.expectedFragIdx++;

    if (fragIdx < fragTotal - 1) {
      return null;
    }

    let totalLen = 0;
    for (const part of this.chunks) {
      totalLen += part.length;
    }
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of this.chunks) {
      merged.set(part, offset);
      offset += part.length;
    }

    this.reset();
    return {
      seq,
      encrypted,
      cmd,
      cmdType,
      fragTotal,
      payload: merged,
    };
  }
}
