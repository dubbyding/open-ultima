/**
 * GATT/SPP UUIDs, Bluetrum ABMate opcodes/TLV tags/key maps, and Jieli RCSP opcodes/attr constants.
 */

/**
 * GATT and Classic SPP UUIDs for Bluetrum ABMate protocol.
 */
export const BLUETRUM_UUIDS = {
  SERVICE: '0000fdb3-0000-1000-8000-00805f9b34fb',
  SPP: '00001101-0000-1000-8000-00805f9b34fb',
  NOTIFY_WRITE: 'B6632277-0642-458B-A7A0-23FB1DC92C93',
} as const;

/**
 * Bluetrum command opcodes (`Command.COMMAND_*`).
 */
export const BLUETRUM_CMD = {
  EQ: 0x20,
  MUSIC_CONTROL: 0x21,
  KEY: 0x22,
  AUTO_SHUTDOWN: 0x23,
  FACTORY_RESET: 0x24,
  WORK_MODE: 0x25,
  IN_EAR_DETECT: 0x26,
  DEVICE_INFO: 0x27,
  NOTIFY: 0x28,
  LANGUAGE: 0x29,
  FIND_DEVICE: 0x2a,
  AUTO_ANSWER: 0x2b,
  ANC_MODE: 0x2c,
  BLUETOOTH_NAME: 0x2d,
  LED_SWITCH: 0x2e,
  CLEAR_PAIR_RECORD: 0x2f,
  ANC_GAIN: 0x30,
  TRANSPARENCY_GAIN: 0x31,
  SOUND_EFFECT_3D: 0x32,
  ONE_DRAG_TWO: 0x33,
  CASE_KEY: 0x40,
  SPATIAL_AUDIO: 0x41,
  LDAC_MODE: 0x42,
} as const;

export type BluetrumCmd = (typeof BLUETRUM_CMD)[keyof typeof BLUETRUM_CMD];

/**
 * Bluetrum packet frame direction/type (`Command.COMMAND_TYPE_*`).
 */
export const BLUETRUM_CMD_TYPE = {
  REQUEST: 1,
  RESPONSE: 2,
  NOTIFY: 3,
} as const;

export type BluetrumCmdType = (typeof BLUETRUM_CMD_TYPE)[keyof typeof BLUETRUM_CMD_TYPE];

/**
 * Bluetrum TLV tags for DeviceInfo (`0x27`) and Notify (`0x28`).
 */
export const BLUETRUM_INFO_TAG = {
  DEVICE_POWER: 0x01,
  FIRMWARE_VERSION: 0x02,
  BLUETOOTH_NAME: 0x03,
  EQ_SETTING: 0x04,
  KEY_SETTINGS: 0x05,
  DEVICE_VOLUME: 0x06,
  PLAY_STATE: 0x07,
  WORK_MODE: 0x08,
  IN_EAR_STATUS: 0x09,
  LANGUAGE_SETTING: 0x0a,
  AUTO_ANSWER: 0x0b,
  ANC_MODE: 0x0c,
  IS_TWS: 0x0d,
  TWS_CONNECTED: 0x0e,
  LED_SWITCH: 0x0f,
  FW_CHECKSUM: 0x10,
  ANC_GAIN: 0x11,
  TRANSPARENCY_GAIN: 0x12,
  ANC_GAIN_NUM: 0x13,
  TRANSPARENCY_GAIN_NUM: 0x14,
  ALL_EQ_SETTINGS: 0x15,
  MAIN_SIDE: 0x16,
  PRODUCT_COLOR: 0x17,
  SOUND_EFFECT_3D: 0x18,
  ONE_DRAG_TWO_SWITCH: 0x19,
  CASE_KEY: 0x30,
  SPACE: 0x31,
  LDAC: 0x32,
  DEVICE_CAPABILITIES: 0xfe,
  MAX_PACKET_SIZE: 0xff,
} as const;

export type BluetrumInfoTag = (typeof BLUETRUM_INFO_TAG)[keyof typeof BLUETRUM_INFO_TAG];

/**
 * Bitflags returned in `BLUETRUM_INFO_TAG.DEVICE_CAPABILITIES` (`0xFE`).
 */
export const BLUETRUM_DEVICE_CAPACITY = {
  TWS: 0x01,
  SOUND_EFFECT_3D: 0x02,
  MULTIPOINT: 0x04,
  ANC: 0x08,
} as const;

/**
 * Bluetrum MusicControl (`0x21`) sub-commands (`MusicControlRequest`).
 */
export const BLUETRUM_MUSIC_CONTROL = {
  VOLUME: 0x01,
  PLAY: 0x02,
  PAUSE: 0x03,
  PREVIOUS: 0x04,
  NEXT: 0x05,
} as const;

export type BluetrumMusicControl =
  (typeof BLUETRUM_MUSIC_CONTROL)[keyof typeof BLUETRUM_MUSIC_CONTROL];

/**
 * Bluetrum earbud touch gesture identifiers (`KeyRequest.KEY_*`).
 */
export const KEY_TYPE = {
  LEFT_SINGLE_TAP: 0x01,
  RIGHT_SINGLE_TAP: 0x02,
  LEFT_DOUBLE_TAP: 0x03,
  RIGHT_DOUBLE_TAP: 0x04,
  LEFT_TRIPLE_TAP: 0x05,
  RIGHT_TRIPLE_TAP: 0x06,
  LEFT_LONG_PRESS: 0x07,
  RIGHT_LONG_PRESS: 0x08,
} as const;

export type KeyType = (typeof KEY_TYPE)[keyof typeof KEY_TYPE];

