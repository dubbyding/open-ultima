/**
 * Bluetrum ABMate TLV, ACK, power, EQ, key-mapping, capability, and DeviceInfo decoders.
 */

import {
  decodeUtf8,
  fromSignedInt8Byte,
  readLittleEndianUint16,
  readLittleEndianUint32,
} from '../adv/hexUtils.ts';
import { BLUETRUM_DEVICE_CAPACITY, BLUETRUM_INFO_TAG } from '../catalog/index.ts';

export interface BluetrumResponseStatus {
  ok: boolean;
  statusCode: number;
}

export interface BluetrumBatteryStatus {
  level: number;
  isCharging: boolean;
  raw: number;
}

export interface BluetrumDevicePower {
  left?: BluetrumBatteryStatus;
  right?: BluetrumBatteryStatus;
  case?: BluetrumBatteryStatus;
}

export interface BluetrumRemoteEqSetting {
  mode: number;
  bandCount: number;
  gains: number[];
}

export type BluetrumKeySettings = Record<number, number>;

export interface BluetrumCaseKeySetting {
  keyFunction: number;
  callControl?: number;
  raw: Uint8Array;
}

export type BluetrumCaseKeySettings = Record<number, BluetrumCaseKeySetting>;

export interface BluetrumDeviceCapacities {
  raw: number;
  tws: boolean;
  soundEffect3d: boolean;
  multipoint: boolean;
  anc: boolean;
}

export interface BluetrumDeviceInfoSnapshot {
  power?: BluetrumDevicePower;
  firmwareVersion?: number;
  bluetoothName?: string;
  eqSetting?: BluetrumRemoteEqSetting;
  eqSettings?: BluetrumRemoteEqSetting[];
  keySettings?: BluetrumKeySettings;
  deviceVolume?: number;
  playState?: boolean;
  workMode?: number;
  inEarDetect?: boolean;
  language?: number;
  autoAnswer?: boolean;
  ancMode?: number;
  isTws?: boolean;
  isTwsConnected?: boolean;
  mainSide?: number;
  productColor?: number;
  ledOn?: boolean;
  fwChecksum?: string;
  ancGain?: number;
  transparencyGain?: number;
  soundEffect3d?: boolean;
  dualConnect?: boolean;
  caseKeySettings?: BluetrumCaseKeySettings;
  capacities?: BluetrumDeviceCapacities;
  ancGainNum?: number;
  transparencyGainNum?: number;
  spatialAudio?: boolean;
  ldacMode?: boolean;
  maxPacketSize?: number;
  rawTags: Map<number, Uint8Array>;
}

/**
 * Decodes a 1-byte Bluetrum command ACK (`0x00 === ok`).
 */
export function decodeBluetrumResponsePayload(payload: Uint8Array): BluetrumResponseStatus {
  const statusCode = payload[0] ?? -1;
  return {
    ok: payload.length > 0 && statusCode === 0x00,
    statusCode,
  };
}

/**
 * Decodes a multi-item TLV ACK payload (`TlvResponsePayloadHandler`) mapping `tag -> (status === 0x00)`.
 */
export function decodeBluetrumTlvAckPayload(payload: Uint8Array): Map<number, boolean> {
  const tlv = decodeBluetrumTlvMap(payload);
  const acks = new Map<number, boolean>();
  for (const [tag, value] of tlv) {
    if (value.length === 1) {
      acks.set(tag, value[0] === 0x00);
    }
  }
  return acks;
}

function decodeBatteryByte(raw: number): BluetrumBatteryStatus {
  return {
    level: raw & 0x7f,
    isCharging: (raw & 0x80) !== 0,
    raw,
  };
}

/**
 * Decodes Bluetrum battery payload `[left, right?, case?]`.
 * Bit 7 (`0x80`) indicates `isCharging`; bits `0..6` (`& 0x7F`) indicate percentage `level`.
 */
export function decodeBluetrumDevicePower(payload: Uint8Array): BluetrumDevicePower {
  const result: BluetrumDevicePower = {};
  if (payload.length >= 1) {
    result.left = decodeBatteryByte(payload[0]!);
  }
  if (payload.length >= 2) {
    result.right = decodeBatteryByte(payload[1]!);
  }
  if (payload.length >= 3) {
    result.case = decodeBatteryByte(payload[2]!);
  }
  return result;
}

/**
 * Parses a Bluetrum TLV stream (`0x27` DeviceInfo response or `0x28` DeviceNotify)
 * encoded as repeating `[tag, length, ...value]` entries.
 */
