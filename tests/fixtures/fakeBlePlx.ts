/**
 * Test-only fake of `react-native-ble-plx` backed by protocol-level device
 * simulators. Lets the production (live BLE) code path in UltimaBleManager be
 * exercised end-to-end in Node without radios or native modules.
 */
import { BLUETRUM_UUIDS, DEVICE_CHIP, JIELI_UUIDS, getProductById } from '../../src/protocols/ultimaLinkConstants.ts';
import type { DeviceChip } from '../../src/protocols/ultimaLinkConstants.ts';
import { encodeUltimaLinkAdv } from '../../src/protocols/ultimaLinkAdvParser.ts';
import { JIELI_AUTH_OK, jieliAuthResponse } from '../../src/domains/audio/jieli/auth.ts';
import { CRREPA_UUIDS, encodeCrpScanRecord } from '../../src/protocols/ultimaFitCrrepa.ts';
import { DEVICE_KIND, OfflineStore } from '../../src/storage/offlineStore.ts';
import { UltimaBleManager } from '../../src/services/bleManager.ts';
import type {
  BlePlxCharacteristicLike,
  BlePlxDeviceLike,
  BlePlxManagerLike,
  BlePlxSubscriptionLike,
} from '../../src/services/bleManager.ts';
import { bytesToBase64, base64ToBytes } from '../../src/domains/bluetooth/controllers/liveBleAdapter.ts';
import { SimBluetrumEarbuds } from './simulators/simBluetrumEarbuds.ts';
import { SimJieliEarbuds } from './simulators/simJieliEarbuds.ts';
import { SimCrrepaWatch } from './simulators/simCrrepaWatch.ts';
import {
  SIM_EARBUDS_FIXTURES,
  SIM_WATCH_FIXTURES,
  buildFallbackEarbudsSpec,
} from './simulators/simDiscovery.ts';
import type { SimEarbudsFixture, SimWatchFixture } from './simulators/simDiscovery.ts';

type FakeGattDevice = BlePlxDeviceLike & { simulateLinkLoss: () => void };

type CharListener = (error: Error | null, characteristic: BlePlxCharacteristicLike | null) => void;

interface Peripheral {
  readonly fixtureId: string;
  readonly advertised: Omit<BlePlxDeviceLike, 'connect' | 'discoverAllServicesAndCharacteristics' | 'requestMTU' |
    'writeCharacteristicWithResponseForService' | 'writeCharacteristicWithoutResponseForService' |
    'monitorCharacteristicForService' | 'cancelConnection' | 'onDisconnected'>;
  readonly connect: () => BlePlxDeviceLike;
}

/** Extracts the 0xFEEA service-data bytes (after the UUID) from a CRREPA scan record. */
function extractFeeaServiceData(scanRecord: Uint8Array): Uint8Array {
  let i = 0;
  while (i < scanRecord.length) {
    const len = scanRecord[i]!;
    if (len === 0) break;
    const type = scanRecord[i + 1];
    if (type === 0x16 && scanRecord[i + 2] === 0xea && scanRecord[i + 3] === 0xfe) {
      return scanRecord.slice(i + 4, i + 1 + len);
    }
    i += 1 + len;
  }
  throw new Error('CRREPA scan record has no 0xFEEA service data');
}

function makeGattDevice(
  base: Peripheral['advertised'],
  notifyChar: string,
  receive: (bytes: Uint8Array) => Uint8Array[],
  extraNotify?: { char: string; value: () => Uint8Array },
): BlePlxDeviceLike {
  const listeners = new Map<string, Set<CharListener>>();
  const disconnectListeners = new Set<(error: Error | null, device: BlePlxDeviceLike) => void>();
  const sub = (set: Set<unknown>, item: unknown): BlePlxSubscriptionLike => {
    set.add(item);
    return { remove: () => { set.delete(item); } };
  };
  const notify = (char: string, bytes: Uint8Array): void => {
    for (const l of listeners.get(char) ?? []) l(null, { uuid: char, value: bytesToBase64(bytes) });
  };
  // Responses are delivered synchronously before the write resolves, matching a
  // fast peripheral whose notification arrives within the GATT write round-trip.
  const write = async (_svc: string, _char: string, valueB64: string): Promise<unknown> => {
    for (const rx of receive(base64ToBytes(valueB64))) notify(notifyChar, rx);
    return null;
  };
  const device: BlePlxDeviceLike = {
    ...base,
    async connect() { return device; },
    async discoverAllServicesAndCharacteristics() { return device; },
    async requestMTU() { return device; },
    writeCharacteristicWithResponseForService: write,
    writeCharacteristicWithoutResponseForService: write,
    monitorCharacteristicForService(_svc, charUuid, listener) {
      let set = listeners.get(charUuid);
      if (!set) { set = new Set(); listeners.set(charUuid, set); }
      const s = sub(set, listener);
      if (extraNotify && charUuid === extraNotify.char) {
        const value = extraNotify.value();
        queueMicrotask(() => listener(null, { uuid: charUuid, value: bytesToBase64(value) }));
      }
      return s;
    },
    async cancelConnection() {
      for (const l of disconnectListeners) l(null, device);
      listeners.clear();
      return device;
    },
    onDisconnected(listener) { return sub(disconnectListeners, listener); },
    async readRSSI() {
      if (lost) throw new Error('Fake BLE: link lost');
      return { ...device, rssi: (base.rssi ?? -60) - 2 };
    },
  };
  let lost = false;
  (device as FakeGattDevice).simulateLinkLoss = () => {
    lost = true;
    const pending = [...disconnectListeners];
    listeners.clear();
    disconnectListeners.clear();
    for (const l of pending) l(new Error('Link supervision timeout'), device);
  };
  return device;
}

