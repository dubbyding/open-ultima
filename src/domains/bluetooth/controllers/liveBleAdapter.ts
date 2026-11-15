import { ALL_ADV_COMPANY_IDS, BLUETRUM_ADV_COMPANY_IDS, BLUETRUM_UUIDS, DEVICE_CHIP, JIELI_UUIDS } from '../../../protocols/ultimaLinkConstants.ts';
import type { DeviceChip } from '../../../protocols/ultimaLinkConstants.ts';
import { bytesToHex, hexToBytes, parseUltimaLinkAdv } from '../../../protocols/ultimaLinkAdvParser.ts';
import { CRREPA_UUIDS, parseCrpScanRecord } from '../../../protocols/ultimaFitCrrepa.ts';
import { DEVICE_KIND } from '../../../storage/offlineStore.ts';
import { PACKET_PROTOCOL } from '../types.ts';
import type { BlePlxDeviceLike, BlePlxManagerLike, BlePlxSubscriptionLike, DiscoveredDevice } from '../types.ts';

const LIVE_SCAN_DURATION_MS = 3500;
/** Direct (non-autoConnect) GATT connect timeout so reconnect attempts fail fast when out of range. */
const CONNECT_TIMEOUT_MS = 12000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface BlePlxModuleLike {
  BleManager: new (options?: Record<string, unknown>) => BlePlxManagerLike;
}

export interface LiveBleAdapterOptions {
  /**
   * iOS Core Bluetooth state-restoration key. With the `bluetooth-central`
   * background mode, iOS relaunches the app for BLE events (e.g. a pending
   * reconnect completing) even after it was suspended or terminated.
   */
  restoreStateIdentifier?: string;
}

/** Lazily loads `react-native-ble-plx` so Node tests can run without native binaries. */
export function loadBlePlxModule(): BlePlxModuleLike | null {
  const mod: unknown = typeof require === 'function' ? (() => {
    try { return require('react-native-ble-plx'); } catch { return null; }
  })() : null;
  if (mod && typeof mod === 'object' && 'BleManager' in mod && typeof (mod as { BleManager?: unknown }).BleManager === 'function') {
    return mod as BlePlxModuleLike;
  }
  return null;
}

// Byte, UTF-8, Base64 & Numeric Helpers

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

export function toSignedInt8Byte(value: number): number {
  return Math.max(-128, Math.min(127, Math.trunc(value))) & 0xff;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >>> 18) & 0x3f]!;
    out += BASE64_ALPHABET[(triple >>> 12) & 0x3f]!;
    out += hasB1 ? BASE64_ALPHABET[(triple >>> 6) & 0x3f]! : '=';
    out += hasB2 ? BASE64_ALPHABET[triple & 0x3f]! : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\r\n\s]/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(clean[i] ?? 'A');
    const c1 = BASE64_ALPHABET.indexOf(clean[i + 1] ?? 'A');
    const c2Char = clean[i + 2] ?? '=';
    const c3Char = clean[i + 3] ?? '=';
    const c2 = c2Char === '=' ? 0 : BASE64_ALPHABET.indexOf(c2Char);
    const c3 = c3Char === '=' ? 0 : BASE64_ALPHABET.indexOf(c3Char);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) break;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out.push((triple >>> 16) & 0xff);
    if (c2Char !== '=') out.push((triple >>> 8) & 0xff);
    if (c3Char !== '=') out.push(triple & 0xff);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Live BLE Advertisement Parser & GATT Transport Adapter
// ---------------------------------------------------------------------------

