import { DEVICE_CHIP, EQ_PRESETS, getProductById } from '../../protocols/ultimaLinkConstants.ts';
import type { DeviceChip, ProductSpec } from '../../protocols/ultimaLinkConstants.ts';
import type { UltimaAdvInfo } from '../../protocols/ultimaLinkAdvParser.ts';
import type { BluetrumDeviceCapacities } from '../../protocols/ultimaLinkBluetrum.ts';
import type { CrpScanInfo, CrpSleepSegment } from '../../protocols/ultimaFitCrrepa.ts';
import { DEVICE_KIND, createDefaultEarbudPrefs, createDefaultWatchSettings } from '../../storage/offlineStore.ts';
import type {
  AncMode, CaseGesture, CaseKeyAction, DeviceKind, DrinkReminderPeriod, EarbudGesture,
  EarbudKeyFunction, EarbudKeyMappings, GpsWorkoutRoute, LastKnownLocation,
  OfflineAppState, VoiceLanguage, WatchAlarmRecord, WatchSettings,
} from '../../storage/offlineStore.ts';

// Exported Bluetooth Transport Constants & State Contracts
export const CONNECTION_MODE = { SIMULATOR: 'simulator', LIVE_BLE: 'live_ble' } as const;
export type ConnectionMode = (typeof CONNECTION_MODE)[keyof typeof CONNECTION_MODE];

export const PACKET_DIRECTION = { TX: 'TX', RX: 'RX' } as const;
export type PacketDirection = (typeof PACKET_DIRECTION)[keyof typeof PACKET_DIRECTION];

export const PACKET_PROTOCOL = { ADV: 'adv', BLUETRUM: 'bluetrum', JIELI: 'jieli', CRREPA: 'crrepa' } as const;
export type PacketProtocol = (typeof PACKET_PROTOCOL)[keyof typeof PACKET_PROTOCOL];

export interface PacketLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly direction: PacketDirection;
  readonly target: 'earbuds' | 'watch';
  readonly protocol: PacketProtocol;
  readonly label: string;
  readonly summary: string;
  readonly hex: string;
  readonly length: number;
  readonly byteLength: number;
  readonly uuid?: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly cmd?: number;
}

export interface DiscoveredDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly rssi: number;
  readonly protocol: PacketProtocol;
  readonly mac?: string;
  readonly edrMac?: string;
  readonly chip?: DeviceChip;
  readonly pid?: number;
  readonly bid?: number;
  readonly product?: ProductSpec;
  readonly productName?: string;
  readonly edrConnected?: boolean;
  readonly license?: string;
  readonly offlineVerified: boolean;
  readonly advInfo?: UltimaAdvInfo;
  readonly crpScanInfo?: CrpScanInfo;
  readonly firmwareType?: string;
  readonly crpFirmware?: string;
  readonly platform?: number;
  readonly crpPlatform?: number;
  readonly chipId?: number;
  readonly crpChipId?: number;
  readonly functionMask?: number;
  readonly crpFunctionMask?: number;
  readonly rawAdvHex: string;
  readonly isSimulated: boolean;
}

export interface EarbudsBatteryState {
  readonly left: number; readonly leftCharging: boolean;
  readonly right: number; readonly rightCharging: boolean;
  readonly case: number; readonly caseCharging: boolean;
}

export interface EarbudsLiveKeyMappings {
  left: Record<EarbudGesture, EarbudKeyFunction>;
  right: Record<EarbudGesture, EarbudKeyFunction>;
  caseKeys: Record<CaseGesture, CaseKeyAction>;
}

export interface DeviceGeoPin {
  readonly lat: number; readonly lng: number; readonly note: string;
  readonly savedAt: number; readonly role: 'left_earbud' | 'right_earbud' | 'case' | 'watch';
}

export interface EarbudSideLocations {
  readonly left: DeviceGeoPin | null; readonly right: DeviceGeoPin | null; readonly casePin: DeviceGeoPin | null;
}