function earbudsPeripheral(fixture: SimEarbudsFixture, store: OfflineStore): Peripheral {
  const payload = encodeUltimaLinkAdv({
    bid: fixture.bid, pid: fixture.pid, edrConnected: true, edrMac: fixture.edrMac, license: fixture.license,
  });
  const mfg = Uint8Array.of(fixture.companyId & 0xff, (fixture.companyId >> 8) & 0xff, ...payload);
  const product = getProductById(fixture.pid);
  const name = product?.name ?? `Ultima 0x${fixture.pid.toString(16)}`;
  const advertised: Peripheral['advertised'] = {
    id: fixture.id, name, localName: name, rssi: fixture.rssi,
    manufacturerData: bytesToBase64(mfg), serviceData: null, serviceUUIDs: null,
  };
  return {
    fixtureId: fixture.id,
    advertised,
    connect: () => {
      const chip: DeviceChip = product?.chip ?? DEVICE_CHIP.BT;
      const spec = product ?? buildFallbackEarbudsSpec({ id: fixture.id, name, pid: fixture.pid } as never, chip);
      const prefs = store.getState().earbudPrefs[fixture.id];
      if (chip === DEVICE_CHIP.BT) {
        const sim = new SimBluetrumEarbuds(spec, prefs);
        return makeGattDevice(advertised, BLUETRUM_UUIDS.NOTIFY_WRITE, (b) => sim.receivePacket(b));
      }
      const sim = new SimJieliEarbuds(spec, prefs);
      return makeGattDevice(advertised, JIELI_UUIDS.NOTIFY, jieliAuthGate((b) => sim.receivePacket(b)));
    },
  };
}

/**
 * Real Jieli earbuds answer the RcspAuth challenge/response before any RCSP
 * command; emulate the device side so the production handshake completes.
 */
function jieliAuthGate(inner: (bytes: Uint8Array) => Uint8Array[]): (bytes: Uint8Array) => Uint8Array[] {
  const deviceChallenge = Uint8Array.of(0x00, ...Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff));
  return (bytes) => {
    if (bytes.length === 17 && bytes[0] === 0x00) return [jieliAuthResponse(bytes)];
    if (bytes.length === 5 && bytes[0] === 0x02) return [deviceChallenge];
    if (bytes.length === 17 && bytes[0] === 0x01) {
      const expected = jieliAuthResponse(deviceChallenge);
      return expected.every((b, i) => b === bytes[i]) ? [JIELI_AUTH_OK] : [];
    }
    if (bytes.length === 10 && bytes[4] === 0x06) return []; // reset-auth flag
    return inner(bytes);
  };
}

function watchPeripheral(fixture: SimWatchFixture, store: OfflineStore): Peripheral {
  const record = encodeCrpScanRecord({
    name: fixture.name, firmwareType: fixture.firmwareType, platform: fixture.platform,
    chipId: fixture.chipId, functionMask: fixture.functionMask,
  });
  const advertised: Peripheral['advertised'] = {
    id: fixture.id, name: fixture.name, localName: fixture.name, rssi: fixture.rssi,
    manufacturerData: null, serviceData: { feea: bytesToBase64(extractFeeaServiceData(record)) },
    serviceUUIDs: [CRREPA_UUIDS.SERVICE],
  };
  return {
    fixtureId: fixture.id,
    advertised,
    connect: () => {
      const state = store.getState();
      const hasPairedWatch = state.pairedDevices.some((d) => d.kind === DEVICE_KIND.WATCH);
      const sim = new SimCrrepaWatch(fixture, state.watchSettings, state.watchAlarms, hasPairedWatch);
      return makeGattDevice(advertised, CRREPA_UUIDS.FEE1, (b) => sim.receivePacket(b), {
        char: CRREPA_UUIDS.BATTERY_LEVEL,
        value: () => Uint8Array.of(fixture.batteryPercent),
      });
    },
  };
}

