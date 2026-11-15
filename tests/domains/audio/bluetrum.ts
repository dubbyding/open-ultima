import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANC_MODE,
  BLUETRUM_CMD,
  BLUETRUM_CMD_TYPE,
  BLUETRUM_DEVICE_CAPACITY,
  BLUETRUM_INFO_TAG,
  BLUETRUM_MUSIC_CONTROL,
  CASE_KEY_TYPE,
  KEY_FUNCTION,
  KEY_TYPE,
  VOICE_LANGUAGE,
  WORK_MODE,
} from '../../../src/protocols/ultimaLinkConstants.ts';
import {
  BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE,
  BluetrumFrameReassembler,
  DEFAULT_BLUETRUM_INFO_TAGS,
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
  encodeBluetrumAncGain,
  encodeBluetrumAncMode,
  encodeBluetrumAutoAnswer,
  encodeBluetrumAutoShutdown,
  encodeBluetrumBluetoothName,
  encodeBluetrumCaseKey,
  encodeBluetrumClearPairRecord,
  encodeBluetrumCommand,
  encodeBluetrumDeviceInfoRequest,
  encodeBluetrumDualConnect,
  encodeBluetrumEq,
  encodeBluetrumFactoryReset,
  encodeBluetrumFindDevice,
  encodeBluetrumFrame,
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
} from '../../../src/protocols/ultimaLinkBluetrum.ts';
import { buildBluetrumTlvStream } from '../testUtils.ts';

// ---------------------------------------------------------------------------
// 3. Ultima Link Bluetrum ABMate Protocol
// ---------------------------------------------------------------------------

test('3.1 Bluetrum 5-byte frame header, single & multi-fragment (> 15B) DeviceInfoRequest round-trip', () => {
  // Single-fragment frame header layout
  const singleCmd = encodeBluetrumAncMode(ANC_MODE.ANC);
  const singleFrames = encodeBluetrumCommand(singleCmd, 0x2a, {
    cmdType: BLUETRUM_CMD_TYPE.REQUEST,
  });
  assert.equal(singleFrames.length, 1);
  assert.deepEqual(
    Array.from(singleFrames[0]!),
    [0x0a, BLUETRUM_CMD.ANC_MODE, BLUETRUM_CMD_TYPE.REQUEST, 0x00, 0x01, 0x01],
  );

  // Empty payload frame
  const resetFrames = encodeBluetrumCommand(encodeBluetrumFactoryReset(), 3);
  assert.equal(resetFrames.length, 1);
  assert.deepEqual(
    Array.from(resetFrames[0]!),
    [0x03, BLUETRUM_CMD.FACTORY_RESET, BLUETRUM_CMD_TYPE.REQUEST, 0x00, 0x00],
  );

  // Multi-fragment (> 15B): 0x27 DeviceInfoRequest with 30 TLV tags (60 bytes -> 4 fragments of 15B)
  assert.ok(DEFAULT_BLUETRUM_INFO_TAGS.length >= 20);
  const infoReq = encodeBluetrumDeviceInfoRequest();
  assert.equal(infoReq.cmd, BLUETRUM_CMD.DEVICE_INFO);
  assert.equal(infoReq.payload.length, DEFAULT_BLUETRUM_INFO_TAGS.length * 2);

  const fragments = encodeBluetrumFrame({
    seq: 14, // tests 4-bit rollover: 14, 15, 0, 1
    cmd: infoReq.cmd,
    cmdType: BLUETRUM_CMD_TYPE.REQUEST,
    payload: infoReq.payload,
    maxPayloadSize: BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE,
  });
  assert.ok(fragments.length > 1);
  assert.equal(
    fragments.length,
    Math.ceil(infoReq.payload.length / BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE),
  );

  const reassembler = new BluetrumFrameReassembler();
  let decoded = null;
  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]!;
    assert.equal(frag[0], (14 + i) & 0x0f);
    assert.equal(frag[1], BLUETRUM_CMD.DEVICE_INFO);
    assert.equal(frag[2], BLUETRUM_CMD_TYPE.REQUEST);
    assert.equal(frag[3], (((fragments.length - 1) << 4) | i) & 0xff);
    assert.equal(frag[4], frag.length - 5);
    assert.ok(frag.length - 5 <= BLUETRUM_DEFAULT_MAX_PAYLOAD_SIZE);

    const step = reassembler.push(frag);
    if (i < fragments.length - 1) {
      assert.equal(step, null);
    } else {
      decoded = step;
    }
  }

  assert.ok(decoded);
  assert.equal(decoded.cmd, BLUETRUM_CMD.DEVICE_INFO);
  assert.equal(decoded.cmdType, BLUETRUM_CMD_TYPE.REQUEST);
  assert.equal(decoded.fragTotal, fragments.length);
  assert.equal(decoded.encrypted, false);
  assert.deepEqual(decoded.payload, infoReq.payload);

  // Out-of-order fragment drops incomplete assembly safely
  assert.equal(reassembler.push(fragments[0]!), null);
  assert.equal(reassembler.push(fragments[2]!), null);
  // Mismatched fragment count boundary throws
  assert.throws(
    () =>
      encodeBluetrumFrame({
        seq: 0,
        cmd: 0x27,
        payload: new Uint8Array(17 * 15),
      }),
    RangeError,
  );
});

