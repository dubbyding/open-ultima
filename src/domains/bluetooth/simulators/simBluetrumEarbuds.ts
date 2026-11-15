import {
  ANC_MODE as PROTOCOL_ANC_MODE,
  BLUETRUM_CMD,
  BLUETRUM_CMD_TYPE,
  BLUETRUM_DEVICE_CAPACITY,
  BLUETRUM_INFO_TAG,
  CASE_KEY_TYPE,
  EQ_PRESETS,
  KEY_TYPE,
  VOICE_LANGUAGE as PROTOCOL_VOICE_LANGUAGE,
  WORK_MODE,
} from '../../../protocols/ultimaLinkConstants.ts';
import type { ProductSpec } from '../../../protocols/ultimaLinkConstants.ts';
import {
  BluetrumFrameReassembler,
  encodeBluetrumFrame,
} from '../../../protocols/ultimaLinkBluetrum.ts';
import type { BluetrumDecodedFrame } from '../../../protocols/ultimaLinkBluetrum.ts';
import { VOICE_LANGUAGE } from '../../../storage/offlineStore.ts';
import type {
  CaseGesture,
  EarbudGesture,
  EarbudPrefs,
} from '../../../storage/offlineStore.ts';
import {
  ANC_STORE_TO_PROTOCOL,
  BLUETRUM_CASE_KEY_TYPE_MAP,
  BLUETRUM_KEY_TYPE_MAP,
  normalizeEqGains,
} from '../controllers/earbudsController.ts';
import {
  concatBytes,
  decodeUtf8,
  encodeUtf8,
  toSignedInt8Byte,
} from '../controllers/liveBleAdapter.ts';

function buildUint16LE(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function packBluetrumTlv(tag: number, value: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + value.length);
  out[0] = tag & 0xff;
  out[1] = value.length & 0xff;
  out.set(value, 2);
  return out;
}

/** Deterministic Bluetrum ABMate GATT responder emitting authentic binary RX frames. */
export class SimBluetrumEarbuds {
  private readonly reassembler = new BluetrumFrameReassembler();
  private readonly product: ProductSpec;
  private bluetoothName: string;
  private ancMode: number;
  private ancGain: number;
  private transparencyGain: number;
  private eqMode = 0;
  private eqGains: number[] = [...EQ_PRESETS.FLAT];
  private workMode: number = WORK_MODE.NORMAL;
  private inEarDetect = false;
  private dualConnect = false;
  private ledOn = true;
  private spatialAudio = false;
  private soundEffect3d = false;
  private ldac = false;
  private language: number = PROTOCOL_VOICE_LANGUAGE.ENGLISH;
  private volume = 65;
  private playing = true;
  private finding = false;
  private readonly leftPower = 88;
  private readonly rightPower = 92;
  private readonly casePower = 75 | 0x80; // charging
  private keyMap = new Map<number, number>([
    [KEY_TYPE.LEFT_SINGLE_TAP, 0x07],
    [KEY_TYPE.RIGHT_SINGLE_TAP, 0x07],
    [KEY_TYPE.LEFT_DOUBLE_TAP, 0x03],
    [KEY_TYPE.RIGHT_DOUBLE_TAP, 0x04],
    [KEY_TYPE.LEFT_TRIPLE_TAP, 0x02],
    [KEY_TYPE.RIGHT_TRIPLE_TAP, 0x08],
    [KEY_TYPE.LEFT_LONG_PRESS, 0x09],
    [KEY_TYPE.RIGHT_LONG_PRESS, 0x09],
  ]);
  private caseKeyMap = new Map<number, { fn: number; call: number }>([
    [CASE_KEY_TYPE.SINGLE_TAP, { fn: 0x07, call: 0x00 }],
    [CASE_KEY_TYPE.DOUBLE_TAP, { fn: 0x04, call: 0x00 }],
    [CASE_KEY_TYPE.TRIPLE_TAP, { fn: 0x03, call: 0x00 }],
    [CASE_KEY_TYPE.LONG_PRESS, { fn: 0x09, call: 0x00 }],
    [CASE_KEY_TYPE.ROTATION_PRESS, { fn: 0x05, call: 0x00 }],
  ]);

