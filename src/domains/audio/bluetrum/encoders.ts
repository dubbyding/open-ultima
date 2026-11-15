/**
 * Bluetrum ABMate command payload encoders (`0x20..0x33`, `0x40..0x42`).
 */

import { encodeUtf8, toSignedInt8Byte } from '../adv/hexUtils.ts';
import {
  BLUETRUM_CMD,
  BLUETRUM_INFO_TAG,
  BLUETRUM_MUSIC_CONTROL,
} from '../catalog/index.ts';
import type {
  AncMode,
  BluetrumCmd,
  BluetrumInfoTag,
  BluetrumMusicControl,
  CaseKeyType,
  KeyFunction,
  KeyType,
  VoiceLanguage,
  WorkMode,
} from '../catalog/index.ts';
import type { BluetrumCommandPayload } from './framing.ts';

/**
 * Default TLV tags queried by `DeviceInfoRequest.defaultInfoRequest()` (`0x27`).
 */
export const DEFAULT_BLUETRUM_INFO_TAGS = [
  BLUETRUM_INFO_TAG.DEVICE_POWER,
  BLUETRUM_INFO_TAG.FIRMWARE_VERSION,
  BLUETRUM_INFO_TAG.BLUETOOTH_NAME,
  BLUETRUM_INFO_TAG.EQ_SETTING,
  BLUETRUM_INFO_TAG.KEY_SETTINGS,
  BLUETRUM_INFO_TAG.DEVICE_VOLUME,
  BLUETRUM_INFO_TAG.PLAY_STATE,
  BLUETRUM_INFO_TAG.WORK_MODE,
  BLUETRUM_INFO_TAG.IN_EAR_STATUS,
  BLUETRUM_INFO_TAG.LANGUAGE_SETTING,
  BLUETRUM_INFO_TAG.AUTO_ANSWER,
  BLUETRUM_INFO_TAG.ANC_MODE,
  BLUETRUM_INFO_TAG.IS_TWS,
  BLUETRUM_INFO_TAG.TWS_CONNECTED,
  BLUETRUM_INFO_TAG.LED_SWITCH,
  BLUETRUM_INFO_TAG.FW_CHECKSUM,
  BLUETRUM_INFO_TAG.ANC_GAIN,
  BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN,
  BLUETRUM_INFO_TAG.SOUND_EFFECT_3D,
  BLUETRUM_INFO_TAG.ONE_DRAG_TWO_SWITCH,
  BLUETRUM_INFO_TAG.CASE_KEY,
  BLUETRUM_INFO_TAG.DEVICE_CAPABILITIES,
  BLUETRUM_INFO_TAG.ANC_GAIN_NUM,
  BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN_NUM,
  BLUETRUM_INFO_TAG.ALL_EQ_SETTINGS,
  BLUETRUM_INFO_TAG.MAIN_SIDE,
  BLUETRUM_INFO_TAG.PRODUCT_COLOR,
  BLUETRUM_INFO_TAG.SPACE,
  BLUETRUM_INFO_TAG.MAX_PACKET_SIZE,
  BLUETRUM_INFO_TAG.LDAC,
] as const;

function bytesCmd(cmd: BluetrumCmd, ...bytes: number[]): BluetrumCommandPayload {
  return { cmd, payload: new Uint8Array(bytes) };
}

function boolCmd(cmd: BluetrumCmd, enabled: boolean): BluetrumCommandPayload {
  return bytesCmd(cmd, enabled ? 0x01 : 0x00);
}

/** `0x20` EQ setting (`[segmentNum, eqMode, ...signedInt8(gains)]`). */
export function encodeBluetrumEq(
  mode: number,
  gains: readonly number[],
  segmentCount = gains.length,
): BluetrumCommandPayload {
  const payload = new Uint8Array(2 + gains.length);
  payload[0] = segmentCount & 0xff;
  payload[1] = mode & 0xff;
  for (let i = 0; i < gains.length; i++) {
    payload[2 + i] = toSignedInt8Byte(gains[i]!);
  }
  return { cmd: BLUETRUM_CMD.EQ, payload };
}

/** `0x21` Music control (`[controlType]` or `[1, volume]` for volume control). */
export function encodeBluetrumMusicControl(
  controlType: BluetrumMusicControl | number,
  volume?: number,
): BluetrumCommandPayload {
  if (controlType === BLUETRUM_MUSIC_CONTROL.VOLUME) {
    return bytesCmd(BLUETRUM_CMD.MUSIC_CONTROL, BLUETRUM_MUSIC_CONTROL.VOLUME, (volume ?? 0) & 0xff);
  }
  return bytesCmd(BLUETRUM_CMD.MUSIC_CONTROL, controlType & 0xff);
}