export interface EarbudsLiveState {
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly deviceId: string | null;
  readonly name: string;
  readonly deviceName: string;
  readonly chip: DeviceChip;
  readonly pid: number | null;
  readonly productId: number;
  readonly mac: string | null;
  readonly product: ProductSpec | null;
  readonly firmwareVersion: string;
  readonly battery: EarbudsBatteryState;
  readonly leftBattery: number;
  readonly leftCharging: boolean;
  readonly rightBattery: number;
  readonly rightCharging: boolean;
  readonly caseBattery: number;
  readonly caseCharging: boolean;
  readonly volume: number;
  readonly playing: boolean;
  readonly ancMode: AncMode;
  readonly ancGain: number;
  readonly ancGainMax: number;
  readonly transparencyGain: number;
  readonly transparencyGainMax: number;
  readonly eqPresetName: string;
  readonly eqModeByte: number;
  readonly eqGains: number[];
  readonly eqCrcHex: string | null;
  readonly gameMode: boolean;
  readonly spatialAudio: boolean;
  readonly soundEffect3d: boolean;
  readonly ldac: boolean;
  readonly ldacEnabled: boolean;
  readonly inEarDetect: boolean;
  readonly dualConnect: boolean;
  readonly ledOn: boolean;
  readonly ledEnabled: boolean;
  readonly autoAnswer: boolean;
  readonly voiceLanguage: VoiceLanguage;
  readonly keyMappings: EarbudsLiveKeyMappings;
  readonly finding: boolean;
  readonly findingActive: boolean;
  readonly lastKnownLocation: LastKnownLocation | null;
  readonly sideLocations: EarbudSideLocations;
  readonly capacities: BluetrumDeviceCapacities | null;
  readonly lastSyncedAt: number | null;
}

export interface WatchSleepLiveState {
  readonly deepMinutes: number;
  readonly lightMinutes: number;
  readonly remMinutes: number;
  readonly awakeMinutes: number;
  readonly totalMinutes: number;
  readonly napMinutes: number;
  readonly segments: readonly CrpSleepSegment[];
}

export interface WatchHeartRateLiveState {
  readonly currentBpm: number;
  readonly restingBpm: number;
  readonly measuring: boolean;
  readonly samples24h: readonly number[];
}

export interface WatchSpO2LiveState {
  readonly percent: number;
  readonly measuring: boolean;
  readonly samples24h: readonly number[];
}

export interface WatchBloodPressureLiveState {
  readonly systolic: number;
  readonly diastolic: number;
  readonly measuring: boolean;
}

export interface WatchStressLiveState {
  readonly score: number;
  readonly samples30m: readonly number[];
}

export interface WatchNotificationRecord {
  readonly messageType: number;
  readonly text: string;
  readonly sentAt: number;
}

export interface WatchLiveState {
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly deviceId: string | null;
  readonly name: string;
  readonly deviceName: string;
  readonly mac: string | null;
  readonly firmwareType: string;
  readonly firmwareVersion: string | null;
  readonly platform: number | null;
  readonly chipId: number | null;
  readonly functionMask: number;
  readonly batteryPercent: number;
  readonly steps: number;
  readonly distanceMeters: number;
  readonly caloriesKcal: number;
  readonly stepBuckets48: number[];
  readonly sleep: WatchSleepLiveState;
  readonly sleepDeepMin: number;
  readonly sleepLightMin: number;
  readonly sleepRemMin: number;
  readonly sleepAwakeMin: number;
  readonly heartRate: WatchHeartRateLiveState;
  readonly heartRateBpm: number;
  readonly measuringHr: boolean;
  readonly spo2: WatchSpO2LiveState;
  readonly spo2Percent: number;
  readonly measuringSpo2: boolean;
  readonly bloodPressure: WatchBloodPressureLiveState;
  readonly systolicBp: number;
  readonly diastolicBp: number;
  readonly measuringBp: boolean;
  readonly stress: WatchStressLiveState;
  readonly stressScore: number;
  readonly alarms: WatchAlarmRecord[];
  readonly settings: WatchSettings;
  readonly goalSteps: number;
  readonly is24Hour: boolean;
  readonly quickView: boolean;
  readonly watchFaceId: number;
  readonly imperialUnits: boolean;
  readonly languageId: number;
  readonly sedentaryReminder: boolean;
  readonly hrIntervalMinutes: number;
  readonly drinkReminderPeriod: DrinkReminderPeriod;
  readonly lastNotification: WatchNotificationRecord | null;
  readonly lastNotificationSent?: WatchNotificationRecord;
  readonly finding: boolean;
  readonly lastKnownLocation: LastKnownLocation | null;
  readonly gpsRoutes: GpsWorkoutRoute[];
  readonly gpsSyncing: boolean;
  readonly lastSyncedAt: number | null;
}

