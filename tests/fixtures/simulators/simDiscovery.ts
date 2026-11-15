import {
  DEVICE_CHIP,
  getProductById,
} from '../../../src/protocols/ultimaLinkConstants.ts';
import type {
  DeviceChip,
  ProductSpec,
} from '../../../src/protocols/ultimaLinkConstants.ts';
import {
  bytesToHex,
  encodeUltimaLinkAdv,
  parseUltimaLinkAdv,
} from '../../../src/protocols/ultimaLinkAdvParser.ts';
import {
  CRP_MCU_PLATFORM,
  encodeCrpScanRecord,
  parseCrpScanRecord,
} from '../../../src/protocols/ultimaFitCrrepa.ts';
import { DEVICE_KIND } from '../../../src/storage/offlineStore.ts';
import { PACKET_PROTOCOL } from '../../../src/domains/bluetooth/types.ts';
import type { DiscoveredDevice } from '../../../src/domains/bluetooth/types.ts';

export interface SimEarbudsFixture {
  readonly id: string;
  readonly pid: number;
  readonly bid: number;
  readonly companyId: number;
  readonly edrMac: string;
  readonly license: string;
  readonly rssi: number;
}

export interface SimWatchFixture {
  readonly id: string;
  readonly name: string;
  readonly mac: string;
  readonly firmwareType: string;
  readonly firmwareVersion: string;
  readonly platform: number;
  readonly chipId: number;
  readonly functionMask: number;
  readonly rssi: number;
  readonly batteryPercent: number;
  readonly steps: number;
  readonly distanceMeters: number;
  readonly caloriesKcal: number;
  readonly restingHr: number;
  readonly spo2: number;
  readonly systolic: number;
  readonly diastolic: number;
  readonly stress: number;
}

export const SIM_EARBUDS_FIXTURES: readonly SimEarbudsFixture[] = [
  {
    id: 'sim-earbuds-xh68b',
    pid: 0x000a,
    bid: 0x5953,
    companyId: 0x0642,
    edrMac: 'AA:BB:CC:11:22:0A',
    license: 'ultimaxh68banc0a',
    rssi: -46,
  },
  {
    id: 'sim-earbuds-prime1',
    pid: 0x0001,
    bid: 0x5953,
    companyId: 0xd222,
    edrMac: 'AA:BB:CC:11:22:01',
    license: 'ultimaprime10001',
    rssi: -52,
  },
  {
    id: 'sim-earbuds-mega7',
    pid: 0x000e,
    bid: 0x5953,
    companyId: 0xd222,
    edrMac: 'AA:BB:CC:11:22:0E',
    license: 'ultimamega70000e',
    rssi: -58,
  },
  {
    id: 'sim-earbuds-boom311',
    pid: 0x0003,
    bid: 0x5953,
    companyId: 0xd222,
    edrMac: 'AA:BB:CC:11:22:03',
    license: 'ultimaboom311003',
    rssi: -61,
  },
];

export const SIM_WATCH_FIXTURES: readonly SimWatchFixture[] = [
  {
    id: 'sim-watch-magic',
    name: 'ULTIMA Watch Magic',
    mac: 'DD:EE:FF:44:55:01',
    firmwareType: 'MOY',
    firmwareVersion: 'MOY-2.9.19',
    platform: CRP_MCU_PLATFORM.REALTEK,
    chipId: 0x31,
    functionMask: 0x07ff,
    rssi: -49,
    batteryPercent: 84,
    steps: 7840,
    distanceMeters: 5620,
    caloriesKcal: 318,
    restingHr: 68,
    spo2: 98,
    systolic: 118,
    diastolic: 76,
    stress: 34,
  },
  {
    id: 'sim-watch-chronos',
    name: 'Ultima Chronos',
    mac: 'DD:EE:FF:44:55:02',
    firmwareType: 'ULT',
    firmwareVersion: 'ULT-3.1.4',
    platform: CRP_MCU_PLATFORM.SIFLI,
    chipId: 0x52,
    functionMask: 0x0fff,
    rssi: -55,
    batteryPercent: 91,
    steps: 9420,
    distanceMeters: 6850,
    caloriesKcal: 402,
    restingHr: 64,
    spo2: 99,
    systolic: 116,
    diastolic: 74,
    stress: 28,
  },
];

export interface SimulatedDiscoveryResult {
  readonly devices: DiscoveredDevice[];
  readonly advPackets: Array<{
    readonly deviceId: string;
    readonly deviceName: string;
    readonly rawAdv: Uint8Array;
    readonly summary: string;
  }>;
}

