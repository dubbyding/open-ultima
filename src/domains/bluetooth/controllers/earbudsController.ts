import {
  ANC_MODE as PROTOCOL_ANC_MODE, BLUETRUM_CMD, CASE_KEY_TYPE, DEVICE_CHIP, EQ_PRESETS,
  JIELI_ATTR_AND_FUN, JIELI_OPCODE, KEY_TYPE, VOICE_LANGUAGE as PROTOCOL_VOICE_LANGUAGE,
  WORK_MODE, getFactoryPresetsForProduct,
} from '../../../protocols/ultimaLinkConstants.ts';
import type { CaseKeyType, DeviceChip, KeyType } from '../../../protocols/ultimaLinkConstants.ts';
import { bytesToHex } from '../../../protocols/ultimaLinkAdvParser.ts';
import {
  BluetrumFrameReassembler, decodeBluetrumDeviceInfo, decodeBluetrumResponsePayload,
  encodeBluetrumAncGain, encodeBluetrumAncMode, encodeBluetrumBluetoothName, encodeBluetrumCaseKey,
  encodeBluetrumCommand, encodeBluetrumDeviceInfoRequest, encodeBluetrumDualConnect,
  encodeBluetrumEq, encodeBluetrumFactoryReset, encodeBluetrumFindDevice, encodeBluetrumInEarDetect,
  encodeBluetrumKeyMapping, encodeBluetrumLanguage, encodeBluetrumLdacMode, encodeBluetrumLedSwitch,
  encodeBluetrumSpatialAudio, encodeBluetrumTransparencyGain, encodeBluetrumWorkMode,
} from '../../../protocols/ultimaLinkBluetrum.ts';
import type { BluetrumCommandPayload, BluetrumDeviceInfoSnapshot } from '../../../protocols/ultimaLinkBluetrum.ts';
import {
  JIELI_ULTIMA_EQ_VALUE, crc16Jieli, encodeJieliAncMode, encodeJieliCustomCmd, encodeJieliCustomEq,
  encodeJieliDeviceName, encodeJieliGetAdvInfo, encodeJieliGetSysInfo, encodeJieliInEarDetect,
  encodeJieliKeySettings, encodeJieliLanguage, encodeJieliLedSettings, encodeJieliSearchDev,
  encodeJieliUltimaEqPreset, encodeJieliUltimaEqQuery, encodeJieliWorkMode,
  parseJieliCustomData, parseJieliLtvEntries, parseJieliRcspPacket,
} from '../../../protocols/ultimaLinkJieli.ts';
import type { JieliKeySetting } from '../../../protocols/ultimaLinkJieli.ts';
import { ANC_MODE, EQ_BAND_COUNT, VOICE_LANGUAGE, createDefaultEarbudPrefs } from '../../../storage/offlineStore.ts';
import type { AncMode, CaseGesture, EarbudGesture, EarbudKeyFunction } from '../../../storage/offlineStore.ts';
import { PACKET_DIRECTION, PACKET_PROTOCOL, cloneEarbudKeyMappings, createCaseKeyControl, syncEarbudsState } from '../types.ts';
import type { EarbudsLiveState, Mutable, PacketDirection, PacketProtocol } from '../types.ts';
import { clampInt, decodeUtf8, toSignedInt8Byte } from './liveBleAdapter.ts';

// Shared Earbuds Protocol Mapping Constants & Pure Helpers
export const BLUETRUM_KEY_TYPE_MAP: Record<'left' | 'right', Record<EarbudGesture, KeyType>> = {
  left: { single: KEY_TYPE.LEFT_SINGLE_TAP, double: KEY_TYPE.LEFT_DOUBLE_TAP, triple: KEY_TYPE.LEFT_TRIPLE_TAP, longPress: KEY_TYPE.LEFT_LONG_PRESS },
  right: { single: KEY_TYPE.RIGHT_SINGLE_TAP, double: KEY_TYPE.RIGHT_DOUBLE_TAP, triple: KEY_TYPE.RIGHT_TRIPLE_TAP, longPress: KEY_TYPE.RIGHT_LONG_PRESS },
};

export const BLUETRUM_CASE_KEY_TYPE_MAP: Record<CaseGesture, CaseKeyType> = {
  single: CASE_KEY_TYPE.SINGLE_TAP, double: CASE_KEY_TYPE.DOUBLE_TAP, triple: CASE_KEY_TYPE.TRIPLE_TAP,
  longPress: CASE_KEY_TYPE.LONG_PRESS, rotation: CASE_KEY_TYPE.ROTATION_PRESS,
};

