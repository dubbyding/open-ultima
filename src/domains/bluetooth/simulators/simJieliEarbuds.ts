import {
  ANC_MODE as PROTOCOL_ANC_MODE,
  EQ_PRESETS,
  JIELI_ATTR_AND_FUN,
  JIELI_OPCODE,
  getFactoryPresetsForProduct,
} from '../../../protocols/ultimaLinkConstants.ts';
import type { ProductSpec } from '../../../protocols/ultimaLinkConstants.ts';
import {
  JIELI_ULTIMA_EQ_TAG,
  JIELI_ULTIMA_EQ_VALUE,
  crc16Jieli,
  packJieliLtv,
  packJieliRcspPacket,
  parseJieliCustomData,
  parseJieliLtvEntries,
  parseJieliRcspPacket,
} from '../../../protocols/ultimaLinkJieli.ts';
import type {
  JieliKeySetting,
  JieliRcspPacket,
} from '../../../protocols/ultimaLinkJieli.ts';
import { EQ_BAND_COUNT, VOICE_LANGUAGE } from '../../../storage/offlineStore.ts';
import type {
  EarbudGesture,
  EarbudPrefs,
} from '../../../storage/offlineStore.ts';
import {
  ANC_STORE_TO_PROTOCOL,
  JIELI_ACTION_BY_GESTURE,
  normalizeEqGains,
} from '../controllers/earbudsController.ts';
import {
  concatBytes,
  decodeUtf8,
  encodeUtf8,
  toSignedInt8Byte,
} from '../controllers/liveBleAdapter.ts';

/** Deterministic Jieli RCSP GATT responder emitting authentic binary RX frames. */
export class SimJieliEarbuds {
  private readonly product: ProductSpec;
  private deviceName: string;
  private ancMode: number;
  private workMode: number; // Jieli ADV work mode: 1=NORMAL, 2=GAME
  private inEarDetect = false;
  private ledOn = true;
  private language: string = VOICE_LANGUAGE.EN;
  private ultimaEqValue: number = JIELI_ULTIMA_EQ_VALUE.SIGNATURE_SOUND;
  private customEqMode = 0;
  private eqGains: number[];
  private keySettings: JieliKeySetting[] = [
    { keyNum: 1, action: 1, fn: 0x07 },
    { keyNum: 2, action: 1, fn: 0x07 },
    { keyNum: 1, action: 2, fn: 0x03 },
    { keyNum: 2, action: 2, fn: 0x04 },
    { keyNum: 1, action: 3, fn: 0x02 },
    { keyNum: 2, action: 3, fn: 0x08 },
    { keyNum: 1, action: 4, fn: 0x09 },
    { keyNum: 2, action: 4, fn: 0x09 },
  ];

  constructor(product: ProductSpec, initialPrefs?: EarbudPrefs) {
    this.product = product;
    this.deviceName = initialPrefs?.customBtName ?? product.name;
    this.ancMode = initialPrefs
      ? ANC_STORE_TO_PROTOCOL[initialPrefs.ancMode]
      : product.supportsAnc
        ? PROTOCOL_ANC_MODE.ANC
        : PROTOCOL_ANC_MODE.OFF;
    this.workMode = initialPrefs?.gameMode ? 2 : 1;
    this.inEarDetect = initialPrefs?.inEarDetect ?? false;
    this.ledOn = initialPrefs?.ledOn ?? true;
    this.language = initialPrefs?.voiceLanguage ?? VOICE_LANGUAGE.EN;
    const factory = getFactoryPresetsForProduct(product.id);
    this.eqGains = product.supportsSignatureBalanceEq
      ? [...factory.signatureSound]
      : [...EQ_PRESETS.FLAT];

    if (initialPrefs) {
      for (const [sideIndex, side] of (['left', 'right'] as const).entries()) {
        const keyNum = sideIndex + 1;
        for (const [gesture, fn] of Object.entries(initialPrefs.keyMappings[side])) {
          if (fn !== undefined) {
            const action = JIELI_ACTION_BY_GESTURE[gesture as EarbudGesture];
            if (action !== undefined) this.upsertKey({ keyNum, action, fn });
          }
        }
      }
    }
  }