export interface BleManagerSnapshot {
  readonly initialized: boolean;
  readonly mode: ConnectionMode;
  readonly bleAvailable: boolean;
  readonly scanning: boolean;
  readonly lastError: string | null;
  readonly discovered: DiscoveredDevice[];
  readonly earbuds: EarbudsLiveState;
  readonly watch: WatchLiveState;
  readonly packetLogs: PacketLogEntry[];
  readonly storeState: OfflineAppState;
}

// ---------------------------------------------------------------------------
// Lazy BLE-PLX Adapter Interfaces
// ---------------------------------------------------------------------------

export interface BlePlxSubscriptionLike {
  remove(): void;
}

export interface BlePlxCharacteristicLike {
  uuid: string;
  value: string | null;
}

export interface BlePlxDeviceLike {
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
  manufacturerData: string | null;
  serviceData: Record<string, string> | null;
  serviceUUIDs: string[] | null;
  connect(): Promise<BlePlxDeviceLike>;
  discoverAllServicesAndCharacteristics(): Promise<BlePlxDeviceLike>;
  requestMTU?(mtu: number): Promise<BlePlxDeviceLike>;
  writeCharacteristicWithResponseForService(serviceUUID: string, characteristicUUID: string, valueBase64: string): Promise<unknown>;
  writeCharacteristicWithoutResponseForService(serviceUUID: string, characteristicUUID: string, valueBase64: string): Promise<unknown>;
  monitorCharacteristicForService(
    serviceUUID: string, characteristicUUID: string,
    listener: (error: Error | null, characteristic: BlePlxCharacteristicLike | null) => void,
  ): BlePlxSubscriptionLike;
  cancelConnection(): Promise<BlePlxDeviceLike>;
  onDisconnected(listener: (error: Error | null, device: BlePlxDeviceLike) => void): BlePlxSubscriptionLike;
}

export interface BlePlxManagerLike {
  startDeviceScan(
    UUIDs: string[] | null, options: Record<string, unknown> | null,
    listener: (error: Error | null, device: BlePlxDeviceLike | null) => void,
  ): void;
  stopDeviceScan(): void;
  connectToDevice(deviceId: string): Promise<BlePlxDeviceLike>;
  destroy?(): void;
}

// Default State Builders, Sync Normalization & Cloning Helpers
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const EARBUD_GESTURES: readonly EarbudGesture[] = ['single', 'double', 'triple', 'longPress'];
const CASE_GESTURES: readonly CaseGesture[] = ['single', 'double', 'triple', 'longPress', 'rotation'];

export function createCaseKeyControl(keyFunction: number, callControl = 0): CaseKeyAction {
  const obj: CaseKeyAction = { keyFunction, callControl };
  Object.defineProperty(obj, 'valueOf', { value: () => keyFunction, enumerable: false });
  return obj;
}

export function cloneEarbudKeyMappings(m: EarbudKeyMappings): EarbudsLiveKeyMappings {
  const defaults = createDefaultEarbudPrefs().keyMappings;
  const cloneSide = (side: 'left' | 'right'): Record<EarbudGesture, EarbudKeyFunction> => {
    const out = {} as Record<EarbudGesture, EarbudKeyFunction>;
    for (const g of EARBUD_GESTURES) out[g] = m[side][g] ?? defaults[side][g] ?? 0;
    return out;
  };
  const caseKeys = {} as Record<CaseGesture, CaseKeyAction>;
  for (const g of CASE_GESTURES) {
    caseKeys[g] = createCaseKeyControl(
      m.caseKeys[g]?.keyFunction ?? defaults.caseKeys[g]?.keyFunction ?? 0,
      m.caseKeys[g]?.callControl ?? defaults.caseKeys[g]?.callControl ?? 0,
    );
  }
  return { left: cloneSide('left'), right: cloneSide('right'), caseKeys };
}