/** Builds and parses simulated Ultima Link & CRREPA advertisement packets. */
export function buildSimulatedDiscovery(): SimulatedDiscoveryResult {
  const devices: DiscoveredDevice[] = [];
  const advPackets: SimulatedDiscoveryResult['advPackets'] = [];

  for (const fixture of SIM_EARBUDS_FIXTURES) {
    const rawAdv = encodeUltimaLinkAdv({
      bid: fixture.bid,
      pid: fixture.pid,
      edrConnected: true,
      edrMac: fixture.edrMac,
      license: fixture.license,
    });
    const parsed = parseUltimaLinkAdv(rawAdv, fixture.companyId);
    if (!parsed) continue;
    const product = parsed.product ?? getProductById(fixture.pid);
    const chip = product?.chip ?? DEVICE_CHIP.BT;
    const name = product?.name ?? `Ultima 0x${fixture.pid.toString(16)}`;
    const protocol = chip === DEVICE_CHIP.BT ? PACKET_PROTOCOL.BLUETRUM : PACKET_PROTOCOL.JIELI;

    const device: DiscoveredDevice = {
      id: fixture.id,
      name,
      kind: DEVICE_KIND.EARBUDS,
      rssi: fixture.rssi,
      protocol,
      mac: parsed.edrMac,
      edrMac: parsed.edrMac,
      chip,
      pid: parsed.pid,
      productName: name,
      bid: parsed.bid,
      product,
      edrConnected: parsed.edrConnected,
      license: parsed.license,
      offlineVerified: parsed.offlineVerified,
      advInfo: parsed,
      rawAdvHex: bytesToHex(rawAdv, ' '),
    };
    devices.push(device);
    advPackets.push({
      deviceId: device.id,
      deviceName: device.name,
      rawAdv,
      summary: `ADV ${device.name} (PID 0x${fixture.pid.toString(16).padStart(4, '0')}, ${chip}, offlineVerified)`,
    });
  }

  for (const fixture of SIM_WATCH_FIXTURES) {
    const scanRecord = encodeCrpScanRecord({
      name: fixture.name,
      firmwareType: fixture.firmwareType,
      platform: fixture.platform,
      chipId: fixture.chipId,
      functionMask: fixture.functionMask,
    });
    const parsed = parseCrpScanRecord(scanRecord);
    if (!parsed) continue;
    const device: DiscoveredDevice = {
      id: fixture.id,
      name: parsed.name || fixture.name,
      kind: DEVICE_KIND.WATCH,
      rssi: fixture.rssi,
      protocol: PACKET_PROTOCOL.CRREPA,
      mac: fixture.mac,
      edrMac: fixture.mac,
      offlineVerified: true,
      crpScanInfo: parsed,
      firmwareType: parsed.firmwareType,
      crpFirmware: parsed.firmwareType,
      platform: parsed.platform,
      crpPlatform: parsed.platform,
      chipId: parsed.chipId,
      crpChipId: parsed.chipId,
      functionMask: parsed.functionMask,
      crpFunctionMask: parsed.functionMask,
      rawAdvHex: bytesToHex(scanRecord, ' '),
    };
    devices.push(device);
    advPackets.push({
      deviceId: device.id,
      deviceName: device.name,
      rawAdv: scanRecord,
      summary: `ADV ${device.name} (CRREPA 0xFEEA, FW ${parsed.firmwareType})`,
    });
  }

  return { devices, advPackets };
}

export function buildFallbackEarbudsSpec(device: DiscoveredDevice, chip: DeviceChip): ProductSpec {
  return {
    id: device.pid ?? 0x000a,
    code: 'SIM',
    name: device.name,
    chip,
    headsetType: 'TWS',
    supportsAnc: true,
    supportsGameMode: true,
    supportsCaseKeys: chip === DEVICE_CHIP.BT,
    supportsDualConnect: chip === DEVICE_CHIP.BT,
    supportsLdac: chip === DEVICE_CHIP.BT,
    supportsSpatialAudio: chip === DEVICE_CHIP.BT,
    supportsSignatureBalanceEq: true,
    supportsOta: false,
  };
}

export function resolveSimWatchFixture(deviceId: string): SimWatchFixture {
  return SIM_WATCH_FIXTURES.find((f) => f.id === deviceId) ?? SIM_WATCH_FIXTURES[0]!;
}