export function parseLiveBleDevice(raw: BlePlxDeviceLike): DiscoveredDevice | null {
  const rawName = raw.localName ?? raw.name ?? '';

  if (raw.manufacturerData) {
    const mfgBytes = base64ToBytes(raw.manufacturerData);
    if (mfgBytes.length >= 2) {
      const companyId = mfgBytes[0]! | (mfgBytes[1]! << 8);
      const payload = mfgBytes.subarray(2);
      if ((ALL_ADV_COMPANY_IDS as readonly number[]).includes(companyId)) {
        const advInfo = parseUltimaLinkAdv(payload, companyId);
        if (advInfo) {
          const chip: DeviceChip =
            advInfo.product?.chip ??
            ((BLUETRUM_ADV_COMPANY_IDS as readonly number[]).includes(companyId)
              ? DEVICE_CHIP.BT
              : DEVICE_CHIP.JL);
          const name = advInfo.product?.name ?? (rawName || `Ultima ${advInfo.pid}`);
          return {
            id: raw.id, name, kind: DEVICE_KIND.EARBUDS, rssi: raw.rssi ?? -65,
            protocol: chip === DEVICE_CHIP.BT ? PACKET_PROTOCOL.BLUETRUM : PACKET_PROTOCOL.JIELI,
            mac: advInfo.edrMac, edrMac: advInfo.edrMac, chip, pid: advInfo.pid, productName: name,
            bid: advInfo.bid, product: advInfo.product, edrConnected: advInfo.edrConnected,
            license: advInfo.license, offlineVerified: advInfo.offlineVerified, advInfo,
            rawAdvHex: bytesToHex(mfgBytes, ' '),
          };
        }
      }
    }
  }

  if (raw.serviceData) {
    for (const [uuid, b64] of Object.entries(raw.serviceData)) {
      const norm = uuid.toLowerCase();
      if (norm === 'feea' || norm === CRREPA_UUIDS.SERVICE) {
        const svcBytes = base64ToBytes(b64);
        if (svcBytes.length >= 6) {
          const nameBytes = encodeUtf8(rawName || 'ULTIMA Watch');
          const scanRecord = concatBytes([
            Uint8Array.of(1 + nameBytes.length, 0x09),
            nameBytes,
            Uint8Array.of(3 + svcBytes.length, 0x16, 0xea, 0xfe),
            svcBytes,
          ]);
          const crp = parseCrpScanRecord(scanRecord);
          if (crp) {
            return {
              id: raw.id, name: crp.name || rawName || 'ULTIMA Watch', kind: DEVICE_KIND.WATCH,
              rssi: raw.rssi ?? -65, protocol: PACKET_PROTOCOL.CRREPA, offlineVerified: true,
              crpScanInfo: crp, firmwareType: crp.firmwareType, crpFirmware: crp.firmwareType,
              platform: crp.platform, crpPlatform: crp.platform, chipId: crp.chipId,
              crpChipId: crp.chipId, functionMask: crp.functionMask, crpFunctionMask: crp.functionMask,
              rawAdvHex: bytesToHex(scanRecord, ' '),
            };
          }
        }
      }
    }
  }

  const uuids = (raw.serviceUUIDs ?? []).map((u) => u.toLowerCase());
  if (uuids.includes(CRREPA_UUIDS.SERVICE) || uuids.includes('feea') || uuids.includes('0000feea')) {
    return {
      id: raw.id, name: rawName || 'ULTIMA Fit Watch', kind: DEVICE_KIND.WATCH,
      rssi: raw.rssi ?? -68, protocol: PACKET_PROTOCOL.CRREPA, offlineVerified: false,
      rawAdvHex: '',
    };
  }
  if (
    uuids.includes(BLUETRUM_UUIDS.SERVICE) || uuids.includes('fdb3') ||
    uuids.includes(JIELI_UUIDS.SERVICE) || uuids.includes('ae00')
  ) {
    const isBt = uuids.includes(BLUETRUM_UUIDS.SERVICE) || uuids.includes('fdb3');
    return {
      id: raw.id, name: rawName || (isBt ? 'Ultima Bluetrum' : 'Ultima Jieli'),
      kind: DEVICE_KIND.EARBUDS, rssi: raw.rssi ?? -68,
      protocol: isBt ? PACKET_PROTOCOL.BLUETRUM : PACKET_PROTOCOL.JIELI,
      chip: isBt ? DEVICE_CHIP.BT : DEVICE_CHIP.JL, offlineVerified: false,
      rawAdvHex: '',
    };
  }
  return null;
}