  constructor(product: ProductSpec, initialPrefs?: EarbudPrefs) {
    this.product = product;
    this.bluetoothName = initialPrefs?.customBtName ?? product.name;
    this.ancMode = initialPrefs
      ? ANC_STORE_TO_PROTOCOL[initialPrefs.ancMode]
      : product.supportsAnc
        ? PROTOCOL_ANC_MODE.ANC
        : PROTOCOL_ANC_MODE.OFF;
    this.ancGain = initialPrefs?.ancGain ?? (product.supportsAnc ? 6 : 0);
    this.transparencyGain = initialPrefs?.transparencyGain ?? (product.supportsAnc ? 5 : 0);
    if (!initialPrefs) return;

    this.workMode = initialPrefs.gameMode ? WORK_MODE.GAMING : WORK_MODE.NORMAL;
    this.spatialAudio = initialPrefs.spatialAudio;
    this.ldac = initialPrefs.ldac;
    this.inEarDetect = initialPrefs.inEarDetect;
    this.dualConnect = initialPrefs.dualConnect;
    this.ledOn = initialPrefs.ledOn;
    this.language =
      initialPrefs.voiceLanguage === VOICE_LANGUAGE.ZH
        ? PROTOCOL_VOICE_LANGUAGE.CHINESE
        : PROTOCOL_VOICE_LANGUAGE.ENGLISH;

    for (const side of ['left', 'right'] as const) {
      for (const [gesture, fn] of Object.entries(initialPrefs.keyMappings[side])) {
        if (fn !== undefined) {
          const keyType = BLUETRUM_KEY_TYPE_MAP[side][gesture as EarbudGesture];
          if (keyType !== undefined) this.keyMap.set(keyType, fn);
        }
      }
    }
    for (const [gesture, action] of Object.entries(initialPrefs.keyMappings.caseKeys)) {
      if (action) {
        const caseKeyType = BLUETRUM_CASE_KEY_TYPE_MAP[gesture as CaseGesture];
        if (caseKeyType !== undefined) {
          this.caseKeyMap.set(caseKeyType, { fn: action.keyFunction, call: action.callControl });
        }
      }
    }
  }

  receivePacket(packet: Uint8Array): Uint8Array[] {
    const frame = this.reassembler.push(packet);
    if (!frame) {
      if (packet.length >= 2) {
        const fragByte = packet[3] ?? 0;
        const fragTotal = ((fragByte >> 4) & 0x0f) + 1;
        const fragIdx = fragByte & 0x0f;
        const fragLen = packet[4] ?? 0;
        const isMultiFrag = packet.length >= 5 + fragLen && fragIdx < fragTotal && fragTotal > 1;
        if (!isMultiFrag) {
          return encodeBluetrumFrame({
            seq: packet[0]! & 0x0f,
            cmd: packet[1]!,
            cmdType: BLUETRUM_CMD_TYPE.RESPONSE,
            payload: Uint8Array.of(0x00),
          });
        }
      }
      return [];
    }
    return this.handleFrame(frame);
  }