export interface FakeRadioControls {
  /** Drops the live link as if the device walked out of range (fires onDisconnected). */
  dropLink(deviceId: string): void;
  /** While out of range, connect attempts fail (or stay pending for persistent connects). */
  setInRange(deviceId: string, inRange: boolean): void;
  connectCalls: Array<{ deviceId: string; options: { timeout?: number; autoConnect?: boolean } | undefined }>;
}

/** Builds a fake BleManager advertising every simulator fixture. */
export function createFakeBleManager(store: OfflineStore): BlePlxManagerLike & FakeRadioControls {
  const peripherals = [
    ...SIM_EARBUDS_FIXTURES.map((f) => earbudsPeripheral(f, store)),
    ...SIM_WATCH_FIXTURES.map((f) => watchPeripheral(f, store)),
  ];
  const live = new Map<string, FakeGattDevice>();
  const outOfRange = new Set<string>();
  const pendingPersistent = new Map<string, Array<() => void>>();
  const connectCalls: FakeRadioControls['connectCalls'] = [];
  return {
    connectCalls,
    dropLink(deviceId) {
      live.get(deviceId)?.simulateLinkLoss();
      live.delete(deviceId);
    },
    setInRange(deviceId, inRange) {
      if (inRange) {
        outOfRange.delete(deviceId);
        for (const resume of pendingPersistent.get(deviceId) ?? []) resume();
        pendingPersistent.delete(deviceId);
      } else outOfRange.add(deviceId);
    },
    async cancelDeviceConnection(deviceId) {
      pendingPersistent.delete(deviceId);
      return null;
    },
    startDeviceScan(_uuids, _opts, listener) {
      for (const p of peripherals) {
        setTimeout(() => listener(null, { ...p.advertised } as BlePlxDeviceLike), 0);
      }
    },
    stopDeviceScan() {},
    async connectToDevice(deviceId, options) {
      connectCalls.push({ deviceId, options });
      const p = peripherals.find((x) => x.fixtureId === deviceId);
      if (!p) throw new Error(`Fake BLE: unknown device ${deviceId}`);
      if (outOfRange.has(deviceId)) {
        // Like iOS: a connect without timeout stays pending until the device returns.
        if (options?.timeout === undefined) {
          await new Promise<void>((resolve) => {
            const list = pendingPersistent.get(deviceId) ?? [];
            list.push(resolve);
            pendingPersistent.set(deviceId, list);
          });
        } else {
          throw new Error(`Fake BLE: connection to ${deviceId} timed out`);
        }
      }
      const device = p.connect() as FakeGattDevice;
      live.set(deviceId, device);
      return device;
    },
    async state() { return 'PoweredOn'; },
    destroy() {},
  };
}

/** Lets pending timers/microtasks (async CRREPA RX followups) settle. */
export async function flushBle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Production UltimaBleManager wired to the fake radio. `startScan()` resolves
 * as soon as all fixtures have advertised instead of waiting the full window,
 * and `connectDevice()` scans first when the id hasn't been discovered yet.
 */
export function createTestManager(store: OfflineStore, options?: { liveGpsSyncTimeoutMs?: number }): UltimaBleManager {
  return createTestRig(store, options).manager;
}

/** Same as createTestManager, plus handles to drive the fake radio. */
export function createTestRig(
  store: OfflineStore,
  options?: { liveGpsSyncTimeoutMs?: number; reconnectStrategy?: 'retry' | 'pending'; keepAlivePingMs?: number },
): { manager: UltimaBleManager; radio: FakeRadioControls } {
  const radio = createFakeBleManager(store);
  const manager = new UltimaBleManager(store, {
    liveBleManager: radio,
    liveGpsSyncTimeoutMs: options?.liveGpsSyncTimeoutMs ?? 2500,
    ...(options?.reconnectStrategy ? { reconnectStrategy: options.reconnectStrategy } : {}),
    ...(options?.keepAlivePingMs !== undefined ? { keepAlivePingMs: options.keepAlivePingMs } : {}),
  });
  const realScan = manager.startScan.bind(manager);
  manager.startScan = async () => {
    const pending = realScan();
    await flushBle(2);
    manager.stopScan();
    return pending;
  };
  const realConnect = manager.connectDevice.bind(manager);
  manager.connectDevice = async (id: string) => {
    if (!manager.getSnapshot().discovered.some((d) => d.id === id)) await manager.startScan();
    await realConnect(id);
    await flushBle();
  };
  return { manager, radio };
}