  private upsertKey(next: JieliKeySetting): void {
    const idx = this.keySettings.findIndex((k) => k.keyNum === next.keyNum && k.action === next.action);
    if (idx >= 0) this.keySettings[idx] = next;
    else this.keySettings.push(next);
  }

  receivePacket(raw: Uint8Array): Uint8Array[] {
    const pkt = parseJieliRcspPacket(raw);
    if (!pkt || !pkt.isCommand) {
      if (raw.length >= 2) {
        return [
          packJieliRcspPacket({
            isCommand: false,
            wantsResponse: false,
            opCode: raw[1]!,
            opCodeSn: raw[0]!,
            status: 0,
            paramData: Uint8Array.of(0x00),
          }),
        ];
      }
      return [];
    }
    return this.handleCommand(pkt);
  }

  private handleCommand(pkt: JieliRcspPacket): Uint8Array[] {
    const respond = (paramData: Uint8Array, status = 0): Uint8Array[] => [
      packJieliRcspPacket({
        isCommand: false,
        wantsResponse: false,
        opCode: pkt.opCode,
        opCodeSn: pkt.opCodeSn,
        status,
        paramData,
      }),
    ];

    switch (pkt.opCode) {
      case JIELI_OPCODE.ADV_GET_INFO:
        return respond(this.buildAdvInfoPayload());

      case JIELI_OPCODE.ADV_SETTINGS: {
        for (const entry of parseJieliLtvEntries(pkt.paramData)) {
          switch (entry.type) {
            case JIELI_ATTR_AND_FUN.ADV_TYPE_DEVICE_NAME: {
              const name = decodeUtf8(entry.value).trim();
              if (name.length > 0) this.deviceName = name;
              break;
            }
            case JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST:
              this.ancMode = entry.value[0] ?? PROTOCOL_ANC_MODE.OFF;
              break;
            case JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE:
              this.workMode = entry.value[0] ?? 1;
              break;
            case JIELI_ATTR_AND_FUN.ADV_TYPE_IN_EAR_CHECK:
              this.inEarDetect = (entry.value[0] ?? 0) !== 0;
              break;
            case JIELI_ATTR_AND_FUN.ADV_TYPE_LED_SETTINGS:
              if (entry.value.length >= 2) this.ledOn = entry.value[1]! !== 0;
              break;
            case JIELI_ATTR_AND_FUN.ADV_TYPE_LANGUAGE:
              if (entry.value.length === 1 && entry.value[0]! <= 1) {
                this.language = entry.value[0]! === 1 ? VOICE_LANGUAGE.ZH : VOICE_LANGUAGE.EN;
              } else {
                this.language = decodeUtf8(entry.value).toLowerCase().startsWith('zh')
                  ? VOICE_LANGUAGE.ZH
                  : VOICE_LANGUAGE.EN;
              }
              break;
            case JIELI_ATTR_AND_FUN.ADV_TYPE_KEY_SETTINGS:
              for (let i = 0; i + 2 < entry.value.length; i += 3) {
                this.upsertKey({ keyNum: entry.value[i]!, action: entry.value[i + 1]!, fn: entry.value[i + 2]! });
              }
              break;
            default:
              break;
          }
        }
        return respond(this.buildAdvInfoPayload());
      }

      case JIELI_OPCODE.EXTRA_CUSTOM: {
        const custom = parseJieliCustomData(pkt.paramData);
        if (custom?.kind === 'eq_query') return respond(Uint8Array.of(JIELI_ULTIMA_EQ_TAG, this.ultimaEqValue));
        if (custom?.kind === 'eq_preset') {
          this.ultimaEqValue = custom.eqValue;
          const factory = getFactoryPresetsForProduct(this.product.id);
          this.eqGains = custom.preset === 'balance' ? [...factory.balanceSound] : [...factory.signatureSound];
          return respond(Uint8Array.of(JIELI_ULTIMA_EQ_TAG, this.ultimaEqValue));
        }
        if (pkt.paramData[0] === 0xff) {
          this.deviceName = this.product.name;
          this.ancMode = PROTOCOL_ANC_MODE.OFF;
          this.workMode = 1;
          this.inEarDetect = false;
          this.ledOn = true;
          this.language = VOICE_LANGUAGE.EN;
          this.customEqMode = 0;
          this.eqGains = [...EQ_PRESETS.FLAT];
          return respond(Uint8Array.of(0xff, 0x00));
        }
        return respond(new Uint8Array(pkt.paramData));
      }

      case JIELI_OPCODE.GET_SYS_INFO: {
        const attrData = this.encodeEqAttrBytes();
        return respond(
          concatBytes([
            Uint8Array.of(JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_PUBLIC),
            packJieliLtv(JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ, attrData),
            crc16Jieli(attrData),
          ]),
        );
      }

      case JIELI_OPCODE.SET_SYS_INFO: {
        const fnType = pkt.paramData[0] ?? JIELI_ATTR_AND_FUN.SYS_INFO_FUNCTION_PUBLIC;
        for (const attr of parseJieliLtvEntries(pkt.paramData.subarray(1))) {
          if (attr.type === JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ && attr.value.length >= 2) {
            const rawMode = attr.value[0]!;
            this.customEqMode = rawMode & 0x7f;
            const gainsStart = (rawMode & 0x80) !== 0 ? 2 : 1;
            const gains: number[] = [];
            for (let i = gainsStart; i < attr.value.length; i++) {
              gains.push(((attr.value[i]! & 0xff) << 24) >> 24);
            }
            this.eqGains = normalizeEqGains(gains);
            return respond(
              concatBytes([
                Uint8Array.of(fnType),
                packJieliLtv(JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ, attr.value),
                crc16Jieli(attr.value),
              ]),
            );
          }
        }
        return respond(Uint8Array.of(fnType, 0x00));
      }

      case JIELI_OPCODE.SEARCH_DEVICE:
        return respond(new Uint8Array(pkt.paramData));

      default:
        return respond(new Uint8Array(0));
    }
  }