export function decodeBluetrumTlvMap(payload: Uint8Array): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  let offset = 0;

  while (offset + 2 <= payload.length) {
    const tag = payload[offset]!;
    const len = payload[offset + 1]!;
    offset += 2;
    if (offset + len > payload.length) {
      break;
    }
    result.set(tag, new Uint8Array(payload.subarray(offset, offset + len)));
    offset += len;
  }

  return result;
}

function readSignedGains(payload: Uint8Array, start: number, count: number): number[] {
  const gains: number[] = [];
  for (let i = 0; i < count; i++) {
    gains.push(fromSignedInt8Byte(payload[start + i]!));
  }
  return gains;
}

/**
 * Decodes a single `RemoteEqSetting` payload (`[bandCount, mode, ...signedInt8(gains)]`).
 */
export function decodeBluetrumRemoteEqSetting(payload: Uint8Array): BluetrumRemoteEqSetting | null {
  if (payload.length < 2) {
    return null;
  }
  const bandCount = payload[0]!;
  const mode = payload[1]!;
  if (payload.length < 2 + bandCount) {
    return null;
  }
  return { mode, bandCount, gains: readSignedGains(payload, 2, bandCount) };
}

/**
 * Decodes `RemoteEqSettings` list (`[bandCount, mode0, ...gains0, mode1, ...gains1, ...]`).
 */
export function decodeBluetrumRemoteEqSettings(payload: Uint8Array): BluetrumRemoteEqSetting[] {
  if (payload.length < 2) {
    return [];
  }
  const bandCount = payload[0]!;
  const entrySize = 1 + bandCount;
  const list: BluetrumRemoteEqSetting[] = [];

  for (let offset = 1; offset + entrySize <= payload.length; offset += entrySize) {
    const mode = payload[offset]!;
    list.push({ mode, bandCount, gains: readSignedGains(payload, offset + 1, bandCount) });
  }
  return list;
}

/**
 * Decodes `KeySettings` TLV (`0x05`) mapping `keyType -> keyFunction` for 1-byte entries.
 */
export function decodeBluetrumKeySettings(payload: Uint8Array): BluetrumKeySettings {
  const tlv = decodeBluetrumTlvMap(payload);
  const settings: BluetrumKeySettings = {};
  for (const [keyType, value] of tlv) {
    if (value.length === 1) {
      settings[keyType] = value[0]!;
    }
  }
  return settings;
}

/**
 * Decodes `CaseKeySettings` TLV (`0x15`) mapping `caseKeyType -> { keyFunction, callControl?, raw }`.
 */
export function decodeBluetrumCaseKeySettings(payload: Uint8Array): BluetrumCaseKeySettings {
  const tlv = decodeBluetrumTlvMap(payload);
  const settings: BluetrumCaseKeySettings = {};
  for (const [keyType, value] of tlv) {
    if (value.length === 1) {
      settings[keyType] = { keyFunction: value[0]!, raw: value };
    } else if (value.length >= 2) {
      settings[keyType] = {
        keyFunction: value[0]!,
        callControl: value[1]!,
        raw: value,
      };
    }
  }
  return settings;
}

/**
 * Decodes 16-bit LE device capability flags (`0x16`).
 */
export function decodeBluetrumDeviceCapacities(payload: Uint8Array): BluetrumDeviceCapacities {
  const raw = payload.length >= 2 ? readLittleEndianUint16(payload)! : (payload[0] ?? 0);
  return {
    raw,
    tws: (raw & BLUETRUM_DEVICE_CAPACITY.TWS) !== 0,
    soundEffect3d: (raw & BLUETRUM_DEVICE_CAPACITY.SOUND_EFFECT_3D) !== 0,
    multipoint: (raw & BLUETRUM_DEVICE_CAPACITY.MULTIPOINT) !== 0,
    anc: (raw & BLUETRUM_DEVICE_CAPACITY.ANC) !== 0,
  };
}

type InfoTagDecoder = (snapshot: BluetrumDeviceInfoSnapshot, value: Uint8Array) => void;
type BoolInfoKey =
  | 'playState' | 'inEarDetect' | 'autoAnswer' | 'isTws' | 'isTwsConnected'
  | 'ledOn' | 'soundEffect3d' | 'dualConnect' | 'spatialAudio' | 'ldacMode';
type Uint8InfoKey =
  | 'deviceVolume' | 'workMode' | 'language' | 'ancMode'
  | 'mainSide' | 'productColor' | 'ancGainNum' | 'transparencyGainNum';

const boolTag = (key: BoolInfoKey): InfoTagDecoder => (s, v) => {
  if (v.length >= 1) s[key] = v[0]! !== 0;
};
const uint8Tag = (key: Uint8InfoKey): InfoTagDecoder => (s, v) => {
  if (v.length >= 1) s[key] = v[0]!;
};
const int8Tag = (key: 'ancGain' | 'transparencyGain'): InfoTagDecoder => (s, v) => {
  if (v.length >= 1) s[key] = fromSignedInt8Byte(v[0]!);
};

