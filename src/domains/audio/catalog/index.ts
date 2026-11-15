/**
 * Audio catalog domain barrel: constants, SKUs, EQ presets, and protocol opcodes.
 */

export {
  ANC_MODE,
  DEVICE_CHIP,
  HEADSET_TYPE,
  VOICE_LANGUAGE,
  WORK_MODE,
} from './types.ts';
export type {
  AncMode,
  DeviceChip,
  HeadsetType,
  ProductFactoryEqPresets,
  ProductSpec,
  VoiceLanguage,
  WorkMode,
} from './types.ts';

export {
  ADV_COMPANY_IDS,
  ALL_ADV_COMPANY_IDS,
  BLUETRUM_ADV_COMPANY_IDS,
  PRODUCT_CATALOG,
  getProductById,
} from './products.ts';

export {
  EQ_FREQUENCIES,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_PRESETS,
  getFactoryPresetsForProduct,
} from './eqPresets.ts';

export {
  BLUETRUM_CMD,
  BLUETRUM_CMD_TYPE,
  BLUETRUM_DEVICE_CAPACITY,
  BLUETRUM_INFO_TAG,
  BLUETRUM_MUSIC_CONTROL,
  BLUETRUM_UUIDS,
  CASE_KEY_TYPE,
  JIELI_ATTR_AND_FUN,
  JIELI_OPCODE,
  JIELI_UUIDS,
  KEY_FUNCTION,
  KEY_TYPE,
} from './opcodes.ts';
export type {
  BluetrumCmd,
  BluetrumCmdType,
  BluetrumInfoTag,
  BluetrumMusicControl,
  CaseKeyType,
  JieliAttrAndFun,
  JieliOpcode,
  KeyFunction,
  KeyType,
} from './opcodes.ts';
