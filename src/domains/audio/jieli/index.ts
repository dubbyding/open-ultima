/**
 * Jieli RCSP audio domain barrel.
 */

export { crc16Jieli } from './crc16.ts';

export {
  JIELI_FLAG_IS_COMMAND,
  JIELI_FLAG_WANTS_RESPONSE,
  JIELI_PACKET_END,
  JIELI_PACKET_PREAMBLE,
  packJieliLtv,
  packJieliRcspPacket,
  parseJieliLtvEntries,
  parseJieliRcspPacket,
} from './rcspFraming.ts';
export type {
  JieliLtvEntry,
  JieliPackPacketOptions,
  JieliRcspPacket,
} from './rcspFraming.ts';

export {
  JIELI_ULTIMA_EQ_TAG,
  JIELI_ULTIMA_EQ_VALUE,
  encodeJieliAncMode,
  encodeJieliCustomCmd,
  encodeJieliCustomEq,
  encodeJieliDeviceName,
  encodeJieliGetAdvInfo,
  encodeJieliGetSysInfo,
  encodeJieliInEarDetect,
  encodeJieliKeySettings,
  encodeJieliLanguage,
  encodeJieliLedSettings,
  encodeJieliSearchDev,
  encodeJieliSetAdvInfo,
  encodeJieliSetSysInfo,
  encodeJieliUltimaEqPreset,
  encodeJieliUltimaEqQuery,
  encodeJieliWorkMode,
  parseJieliCustomData,
} from './commands.ts';
export type {
  JieliCustomDataResult,
  JieliCustomEqOptions,
  JieliKeySetting,
  JieliLedSetting,
  JieliSearchDevOptions,
  JieliUltimaEqPresetName,
  JieliUltimaEqValue,
} from './commands.ts';

export {
  JIELI_AUTH_ADDRESS,
  JIELI_AUTH_LINK_KEY,
  JIELI_AUTH_OK,
  JIELI_AUTH_RESET_FLAG,
  bluetoothE1,
  isJieliAuthMessage,
  isJieliAuthOk,
  jieliAuthChallenge,
  jieliAuthResponse,
  saferAr,
} from './auth.ts';
