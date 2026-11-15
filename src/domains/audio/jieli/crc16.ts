/**
 * Jieli RCSP CRC-16/CCITT-style checksum matching `EqModelImpl.crc16`.
 */

/**
 * Computes Jieli's big-endian 2-byte CRC-16/CCITT-style checksum matching `EqModelImpl.crc16`.
 */
export function crc16Jieli(data: Uint8Array, length = data.length): Uint8Array {
  const count = Math.max(0, Math.min(data.length, length));
  let crc = 0xffff;

  for (let i = 0; i < count; i++) {
    crc = (((crc >> 8) | (crc << 8)) & 0xffff) ^ (data[i]! & 0xff);
    crc ^= (crc & 0xff) >> 4;
    crc ^= (crc << 12) & 0xffff;
    crc ^= ((crc & 0xff) << 5) & 0xffff;
  }

  return new Uint8Array([(crc >> 8) & 0xff, crc & 0xff]);
}
