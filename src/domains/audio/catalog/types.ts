/**
 * Core audio domain types, chip identifiers, product specification contract,
 * and shared earbud mode enumerations (`as const` objects + union types).
 */

export const DEVICE_CHIP = {
  JL: 'JL',
  BT: 'BT',
} as const;

export type DeviceChip = (typeof DEVICE_CHIP)[keyof typeof DEVICE_CHIP];

export const HEADSET_TYPE = {
  TWS: 'TWS',
  HEAD_MOUNTED: 'HEAD_MOUNTED',
  SPEAKER: 'SPEAKER',
} as const;

export type HeadsetType = (typeof HEADSET_TYPE)[keyof typeof HEADSET_TYPE];

export interface ProductSpec {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly chip: DeviceChip;
  readonly headsetType: HeadsetType;
  readonly supportsAnc: boolean;
  readonly supportsGameMode: boolean;
  readonly supportsCaseKeys: boolean;
  readonly supportsDualConnect: boolean;
  readonly supportsLdac: boolean;
  readonly supportsSpatialAudio: boolean;
  readonly supportsSignatureBalanceEq: boolean;
  readonly supportsOta: boolean;
}

export interface ProductFactoryEqPresets {
  readonly flat: readonly number[];
  readonly signatureSound: readonly number[];
  readonly balanceSound: readonly number[];
}

export const ANC_MODE = {
  OFF: 0,
  ANC: 1,
  TRANSPARENCY: 2,
} as const;

export type AncMode = (typeof ANC_MODE)[keyof typeof ANC_MODE];

/**
 * Bluetrum `WORK_MODE` values (`0x25` command). Note that Jieli ADV work mode uses 1=NORMAL, 2=GAME.
 */
export const WORK_MODE = {
  NORMAL: 0,
  GAMING: 1,
} as const;

export type WorkMode = (typeof WORK_MODE)[keyof typeof WORK_MODE];

/**
 * Bluetrum voice prompt language codes (`LanguageRequest`).
 */
export const VOICE_LANGUAGE = {
  ENGLISH: 0,
  CHINESE: 1,
} as const;

export type VoiceLanguage = (typeof VOICE_LANGUAGE)[keyof typeof VOICE_LANGUAGE];