  private handleFrame(frame: BluetrumDecodedFrame): Uint8Array[] {
    const { cmd, seq, payload } = frame;
    const ack = (status = 0x00): Uint8Array[] =>
      encodeBluetrumFrame({ seq, cmd, cmdType: BLUETRUM_CMD_TYPE.RESPONSE, payload: Uint8Array.of(status) });

    const notify = (tlvs: Uint8Array[]): Uint8Array[] =>
      encodeBluetrumFrame({ seq: (seq + 1) & 0x0f, cmd: BLUETRUM_CMD.NOTIFY, cmdType: BLUETRUM_CMD_TYPE.NOTIFY, payload: concatBytes(tlvs) });

    const ackNotify = (tag: number, value: Uint8Array): Uint8Array[] => [
      ...ack(),
      ...notify([packBluetrumTlv(tag, value)]),
    ];

    switch (cmd) {
      case BLUETRUM_CMD.DEVICE_INFO: {
        const requested = new Set<number>();
        for (let i = 0; i + 1 < payload.length; i += 2) requested.add(payload[i]!);
        return encodeBluetrumFrame({
          seq,
          cmd: BLUETRUM_CMD.DEVICE_INFO,
          cmdType: BLUETRUM_CMD_TYPE.RESPONSE,
          payload: this.buildDeviceInfoTlv(requested),
        });
      }
      case BLUETRUM_CMD.ANC_MODE:
        this.ancMode = payload[0] ?? PROTOCOL_ANC_MODE.OFF;
        return ackNotify(BLUETRUM_INFO_TAG.ANC_MODE, Uint8Array.of(this.ancMode));
      case BLUETRUM_CMD.ANC_GAIN:
        this.ancGain = ((payload[0] ?? 0) << 24) >> 24;
        return ackNotify(BLUETRUM_INFO_TAG.ANC_GAIN, Uint8Array.of(toSignedInt8Byte(this.ancGain)));
      case BLUETRUM_CMD.TRANSPARENCY_GAIN:
        this.transparencyGain = ((payload[0] ?? 0) << 24) >> 24;
        return ackNotify(BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN, Uint8Array.of(toSignedInt8Byte(this.transparencyGain)));
      case BLUETRUM_CMD.EQ: {
        if (payload.length >= 2) {
          const bandCount = payload[0]!;
          this.eqMode = payload[1]!;
          const gains: number[] = [];
          for (let i = 0; i < bandCount && 2 + i < payload.length; i++) {
            gains.push(((payload[2 + i]! & 0xff) << 24) >> 24);
          }
          this.eqGains = normalizeEqGains(gains);
        }
        return ackNotify(BLUETRUM_INFO_TAG.EQ_SETTING, this.encodeEqTagValue());
      }
      case BLUETRUM_CMD.WORK_MODE:
        this.workMode = payload[0] ?? WORK_MODE.NORMAL;
        return ackNotify(BLUETRUM_INFO_TAG.WORK_MODE, Uint8Array.of(this.workMode));
      case BLUETRUM_CMD.SPATIAL_AUDIO:
        this.spatialAudio = (payload[0] ?? 0) !== 0;
        return ackNotify(BLUETRUM_INFO_TAG.SPACE, Uint8Array.of(this.spatialAudio ? 1 : 0));
      case BLUETRUM_CMD.SOUND_EFFECT_3D:
        this.soundEffect3d = (payload[0] ?? 0) !== 0;
        return ackNotify(BLUETRUM_INFO_TAG.SOUND_EFFECT_3D, Uint8Array.of(this.soundEffect3d ? 1 : 0));
      case BLUETRUM_CMD.LDAC_MODE:
        this.ldac = (payload[0] ?? 0) !== 0;
        return ackNotify(BLUETRUM_INFO_TAG.LDAC, Uint8Array.of(this.ldac ? 1 : 0));
      case BLUETRUM_CMD.IN_EAR_DETECT:
        this.inEarDetect = (payload[0] ?? 0) !== 0;
        return ackNotify(BLUETRUM_INFO_TAG.IN_EAR_STATUS, Uint8Array.of(this.inEarDetect ? 1 : 0));
      case BLUETRUM_CMD.ONE_DRAG_TWO:
        this.dualConnect = (payload[2] ?? payload[0] ?? 0) !== 0;
        return ackNotify(BLUETRUM_INFO_TAG.ONE_DRAG_TWO_SWITCH, Uint8Array.of(this.dualConnect ? 1 : 0));
      case BLUETRUM_CMD.LED_SWITCH:
        this.ledOn = (payload[0] ?? 0) !== 0;
        return ackNotify(BLUETRUM_INFO_TAG.LED_SWITCH, Uint8Array.of(this.ledOn ? 1 : 0));
      case BLUETRUM_CMD.LANGUAGE:
        this.language = payload[0] ?? PROTOCOL_VOICE_LANGUAGE.ENGLISH;
        return ackNotify(BLUETRUM_INFO_TAG.LANGUAGE_SETTING, Uint8Array.of(this.language));
      case BLUETRUM_CMD.KEY:
        if (payload.length >= 3) this.keyMap.set(payload[0]!, payload[2]!);
        return ackNotify(BLUETRUM_INFO_TAG.KEY_SETTINGS, this.encodeKeySettingsTagValue());
      case BLUETRUM_CMD.CASE_KEY:
        if (payload.length >= 4) this.caseKeyMap.set(payload[0]!, { fn: payload[2]!, call: payload[3]! });
        return ackNotify(BLUETRUM_INFO_TAG.CASE_KEY, this.encodeCaseKeyTagValue());
      case BLUETRUM_CMD.BLUETOOTH_NAME: {
        const nextName = decodeUtf8(payload).trim();
        if (nextName.length > 0) this.bluetoothName = nextName;
        return ackNotify(BLUETRUM_INFO_TAG.BLUETOOTH_NAME, encodeUtf8(this.bluetoothName));
      }
      case BLUETRUM_CMD.FIND_DEVICE:
        this.finding = (payload[0] ?? 0) !== 0;
        return ack();
      case BLUETRUM_CMD.FACTORY_RESET:
        this.resetDefaults();
        return [...ack(), ...notify(this.buildResetNotifyTlvs())];
      default:
        return ack();
    }
  }

