import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQ_PRESETS,
  JIELI_ATTR_AND_FUN,
  JIELI_OPCODE,
} from '../../../src/protocols/ultimaLinkConstants.ts';
import {
  JIELI_FLAG_IS_COMMAND,
  JIELI_FLAG_WANTS_RESPONSE,
  JIELI_PACKET_END,
  JIELI_PACKET_PREAMBLE,
  JIELI_ULTIMA_EQ_TAG,
  JIELI_ULTIMA_EQ_VALUE,
  crc16Jieli,
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
  packJieliLtv,
  packJieliRcspPacket,
  parseJieliCustomData,
  parseJieliLtvEntries,
  parseJieliRcspPacket,
} from '../../../src/protocols/ultimaLinkJieli.ts';
import { concatUint8Arrays } from '../testUtils.ts';

// ---------------------------------------------------------------------------
// 4. Ultima Link Jieli RCSP Protocol
// ---------------------------------------------------------------------------

test('4.1 Jieli RCSP FE DC BA ... EF framing, flags, BE paramLen, xmOpCode, and round-trip parser', () => {
  // Standard command (opCode != 0x01)
  const cmdPacket = packJieliRcspPacket({
    isCommand: true,
    wantsResponse: true,
    opCode: JIELI_OPCODE.GET_TARGET_FEATURE_MAP,
    opCodeSn: 0x2a,
    paramData: Uint8Array.of(0x01, 0x02, 0x03),
  });
  assert.deepEqual(Array.from(cmdPacket.subarray(0, 3)), Array.from(JIELI_PACKET_PREAMBLE));
  assert.equal(cmdPacket[3], JIELI_FLAG_IS_COMMAND | JIELI_FLAG_WANTS_RESPONSE);
  assert.equal(cmdPacket[4], JIELI_OPCODE.GET_TARGET_FEATURE_MAP);
  // bodyLen = 1 (opCodeSn) + 3 = 4 -> BE [0x00, 0x04]
  assert.equal(cmdPacket[5], 0x00);
  assert.equal(cmdPacket[6], 0x04);
  assert.equal(cmdPacket[7], 0x2a);
  assert.equal(cmdPacket[cmdPacket.length - 1], JIELI_PACKET_END);

  const parsedCmd = parseJieliRcspPacket(cmdPacket);
  assert.ok(parsedCmd);
  assert.equal(parsedCmd.isCommand, true);
  assert.equal(parsedCmd.wantsResponse, true);
  assert.equal(parsedCmd.opCode, JIELI_OPCODE.GET_TARGET_FEATURE_MAP);
  assert.equal(parsedCmd.opCodeSn, 0x2a);
  assert.equal(parsedCmd.status, undefined);
  assert.equal(parsedCmd.xmOpCode, undefined);
  assert.deepEqual(parsedCmd.paramData, Uint8Array.of(0x01, 0x02, 0x03));

  // Extended opCode === 0x01 with xmOpCode and >255 byte BE paramLen in a response packet
  const bigParam = new Uint8Array(260).fill(0x5a);
  const xmResp = packJieliRcspPacket({
    isCommand: false,
    wantsResponse: false,
    opCode: 0x01,
    opCodeSn: 0x77,
    status: 0x00,
    xmOpCode: 0x33,
    paramData: bigParam,
  });
  // bodyLen = 1 (status) + 1 (opCodeSn) + 1 (xmOpCode) + 260 = 263 = 0x0107
  assert.equal(xmResp[3], 0x00);
  assert.equal(xmResp[4], 0x01);
  assert.equal(xmResp[5], 0x01);
  assert.equal(xmResp[6], 0x07);
  assert.equal(xmResp[7], 0x00); // status
  assert.equal(xmResp[8], 0x77); // opCodeSn
  assert.equal(xmResp[9], 0x33); // xmOpCode

  // Prefixed noise before FE DC BA should still parse cleanly
  const withPrefixNoise = concatUint8Arrays([Uint8Array.of(0x00, 0xff, 0xfe), xmResp]);
  const parsedResp = parseJieliRcspPacket(withPrefixNoise);
  assert.ok(parsedResp);
  assert.equal(parsedResp.isCommand, false);
  assert.equal(parsedResp.wantsResponse, false);
  assert.equal(parsedResp.status, 0x00);
  assert.equal(parsedResp.opCodeSn, 0x77);
  assert.equal(parsedResp.xmOpCode, 0x33);
  assert.deepEqual(parsedResp.paramData, bigParam);

  // Explicit flag bit combinations: Command without response (0x80), Response with wantsResponse bit (0x40)
  const cmdNoResp = packJieliRcspPacket({
    isCommand: true,
    wantsResponse: false,
    opCode: JIELI_OPCODE.SEARCH_DEVICE,
    opCodeSn: 0x11,
  });
  assert.equal(cmdNoResp[3], JIELI_FLAG_IS_COMMAND);
  assert.equal(parseJieliRcspPacket(cmdNoResp)?.wantsResponse, false);

  const respFlag40 = packJieliRcspPacket({
    isCommand: false,
    wantsResponse: true,
    opCode: JIELI_OPCODE.GET_SYS_INFO,
    opCodeSn: 0x12,
    status: 0x00,
  });
  assert.equal(respFlag40[3], JIELI_FLAG_WANTS_RESPONSE);
  const parsedFlag40 = parseJieliRcspPacket(respFlag40);
  assert.equal(parsedFlag40?.isCommand, false);
  assert.equal(parsedFlag40?.wantsResponse, true);

  // Corrupted tail byte or truncated frame returns null
  const badTail = new Uint8Array(cmdPacket);
  badTail[badTail.length - 1] = 0x00;
  assert.equal(parseJieliRcspPacket(badTail), null);
  assert.equal(parseJieliRcspPacket(cmdPacket.subarray(0, cmdPacket.length - 1)), null);
});