export function cloneEarbudSideLocations(sides: EarbudSideLocations): EarbudSideLocations {
  return {
    left: sides.left ? { ...sides.left } : null,
    right: sides.right ? { ...sides.right } : null,
    casePin: sides.casePin ? { ...sides.casePin } : null,
  };
}

export function deriveEarbudSideLocations(
  base: LastKnownLocation | null,
  existing?: EarbudSideLocations,
): EarbudSideLocations {
  if (!base) {
    return existing ? cloneEarbudSideLocations(existing) : { left: null, right: null, casePin: null };
  }
  const pickPin = (pin: DeviceGeoPin | null | undefined, fallback: DeviceGeoPin): DeviceGeoPin =>
    pin && pin.savedAt > base.savedAt ? { ...pin } : fallback;
  return {
    left: pickPin(existing?.left, {
      lat: Number((base.lat + 0.000045).toFixed(6)), lng: Number((base.lng - 0.000062).toFixed(6)),
      note: `${base.note} (Left Bud)`, savedAt: base.savedAt, role: 'left_earbud',
    }),
    right: pickPin(existing?.right, {
      lat: Number((base.lat - 0.000038).toFixed(6)), lng: Number((base.lng + 0.000058).toFixed(6)),
      note: `${base.note} (Right Bud)`, savedAt: base.savedAt, role: 'right_earbud',
    }),
    casePin: pickPin(existing?.casePin, {
      lat: base.lat, lng: base.lng, note: `${base.note} (Charging Case)`, savedAt: base.savedAt, role: 'case',
    }),
  };
}

export function cloneGpsRoutes(routes: readonly GpsWorkoutRoute[]): GpsWorkoutRoute[] {
  return routes.map((route) => ({ ...route, waypoints: route.waypoints.map((wp) => ({ ...wp })) }));
}

export function syncEarbudsState(state: EarbudsLiveState): EarbudsLiveState {
  const battery: EarbudsBatteryState = { ...state.battery };
  return {
    ...state,
    deviceName: state.name,
    productId: state.pid ?? state.productId ?? 0,
    battery,
    leftBattery: battery.left, leftCharging: battery.leftCharging,
    rightBattery: battery.right, rightCharging: battery.rightCharging,
    caseBattery: battery.case, caseCharging: battery.caseCharging,
    eqGains: [...state.eqGains],
    ldacEnabled: state.ldac,
    ledEnabled: state.ledOn,
    findingActive: state.finding,
    keyMappings: cloneEarbudKeyMappings(state.keyMappings),
    lastKnownLocation: state.lastKnownLocation ? { ...state.lastKnownLocation } : null,
    sideLocations: deriveEarbudSideLocations(state.lastKnownLocation, state.sideLocations),
    capacities: state.capacities ? { ...state.capacities } : null,
  };
}

export function syncWatchState(state: WatchLiveState): WatchLiveState {
  const settings: WatchSettings = {
    ...state.settings,
    drinkReminderPeriod: { ...state.settings.drinkReminderPeriod },
    notificationRules: { ...state.settings.notificationRules },
  };
  const lastNotif = state.lastNotification ? { ...state.lastNotification } : null;
  const synced: WatchLiveState = {
    ...state,
    deviceName: state.name,
    stepBuckets48: [...state.stepBuckets48],
    sleep: { ...state.sleep, segments: state.sleep.segments.map((s) => ({ ...s })) },
    sleepDeepMin: state.sleep.deepMinutes, sleepLightMin: state.sleep.lightMinutes,
    sleepRemMin: state.sleep.remMinutes, sleepAwakeMin: state.sleep.awakeMinutes,
    heartRate: { ...state.heartRate, samples24h: [...state.heartRate.samples24h] },
    heartRateBpm: state.heartRate.currentBpm, measuringHr: state.heartRate.measuring,
    spo2: { ...state.spo2, samples24h: [...state.spo2.samples24h] },
    spo2Percent: state.spo2.percent, measuringSpo2: state.spo2.measuring,
    bloodPressure: { ...state.bloodPressure },
    systolicBp: state.bloodPressure.systolic, diastolicBp: state.bloodPressure.diastolic,
    measuringBp: state.bloodPressure.measuring,
    stress: { ...state.stress, samples30m: [...state.stress.samples30m] },
    stressScore: state.stress.score,
    alarms: state.alarms.map((a) => ({ ...a })),
    settings,
    goalSteps: settings.goalSteps, is24Hour: settings.is24Hour, quickView: settings.quickView,
    watchFaceId: settings.watchFaceId, imperialUnits: settings.imperialUnits, languageId: settings.languageId,
    sedentaryReminder: settings.sedentaryReminder, hrIntervalMinutes: settings.hrIntervalMinutes,
    drinkReminderPeriod: { ...settings.drinkReminderPeriod },
    lastNotification: lastNotif,
    ...(lastNotif ? { lastNotificationSent: { ...lastNotif } } : {}),
    lastKnownLocation: state.lastKnownLocation ? { ...state.lastKnownLocation } : null,
    gpsRoutes: cloneGpsRoutes(state.gpsRoutes),
  };
  if (!lastNotif && 'lastNotificationSent' in synced) {
    delete (synced as { lastNotificationSent?: WatchNotificationRecord }).lastNotificationSent;
  }
  return synced;
}

