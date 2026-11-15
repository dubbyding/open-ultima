/**
 * Ultima Link SKU catalog (14 products) and BLE advertisement company IDs.
 */

import { DEVICE_CHIP, HEADSET_TYPE } from './types.ts';
import type { ProductSpec } from './types.ts';

/**
 * Complete catalog of the 14 Ultima Link SKUs (PID 0x0001..0x000F, 0x0007 unused).
 */
export const PRODUCT_CATALOG: readonly ProductSpec[] = [
  {
    id: 0x0001,
    code: 'TW_538',
    name: 'Ultima Prime1',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: true,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: true,
    supportsOta: true,
  },
  {
    id: 0x0002,
    code: 'BOOM_141',
    name: 'BOOM_141',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: true,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: true,
  },
  {
    id: 0x0003,
    code: 'BOOM_311',
    name: 'BOOM_311',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: true,
    supportsOta: true,
  },
  {
    id: 0x0004,
    code: 'BOOM_181',
    name: 'BOOM_181',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: true,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: true,
  },
  {
    id: 0x0005,
    code: 'BOOM_211',
    name: 'BOOM_211',
    chip: DEVICE_CHIP.BT,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: true,
    supportsOta: true,
  },
  {
    id: 0x0006,
    code: 'N1',
    name: 'BOOM_181',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: true,
  },
  {
    id: 0x0008,
    code: 'x2',
    name: 'BOOM_181',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: true,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: true,
  },
  {
    id: 0x0009,
    code: 'AK',
    name: 'BOOM_181',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: true,
  },
  {
    id: 0x000a,
    code: 'XH68',
    name: 'XH-68B ANC',
    chip: DEVICE_CHIP.BT,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: true,
    supportsGameMode: true,
    supportsCaseKeys: true,
    supportsDualConnect: true,
    supportsLdac: true,
    supportsSpatialAudio: true,
    supportsSignatureBalanceEq: false,
    supportsOta: false,
  },
  {
    id: 0x000b,
    code: 'X1',
    name: 'X1',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: true,
    supportsOta: true,
  },
  {
    id: 0x000c,
    code: 'HNC69MB',
    name: 'HNC69MB',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.HEAD_MOUNTED,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: false,
  },
  {
    id: 0x000d,
    code: 'YT06_PRO',
    name: 'YT06 Pro',
    chip: DEVICE_CHIP.BT,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: false,
  },
  {
    id: 0x000e,
    code: 'ABC',
    name: 'Mega 7',
    chip: DEVICE_CHIP.BT,
    headsetType: HEADSET_TYPE.TWS,
    supportsAnc: false,
    supportsGameMode: true,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: true,
    supportsOta: false,
  },
  {
    id: 0x000f,
    code: 'GL06',
    name: 'Melody',
    chip: DEVICE_CHIP.JL,
    headsetType: HEADSET_TYPE.SPEAKER,
    supportsAnc: false,
    supportsGameMode: false,
    supportsCaseKeys: false,
    supportsDualConnect: false,
    supportsLdac: false,
    supportsSpatialAudio: false,
    supportsSignatureBalanceEq: false,
    supportsOta: false,
  },
] as const;

const PRODUCT_BY_ID: ReadonlyMap<number, ProductSpec> = new Map(
  PRODUCT_CATALOG.map((product) => [product.id, product]),
);

/**
 * Look up a known Ultima Link SKU by its 16-bit Product ID.
 */
export function getProductById(pid: number): ProductSpec | undefined {
  return PRODUCT_BY_ID.get(pid);
}

/**
 * BLE manufacturer company IDs carrying the Ultima Link 27-byte beacon payload.
 */
export const ADV_COMPANY_IDS = [0xd222, 0xfe22] as const;

/**
 * Known Bluetrum vendor manufacturer company IDs seen in BLE advertisements.
 */
export const BLUETRUM_ADV_COMPANY_IDS = [0x0642, 0x0301, 0x4301] as const;

/**
 * Union of Ultima Link and Bluetrum BLE manufacturer company IDs.
 */
export const ALL_ADV_COMPANY_IDS = [
  ...ADV_COMPANY_IDS,
  ...BLUETRUM_ADV_COMPANY_IDS,
] as const;