  private encodeEqAttrBytes(): Uint8Array {
    const out = new Uint8Array(1 + EQ_BAND_COUNT);
    out[0] = this.customEqMode & 0xff;
    for (let i = 0; i < EQ_BAND_COUNT; i++) out[1 + i] = toSignedInt8Byte(this.eqGains[i] ?? 0);
    return out;
  }

  private buildAdvInfoPayload(): Uint8Array {
    const keyBytes = new Uint8Array(this.keySettings.length * 3);
    for (let i = 0; i < this.keySettings.length; i++) {
      const k = this.keySettings[i]!;
      keyBytes[i * 3] = k.keyNum & 0xff;
      keyBytes[i * 3 + 1] = k.action & 0xff;
      keyBytes[i * 3 + 2] = k.fn & 0xff;
    }

    return concatBytes([
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_BATTERY_QUANTITY, Uint8Array.of(90, 91, 80)),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_DEVICE_NAME, encodeUtf8(this.deviceName)),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_KEY_SETTINGS, keyBytes),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_LED_SETTINGS, Uint8Array.of(1, this.ledOn ? 1 : 0)),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE, Uint8Array.of(this.workMode)),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_IN_EAR_CHECK, Uint8Array.of(this.inEarDetect ? 1 : 0)),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_LANGUAGE, encodeUtf8(this.language)),
      packJieliLtv(JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST, Uint8Array.of(this.ancMode)),
    ]);
  }
}