export interface LiveScanCallbacks {
  getDiscovered: () => DiscoveredDevice[];
  onDevicesUpdated: (devices: DiscoveredDevice[]) => void;
  onFirstAdvPacket: (device: DiscoveredDevice, rawAdv: Uint8Array) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export class LiveBleAdapter {
  private manager: BlePlxManagerLike | null = null;
  /**
   * ble-plx numbers monitor transactions "1", "2", … per JS instance, but native
   * monitors survive a JS reload / manager re-creation and keep emitting with the
   * old ids — which then match new listeners (duplicated packets, watch frames in
   * the earbuds handler). A per-session prefix keeps every id unique.
   */
  private readonly txSession = Math.random().toString(36).slice(2, 8);
  private txCounter = 0;
  private nextTxId(tag: string): string {
    this.txCounter += 1;
    return `ultima-${this.txSession}-${tag}-${this.txCounter}`;
  }
  /** Set once the earbuds rejected a write-with-response, so later writes skip straight to without-response. */
  private earbudsWriteNoResponse = false;
  private bleAvailable: boolean;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanResolver: ((devices: DiscoveredDevice[]) => void) | null = null;
  private earbudsDevice: BlePlxDeviceLike | null = null;
  private watchDevice: BlePlxDeviceLike | null = null;
  private earbudsSubs: BlePlxSubscriptionLike[] = [];
  private watchSubs: BlePlxSubscriptionLike[] = [];

  private readonly options: LiveBleAdapterOptions;

  constructor(injectedManager?: BlePlxManagerLike, options: LiveBleAdapterOptions = {}) {
    this.options = options;
    if (injectedManager) {
      this.manager = injectedManager;
      this.bleAvailable = true;
    } else {
      this.bleAvailable = loadBlePlxModule() !== null;
    }
  }

  isAvailable(): boolean {
    return this.bleAvailable;
  }

  private ensureManager(onError?: (message: string) => void): BlePlxManagerLike {
    if (this.manager) return this.manager;
    const mod = loadBlePlxModule();
    if (!mod) {
      this.bleAvailable = false;
      const msg = 'Native BLE (react-native-ble-plx) is unavailable in this environment.';
      onError?.(msg);
      throw new Error(msg);
    }
    try {
      const instance = this.options.restoreStateIdentifier
        ? new mod.BleManager({
            restoreStateIdentifier: this.options.restoreStateIdentifier,
            // Restored peripherals are re-acquired by the keep-alive reconnect pass.
            restoreStateFunction: () => undefined,
          })
        : new mod.BleManager();
      this.manager = instance;
      this.bleAvailable = true;
      return instance;
    } catch (err) {
      this.bleAvailable = false;
      const reason = err instanceof Error ? err.message : String(err);
      const msg = `Failed to initialize native BleManager: ${reason}`;
      onError?.(msg);
      throw new Error(msg);
    }
  }

  /** Rejects with a readable message when the phone's Bluetooth radio is off or unauthorized. */
  async assertPoweredOn(onError?: (message: string) => void): Promise<void> {
    const manager = this.ensureManager(onError);
    if (typeof manager.state !== 'function') return;
    let state = 'Unknown';
    try { state = await manager.state(); } catch { return; }
    if (state === 'PoweredOn' || state === 'Unknown' || state === 'Resetting') return;
    const msg = state === 'PoweredOff'
      ? 'Bluetooth is turned off. Turn it on and try again.'
      : state === 'Unauthorized'
        ? 'Bluetooth access is not authorized for Ultima Open.'
        : `Bluetooth unavailable (${state}).`;
    onError?.(msg);
    throw new Error(msg);
  }

  async runScan(callbacks: LiveScanCallbacks): Promise<DiscoveredDevice[]> {
    await this.assertPoweredOn(callbacks.onError);
    const manager = this.ensureManager(callbacks.onError);
    const seen = new Map<string, DiscoveredDevice>();

    return new Promise<DiscoveredDevice[]>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.scanResolver = null;
        if (this.scanTimer !== null) {
          clearTimeout(this.scanTimer);
          this.scanTimer = null;
        }
        try {
          manager.stopDeviceScan();
        } catch {
          // ignore
        }
        callbacks.onComplete();
        resolve([...callbacks.getDiscovered()]);
      };

      this.scanResolver = (devices) => {
        if (!settled) {
          settled = true;
          resolve(devices);
        }
      };

      try {
        manager.startDeviceScan(null, { allowDuplicates: false }, (error, rawDevice) => {
          if (error) {
            if (!settled) {
              settled = true;
              this.scanResolver = null;
              if (this.scanTimer !== null) {
                clearTimeout(this.scanTimer);
                this.scanTimer = null;
              }
              callbacks.onError(error.message);
              reject(error);
            }
            return;
          }
          if (!rawDevice) return;
          const parsed = parseLiveBleDevice(rawDevice);
          if (!parsed) return;
          if (!seen.has(parsed.id)) {
            callbacks.onFirstAdvPacket(parsed, hexToBytes(parsed.rawAdvHex || '00'));
          }
          seen.set(parsed.id, parsed);
          callbacks.onDevicesUpdated(Array.from(seen.values()));
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          this.scanResolver = null;
          const msg = err instanceof Error ? err.message : String(err);
          callbacks.onError(msg);
          reject(err instanceof Error ? err : new Error(msg));
        }
        return;
      }

      this.scanTimer = setTimeout(finish, LIVE_SCAN_DURATION_MS);
    });
  }

  stopScan(currentDiscovered: readonly DiscoveredDevice[]): void {
    if (this.scanTimer !== null) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.manager) {
      try {
        this.manager.stopDeviceScan();
      } catch {
        // Ignore scan-stop errors when native adapter is unavailable.
      }
    }
    if (this.scanResolver) {
      const resolve = this.scanResolver;
      this.scanResolver = null;
      resolve([...currentDiscovered]);
    }
  }

  private async connectAndDiscover(
    deviceId: string,
    mtu: number,
    onError: (message: string) => void,
    persistent = false,
  ): Promise<BlePlxDeviceLike> {
    const manager = this.ensureManager(onError);
    // Persistent (iOS): no timeout — the OS keeps the request pending until the device is in range.
    const connected = await manager.connectToDevice(deviceId, persistent ? {} : { timeout: CONNECT_TIMEOUT_MS });
    await connected.discoverAllServicesAndCharacteristics();
    if (typeof connected.requestMTU === 'function') {
      try {
        await connected.requestMTU(mtu);
      } catch {
        // Optional MTU upgrade
      }
    }
    return connected;
  }

  async connectEarbuds(
    deviceId: string,
    /** null = unknown (e.g. connecting to an already-paired device without a scan): detected from GATT services. */
    chipHint: DeviceChip | null,
    callbacks: {
      onRxBytes: (bytes: Uint8Array) => void;
      onDisconnected: () => void;
      onError: (message: string) => void;
      /** Called before notifications start when the chip had to be detected. */
      onChipDetected?: (chip: DeviceChip) => void;
    },
    persistent = false,
  ): Promise<DeviceChip> {
    const connected = await this.connectAndDiscover(deviceId, 128, callbacks.onError, persistent);
    let chip = chipHint;
    if (chip === null) {
      chip = await detectEarbudsChip(connected);
      if (chip === null) {
        await this.manager?.cancelDeviceConnection?.(deviceId).catch(() => undefined);
        throw new Error('These earbuds don’t support app controls. They still work for music and calls.');
      }
      callbacks.onChipDetected?.(chip);
    }
    this.earbudsDevice = connected;
    this.earbudsWriteNoResponse = false;
    this.clearEarbudsSubs();

    const notifyService = chip === DEVICE_CHIP.BT ? BLUETRUM_UUIDS.SERVICE : JIELI_UUIDS.SERVICE;
    const notifyChar = chip === DEVICE_CHIP.BT ? BLUETRUM_UUIDS.NOTIFY_WRITE : JIELI_UUIDS.NOTIFY;
    const sub = connected.monitorCharacteristicForService(notifyService, notifyChar, (error, char) => {
      if (error || !char?.value) return;
      callbacks.onRxBytes(base64ToBytes(char.value));
    }, this.nextTxId('earbuds'));
    const disconnSub = connected.onDisconnected(() => {
      this.clearEarbudsSubs();
      this.earbudsDevice = null;
      callbacks.onDisconnected();
    });
    this.earbudsSubs = [sub, disconnSub];
    return chip;
  }

  async connectWatch(
    deviceId: string,
    callbacks: {
      onCrrepaRxBytes: (bytes: Uint8Array) => void;
      onBatteryPercent: (percent: number) => void;
      /** Raw (unframed) live step/distance/calorie record from the FEE1 step characteristic. */
      onStepBytes?: (bytes: Uint8Array) => void;
      /** Firmware revision string from the standard Device Information service. */
      onFirmwareRevision?: (revision: string) => void;
      onDisconnected: () => void;
      onError: (message: string) => void;
    },
    persistent = false,
  ): Promise<void> {
    const connected = await this.connectAndDiscover(deviceId, 247, callbacks.onError, persistent);
    this.watchDevice = connected;
    this.clearWatchSubs();

    const subs: BlePlxSubscriptionLike[] = [];
    // FEE1 carries live step totals as a raw record (not a 0xFE 0xEA frame).
    try {
      subs.push(
        connected.monitorCharacteristicForService(CRREPA_UUIDS.SERVICE, CRREPA_UUIDS.FEE1, (error, char) => {
          if (error || !char?.value) return;
          const bytes = base64ToBytes(char.value);
          if (bytes[0] === 0xfe && bytes[1] === 0xea) callbacks.onCrrepaRxBytes(bytes);
          else callbacks.onStepBytes?.(bytes);
        }, this.nextTxId('watch-steps')),
      );
    } catch {
      // Step characteristic is optional on some variants.
    }
    if (connected.readCharacteristicForService) {
      void connected.readCharacteristicForService(CRREPA_UUIDS.SERVICE, CRREPA_UUIDS.FEE1)
        .then((char) => { if (char?.value) callbacks.onStepBytes?.(base64ToBytes(char.value)); })
        .catch(() => undefined);
      void connected.readCharacteristicForService(CRREPA_UUIDS.DEVICE_INFO_SERVICE, CRREPA_UUIDS.FIRMWARE_REVISION)
        .then((char) => {
          if (!char?.value) return;
          const text = printableAscii(base64ToBytes(char.value));
          if (text) callbacks.onFirmwareRevision?.(text);
        })
        .catch(() => undefined);
    }

    for (const charUuid of [CRREPA_UUIDS.FEE3, CRREPA_UUIDS.FEE6]) {
      try {
        subs.push(
          connected.monitorCharacteristicForService(CRREPA_UUIDS.SERVICE, charUuid, (error, char) => {
            if (error || !char?.value) return;
            callbacks.onCrrepaRxBytes(base64ToBytes(char.value));
          }, this.nextTxId('watch-rx')),
        );
      } catch {
        // Not all watch variants expose every auxiliary notify characteristic.
      }
    }

    try {
      subs.push(
        connected.monitorCharacteristicForService(
          CRREPA_UUIDS.BATTERY_SERVICE,
          CRREPA_UUIDS.BATTERY_LEVEL,
          (error, char) => {
            if (error || !char?.value) return;
            const bytes = base64ToBytes(char.value);
            if (bytes.length > 0) callbacks.onBatteryPercent(clampInt(bytes[0]!, 0, 100));
          },
          this.nextTxId('watch-battery'),
        ),
      );
    } catch {
      // Optional standard battery service
    }

    subs.push(
      connected.onDisconnected(() => {
        this.clearWatchSubs();
        this.watchDevice = null;
        callbacks.onDisconnected();
      }),
    );
    this.watchSubs = subs;
  }

  /** Keep-alive ping: reads RSSI over the live link. Returns dBm, or null if the device can't report it. Throws if the link is dead. */
  async pingEarbuds(): Promise<number | null> {
    return pingDevice(this.earbudsDevice, 'earbuds');
  }

  async pingWatch(): Promise<number | null> {
    return pingDevice(this.watchDevice, 'watch');
  }

  async writeEarbudsBytes(chip: DeviceChip, bytes: Uint8Array): Promise<void> {
    if (!this.earbudsDevice) throw new Error('Live earbuds GATT device is not connected');
    const serviceUuid = chip === DEVICE_CHIP.BT ? BLUETRUM_UUIDS.SERVICE : JIELI_UUIDS.SERVICE;
    const charUuid = chip === DEVICE_CHIP.BT ? BLUETRUM_UUIDS.NOTIFY_WRITE : JIELI_UUIDS.WRITE;
    const b64 = bytesToBase64(bytes);
    // Jieli's AE01 is usually write-without-response only; fall back so writes aren't silently rejected.
    if (this.earbudsWriteNoResponse) {
      await this.earbudsDevice.writeCharacteristicWithoutResponseForService(serviceUuid, charUuid, b64);
      return;
    }
    try {
      await this.earbudsDevice.writeCharacteristicWithResponseForService(serviceUuid, charUuid, b64);
    } catch (err) {
      await this.earbudsDevice.writeCharacteristicWithoutResponseForService(serviceUuid, charUuid, b64);
      this.earbudsWriteNoResponse = true;
      void err;
    }
  }

  async writeWatchBytes(bytes: Uint8Array): Promise<void> {
    if (!this.watchDevice) throw new Error('Live watch GATT device is not connected');
    const b64 = bytesToBase64(bytes);
    try {
      await this.watchDevice.writeCharacteristicWithoutResponseForService(CRREPA_UUIDS.SERVICE, CRREPA_UUIDS.FEE2, b64);
    } catch {
      await this.watchDevice.writeCharacteristicWithResponseForService(CRREPA_UUIDS.SERVICE, CRREPA_UUIDS.FEE1, b64);
    }
  }

  /** Aborts a connect that hasn't completed yet (e.g. an iOS pending reconnect). */
  async cancelPendingConnect(deviceId: string): Promise<void> {
    if (!this.manager || typeof this.manager.cancelDeviceConnection !== 'function') return;
    try { await this.manager.cancelDeviceConnection(deviceId); } catch { /* nothing pending */ }
  }

  async disconnectEarbuds(): Promise<void> {
    this.earbudsSubs = clearSubsList(this.earbudsSubs);
    this.earbudsDevice = await cancelDeviceSafe(this.earbudsDevice);
  }

  async disconnectWatch(): Promise<void> {
    this.watchSubs = clearSubsList(this.watchSubs);
    this.watchDevice = await cancelDeviceSafe(this.watchDevice);
  }

  teardownConnectionsSync(): void {
    this.earbudsSubs = clearSubsList(this.earbudsSubs);
    this.watchSubs = clearSubsList(this.watchSubs);
    if (this.earbudsDevice) {
      void this.earbudsDevice.cancelConnection().catch(() => undefined);
      this.earbudsDevice = null;
    }
    if (this.watchDevice) {
      void this.watchDevice.cancelConnection().catch(() => undefined);
      this.watchDevice = null;
    }
  }

  destroy(): void {
    this.teardownConnectionsSync();
    if (this.manager && typeof this.manager.destroy === 'function') {
      try {
        this.manager.destroy();
      } catch {
        // ignore native teardown errors
      }
      this.manager = null;
    }
  }

  private clearEarbudsSubs(): void {
    this.earbudsSubs = clearSubsList(this.earbudsSubs);
  }

  private clearWatchSubs(): void {
    this.watchSubs = clearSubsList(this.watchSubs);
  }
}