test('3.2 Bluetrum encoders & decoders for EQ, ANC, Gains, Keys, CaseKey, GameMode, DualConnect, Spatial, LDAC, Power', () => {
  // EQ (0x20)
  const eqGains = [3, -5, 10, 0, -10, 2, 4, -1, 6, 8];
  const eqCmd = encodeBluetrumEq(0x20, eqGains);
  assert.equal(eqCmd.cmd, 0x20);
  assert.deepEqual(
    Array.from(eqCmd.payload),
    [10, 0x20, 3, 0xfb, 10, 0, 0xf6, 2, 4, 0xff, 6, 8],
  );
  const decodedEq = decodeBluetrumRemoteEqSetting(eqCmd.payload);
  assert.deepEqual(decodedEq, { mode: 0x20, bandCount: 10, gains: eqGains });

  // ALL_EQ_SETTINGS list decode
  const multiEqPayload = Uint8Array.of(
    10,
    0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x20, 3, 0xfb, 10, 0, 0xf6, 2, 4, 0xff, 6, 8,
  );
  const decodedEqList = decodeBluetrumRemoteEqSettings(multiEqPayload);
  assert.equal(decodedEqList.length, 2);
  assert.equal(decodedEqList[0]!.mode, 0x00);
  assert.deepEqual(decodedEqList[1]!.gains, eqGains);

  // ANC Mode (0x2C) & Gains (0x30 / 0x31)
  assert.deepEqual(encodeBluetrumAncMode(ANC_MODE.OFF).payload, Uint8Array.of(0x00));
  assert.deepEqual(encodeBluetrumAncMode(ANC_MODE.ANC).payload, Uint8Array.of(0x01));
  assert.deepEqual(encodeBluetrumAncMode(ANC_MODE.TRANSPARENCY).payload, Uint8Array.of(0x02));
  assert.deepEqual(encodeBluetrumAncGain(-3).payload, Uint8Array.of(0xfd));
  assert.deepEqual(encodeBluetrumTransparencyGain(5).payload, Uint8Array.of(0x05));

  // Key mapping (0x22)
  const keyCmd = encodeBluetrumKeyMapping(KEY_TYPE.LEFT_DOUBLE_TAP, KEY_FUNCTION.ANC_MODE);
  assert.equal(keyCmd.cmd, 0x22);
  assert.deepEqual(keyCmd.payload, Uint8Array.of(0x03, 0x01, 0x09));
  const keyMap = decodeBluetrumKeySettings(
    buildBluetrumTlvStream([
      [KEY_TYPE.LEFT_DOUBLE_TAP, Uint8Array.of(KEY_FUNCTION.ANC_MODE)],
      [KEY_TYPE.RIGHT_LONG_PRESS, Uint8Array.of(KEY_FUNCTION.ASSISTANT)],
    ]),
  );
  assert.equal(keyMap[KEY_TYPE.LEFT_DOUBLE_TAP], KEY_FUNCTION.ANC_MODE);
  assert.equal(keyMap[KEY_TYPE.RIGHT_LONG_PRESS], KEY_FUNCTION.ASSISTANT);

  // Case Key (0x40)
  const caseCmd = encodeBluetrumCaseKey(CASE_KEY_TYPE.ROTATION_PRESS, KEY_FUNCTION.VOLUME_UP, 1);
  assert.equal(caseCmd.cmd, 0x40);
  assert.deepEqual(caseCmd.payload, Uint8Array.of(0x05, 0x02, 0x05, 0x01));
  const caseSettings = decodeBluetrumCaseKeySettings(
    buildBluetrumTlvStream([
      [CASE_KEY_TYPE.SINGLE_TAP, Uint8Array.of(KEY_FUNCTION.PLAY_PAUSE)],
      [CASE_KEY_TYPE.ROTATION_PRESS, Uint8Array.of(KEY_FUNCTION.VOLUME_UP, 0x01)],
    ]),
  );
  assert.equal(caseSettings[CASE_KEY_TYPE.SINGLE_TAP]!.keyFunction, KEY_FUNCTION.PLAY_PAUSE);
  assert.equal(caseSettings[CASE_KEY_TYPE.ROTATION_PRESS]!.keyFunction, KEY_FUNCTION.VOLUME_UP);
  assert.equal(caseSettings[CASE_KEY_TYPE.ROTATION_PRESS]!.callControl, 0x01);

  // Game Mode (0x25), Find Device (0x2A), Dual Connect (0x33), Spatial Audio (0x41), LDAC (0x42)
  assert.deepEqual(encodeBluetrumWorkMode(WORK_MODE.GAMING), {
    cmd: 0x25,
    payload: Uint8Array.of(0x01),
  });
  assert.deepEqual(encodeBluetrumWorkMode(WORK_MODE.NORMAL), {
    cmd: 0x25,
    payload: Uint8Array.of(0x00),
  });
  assert.deepEqual(encodeBluetrumFindDevice(true), {
    cmd: 0x2a,
    payload: Uint8Array.of(0x01),
  });
  assert.deepEqual(encodeBluetrumDualConnect(true), {
    cmd: 0x33,
    payload: Uint8Array.of(0x01, 0x01, 0x01),
  });
  assert.deepEqual(encodeBluetrumDualConnect(false), {
    cmd: 0x33,
    payload: Uint8Array.of(0x01, 0x01, 0x00),
  });
  assert.deepEqual(encodeBluetrumSpatialAudio(true), {
    cmd: 0x41,
    payload: Uint8Array.of(0x01),
  });
  assert.deepEqual(encodeBluetrumLdacMode(true), {
    cmd: 0x42,
    payload: Uint8Array.of(0x01),
  });

  // Remaining Bluetrum control encoders
  assert.deepEqual(
    encodeBluetrumMusicControl(BLUETRUM_MUSIC_CONTROL.VOLUME, 75).payload,
    Uint8Array.of(0x01, 75),
  );
  assert.deepEqual(encodeBluetrumAutoShutdown(0xff).payload, Uint8Array.of(0xff));
  assert.deepEqual(encodeBluetrumInEarDetect(true).payload, Uint8Array.of(0x01));
  assert.deepEqual(encodeBluetrumLanguage(VOICE_LANGUAGE.ENGLISH).payload, Uint8Array.of(0x00));
  assert.deepEqual(encodeBluetrumAutoAnswer(true).payload, Uint8Array.of(0x01));
  assert.deepEqual(encodeBluetrumBluetoothName('XH-68B').payload, Uint8Array.from([88, 72, 45, 54, 56, 66]));
  assert.deepEqual(encodeBluetrumLedSwitch(false).payload, Uint8Array.of(0x00));
  assert.equal(encodeBluetrumClearPairRecord().payload.length, 0);
  assert.deepEqual(encodeBluetrumSoundEffect3d(true).payload, Uint8Array.of(0x01));

  // DevicePower (bit 7 charging + bits 0..6 level)
  const power = decodeBluetrumDevicePower(Uint8Array.of(0x80 | 85, 92, 0x80 | 40));
  assert.deepEqual(power.left, { level: 85, isCharging: true, raw: 0x80 | 85 });
  assert.deepEqual(power.right, { level: 92, isCharging: false, raw: 92 });
  assert.deepEqual(power.case, { level: 40, isCharging: true, raw: 0x80 | 40 });

  // ACK & TLV ACK decoders
  assert.deepEqual(decodeBluetrumResponsePayload(Uint8Array.of(0x00)), { ok: true, statusCode: 0 });
  assert.deepEqual(decodeBluetrumResponsePayload(Uint8Array.of(0x05)), { ok: false, statusCode: 5 });
  const tlvAcks = decodeBluetrumTlvAckPayload(
    buildBluetrumTlvStream([
      [0x01, Uint8Array.of(0x00)],
      [0x02, Uint8Array.of(0x01)],
    ]),
  );
  assert.equal(tlvAcks.get(0x01), true);
  assert.equal(tlvAcks.get(0x02), false);
});