test('4.2 Jieli crc16Jieli determinism, BE 2-byte output, and CCITT-FALSE vectors', () => {
  assert.deepEqual(crc16Jieli(new Uint8Array(0)), Uint8Array.of(0xff, 0xff));

  const check = new TextEncoder().encode('123456789');
  const c1 = crc16Jieli(check);
  const c2 = crc16Jieli(check);
  assert.equal(c1.length, 2);
  assert.deepEqual(c1, c2);
  assert.deepEqual(c1, Uint8Array.of(0x29, 0xb1));

  // Partial length argument matches sliced buffer
  const padded = concatUint8Arrays([check, Uint8Array.of(0xde, 0xad)]);
  assert.deepEqual(crc16Jieli(padded, check.length), Uint8Array.of(0x29, 0xb1));
});

test('4.3 Jieli Custom Ultima EQ (0xFF), CustomEq (0x08), SearchDev (0x19), SetADVInfo (0xC0) & LTVs', () => {
  // [0x10] query
  const qPacket = parseJieliRcspPacket(encodeJieliUltimaEqQuery(1));
  assert.ok(qPacket);
  assert.equal(qPacket.opCode, JIELI_OPCODE.EXTRA_CUSTOM);
  assert.deepEqual(qPacket.paramData, Uint8Array.of(JIELI_ULTIMA_EQ_TAG));
  assert.deepEqual(parseJieliCustomData(qPacket.paramData), {
    kind: 'eq_query',
    tag: JIELI_ULTIMA_EQ_TAG,
    raw: Uint8Array.of(0x10),
  });

  // [0x10, 0x00] Signature Sound
  const sigPacket = parseJieliRcspPacket(encodeJieliUltimaEqPreset('signature', 2));
  assert.ok(sigPacket);
  assert.equal(sigPacket.opCode, JIELI_OPCODE.EXTRA_CUSTOM);
  assert.deepEqual(
    sigPacket.paramData,
    Uint8Array.of(JIELI_ULTIMA_EQ_TAG, JIELI_ULTIMA_EQ_VALUE.SIGNATURE_SOUND),
  );
  assert.deepEqual(parseJieliCustomData(sigPacket.paramData), {
    kind: 'eq_preset',
    tag: JIELI_ULTIMA_EQ_TAG,
    preset: 'signature',
    eqValue: 0x00,
    raw: Uint8Array.of(0x10, 0x00),
  });

  // [0x10, 0x01] Balance Sound
  const balPacket = parseJieliRcspPacket(encodeJieliUltimaEqPreset('balance', 3));
  assert.ok(balPacket);
  assert.deepEqual(
    balPacket.paramData,
    Uint8Array.of(JIELI_ULTIMA_EQ_TAG, JIELI_ULTIMA_EQ_VALUE.BALANCE_SOUND),
  );
  assert.deepEqual(parseJieliCustomData(balPacket.paramData), {
    kind: 'eq_preset',
    tag: JIELI_ULTIMA_EQ_TAG,
    preset: 'balance',
    eqValue: 0x01,
    raw: Uint8Array.of(0x10, 0x01),
  });

  // Unknown value & non-0x10 handling
  assert.equal(parseJieliCustomData(Uint8Array.of(0x10, 0x09))?.kind, 'eq_preset');
  assert.equal(
    (parseJieliCustomData(Uint8Array.of(0x10, 0x09)) as { preset: string }).preset,
    'unknown',
  );
  assert.equal(parseJieliCustomData(Uint8Array.of(0x11, 0x00)), null);
  assert.equal(encodeJieliCustomCmd(Uint8Array.of(0x99), 4, false)[3], JIELI_FLAG_IS_COMMAND);

  // Custom 10-band EQ over SetSysInfo (0x08) fixed and dynamic
  const fixedEq = parseJieliRcspPacket(
    encodeJieliCustomEq({
      mode: 6,
      gains: EQ_PRESETS.SIGNATURE_SOUND_311,
      opCodeSn: 4,
    }),
  );
  assert.ok(fixedEq);
  assert.equal(fixedEq.opCode, JIELI_OPCODE.SET_SYS_INFO);
  assert.equal(fixedEq.paramData[0], JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_PUBLIC);
  const fixedLtvs = parseJieliLtvEntries(fixedEq.paramData.subarray(1));
  assert.equal(fixedLtvs.length, 1);
  assert.equal(fixedLtvs[0]!.type, JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ);
  assert.deepEqual(
    Array.from(fixedLtvs[0]!.value),
    [6, 2, 0xfd, 0, 1, 0, 2, 3, 2, 3, 0xfc],
  );

  const dynEq = parseJieliRcspPacket(
    encodeJieliCustomEq({
      mode: 6,
      gains: [1, -2, 3, 4],
      opCodeSn: 5,
      dynamic: true,
    }),
  );
  assert.ok(dynEq);
  const dynLtvs = parseJieliLtvEntries(dynEq.paramData.subarray(1));
  assert.deepEqual(Array.from(dynLtvs[0]!.value), [0x86, 4, 1, 0xfe, 3, 4]);

  // SetSysInfo generic helper
  const sysInfo = parseJieliRcspPacket(
    encodeJieliSetSysInfo(
      JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_EQ,
      [{ type: 0x01, data: Uint8Array.of(0xaa) }],
      6,
    ),
  );
  assert.equal(sysInfo?.opCode, JIELI_OPCODE.SET_SYS_INFO);
  assert.equal(sysInfo?.paramData[0], JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_EQ);

  // SearchDev (0x19)
  const searchPkt = parseJieliRcspPacket(
    encodeJieliSearchDev({
      opCodeSn: 7,
      type: 1,
      op: 1,
      timeoutSec: 300, // 0x012C BE
      way: 2,
      player: 1,
    }),
  );
  assert.ok(searchPkt);
  assert.equal(searchPkt.opCode, JIELI_OPCODE.SEARCH_DEVICE);
  assert.deepEqual(searchPkt.paramData, Uint8Array.of(1, 1, 0x01, 0x2c, 2, 1));

  // SetADVInfo (0xC0) & helpers
  const advPkt = parseJieliRcspPacket(
    encodeJieliSetAdvInfo(
      [
        { type: JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST, value: Uint8Array.of(1) },
        { type: JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE, value: Uint8Array.of(2) },
      ],
      8,
    ),
  );
  assert.ok(advPkt);
  assert.equal(advPkt.opCode, JIELI_OPCODE.ADV_SETTINGS);
  const advLtvs = parseJieliLtvEntries(advPkt.paramData);
  assert.equal(advLtvs.length, 2);
  assert.equal(advLtvs[0]!.type, JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST);
  assert.deepEqual(advLtvs[0]!.value, Uint8Array.of(1));
  assert.equal(advLtvs[1]!.type, JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE);
  assert.deepEqual(advLtvs[1]!.value, Uint8Array.of(2));

  assert.deepEqual(
    parseJieliLtvEntries(parseJieliRcspPacket(encodeJieliAncMode(2, 9))!.paramData),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST, value: Uint8Array.of(2) }],
  );
  assert.deepEqual(
    parseJieliLtvEntries(
      parseJieliRcspPacket(
        encodeJieliKeySettings([{ keyNum: 1, action: 2, fn: 5 }], 10),
      )!.paramData,
    ),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_KEY_SETTINGS, value: Uint8Array.of(1, 2, 5) }],
  );
  assert.deepEqual(
    parseJieliLtvEntries(parseJieliRcspPacket(encodeJieliWorkMode(2, 11))!.paramData),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE, value: Uint8Array.of(2) }],
  );
  assert.deepEqual(
    parseJieliLtvEntries(parseJieliRcspPacket(encodeJieliInEarDetect(true, 12))!.paramData),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_IN_EAR_CHECK, value: Uint8Array.of(1) }],
  );
  assert.deepEqual(
    parseJieliLtvEntries(
      parseJieliRcspPacket(encodeJieliLedSettings([{ scene: 1, effect: 3 }], 13))!.paramData,
    ),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_LED_SETTINGS, value: Uint8Array.of(1, 3) }],
  );
  assert.deepEqual(
    parseJieliLtvEntries(parseJieliRcspPacket(encodeJieliDeviceName('BOOM_311', 14))!.paramData),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_DEVICE_NAME, value: new TextEncoder().encode('BOOM_311') }],
  );
  assert.deepEqual(
    parseJieliLtvEntries(parseJieliRcspPacket(encodeJieliLanguage('en', 15))!.paramData),
    [{ type: JIELI_ATTR_AND_FUN.ADV_TYPE_LANGUAGE, value: new TextEncoder().encode('en') }],
  );

  // GetADVInfo (0xC1) & GetSysInfo (0x07) & packJieliLtv
  const getAdv = parseJieliRcspPacket(encodeJieliGetAdvInfo(16, 0x01020304));
  assert.equal(getAdv?.opCode, JIELI_OPCODE.ADV_GET_INFO);
  assert.deepEqual(getAdv?.paramData, Uint8Array.of(0x01, 0x02, 0x03, 0x04));

  const getSys = parseJieliRcspPacket(encodeJieliGetSysInfo(17, 0x00000010, 0x07));
  assert.equal(getSys?.opCode, JIELI_OPCODE.GET_SYS_INFO);
  assert.deepEqual(getSys?.paramData, Uint8Array.of(0x07, 0x00, 0x00, 0x00, 0x10));

  assert.deepEqual(packJieliLtv(0x04, Uint8Array.of(0xaa, 0xbb)), Uint8Array.of(3, 0x04, 0xaa, 0xbb));
});