export const JIELI_ACTION_BY_GESTURE: Record<EarbudGesture, number> = { single: 1, double: 2, triple: 3, longPress: 4 };
export const GESTURE_BY_JIELI_ACTION: Record<number, EarbudGesture> = { 1: 'single', 2: 'double', 3: 'triple', 4: 'longPress' };

export const ANC_PROTOCOL_TO_STORE: Record<number, AncMode> = {
  [PROTOCOL_ANC_MODE.OFF]: ANC_MODE.OFF, [PROTOCOL_ANC_MODE.ANC]: ANC_MODE.ANC, [PROTOCOL_ANC_MODE.TRANSPARENCY]: ANC_MODE.TRANSPARENCY,
};

export const ANC_STORE_TO_PROTOCOL: Record<AncMode, number> = {
  [ANC_MODE.OFF]: PROTOCOL_ANC_MODE.OFF, [ANC_MODE.ANC]: PROTOCOL_ANC_MODE.ANC, [ANC_MODE.TRANSPARENCY]: PROTOCOL_ANC_MODE.TRANSPARENCY,
};

export function normalizeEqGains(gains: readonly number[]): number[] {
  const normalized = new Array<number>(EQ_BAND_COUNT).fill(0);
  for (let i = 0; i < Math.min(EQ_BAND_COUNT, gains.length); i++) {
    const val = gains[i]!;
    normalized[i] = Number.isFinite(val) ? Math.trunc(val) : 0;
  }
  return normalized;
}

export function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function formatBluetrumFirmwareVersion(rawVersion: number): string {
  const [b3, b2, b1, b0] = [(rawVersion >>> 24) & 0xff, (rawVersion >>> 16) & 0xff, (rawVersion >>> 8) & 0xff, rawVersion & 0xff];
  return b3 === 0 ? `v${b2}.${b1}.${b0}` : `v${b3}.${b2}.${b1}.${b0}`;
}

export interface PendingEqContext {
  gains: number[];
  presetName: string;
  modeByte: number;
  expectedCrcHex: string | null;
}

export interface EarbudsTransportHost {
  getState(): EarbudsLiveState;
  setState(next: EarbudsLiveState): void;
  isSimulator(): boolean;
  sendSimulatorBluetrum(frame: Uint8Array): Uint8Array[];
  sendSimulatorJieli(packet: Uint8Array): Uint8Array[];
  writeLiveBytes(chip: DeviceChip, bytes: Uint8Array): Promise<void>;
  logPacket(direction: PacketDirection, protocol: PacketProtocol, deviceId: string, deviceName: string, bytes: Uint8Array, summary: string, cmd?: number): void;
  setError(message: string): void;
  emit(): void;
}

/** Coordinates Bluetrum ABMate & Jieli RCSP command serialization, RX decoding, and state updates. */
export class EarbudsController {
  private btSeq = 0;
  private jlOpCodeSn = 1;
  private readonly btRxReassembler = new BluetrumFrameReassembler();
  private pendingEqContext: PendingEqContext | null = null;
  private pendingBtFind: boolean | null = null;

  resetReassembler(): void {
    this.btRxReassembler.reset();
    this.pendingEqContext = null;
    this.pendingBtFind = null;
  }

  async sendBluetrumCommand(host: EarbudsTransportHost, command: BluetrumCommandPayload, summary: string): Promise<void> {
    const seq = this.btSeq & 0x0f;
    const frames = encodeBluetrumCommand(command, seq);
    this.btSeq = (seq + frames.length) & 0x0f;
    const state = host.getState();
    const deviceId = state.deviceId ?? 'earbuds';

    for (const frame of frames) {
      host.logPacket(PACKET_DIRECTION.TX, PACKET_PROTOCOL.BLUETRUM, deviceId, state.name, frame, summary, command.cmd);
      if (host.isSimulator()) {
        for (const rx of host.sendSimulatorBluetrum(frame)) this.handleBluetrumRxBytes(host, rx);
      } else {
        await host.writeLiveBytes(DEVICE_CHIP.BT, frame);
      }
    }
  }