export function createEmptyEarbudsState(): EarbudsLiveState {
  const prefs = createDefaultEarbudPrefs();
  return syncEarbudsState({
    connected: false, connecting: false, deviceId: null, name: 'No Earbuds Connected', deviceName: 'No Earbuds Connected',
    chip: DEVICE_CHIP.BT, pid: null, productId: 0, mac: null, product: null, firmwareVersion: '',
    battery: { left: 0, leftCharging: false, right: 0, rightCharging: false, case: 0, caseCharging: false },
    leftBattery: 0, leftCharging: false, rightBattery: 0, rightCharging: false, caseBattery: 0, caseCharging: false,
    volume: 0, playing: false, ancMode: prefs.ancMode, ancGain: prefs.ancGain, ancGainMax: 10,
    transparencyGain: prefs.transparencyGain, transparencyGainMax: 10, eqPresetName: 'Flat', eqModeByte: 0,
    eqGains: [...EQ_PRESETS.FLAT], eqCrcHex: null, gameMode: prefs.gameMode, spatialAudio: prefs.spatialAudio,
    soundEffect3d: false, ldac: prefs.ldac, ldacEnabled: prefs.ldac, inEarDetect: prefs.inEarDetect,
    dualConnect: prefs.dualConnect, ledOn: prefs.ledOn, ledEnabled: prefs.ledOn, autoAnswer: false,
    voiceLanguage: prefs.voiceLanguage, keyMappings: cloneEarbudKeyMappings(prefs.keyMappings),
    finding: false, findingActive: false, lastKnownLocation: null,
    sideLocations: { left: null, right: null, casePin: null }, capacities: null, lastSyncedAt: null,
  });
}

export function createEmptyWatchState(settings?: WatchSettings): WatchLiveState {
  const s = settings ?? createDefaultWatchSettings();
  return syncWatchState({
    connected: false, connecting: false, deviceId: null, name: 'No Watch Connected', deviceName: 'No Watch Connected',
    mac: null, firmwareType: '', firmwareVersion: null, platform: null, chipId: null, functionMask: 0,
    batteryPercent: 0, steps: 0, distanceMeters: 0, caloriesKcal: 0, stepBuckets48: [],
    sleep: { deepMinutes: 0, lightMinutes: 0, remMinutes: 0, awakeMinutes: 0, totalMinutes: 0, napMinutes: 0, segments: [] },
    sleepDeepMin: 0, sleepLightMin: 0, sleepRemMin: 0, sleepAwakeMin: 0,
    heartRate: { currentBpm: 0, restingBpm: 0, measuring: false, samples24h: [] },
    heartRateBpm: 0, measuringHr: false, spo2: { percent: 0, measuring: false, samples24h: [] },
    spo2Percent: 0, measuringSpo2: false, bloodPressure: { systolic: 0, diastolic: 0, measuring: false },
    systolicBp: 0, diastolicBp: 0, measuringBp: false, stress: { score: 0, samples30m: [] }, stressScore: 0,
    alarms: [], settings: s, goalSteps: s.goalSteps, is24Hour: s.is24Hour, quickView: s.quickView,
    watchFaceId: s.watchFaceId, imperialUnits: s.imperialUnits, languageId: s.languageId,
    sedentaryReminder: s.sedentaryReminder, hrIntervalMinutes: s.hrIntervalMinutes,
    drinkReminderPeriod: { ...s.drinkReminderPeriod }, lastNotification: null, finding: false,
    lastKnownLocation: null, gpsRoutes: [], gpsSyncing: false, lastSyncedAt: null,
  });
}