/** `0x22` Key mapping (`[keyType, 0x01, keyFunction]`). */
export function encodeBluetrumKeyMapping(
  keyType: KeyType | number,
  keyFunction: KeyFunction | number,
): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.KEY, keyType & 0xff, 0x01, keyFunction & 0xff);
}

/**
 * `0x23` Auto shutdown timer (`0` = immediately, `0xFF` / `-1` = cancel, or minutes byte).
 */
export function encodeBluetrumAutoShutdown(minutesOrSetting: number): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.AUTO_SHUTDOWN, minutesOrSetting & 0xff);
}

/** `0x24` Factory reset (empty payload). */
export function encodeBluetrumFactoryReset(): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.FACTORY_RESET);
}

/** `0x25` Work mode (`0` = normal, `1` = gaming). */
export function encodeBluetrumWorkMode(mode: WorkMode | number): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.WORK_MODE, mode & 0xff);
}

/** `0x26` In-ear wear detection switch. */
export function encodeBluetrumInEarDetect(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.IN_EAR_DETECT, enabled);
}

/**
 * `0x27` Device info query (`[tag, 0x00]` pairs).
 * Defaults to all 30 tags from `DeviceInfoRequest.defaultInfoRequest()`.
 */
export function encodeBluetrumDeviceInfoRequest(
  tags: readonly (BluetrumInfoTag | number)[] = DEFAULT_BLUETRUM_INFO_TAGS,
): BluetrumCommandPayload {
  const payload = new Uint8Array(tags.length * 2);
  for (let i = 0; i < tags.length; i++) {
    payload[i * 2] = tags[i]! & 0xff;
    payload[i * 2 + 1] = 0x00;
  }
  return { cmd: BLUETRUM_CMD.DEVICE_INFO, payload };
}

/** `0x29` Voice prompt language (`0` = English, `1` = Chinese). */
export function encodeBluetrumLanguage(language: VoiceLanguage | number): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.LANGUAGE, language & 0xff);
}

/** `0x2A` Find device tone switch. */
export function encodeBluetrumFindDevice(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.FIND_DEVICE, enabled);
}

/** `0x2B` Auto-answer incoming call switch. */
export function encodeBluetrumAutoAnswer(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.AUTO_ANSWER, enabled);
}

/** `0x2C` ANC mode (`0` = off, `1` = ANC, `2` = transparency). */
export function encodeBluetrumAncMode(mode: AncMode | number): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.ANC_MODE, mode & 0xff);
}

/** `0x2D` Set Bluetooth Classic device name (UTF-8). */
export function encodeBluetrumBluetoothName(name: string): BluetrumCommandPayload {
  return { cmd: BLUETRUM_CMD.BLUETOOTH_NAME, payload: encodeUtf8(name) };
}

/** `0x2E` LED indicator switch. */
export function encodeBluetrumLedSwitch(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.LED_SWITCH, enabled);
}

/** `0x2F` Clear Bluetooth pairing records (empty payload). */
export function encodeBluetrumClearPairRecord(): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.CLEAR_PAIR_RECORD);
}

/** `0x30` ANC gain level. */
export function encodeBluetrumAncGain(gain: number): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.ANC_GAIN, toSignedInt8Byte(gain));
}

/** `0x31` Transparency gain level. */
export function encodeBluetrumTransparencyGain(gain: number): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.TRANSPARENCY_GAIN, toSignedInt8Byte(gain));
}

/** `0x32` 3D sound effect toggle. */
export function encodeBluetrumSoundEffect3d(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.SOUND_EFFECT_3D, enabled);
}

/** `0x33` Dual-connect / one-drag-two switch (`[0x01, 0x01, 0|1]`). */
export function encodeBluetrumDualConnect(enabled: boolean): BluetrumCommandPayload {
  return bytesCmd(BLUETRUM_CMD.ONE_DRAG_TWO, 0x01, 0x01, enabled ? 0x01 : 0x00);
}

/** `0x40` Smart charging case key mapping (`[keyType, 0x02, keyFunction, callControl]`). */
export function encodeBluetrumCaseKey(
  keyType: CaseKeyType | number,
  keyFunction: number,
  callControl = 0,
): BluetrumCommandPayload {
  return bytesCmd(
    BLUETRUM_CMD.CASE_KEY,
    keyType & 0xff,
    0x02,
    keyFunction & 0xff,
    callControl & 0xff,
  );
}

/** `0x41` Spatial audio toggle. */
export function encodeBluetrumSpatialAudio(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.SPATIAL_AUDIO, enabled);
}

/** `0x42` LDAC high-definition codec toggle. */
export function encodeBluetrumLdacMode(enabled: boolean): BluetrumCommandPayload {
  return boolCmd(BLUETRUM_CMD.LDAC_MODE, enabled);
}