  async sendJieliPacket(host: EarbudsTransportHost, build: (opCodeSn: number) => Uint8Array, summary: string): Promise<void> {
    const sn = this.jlOpCodeSn & 0xff;
    this.jlOpCodeSn = (this.jlOpCodeSn + 1) & 0xff;
    const packet = build(sn);
    const parsed = parseJieliRcspPacket(packet);
    const state = host.getState();
    host.logPacket(PACKET_DIRECTION.TX, PACKET_PROTOCOL.JIELI, state.deviceId ?? 'earbuds', state.name, packet, summary, parsed?.opCode);
    if (host.isSimulator()) {
      for (const rx of host.sendSimulatorJieli(packet)) this.handleJieliRxBytes(host, rx);
    } else {
      await host.writeLiveBytes(DEVICE_CHIP.JL, packet);
    }
  }

  async refreshInfo(host: EarbudsTransportHost, chip: DeviceChip): Promise<void> {
    if (chip === DEVICE_CHIP.BT) { await this.sendBluetrumCommand(host, encodeBluetrumDeviceInfoRequest(), 'DeviceInfoRequest (0x27)'); return; }
    await this.sendJieliPacket(host, (sn) => encodeJieliGetAdvInfo(sn), 'Jieli GetADVInfo (0xC1)');
    await this.sendJieliPacket(host, (sn) => encodeJieliUltimaEqQuery(sn), 'Jieli UltimaEqQuery (0xFF [0x10])');
    await this.sendJieliPacket(host, (sn) => encodeJieliGetSysInfo(sn, 1 << JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ), 'Jieli GetSysInfo EQ (0x07)');
  }

  async setAncMode(host: EarbudsTransportHost, chip: DeviceChip, mode: 'off' | 'anc' | 'transparency'): Promise<void> {
    const p = ANC_STORE_TO_PROTOCOL[mode];
    await this.sendChip(host, chip, encodeBluetrumAncMode(p), `SetANCMode (${mode})`, (sn) => encodeJieliAncMode(p, sn), `Jieli SetANCMode (${mode})`);
  }

  async setAncGain(host: EarbudsTransportHost, chip: DeviceChip, gain: number): Promise<void> {
    const g = clampInt(gain, 0, host.getState().ancGainMax || 10);
    await this.dispatchBtOrJieliCustom(host, chip, encodeBluetrumAncGain(g), `SetANCGain (${g})`, Uint8Array.of(0x20, g & 0xff), `Jieli Custom ANCGain (${g})`, { ancGain: g });
  }

  async setTransparencyGain(host: EarbudsTransportHost, chip: DeviceChip, gain: number): Promise<void> {
    const g = clampInt(gain, 0, host.getState().transparencyGainMax || 10);
    await this.dispatchBtOrJieliCustom(host, chip, encodeBluetrumTransparencyGain(g), `SetTransparencyGain (${g})`, Uint8Array.of(0x21, g & 0xff), `Jieli Custom TransparencyGain (${g})`, { transparencyGain: g });
  }

  async setEq(host: EarbudsTransportHost, chip: DeviceChip, gains: number[], presetName: string, presetModeByte?: number): Promise<void> {
    const normalizedGains = normalizeEqGains(gains);
    const trimmedName = presetName.trim() || 'Custom';
    const lowerName = trimmedName.toLowerCase();

    if (chip === DEVICE_CHIP.BT) {
      const modeByte = presetModeByte ?? (lowerName === 'flat' ? 0 : 0x20);
      this.pendingEqContext = { gains: normalizedGains, presetName: trimmedName, modeByte, expectedCrcHex: null };
      await this.sendBluetrumCommand(host, encodeBluetrumEq(modeByte, normalizedGains, EQ_BAND_COUNT), `SetEQ (${trimmedName})`);
      return;
    }

    const current = host.getState();
    const isSig = lowerName === 'signature sound' || lowerName === 'signature';
    const isBal = lowerName === 'balance sound' || lowerName === 'balance';
    if ((current.product?.supportsSignatureBalanceEq ?? false) && (isSig || isBal)) {
      const jieliPreset = isSig ? 'signature' : 'balance';
      const factory = getFactoryPresetsForProduct(current.pid ?? 0x0001);
      const factoryGains = normalizeEqGains(isSig ? factory.signatureSound : factory.balanceSound);
      const modeByte = presetModeByte ?? (isSig ? JIELI_ULTIMA_EQ_VALUE.SIGNATURE_SOUND : JIELI_ULTIMA_EQ_VALUE.BALANCE_SOUND);
      const crcHex = bytesToHex(crc16Jieli(Uint8Array.of(modeByte, ...factoryGains.map(toSignedInt8Byte))));
      this.pendingEqContext = { gains: factoryGains, presetName: isSig ? 'Signature Sound' : 'Balance Sound', modeByte, expectedCrcHex: crcHex };
      await this.sendJieliPacket(host, (sn) => encodeJieliUltimaEqPreset(jieliPreset, sn), `Jieli UltimaEqPreset (${jieliPreset})`);
      return;
    }

    const modeByte = presetModeByte ?? (lowerName === 'flat' ? 0 : 6);
    const expectedCrcHex = bytesToHex(crc16Jieli(Uint8Array.of(modeByte & 0xff, ...normalizedGains.map(toSignedInt8Byte))));
    this.pendingEqContext = { gains: normalizedGains, presetName: trimmedName, modeByte, expectedCrcHex };
    await this.sendJieliPacket(host, (sn) => encodeJieliCustomEq({ mode: modeByte, gains: normalizedGains, opCodeSn: sn }), `Jieli SetCustomEq (${trimmedName}, CRC ${expectedCrcHex})`);
  }

