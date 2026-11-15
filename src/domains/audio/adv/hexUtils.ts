/**
 * Pure-JS hex, MAC, signed-int8, little-endian, and UTF-8 byte utilities
 * shared across Ultima Link audio protocol codecs (zero Node/native dependencies).
 */

/**
 * Convert a byte buffer into a hex string (optionally separated by a delimiter).
 */
export function bytesToHex(bytes: Uint8Array, separator = ''): string {
  const parts: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    parts[i] = bytes[i]!.toString(16).padStart(2, '0');
  }
  return parts.join(separator);
}

/**
 * Parse a hex string (with optional spaces, colons, hyphens, or `0x` prefix) into bytes.
 */
export function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.trim().replace(/^0x/i, '').replace(/[\s:-]/g, '');
  if (stripped.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(stripped)) {
    throw new RangeError(`Invalid hex string: "${hex}"`);
  }
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Format a 6-byte MAC buffer as uppercase colon-delimited hex (`AA:BB:CC:DD:EE:FF`). */
export function formatMacUpper(macBytes: Uint8Array): string {
  const parts: string[] = new Array(macBytes.length);
  for (let i = 0; i < macBytes.length; i += 1) {
    parts[i] = macBytes[i]!.toString(16).toUpperCase().padStart(2, '0');
  }
  return parts.join(':');
}

/** Decode a fixed-length ASCII slice from `bytes[start..start + length)`. */
export function decodeAsciiSlice(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[start + i]!);
  }
  return out;
}

/** Clamp an integer to `[-128, 127]` and return its unsigned two's-complement byte. */
export function toSignedInt8Byte(value: number): number {
  const clamped = Math.max(-128, Math.min(127, Math.trunc(value)));
  return clamped & 0xff;
}

/** Sign-extend a single byte into `[-128, 127]`. */
export function fromSignedInt8Byte(byte: number): number {
  return ((byte & 0xff) << 24) >> 24;
}

/** Read an unsigned 16-bit little-endian integer if at least 2 bytes exist. */
export function readLittleEndianUint16(bytes: Uint8Array): number | undefined {
  if (bytes.length < 2) {
    return undefined;
  }
  return ((bytes[1]! << 8) | bytes[0]!) & 0xffff;
}

/** Read an unsigned 32-bit little-endian integer if at least 4 bytes exist. */
export function readLittleEndianUint32(bytes: Uint8Array): number | undefined {
  if (bytes.length < 4) {
    return undefined;
  }
  return (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
}

/** Encode a JavaScript string into UTF-8 bytes without relying on `TextEncoder`. */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(++i);
      const cp = 0x10000 + (((code - 0xd800) << 10) | (next - 0xdc00));
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/** Decode UTF-8 bytes into a string without relying on `TextDecoder`. */
export function decodeUtf8(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      const b1 = bytes[i++]!;
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++]!;
      const b2 = bytes[i++]!;
      result += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++]!;
      const b2 = bytes[i++]!;
      const b3 = bytes[i++]!;
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      const offset = cp - 0x10000;
      result += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      result += '\ufffd';
    }
  }
  return result;
}