  private resetDefaults(): void {
    this.bluetoothName = this.product.name;
    this.ancMode = PROTOCOL_ANC_MODE.OFF;
    this.ancGain = 0;
    this.transparencyGain = 0;
    this.eqMode = 0;
    this.eqGains = [...EQ_PRESETS.FLAT];
    this.workMode = WORK_MODE.NORMAL;
    this.inEarDetect = false;
    this.dualConnect = false;
    this.ledOn = true;
    this.spatialAudio = false;
    this.soundEffect3d = false;
    this.ldac = false;
    this.language = PROTOCOL_VOICE_LANGUAGE.ENGLISH;
    this.finding = false;
    this.keyMap.clear();
    this.caseKeyMap.clear();
  }

  private encodeEqTagValue(): Uint8Array {
    const out = new Uint8Array(2 + this.eqGains.length);
    out[0] = this.eqGains.length;
    out[1] = this.eqMode & 0xff;
    for (let i = 0; i < this.eqGains.length; i++) out[2 + i] = toSignedInt8Byte(this.eqGains[i]!);
    return out;
  }

  private encodeKeySettingsTagValue(): Uint8Array {
    const entries: Uint8Array[] = [];
    for (const [keyType, fn] of this.keyMap.entries()) entries.push(Uint8Array.of(keyType & 0xff, 0x01, fn & 0xff));
    return concatBytes(entries);
  }

  private encodeCaseKeyTagValue(): Uint8Array {
    const entries: Uint8Array[] = [];
    for (const [caseKeyType, action] of this.caseKeyMap.entries()) {
      entries.push(Uint8Array.of(caseKeyType & 0xff, 0x02, action.fn & 0xff, action.call & 0xff));
    }
    return concatBytes(entries);
  }

  private buildResetNotifyTlvs(): Uint8Array[] {
    return [
      packBluetrumTlv(BLUETRUM_INFO_TAG.BLUETOOTH_NAME, encodeUtf8(this.bluetoothName)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.EQ_SETTING, this.encodeEqTagValue()),
      packBluetrumTlv(BLUETRUM_INFO_TAG.KEY_SETTINGS, this.encodeKeySettingsTagValue()),
      packBluetrumTlv(BLUETRUM_INFO_TAG.WORK_MODE, Uint8Array.of(this.workMode)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.IN_EAR_STATUS, Uint8Array.of(0)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.LANGUAGE_SETTING, Uint8Array.of(this.language)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.ANC_MODE, Uint8Array.of(this.ancMode)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.LED_SWITCH, Uint8Array.of(1)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.ANC_GAIN, Uint8Array.of(0)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN, Uint8Array.of(0)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.ONE_DRAG_TWO_SWITCH, Uint8Array.of(0)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.CASE_KEY, this.encodeCaseKeyTagValue()),
      packBluetrumTlv(BLUETRUM_INFO_TAG.SPACE, Uint8Array.of(0)),
      packBluetrumTlv(BLUETRUM_INFO_TAG.LDAC, Uint8Array.of(0)),
    ];
  }