  async setGameMode(host: EarbudsTransportHost, chip: DeviceChip, enabled: boolean): Promise<void> {
    await this.sendChip(host, chip, encodeBluetrumWorkMode(enabled ? WORK_MODE.GAMING : WORK_MODE.NORMAL), `SetGameMode (${enabled})`, (sn) => encodeJieliWorkMode(enabled ? 2 : 1, sn), `Jieli SetWorkMode (${enabled ? 'Game' : 'Normal'})`);
  }

  async setSpatialAudio(host: EarbudsTransportHost, chip: DeviceChip, enabled: boolean): Promise<void> {
    await this.dispatchBtOrJieliCustom(host, chip, encodeBluetrumSpatialAudio(enabled), `SetSpatialAudio (${enabled})`, Uint8Array.of(0x22, enabled ? 1 : 0), `Jieli Custom SpatialAudio (${enabled})`, { spatialAudio: enabled });
  }

  async setLdac(host: EarbudsTransportHost, chip: DeviceChip, enabled: boolean): Promise<void> {
    await this.dispatchBtOrJieliCustom(host, chip, encodeBluetrumLdacMode(enabled), `SetLDAC (${enabled})`, Uint8Array.of(0x23, enabled ? 1 : 0), `Jieli Custom LDAC (${enabled})`, { ldac: enabled, ldacEnabled: enabled });
  }

  async setInEarDetect(host: EarbudsTransportHost, chip: DeviceChip, enabled: boolean): Promise<void> {
    await this.sendChip(host, chip, encodeBluetrumInEarDetect(enabled), `SetInEarDetect (${enabled})`, (sn) => encodeJieliInEarDetect(enabled, sn), `Jieli SetInEarDetect (${enabled})`);
  }

  async setDualConnect(host: EarbudsTransportHost, chip: DeviceChip, enabled: boolean): Promise<void> {
    await this.dispatchBtOrJieliCustom(host, chip, encodeBluetrumDualConnect(enabled), `SetDualConnect (${enabled})`, Uint8Array.of(0x24, enabled ? 1 : 0), `Jieli Custom DualConnect (${enabled})`, { dualConnect: enabled });
  }

  async setLed(host: EarbudsTransportHost, chip: DeviceChip, enabled: boolean): Promise<void> {
    const val = enabled ? 1 : 0;
    await this.sendChip(host, chip, encodeBluetrumLedSwitch(enabled), `SetLED (${enabled})`, (sn) => encodeJieliLedSettings([{ scene: 1, effect: val }, { scene: 2, effect: val }], sn), `Jieli SetLED (${enabled})`);
  }

  async setLanguage(host: EarbudsTransportHost, chip: DeviceChip, lang: 'en' | 'zh'): Promise<void> {
    const code = lang === VOICE_LANGUAGE.ZH ? PROTOCOL_VOICE_LANGUAGE.CHINESE : PROTOCOL_VOICE_LANGUAGE.ENGLISH;
    await this.sendChip(host, chip, encodeBluetrumLanguage(code), `SetVoiceLanguage (${lang})`, (sn) => encodeJieliLanguage(lang, sn), `Jieli SetLanguage (${lang})`);
  }