/**
 * Bluetrum touch key assignable action functions (`KeyRequest.KEY_FUNCTION_*`).
 */
export const KEY_FUNCTION = {
  NONE: 0x00,
  RECALL: 0x01,
  ASSISTANT: 0x02,
  PREVIOUS: 0x03,
  NEXT: 0x04,
  VOLUME_UP: 0x05,
  VOLUME_DOWN: 0x06,
  PLAY_PAUSE: 0x07,
  GAME_MODE: 0x08,
  ANC_MODE: 0x09,
} as const;

export type KeyFunction = (typeof KEY_FUNCTION)[keyof typeof KEY_FUNCTION];

/**
 * Bluetrum smart-case touch gesture identifiers (`KeyCaseRequest.KEY_CASE_*`).
 */
export const CASE_KEY_TYPE = {
  SINGLE_TAP: 0x01,
  DOUBLE_TAP: 0x02,
  TRIPLE_TAP: 0x03,
  LONG_PRESS: 0x04,
  ROTATION_PRESS: 0x05,
} as const;

export type CaseKeyType = (typeof CASE_KEY_TYPE)[keyof typeof CASE_KEY_TYPE];

/**
 * GATT UUIDs and authentication vendor ID for Jieli RCSP devices.
 */
export const JIELI_UUIDS = {
  SERVICE: '0000ae00-0000-1000-8000-00805f9b34fb',
  WRITE: '0000ae01-0000-1000-8000-00805f9b34fb',
  NOTIFY: '0000ae02-0000-1000-8000-00805f9b34fb',
  AUTH_VID: [0x05, 0xd6] as const,
} as const;

/**
 * Jieli RCSP opcodes used by Ultima Link (`Command.CMD_*`).
 */
export const JIELI_OPCODE = {
  GET_TARGET_FEATURE_MAP: 0x02,
  GET_TARGET_INFO: 0x03,
  GET_SYS_INFO: 0x07,
  SET_SYS_INFO: 0x08,
  SYS_INFO_AUTO_UPDATE: 0x09,
  SEARCH_DEVICE: 0x19,
  ADV_SETTINGS: 0xc0,
  ADV_GET_INFO: 0xc1,
  EXTRA_CUSTOM: 0xff,
} as const;

export type JieliOpcode = (typeof JIELI_OPCODE)[keyof typeof JIELI_OPCODE];

/**
 * Jieli RCSP attribute, ADV TLV, and SysInfo function constants (`AttrAndFunCode`).
 */
export const JIELI_ATTR_AND_FUN = {
  ADV_TYPE_BATTERY_QUANTITY: 0x00,
  ADV_TYPE_DEVICE_NAME: 0x01,
  ADV_TYPE_KEY_SETTINGS: 0x02,
  ADV_TYPE_LED_SETTINGS: 0x03,
  ADV_TYPE_MIC_CHANNEL_SETTINGS: 0x04,
  ADV_TYPE_WORK_MODE: 0x05,
  ADV_TYPE_PRODUCT_MESSAGE: 0x06,
  ADV_TYPE_CONNECTED_TIME: 0x07,
  ADV_TYPE_IN_EAR_CHECK: 0x08,
  ADV_TYPE_LANGUAGE: 0x09,
  ADV_TYPE_ANC_MODE_LIST: 0x0a,
  ATTR_TYPE_PROTOCOL_VERSION: 0x00,
  ATTR_TYPE_POWER_UP_SYS_INFO: 0x01,
  ATTR_TYPE_EDR_ADDR: 0x02,
  ATTR_TYPE_PLATFORM: 0x03,
  ATTR_TYPE_FUNCTION_INFO: 0x04,
  ATTR_TYPE_FIRMWARE_INFO: 0x05,
  ATTR_TYPE_SDK_TYPE: 0x06,
  ATTR_TYPE_UBOOT_VERSION: 0x07,
  ATTR_TYPE_SUPPORT_DOUBLE_BACKUP: 0x08,
  ATTR_TYPE_MANDATORY_UPGRADE_FLAG: 0x09,
  ATTR_TYPE_VID_AND_PID: 0x0a,
  ATTR_TYPE_AUTH_KEY: 0x0b,
  ATTR_TYPE_PROJECT_CODE: 0x0c,
  ATTR_TYPE_PROTOCOL_MTU: 0x0d,
  ATTR_TYPE_ALLOW_CONNECT: 0x0e,
  SYS_INFO_FUNCTION_BT: 0x00,
  SYS_INFO_FUNCTION_MUSIC: 0x01,
  SYS_INFO_FUNCTION_RTC: 0x02,
  SYS_INFO_FUNCTION_AUX: 0x03,
  SYS_INFO_FUNCTION_FM: 0x04,
  SYS_INFO_FUNCTION_LIGHT: 0x05,
  SYS_INFO_FUNCTION_FMTX: 0x06,
  SYS_INFO_FUNCTION_EQ: 0x07,
  SYS_INFO_FUNCTION_SPDIF: 0x08,
  SYS_INFO_FUNCTION_PC_SLAVE: 0x09,
  SYS_INFO_FUNCTION_LOW_POWER: 0x16,
  SYS_INFO_FUNCTION_PUBLIC: 0xff,
  SYS_INFO_ATTR_EQ: 0x04,
  SYS_INFO_ATTR_EQ_PRESET_VALUE: 0x0c,
  SYS_INFO_ATTR_CURRENT_NOISE_MODE: 0x0d,
} as const;

export type JieliAttrAndFun =
  (typeof JIELI_ATTR_AND_FUN)[keyof typeof JIELI_ATTR_AND_FUN];