test('3.3 Bluetrum TLV response map decoding across fragmented Notify/DeviceInfo frames', () => {
  const keyTlv = buildBluetrumTlvStream([
    [KEY_TYPE.LEFT_SINGLE_TAP, Uint8Array.of(KEY_FUNCTION.PLAY_PAUSE)],
    [KEY_TYPE.RIGHT_DOUBLE_TAP, Uint8Array.of(KEY_FUNCTION.NEXT)],
  ]);
  const caseKeyTlv = buildBluetrumTlvStream([
    [CASE_KEY_TYPE.DOUBLE_TAP, Uint8Array.of(KEY_FUNCTION.ANC_MODE, 0x00)],
  ]);
  const capBytes = Uint8Array.of(
    BLUETRUM_DEVICE_CAPACITY.TWS |
      BLUETRUM_DEVICE_CAPACITY.SOUND_EFFECT_3D |
      BLUETRUM_DEVICE_CAPACITY.MULTIPOINT |
      BLUETRUM_DEVICE_CAPACITY.ANC,
    0x00,
  );

  const infoPayload = buildBluetrumTlvStream([
    [BLUETRUM_INFO_TAG.DEVICE_POWER, Uint8Array.of(0x80 | 90, 88, 65)],
    [BLUETRUM_INFO_TAG.FIRMWARE_VERSION, Uint8Array.of(0x04, 0x03, 0x02, 0x01)],
    [BLUETRUM_INFO_TAG.BLUETOOTH_NAME, new TextEncoder().encode('Ultima XH-68B')],
    [BLUETRUM_INFO_TAG.EQ_SETTING, Uint8Array.of(10, 0x21, 1, 2, 3, 0, 0xff, 0xfe, 4, 5, 0, 2)],
    [BLUETRUM_INFO_TAG.KEY_SETTINGS, keyTlv],
    [BLUETRUM_INFO_TAG.DEVICE_VOLUME, Uint8Array.of(12)],
    [BLUETRUM_INFO_TAG.PLAY_STATE, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.WORK_MODE, Uint8Array.of(WORK_MODE.GAMING)],
    [BLUETRUM_INFO_TAG.IN_EAR_STATUS, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.LANGUAGE_SETTING, Uint8Array.of(VOICE_LANGUAGE.ENGLISH)],
    [BLUETRUM_INFO_TAG.AUTO_ANSWER, Uint8Array.of(0)],
    [BLUETRUM_INFO_TAG.ANC_MODE, Uint8Array.of(ANC_MODE.ANC)],
    [BLUETRUM_INFO_TAG.IS_TWS, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.TWS_CONNECTED, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.LED_SWITCH, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.FW_CHECKSUM, Uint8Array.of(0xef, 0xcd, 0xab, 0x89)],
    [BLUETRUM_INFO_TAG.ANC_GAIN, Uint8Array.of(0xfd)], // -3
    [BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN, Uint8Array.of(4)],
    [BLUETRUM_INFO_TAG.SOUND_EFFECT_3D, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.ONE_DRAG_TWO_SWITCH, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.CASE_KEY, caseKeyTlv],
    [BLUETRUM_INFO_TAG.DEVICE_CAPABILITIES, capBytes],
    [BLUETRUM_INFO_TAG.SPACE, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.LDAC, Uint8Array.of(1)],
    [BLUETRUM_INFO_TAG.MAX_PACKET_SIZE, Uint8Array.of(0x00, 0x01)], // 256 LE
  ]);

  const txFrames = encodeBluetrumFrame({
    seq: 2,
    cmd: BLUETRUM_CMD.DEVICE_INFO,
    cmdType: BLUETRUM_CMD_TYPE.RESPONSE,
    payload: infoPayload,
    maxPayloadSize: 15,
  });
  assert.ok(txFrames.length > 5);

  const reassembler = new BluetrumFrameReassembler();
  let reassembled = null;
  for (const frame of txFrames) {
    reassembled = reassembler.push(frame);
  }
  assert.ok(reassembled);
  assert.equal(reassembled.cmd, BLUETRUM_CMD.DEVICE_INFO);
  assert.equal(reassembled.cmdType, BLUETRUM_CMD_TYPE.RESPONSE);

  const rawMap = decodeBluetrumTlvMap(reassembled.payload);
  assert.equal(rawMap.size, 25);

  const snapshot = decodeBluetrumDeviceInfo(reassembled.payload);
  assert.equal(snapshot.power?.left?.level, 90);
  assert.equal(snapshot.power?.left?.isCharging, true);
  assert.equal(snapshot.power?.right?.level, 88);
  assert.equal(snapshot.power?.case?.level, 65);
  assert.equal(snapshot.firmwareVersion, 0x01020304);
  assert.equal(snapshot.bluetoothName, 'Ultima XH-68B');
  assert.equal(snapshot.eqSetting?.mode, 0x21);
  assert.deepEqual(snapshot.eqSetting?.gains, [1, 2, 3, 0, -1, -2, 4, 5, 0, 2]);
  assert.equal(snapshot.keySettings?.[KEY_TYPE.LEFT_SINGLE_TAP], KEY_FUNCTION.PLAY_PAUSE);
  assert.equal(snapshot.deviceVolume, 12);
  assert.equal(snapshot.playState, true);
  assert.equal(snapshot.workMode, WORK_MODE.GAMING);
  assert.equal(snapshot.inEarDetect, true);
  assert.equal(snapshot.ancMode, ANC_MODE.ANC);
  assert.equal(snapshot.fwChecksum, '89abcdef');
  assert.equal(snapshot.ancGain, -3);
  assert.equal(snapshot.transparencyGain, 4);
  assert.equal(snapshot.soundEffect3d, true);
  assert.equal(snapshot.dualConnect, true);
  assert.equal(snapshot.caseKeySettings?.[CASE_KEY_TYPE.DOUBLE_TAP]?.keyFunction, KEY_FUNCTION.ANC_MODE);
  assert.deepEqual(decodeBluetrumDeviceCapacities(capBytes), {
    raw: 0x0f,
    tws: true,
    soundEffect3d: true,
    multipoint: true,
    anc: true,
  });
  assert.equal(snapshot.spatialAudio, true);
  assert.equal(snapshot.ldacMode, true);
  assert.equal(snapshot.maxPacketSize, 256);
});