  async setKeyMapping(host: EarbudsTransportHost, chip: DeviceChip, side: 'left' | 'right', gesture: EarbudGesture, safeFn: EarbudKeyFunction): Promise<void> {
    if (chip === DEVICE_CHIP.BT) {
      await this.sendBluetrumCommand(host, encodeBluetrumKeyMapping(BLUETRUM_KEY_TYPE_MAP[side][gesture], safeFn), `SetKeyMapping (${side}.${gesture}=0x${safeFn.toString(16)})`);
      return;
    }
    const nextMappings = cloneEarbudKeyMappings(host.getState().keyMappings);
    nextMappings[side][gesture] = safeFn;
    const entries: JieliKeySetting[] = [];
    for (const [sIdx, s] of (['left', 'right'] as const).entries()) {
      for (const [g, fn] of Object.entries(nextMappings[s])) {
        if (fn !== undefined) entries.push({ keyNum: sIdx + 1, action: JIELI_ACTION_BY_GESTURE[g as EarbudGesture], fn });
      }
    }
    await this.sendJieliPacket(host, (sn) => encodeJieliKeySettings(entries, sn), `Jieli SetKeyMapping (${side}.${gesture}=0x${safeFn.toString(16)})`);
  }

  async setCaseKeyMapping(host: EarbudsTransportHost, chip: DeviceChip, gesture: CaseGesture, safeFn: number): Promise<void> {
    if (chip === DEVICE_CHIP.BT) {
      await this.sendBluetrumCommand(host, encodeBluetrumCaseKey(BLUETRUM_CASE_KEY_TYPE_MAP[gesture], safeFn, 0), `SetCaseKeyMapping (${gesture}=0x${safeFn.toString(16)})`);
      return;
    }
    await this.sendJieliPacket(host, (sn) => encodeJieliCustomCmd(Uint8Array.of(0x25, safeFn & 0xff), sn), `Jieli Custom CaseKey (${gesture}=0x${safeFn.toString(16)})`);
    const current = host.getState();
    const next = cloneEarbudKeyMappings(current.keyMappings);
    next.caseKeys[gesture] = createCaseKeyControl(safeFn, 0);
    host.setState(syncEarbudsState({ ...current, keyMappings: next }));
    host.emit();
  }

  async rename(host: EarbudsTransportHost, chip: DeviceChip, trimmed: string): Promise<void> {
    await this.sendChip(host, chip, encodeBluetrumBluetoothName(trimmed), `RenameEarbuds (${trimmed})`, (sn) => encodeJieliDeviceName(trimmed, sn), `Jieli RenameEarbuds (${trimmed})`);
  }

  async find(host: EarbudsTransportHost, chip: DeviceChip, enable: boolean): Promise<void> {
    if (chip === DEVICE_CHIP.BT) {
      this.pendingBtFind = enable;
      await this.sendBluetrumCommand(host, encodeBluetrumFindDevice(enable), `FindEarbuds (${enable ? 'ring' : 'stop'})`);
      return;
    }
    await this.sendJieliPacket(host, (sn) => encodeJieliSearchDev({ opCodeSn: sn, op: enable ? 1 : 0, type: 0, timeoutSec: enable ? 30 : 0, way: 0 }), `Jieli SearchDev (${enable ? 'ring' : 'stop'})`);
    host.setState(syncEarbudsState({ ...host.getState(), finding: enable, findingActive: enable }));
    host.emit();
  }

  async factoryReset(host: EarbudsTransportHost, chip: DeviceChip): Promise<void> {
    if (chip === DEVICE_CHIP.BT) {
      await this.sendBluetrumCommand(host, encodeBluetrumFactoryReset(), 'FactoryReset (0x24)');
      return;
    }
    await this.sendJieliPacket(host, (sn) => encodeJieliCustomCmd(Uint8Array.of(0xff), sn), 'Jieli FactoryReset');
    const defaults = createDefaultEarbudPrefs();
    const current = host.getState();
    const defaultName = current.product?.name ?? current.name;
    host.setState(syncEarbudsState({
      ...current, name: defaultName, deviceName: defaultName, ancMode: defaults.ancMode,
      ancGain: defaults.ancGain, transparencyGain: defaults.transparencyGain,
      eqPresetName: 'Flat', eqModeByte: 0, eqGains: [...EQ_PRESETS.FLAT], eqCrcHex: null,
      gameMode: defaults.gameMode, spatialAudio: defaults.spatialAudio, soundEffect3d: false,
      ldac: defaults.ldac, ldacEnabled: defaults.ldac, inEarDetect: defaults.inEarDetect,
      dualConnect: defaults.dualConnect, ledOn: defaults.ledOn, ledEnabled: defaults.ledOn,
      voiceLanguage: defaults.voiceLanguage, keyMappings: cloneEarbudKeyMappings(defaults.keyMappings),
      finding: false, findingActive: false,
    }));
  }