  private buildDeviceInfoTlv(requested: Set<number>): Uint8Array {
    const includeAll = requested.size === 0;
    const tlvs: Uint8Array[] = [];
    const push = (tag: number, buildValue: () => Uint8Array): void => {
      if (includeAll || requested.has(tag)) tlvs.push(packBluetrumTlv(tag, buildValue()));
    };

    let cap = BLUETRUM_DEVICE_CAPACITY.TWS;
    if (this.product.supportsAnc) cap |= BLUETRUM_DEVICE_CAPACITY.ANC;
    if (this.product.supportsDualConnect) cap |= BLUETRUM_DEVICE_CAPACITY.MULTIPOINT;
    if (this.product.supportsSpatialAudio) cap |= BLUETRUM_DEVICE_CAPACITY.SOUND_EFFECT_3D;

    push(BLUETRUM_INFO_TAG.DEVICE_POWER, () => Uint8Array.of(this.leftPower, this.rightPower, this.casePower));
    push(BLUETRUM_INFO_TAG.FIRMWARE_VERSION, () => Uint8Array.of(24, 0, 1, 0));
    push(BLUETRUM_INFO_TAG.BLUETOOTH_NAME, () => encodeUtf8(this.bluetoothName));
    push(BLUETRUM_INFO_TAG.EQ_SETTING, () => this.encodeEqTagValue());
    push(BLUETRUM_INFO_TAG.KEY_SETTINGS, () => this.encodeKeySettingsTagValue());
    push(BLUETRUM_INFO_TAG.DEVICE_VOLUME, () => Uint8Array.of(this.volume));
    push(BLUETRUM_INFO_TAG.PLAY_STATE, () => Uint8Array.of(this.playing ? 1 : 0));
    push(BLUETRUM_INFO_TAG.WORK_MODE, () => Uint8Array.of(this.workMode));
    push(BLUETRUM_INFO_TAG.IN_EAR_STATUS, () => Uint8Array.of(this.inEarDetect ? 1 : 0));
    push(BLUETRUM_INFO_TAG.LANGUAGE_SETTING, () => Uint8Array.of(this.language));
    push(BLUETRUM_INFO_TAG.ANC_MODE, () => Uint8Array.of(this.ancMode));
    push(BLUETRUM_INFO_TAG.IS_TWS, () => Uint8Array.of(1));
    push(BLUETRUM_INFO_TAG.TWS_CONNECTED, () => Uint8Array.of(1));
    push(BLUETRUM_INFO_TAG.LED_SWITCH, () => Uint8Array.of(this.ledOn ? 1 : 0));
    push(BLUETRUM_INFO_TAG.ANC_GAIN, () => Uint8Array.of(toSignedInt8Byte(this.ancGain)));
    push(BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN, () => Uint8Array.of(toSignedInt8Byte(this.transparencyGain)));
    push(BLUETRUM_INFO_TAG.ANC_GAIN_NUM, () => Uint8Array.of(10));
    push(BLUETRUM_INFO_TAG.TRANSPARENCY_GAIN_NUM, () => Uint8Array.of(10));
    push(BLUETRUM_INFO_TAG.SOUND_EFFECT_3D, () => Uint8Array.of(this.soundEffect3d ? 1 : 0));
    push(BLUETRUM_INFO_TAG.ONE_DRAG_TWO_SWITCH, () => Uint8Array.of(this.dualConnect ? 1 : 0));
    if (this.product.supportsCaseKeys) push(BLUETRUM_INFO_TAG.CASE_KEY, () => this.encodeCaseKeyTagValue());
    push(BLUETRUM_INFO_TAG.SPACE, () => Uint8Array.of(this.spatialAudio ? 1 : 0));
    push(BLUETRUM_INFO_TAG.LDAC, () => Uint8Array.of(this.ldac ? 1 : 0));
    push(BLUETRUM_INFO_TAG.DEVICE_CAPABILITIES, () => buildUint16LE(cap));
    push(BLUETRUM_INFO_TAG.MAX_PACKET_SIZE, () => buildUint16LE(128));
    return concatBytes(tlvs);
  }
}
