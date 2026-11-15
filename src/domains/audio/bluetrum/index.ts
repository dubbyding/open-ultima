/**
 * Bluetrum ABMate protocol barrel.
 */

export {
  BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE,
  BluetrumFrameReassembler,
  encodeBluetrumCommand,
  encodeBluetrumFrame,
} from './framing.ts';
export type {
  BluetrumCommandPayload,
  BluetrumDecodedFrame,
  BluetrumEncodeFrameOptions,
} from './framing.ts';

export {
  DEFAULT_BLUETRUM_INFO_TAGS,
  encodeBluetrumAncGain,
  encodeBluetrumAncMode,
  encodeBluetrumAutoAnswer,
  encodeBluetrumAutoShutdown,
  encodeBluetrumBluetoothName,
  encodeBluetrumCaseKey,
  encodeBluetrumClearPairRecord,
  encodeBluetrumDeviceInfoRequest,
  encodeBluetrumDualConnect,
  encodeBluetrumEq,
  encodeBluetrumFactoryReset,
  encodeBluetrumFindDevice,
  encodeBluetrumInEarDetect,
  encodeBluetrumKeyMapping,
  encodeBluetrumLanguage,
  encodeBluetrumLdacMode,
  encodeBluetrumLedSwitch,
  encodeBluetrumMusicControl,
  encodeBluetrumSoundEffect3d,
  encodeBluetrumSpatialAudio,
  encodeBluetrumTransparencyGain,
  encodeBluetrumWorkMode,
} from './encoders.ts';

export {
  decodeBluetrumCaseKeySettings,
  decodeBluetrumDeviceCapacities,
  decodeBluetrumDeviceInfo,
  decodeBluetrumDevicePower,
  decodeBluetrumKeySettings,
  decodeBluetrumRemoteEqSetting,
  decodeBluetrumRemoteEqSettings,
  decodeBluetrumResponsePayload,
  decodeBluetrumTlvAckPayload,
  decodeBluetrumTlvMap,
} from './decoders.ts';
export type {
  BluetrumBatteryStatus,
  BluetrumCaseKeySetting,
  BluetrumCaseKeySettings,
  BluetrumDeviceCapacities,
  BluetrumDeviceInfoSnapshot,
  BluetrumDevicePower,
  BluetrumKeySettings,
  BluetrumRemoteEqSetting,
  BluetrumResponseStatus,
} from './decoders.ts';
