/**
 * Ultima Link 27-byte BLE manufacturer advertisement parser and encoder.
 */

import { ALL_ADV_COMPANY_IDS, getProductById } from '../catalog/index.ts';
import type { ProductSpec } from '../catalog/index.ts';
import { decodeAsciiSlice, formatMacUpper, hexToBytes } from './hexUtils.ts';

const ADV_MIN_LENGTH = 27;
const ADV_MAC_OFFSET = 5;
const ADV_MAC_LENGTH = 6;
const ADV_MAC_XOR_KEY = 0xad;
const ADV_LICENSE_OFFSET = 11;
const ADV_LICENSE_LENGTH = 16;
const LICENSE_PATTERN = /^[a-z0-9]{16}$/;

export interface UltimaAdvInfo {
  readonly companyId?: number;
  readonly bid: number;
  readonly pid: number;
  readonly edrConnectState: number;
  readonly edrConnected: boolean;
  readonly edrMac: string;
  readonly license: string;
  readonly product: ProductSpec | undefined;
  readonly offlineVerified: true;
}

export interface UltimaAdvEncodeInput {
  readonly bid: number;
  readonly pid: number;
  readonly edrConnected: boolean;
  readonly edrMac: string;
  readonly license: string;
}

/**
 * Parse a 27-byte Ultima Link BLE manufacturer advertisement payload offline.
 *
 * Bypasses remote YSAppSDK license verification (`offlineVerified: true`) once
 * the structural frame, MAC XOR mask (`0xAD`), and `/^[a-z0-9]{16}$/` license pass.
 */
export function parseUltimaLinkAdv(
  data: Uint8Array,
  companyId?: number,
): UltimaAdvInfo | null {
  if (data.length < ADV_MIN_LENGTH) {
    return null;
  }
  if (
    companyId !== undefined &&
    !(ALL_ADV_COMPANY_IDS as readonly number[]).includes(companyId)
  ) {
    return null;
  }

  const bid = (data[0]! << 8) | data[1]!;
  const pid = (data[2]! << 8) | data[3]!;
  const edrConnectState = data[4]!;

  const macBytes = new Uint8Array(ADV_MAC_LENGTH);
  for (let i = 0; i < ADV_MAC_LENGTH; i += 1) {
    macBytes[i] = data[ADV_MAC_OFFSET + i]! ^ ADV_MAC_XOR_KEY;
  }
  const edrMac = formatMacUpper(macBytes);

  const license = decodeAsciiSlice(data, ADV_LICENSE_OFFSET, ADV_LICENSE_LENGTH);
  if (!LICENSE_PATTERN.test(license)) {
    return null;
  }

  return {
    ...(companyId !== undefined ? { companyId } : {}),
    bid,
    pid,
    edrConnectState,
    edrConnected: edrConnectState !== 0,
    edrMac,
    license,
    product: getProductById(pid),
    offlineVerified: true,
  };
}

/**
 * Encode an Ultima Link 27-byte BLE manufacturer advertisement payload for simulator or round-trip tests.
 */
export function encodeUltimaLinkAdv(info: UltimaAdvEncodeInput): Uint8Array {
  if (!LICENSE_PATTERN.test(info.license)) {
    throw new RangeError(`Invalid Ultima Link license: "${info.license}"`);
  }
  const macBytes = hexToBytes(info.edrMac);
  if (macBytes.length !== ADV_MAC_LENGTH) {
    throw new RangeError(`Invalid EDR MAC address: "${info.edrMac}"`);
  }

  const out = new Uint8Array(ADV_MIN_LENGTH);
  out[0] = (info.bid >> 8) & 0xff;
  out[1] = info.bid & 0xff;
  out[2] = (info.pid >> 8) & 0xff;
  out[3] = info.pid & 0xff;
  out[4] = info.edrConnected ? 1 : 0;

  for (let i = 0; i < ADV_MAC_LENGTH; i += 1) {
    out[ADV_MAC_OFFSET + i] = macBytes[i]! ^ ADV_MAC_XOR_KEY;
  }
  for (let i = 0; i < ADV_LICENSE_LENGTH; i += 1) {
    out[ADV_LICENSE_OFFSET + i] = info.license.charCodeAt(i) & 0xff;
  }
  return out;
}