/** Rehydrates live earbuds state from persisted OfflineStore paired device & preference records. */
export function hydrateEarbudsFromStore(state: OfflineAppState): EarbudsLiveState {
  const latest = state.pairedDevices.find((d) => d.kind === DEVICE_KIND.EARBUDS);
  if (!latest) return createEmptyEarbudsState();
  const prefs = state.earbudPrefs[latest.id];
  const product = latest.pid !== undefined ? (getProductById(latest.pid) ?? null) : null;
  return syncEarbudsState({
    ...createEmptyEarbudsState(), name: prefs?.customBtName ?? latest.name,
    chip: latest.chip ?? product?.chip ?? DEVICE_CHIP.BT, pid: latest.pid ?? null, productId: latest.pid ?? product?.id ?? 0,
    mac: latest.mac ?? null, product, lastKnownLocation: latest.lastKnownLocation ? { ...latest.lastKnownLocation } : null,
    ...(prefs ? {
      ancMode: prefs.ancMode, ancGain: prefs.ancGain, transparencyGain: prefs.transparencyGain, gameMode: prefs.gameMode,
      spatialAudio: prefs.spatialAudio, ldac: prefs.ldac, inEarDetect: prefs.inEarDetect, dualConnect: prefs.dualConnect,
      ledOn: prefs.ledOn, voiceLanguage: prefs.voiceLanguage, keyMappings: cloneEarbudKeyMappings(prefs.keyMappings),
    } : {}),
  });
}

/** Rehydrates live watch state from persisted OfflineStore settings, alarms, GPS routes, and health history. */
export function hydrateWatchFromStore(state: OfflineAppState): WatchLiveState {
  const latestWatch = state.pairedDevices.find((d) => d.kind === DEVICE_KIND.WATCH);
  const latestDay = state.healthHistory.length > 0 ? state.healthHistory[state.healthHistory.length - 1] : undefined;
  return syncWatchState({
    ...createEmptyWatchState(state.watchSettings),
    ...(latestWatch ? { name: latestWatch.name, mac: latestWatch.mac ?? null, lastKnownLocation: latestWatch.lastKnownLocation ? { ...latestWatch.lastKnownLocation } : null } : {}),
    alarms: state.watchAlarms.map((a) => ({ ...a })), gpsRoutes: cloneGpsRoutes(state.gpsRoutes ?? []),
    ...(latestDay ? {
      steps: latestDay.steps, distanceMeters: latestDay.distanceMeters, caloriesKcal: latestDay.caloriesKcal,
      stepBuckets48: latestDay.stepBuckets48 ? [...latestDay.stepBuckets48] : [],
      sleep: { deepMinutes: latestDay.deepSleepMin, lightMinutes: latestDay.lightSleepMin, remMinutes: latestDay.remSleepMin, awakeMinutes: latestDay.awakeMin, totalMinutes: latestDay.deepSleepMin + latestDay.lightSleepMin + latestDay.remSleepMin, napMinutes: 0, segments: [] },
      heartRate: { currentBpm: latestDay.hrSamples.length > 0 ? latestDay.hrSamples[latestDay.hrSamples.length - 1]! : latestDay.restingHr, restingBpm: latestDay.restingHr, measuring: false, samples24h: [...latestDay.hrSamples] },
      spo2: { percent: latestDay.spo2Percent, measuring: false, samples24h: latestDay.spo2Percent > 0 ? [latestDay.spo2Percent] : [] },
      bloodPressure: { systolic: latestDay.systolicBp, diastolic: latestDay.diastolicBp, measuring: false },
      stress: { score: latestDay.stressScore, samples30m: latestDay.stressScore > 0 ? [latestDay.stressScore] : [] },
    } : {}),
  });
}