  handleBluetrumRxBytes(host: EarbudsTransportHost, packet: Uint8Array): void {
    const state = host.getState();
    host.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.BLUETRUM, state.deviceId ?? 'earbuds', state.name, packet, `Bluetrum RX (${packet.length} B)`, packet.length >= 2 ? packet[1] : undefined);
    const frame = this.btRxReassembler.push(packet);
    if (!frame) return;

    if (frame.cmd === BLUETRUM_CMD.DEVICE_INFO || frame.cmd === BLUETRUM_CMD.NOTIFY) {
      host.setState(this.applyBluetrumDeviceInfo(host.getState(), decodeBluetrumDeviceInfo(frame.payload)));
      host.emit();
      return;
    }
    const ack = decodeBluetrumResponsePayload(frame.payload);
    if (!ack.ok) {
      host.setError(`Bluetrum command 0x${frame.cmd.toString(16)} failed (status 0x${ack.statusCode.toString(16)})`);
      host.emit();
      return;
    }
    if (frame.cmd === BLUETRUM_CMD.FIND_DEVICE && this.pendingBtFind !== null) {
      host.setState(syncEarbudsState({ ...host.getState(), finding: this.pendingBtFind, findingActive: this.pendingBtFind }));
      this.pendingBtFind = null;
      host.emit();
    }
  }

  handleJieliRxBytes(host: EarbudsTransportHost, raw: Uint8Array): void {
    const current = host.getState();
    const pkt = parseJieliRcspPacket(raw);
    host.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.JIELI, current.deviceId ?? 'earbuds', current.name, raw, pkt ? `Jieli RX opCode=0x${pkt.opCode.toString(16)} sn=${pkt.opCodeSn}` : `Jieli RX (${raw.length} B)`, pkt?.opCode);
    if (!pkt) return;
    if (!pkt.isCommand && pkt.status !== undefined && pkt.status !== 0) {
      host.setError(`Jieli RCSP 0x${pkt.opCode.toString(16)} error status=${pkt.status}`);
      host.emit();
      return;
    }

    let next: EarbudsLiveState = { ...current, lastSyncedAt: Date.now() };
    if (pkt.opCode === JIELI_OPCODE.ADV_GET_INFO || pkt.opCode === JIELI_OPCODE.ADV_SETTINGS) {
      next = this.applyJieliAdvInfo(next, pkt.paramData);
    } else if (pkt.opCode === JIELI_OPCODE.EXTRA_CUSTOM) {
      const custom = parseJieliCustomData(pkt.paramData);
      if (custom?.kind === 'eq_preset') {
        const factory = getFactoryPresetsForProduct(next.pid ?? 0x0001);
        const isSig = custom.preset === 'signature';
        const gains = normalizeEqGains(isSig ? factory.signatureSound : factory.balanceSound);
        next = {
          ...next, eqPresetName: isSig ? 'Signature Sound' : 'Balance Sound', eqModeByte: custom.eqValue,
          eqGains: gains, eqCrcHex: bytesToHex(crc16Jieli(Uint8Array.of(custom.eqValue, ...gains.map(toSignedInt8Byte)))),
        };
        this.pendingEqContext = null;
      }
    } else if (pkt.opCode === JIELI_OPCODE.GET_SYS_INFO || pkt.opCode === JIELI_OPCODE.SET_SYS_INFO) {
      const res = this.applyJieliSysInfoEq(next, pkt.opCode, pkt.paramData);
      if (res.error) { host.setError(res.error); host.emit(); return; }
      next = res.state;
    }
    host.setState(syncEarbudsState(next));
    host.emit();
  }

  private async sendChip(
    host: EarbudsTransportHost, chip: DeviceChip, btCmd: BluetrumCommandPayload, btSummary: string,
    jlBuild: (sn: number) => Uint8Array, jlSummary: string,
  ): Promise<void> {
    if (chip === DEVICE_CHIP.BT) await this.sendBluetrumCommand(host, btCmd, btSummary);
    else await this.sendJieliPacket(host, jlBuild, jlSummary);
  }

  private async dispatchBtOrJieliCustom(
    host: EarbudsTransportHost, chip: DeviceChip, btCmd: BluetrumCommandPayload, btSummary: string,
    jlPayload: Uint8Array, jlSummary: string, jlPatch: Partial<EarbudsLiveState>,
  ): Promise<void> {
    if (chip === DEVICE_CHIP.BT) { await this.sendBluetrumCommand(host, btCmd, btSummary); return; }
    await this.sendJieliPacket(host, (sn) => encodeJieliCustomCmd(jlPayload, sn), jlSummary);
    host.setState(syncEarbudsState({ ...host.getState(), ...jlPatch }));
    host.emit();
  }

  private applyBluetrumDeviceInfo(current: EarbudsLiveState, info: BluetrumDeviceInfoSnapshot): EarbudsLiveState {
    const next: Mutable<EarbudsLiveState> = { ...current, lastSyncedAt: Date.now() };
    if (info.power) {
      next.battery = {
        left: info.power.left?.level ?? next.battery.left, leftCharging: info.power.left?.isCharging ?? next.battery.leftCharging,
        right: info.power.right?.level ?? next.battery.right, rightCharging: info.power.right?.isCharging ?? next.battery.rightCharging,
        case: info.power.case?.level ?? next.battery.case, caseCharging: info.power.case?.isCharging ?? next.battery.caseCharging,
      };
    }
    if (info.firmwareVersion !== undefined) next.firmwareVersion = formatBluetrumFirmwareVersion(info.firmwareVersion);
    if (info.bluetoothName) { next.name = info.bluetoothName; next.deviceName = info.bluetoothName; }
    if (info.eqSetting) {
      const match = this.pendingEqContext && arraysEqual(this.pendingEqContext.gains, info.eqSetting.gains);
      next.eqModeByte = info.eqSetting.mode;
      next.eqGains = normalizeEqGains(info.eqSetting.gains);
      next.eqCrcHex = null;
      next.eqPresetName = match ? this.pendingEqContext!.presetName : (info.eqSetting.mode === 0 && arraysEqual(next.eqGains, EQ_PRESETS.FLAT) ? 'Flat' : 'Custom');
      if (match) this.pendingEqContext = null;
    }
    if (info.keySettings || info.caseKeySettings) {
      const updated = cloneEarbudKeyMappings(next.keyMappings);
      if (info.keySettings) {
        for (const side of ['left', 'right'] as const) {
          for (const [gesture, keyType] of Object.entries(BLUETRUM_KEY_TYPE_MAP[side])) {
            const fn = info.keySettings[keyType];
            if (fn !== undefined && fn >= 0 && fn <= 9) updated[side][gesture as EarbudGesture] = fn as EarbudKeyFunction;
          }
        }
      }
      if (info.caseKeySettings) {
        for (const [gesture, caseKeyType] of Object.entries(BLUETRUM_CASE_KEY_TYPE_MAP)) {
          const entry = info.caseKeySettings[caseKeyType];
          if (entry) updated.caseKeys[gesture as CaseGesture] = createCaseKeyControl(entry.keyFunction, entry.callControl ?? 0);
        }
      }
      next.keyMappings = updated;
    }
    if (info.deviceVolume !== undefined) next.volume = info.deviceVolume;
    if (info.playState !== undefined) next.playing = info.playState;
    if (info.workMode !== undefined) next.gameMode = info.workMode === WORK_MODE.GAMING;
    if (info.inEarDetect !== undefined) next.inEarDetect = info.inEarDetect;
    if (info.language !== undefined) next.voiceLanguage = info.language === PROTOCOL_VOICE_LANGUAGE.CHINESE ? VOICE_LANGUAGE.ZH : VOICE_LANGUAGE.EN;
    if (info.ancMode !== undefined) next.ancMode = ANC_PROTOCOL_TO_STORE[info.ancMode] ?? ANC_MODE.OFF;
    if (info.ancGain !== undefined) next.ancGain = Math.max(0, info.ancGain);
    if (info.transparencyGain !== undefined) next.transparencyGain = Math.max(0, info.transparencyGain);
    if (info.ancGainNum !== undefined && info.ancGainNum > 0) next.ancGainMax = info.ancGainNum;
    if (info.transparencyGainNum !== undefined && info.transparencyGainNum > 0) next.transparencyGainMax = info.transparencyGainNum;
    if (info.ledOn !== undefined) { next.ledOn = info.ledOn; next.ledEnabled = info.ledOn; }
    if (info.soundEffect3d !== undefined) next.soundEffect3d = info.soundEffect3d;
    if (info.dualConnect !== undefined) next.dualConnect = info.dualConnect;
    if (info.spatialAudio !== undefined) next.spatialAudio = info.spatialAudio;
    if (info.ldacMode !== undefined) { next.ldac = info.ldacMode; next.ldacEnabled = info.ldacMode; }
    if (info.capacities) next.capacities = info.capacities;
    return syncEarbudsState(next);
  }

  private applyJieliAdvInfo(current: EarbudsLiveState, paramData: Uint8Array): EarbudsLiveState {
    const next: Mutable<EarbudsLiveState> = { ...current };
    for (const entry of parseJieliLtvEntries(paramData)) {
      if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_BATTERY_QUANTITY) {
        next.battery = {
          left: (entry.value[0] ?? next.battery.left) & 0x7f, leftCharging: ((entry.value[0] ?? 0) & 0x80) !== 0,
          right: (entry.value[1] ?? next.battery.right) & 0x7f, rightCharging: ((entry.value[1] ?? 0) & 0x80) !== 0,
          case: (entry.value[2] ?? next.battery.case) & 0x7f, caseCharging: ((entry.value[2] ?? 0) & 0x80) !== 0,
        };
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_DEVICE_NAME) {
        const name = decodeUtf8(entry.value).trim();
        if (name.length > 0) { next.name = name; next.deviceName = name; }
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_KEY_SETTINGS) {
        const updated = cloneEarbudKeyMappings(next.keyMappings);
        for (let i = 0; i + 2 < entry.value.length; i += 3) {
          const side = entry.value[i] === 1 ? 'left' : entry.value[i] === 2 ? 'right' : null;
          const gesture = GESTURE_BY_JIELI_ACTION[entry.value[i + 1]!];
          const fn = entry.value[i + 2]!;
          if (side && gesture && fn >= 0 && fn <= 9) updated[side][gesture] = fn as EarbudKeyFunction;
        }
        next.keyMappings = updated;
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_LED_SETTINGS && entry.value.length >= 2) {
        next.ledOn = entry.value[1]! !== 0; next.ledEnabled = next.ledOn;
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_WORK_MODE && entry.value.length >= 1) {
        next.gameMode = entry.value[0]! === 2;
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_IN_EAR_CHECK && entry.value.length >= 1) {
        next.inEarDetect = entry.value[0]! !== 0;
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_LANGUAGE) {
        next.voiceLanguage = entry.value.length === 1 && entry.value[0]! <= 1
          ? (entry.value[0]! === 1 ? VOICE_LANGUAGE.ZH : VOICE_LANGUAGE.EN)
          : (decodeUtf8(entry.value).toLowerCase().startsWith('zh') ? VOICE_LANGUAGE.ZH : VOICE_LANGUAGE.EN);
      } else if (entry.type === JIELI_ATTR_AND_FUN.ADV_TYPE_ANC_MODE_LIST && entry.value.length >= 1) {
        next.ancMode = ANC_PROTOCOL_TO_STORE[entry.value[0]!] ?? ANC_MODE.OFF;
      }
    }
    return next;
  }

  private applyJieliSysInfoEq(current: EarbudsLiveState, opCode: number, paramData: Uint8Array): { state: EarbudsLiveState; error?: string } {
    const next: Mutable<EarbudsLiveState> = { ...current };
    if (paramData.length < 3) return { state: next };
    const body = paramData.subarray(1);
    for (const attr of parseJieliLtvEntries(body)) {
      if (attr.type !== JIELI_ATTR_AND_FUN.SYS_INFO_ATTR_EQ || attr.value.length < 2) continue;
      const rawMode = attr.value[0]!;
      const modeByte = rawMode & 0x7f;
      const gains: number[] = [];
      for (let i = (rawMode & 0x80) !== 0 ? 2 : 1; i < attr.value.length; i++) gains.push(((attr.value[i]! & 0xff) << 24) >> 24);
      const computedCrcHex = bytesToHex(crc16Jieli(attr.value));
      const attrWireLen = 2 + attr.value.length;
      if (body.length >= attrWireLen + 2) {
        const rxCrcHex = bytesToHex(body.subarray(attrWireLen, attrWireLen + 2));
        if (rxCrcHex !== computedCrcHex) return { state: next, error: `Jieli EQ CRC16 mismatch: expected ${computedCrcHex}, got ${rxCrcHex}` };
      }
      const normalized = normalizeEqGains(gains);
      const match = this.pendingEqContext && arraysEqual(this.pendingEqContext.gains, normalized);
      next.eqModeByte = modeByte;
      next.eqGains = normalized;
      next.eqCrcHex = computedCrcHex;
      if (match) { next.eqPresetName = this.pendingEqContext!.presetName; this.pendingEqContext = null; }
      else if (opCode === JIELI_OPCODE.SET_SYS_INFO || !next.product?.supportsSignatureBalanceEq) {
        next.eqPresetName = modeByte === 0 && arraysEqual(normalized, EQ_PRESETS.FLAT) ? 'Flat' : 'Custom';
      }
    }
    return { state: next };
  }
}