async function pingDevice(device: BlePlxDeviceLike | null, label: string): Promise<number | null> {
  if (!device) throw new Error(`Live ${label} GATT device is not connected`);
  if (typeof device.readRSSI !== 'function') return null;
  const updated = await device.readRSSI();
  return typeof updated?.rssi === 'number' ? updated.rssi : null;
}

function clearSubsList(subs: BlePlxSubscriptionLike[]): BlePlxSubscriptionLike[] {
  for (const sub of subs) {
    try { sub.remove(); } catch { /* ignore */ }
  }
  return [];
}

async function cancelDeviceSafe(device: BlePlxDeviceLike | null): Promise<null> {
  if (device) {
    try { await device.cancelConnection(); } catch { /* ignore */ }
  }
  return null;
}

/** Decodes bytes as ASCII and returns it only if it's a readable string (no control bytes). */
export function printableAscii(bytes: Uint8Array): string | null {
  let out = '';
  for (const b of bytes) {
    if (b === 0) break;
    if (b < 0x20 || b > 0x7e) return null;
    out += String.fromCharCode(b);
  }
  const t = out.trim();
  return t.length > 0 ? t : null;
}

/** Picks the earbuds control protocol from the GATT services a connected device exposes. */
async function detectEarbudsChip(device: BlePlxDeviceLike): Promise<DeviceChip | null> {
  if (typeof device.services !== 'function') return null;
  const uuids = (await device.services().catch(() => [])).map((s) => s.uuid.toLowerCase());
  if (uuids.includes(BLUETRUM_UUIDS.SERVICE.toLowerCase())) return DEVICE_CHIP.BT;
  if (uuids.includes(JIELI_UUIDS.SERVICE.toLowerCase())) return DEVICE_CHIP.JL;
  return null;
}