function decodeReversedHexChecksum(value: Uint8Array): string {
  let hex = '';
  for (let i = value.length - 1; i >= 0; i--) {
    hex += value[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

const INFO_TAG_DECODERS: ReadonlyMap<number, InfoTagDecoder> = new Map<number, InfoTagDecoder>([
  [BLUETRUM_INFO_TAG.DEVICE_POWER, (s, v) => { s.power = decodeBluetrumDevicePower(v); }],
  [BLUETRUM_INFO_TAG.FIRMWARE_VERSION, (s, v) => { s.firmwareVersion = readLittleEndianUint32(v); }],
  [BLUETRUM_INFO_TAG.BLUETOOTH_NAME, (s, v) => { s.bluetoothName = decodeUtf8(v); }],
  [BLUETRUM_INFO_TAG.EQ_SETTING, (s, v) => { const eq = decodeBluetrumRemoteEqSetting(v); if (eq) s.eqSetting = eq; }],
  [BLUETRUM_INFO_TAG.KEY_SETTINGS, (s, v) => { s.keySettings = decodeBluetrumKeySettings(v); }],
  [BLUETRUM_INFO_TAG.DEVICE_VOLUME, uint8Tag('deviceVolume')],
  [BLUETRUM_INFO_TAG.PLAY_STATE, boolTag('playState')],
  [BLUETRUM_INFO_TAG.WORK_MODE, uint8Tag('workMode')],
  [BLUETRUM_INFO_TAG.IN_EAR_STATUS, boolTag('inEarDetect')],
  [BLUETRUM_INFO_TAG.LANGUAGE_SETTING, uint8Tag('language')],
  [BLUETRUM_INFO_TAG.AUTO_ANSWER, boolTag('autoAnswer')],
  [BLUETRUM_INFO_TAG.ANC_MODE, uint8Tag('ancMode')],
  [BLUETRUM_INFO_TAG.IS_TWS, boolTag('isTws')],
  [BLUETRUM_INFO_TAG.TWS_CONNECTED, boolTag('isTwsConnected')],
  [BLUETRUM_INFO_TAG.MAIN_SIDE, uint8Tag('mainSide')],
  [BLUETRUM_INFO_TAG.PRODUCT_COLOR, uint8Tag('productColor')],
  [BLUETRUM_INFO_TAG.LED_SWITCH, boolTag('ledOn')],
  [BLUETRUM_INFO_TAG.FW_CHECKSUM, (s, v) => { if (v.length >= 4) s.fwChecksum = decodeReversedHexChecksum(v); }],
  [BLUETRUM_INFO_TAG.ANC_GAIN, int8Tag('ancGain')],
  [BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN, int8Tag('transparencyGain')],
  [BLUETRUM_INFO_TAG.SOUND_EFFECT_3D, boolTag('soundEffect3d')],
  [BLUETRUM_INFO_TAG.ONE_DRAG_TWO_SWITCH, boolTag('dualConnect')],
  [BLUETRUM_INFO_TAG.CASE_KEY, (s, v) => { s.caseKeySettings = decodeBluetrumCaseKeySettings(v); }],
  [BLUETRUM_INFO_TAG.DEVICE_CAPABILITIES, (s, v) => { s.capacities = decodeBluetrumDeviceCapacities(v); }],
  [BLUETRUM_INFO_TAG.ANC_GAIN_NUM, uint8Tag('ancGainNum')],
  [BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN_NUM, uint8Tag('transparencyGainNum')],
  [BLUETRUM_INFO_TAG.ALL_EQ_SETTINGS, (s, v) => { s.eqSettings = decodeBluetrumRemoteEqSettings(v); }],
  [BLUETRUM_INFO_TAG.SPACE, boolTag('spatialAudio')],
  [BLUETRUM_INFO_TAG.LDAC, boolTag('ldacMode')],
  [BLUETRUM_INFO_TAG.MAX_PACKET_SIZE, (s, v) => { s.maxPacketSize = readLittleEndianUint16(v); }],
]);

/**
 * Decodes all recognized TLV entries from a `0x27` DeviceInfo response or `0x28` notification payload.
 */
export function decodeBluetrumDeviceInfo(payload: Uint8Array): BluetrumDeviceInfoSnapshot {
  const rawTags = decodeBluetrumTlvMap(payload);
  const snapshot: BluetrumDeviceInfoSnapshot = { rawTags };

  for (const [tag, value] of rawTags) {
    INFO_TAG_DECODERS.get(tag)?.(snapshot, value);
  }

  return snapshot;
}
