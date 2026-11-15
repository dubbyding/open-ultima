import {
  CRP_CMD, CRP_GPS_SENTINEL, CRP_GPS_SUBCMD, CRP_STRESS_DATE,
  decodeAlarms, decodeBloodPressure, decodeGpsHistoryTimestamps, decodeGpsLiveLocation,
  decodeGpsPath, decodeHeartRate24h, decodeHeartRateSingle, decodeMovementWorkouts,
  decodeNapSleep, decodeSleepSegments, decodeSpO2, decodeStepCategory, decodeStepInfo,
  decodeStress, encodeDeleteNewAlarm, encodeFindWatch, encodeMeasureBloodPressure,
  encodeMeasureHeartRate, encodeMeasureSpO2, encodeNewAlarm, encodePushNotification,
  encodeQuery24hBp, encodeQuery24hSpO2, encodeQueryAllSettings, encodeQueryGpsHistory,
  encodeQueryGpsLiveLocation, encodeQueryGpsPath, encodeQueryMovementWorkouts,
  encodeQueryNewAlarms, encodeQueryTimingStress, encodeQueryTodayHeartRate,
  encodeSyncNapSleep, encodeSyncStepCategory, encodeSyncStepsAndSleep, encodeTimeSync, parseCrpFrame,
} from '../../../protocols/ultimaFitCrrepa.ts';
import type { CrpMovementWorkoutRecord, CrpSleepSummary } from '../../../protocols/ultimaFitCrrepa.ts';
import type { DailyHealthRecordInput, GpsWaypoint, GpsWorkoutRoute, OfflineStore, WatchAlarmRecord, WatchSettings } from '../../../storage/offlineStore.ts';
import { isValidGpsCoordinate, totalPathDistanceMeters } from '../../../utils/geoMath.ts';
import { PACKET_DIRECTION, PACKET_PROTOCOL, syncWatchState } from '../types.ts';
import type { Mutable, PacketDirection, PacketProtocol, WatchLiveState } from '../types.ts';
import { clampInt, decodeUtf8 } from './liveBleAdapter.ts';

export interface PendingCrpFollowup { frame: Uint8Array; summary: string; }
export interface PendingGpsRouteBuffer { startedAt: Date; waypoints: GpsWaypoint[]; completed: boolean; persisted: boolean; }

export interface WatchTransportHost {
  getState(): WatchLiveState;
  setState(next: WatchLiveState): void;
  isSimulator(): boolean;
  isLiveBle(): boolean;
  sendSimulatorWatch(frame: Uint8Array): Uint8Array[];
  writeLiveBytes(bytes: Uint8Array): Promise<void>;
  logPacket(direction: PacketDirection, protocol: PacketProtocol, deviceId: string, deviceName: string, bytes: Uint8Array, summary: string, cmd?: number): void;
  getStore(): OfflineStore;
  emit(): void;
}

const BOOL_SETTING_CMDS: Readonly<Record<number, 'is24Hour' | 'quickView' | 'imperialUnits' | 'sedentaryReminder'>> = {
  [CRP_CMD.QUERY_TIME_SYSTEM]: 'is24Hour', [CRP_CMD.SET_TIME_SYSTEM]: 'is24Hour',
  [CRP_CMD.QUERY_QUICK_VIEW]: 'quickView', [CRP_CMD.SET_QUICK_VIEW]: 'quickView',
  [CRP_CMD.QUERY_METRIC_SYSTEM]: 'imperialUnits', [CRP_CMD.SET_METRIC_SYSTEM]: 'imperialUnits',
  [CRP_CMD.QUERY_SEDENTARY_REMINDER]: 'sedentaryReminder', [CRP_CMD.SET_SEDENTARY_REMINDER]: 'sedentaryReminder',
};

const BYTE_SETTING_CMDS: Readonly<Record<number, 'watchFaceId' | 'languageId'>> = {
  [CRP_CMD.QUERY_WATCH_FACE]: 'watchFaceId', [CRP_CMD.SET_WATCH_FACE]: 'watchFaceId',
  [CRP_CMD.QUERY_LANGUAGE]: 'languageId', [CRP_CMD.SET_LANGUAGE]: 'languageId',
};

/** Builds a persistable daily health snapshot from the active watch live state. */
export function buildWatchHealthDayInput(watch: WatchLiveState): DailyHealthRecordInput {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    date, steps: Math.max(0, watch.steps), distanceMeters: Math.max(0, watch.distanceMeters),
    caloriesKcal: Math.max(0, watch.caloriesKcal), deepSleepMin: Math.max(0, watch.sleep.deepMinutes),
    lightSleepMin: Math.max(0, watch.sleep.lightMinutes), remSleepMin: Math.max(0, watch.sleep.remMinutes),
    awakeMin: Math.max(0, watch.sleep.awakeMinutes), restingHr: Math.max(0, watch.heartRate.restingBpm),
    hrSamples: watch.heartRate.samples24h.filter((n) => n >= 0), spo2Percent: Math.max(0, watch.spo2.percent),
    systolicBp: Math.max(0, watch.bloodPressure.systolic), diastolicBp: Math.max(0, watch.bloodPressure.diastolic),
    stressScore: Math.max(0, watch.stress.score),
    ...(watch.stepBuckets48.length > 0 ? { stepBuckets48: watch.stepBuckets48.slice(0, 48) } : {}),
  };
}

function applySleepSummary(next: Mutable<WatchLiveState>, sleep: CrpSleepSummary): void {
  next.sleep = { ...next.sleep, deepMinutes: sleep.deepMinutes, lightMinutes: sleep.lightMinutes, remMinutes: sleep.remMinutes, awakeMinutes: sleep.awakeMinutes, totalMinutes: sleep.totalMinutes, segments: sleep.segments };
}

function applyStepSummary(next: Mutable<WatchLiveState>, payload: Uint8Array, format?: '4byte'): void {
  const s = decodeStepInfo(payload, format ? { format } : undefined);
  if (s) { next.steps = s.steps; next.distanceMeters = s.distanceMeters; next.caloriesKcal = s.caloriesKcal; }
}

function mapDecodedAlarms(
  decoded: readonly { id: number; enabled: boolean; hour: number; minute: number; repeatMask: number; year?: number; month?: number; day?: number }[],
  labelById?: ReadonlyMap<number, string>,
): WatchAlarmRecord[] {
  return decoded.map((a) => ({
    id: a.id, enabled: a.enabled, hour: a.hour, minute: a.minute, repeatMask: a.repeatMask,
    year: a.year ?? 2026, month: a.month ?? 1, day: a.day ?? 1, label: labelById?.get(a.id) ?? `Alarm ${a.id + 1}`,
  }));
}

function applyHrSeries(next: Mutable<WatchLiveState>, values: readonly number[]): void {
  const valid = values.filter((v) => v > 0);
  next.heartRate = {
    ...next.heartRate, samples24h: [...values],
    restingBpm: valid.length > 0 ? Math.min(...valid) : next.heartRate.restingBpm,
    currentBpm: valid.length > 0 ? valid[valid.length - 1]! : next.heartRate.currentBpm,
  };
}

function applyWatchSettingFrame(settings: WatchSettings, cmd: number, payload: Uint8Array): WatchSettings | null {
  const boolKey = BOOL_SETTING_CMDS[cmd];
  if (boolKey) return payload.length >= 1 ? { ...settings, [boolKey]: payload[0]! !== 0 } : null;
  const byteKey = BYTE_SETTING_CMDS[cmd];
  if (byteKey) return payload.length >= 1 ? { ...settings, [byteKey]: payload[0]! } : null;
  if (cmd === CRP_CMD.QUERY_GOAL_STEPS || cmd === CRP_CMD.SET_GOAL_STEPS) {
    return payload.length >= 4 ? { ...settings, goalSteps: new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false) } : null;
  }
  if (cmd === CRP_CMD.QUERY_TIMING_HEART_RATE_INTERVAL || cmd === CRP_CMD.SET_TIMING_HEART_RATE) {
    return payload.length >= 1 ? { ...settings, hrIntervalMinutes: payload[0]! * 5 } : null;
  }
  if (cmd === CRP_CMD.QUERY_DRINK_WATER_PERIOD || cmd === CRP_CMD.SET_DRINK_WATER_REMINDER) {
    return payload.length >= 5 ? { ...settings, drinkReminderPeriod: { enabled: payload[0]! !== 0, startHour: payload[1]!, startMinute: payload[2]!, endHour: payload[3]!, endMinute: payload[4]! } } : null;
  }
  return null;
}

function mapWorkoutTypeToActivity(workoutType?: number): [string, string] {
  if (workoutType === 2) return ['outdoor_walk', 'Outdoor Walk'];
  if (workoutType === 3) return ['cycling', 'Outdoor Cycling'];
  if (workoutType === 4) return ['trail_hike', 'GPS Workout'];
  return ['outdoor_run', 'Outdoor Run'];
}

function buildEnrichedGpsRoute(
  watchSec: number, buffer: PendingGpsRouteBuffer, summary: CrpMovementWorkoutRecord | undefined, restingBpm: number, deviceId: string | null,
): GpsWorkoutRoute {
  const [activityType, routeLabel] = mapWorkoutTypeToActivity(summary?.workoutType);
  const computedDistance = Math.round(totalPathDistanceMeters(buffer.waypoints));
  const distanceMeters = computedDistance > 0 ? computedDistance : (summary?.distanceMeters ?? 0);
  const durationSec = summary && summary.validTimeSeconds > 0 ? summary.validTimeSeconds : Math.max(buffer.waypoints.length * 45, 60);
  const caloriesKcal = summary && summary.caloriesKcal > 0 ? summary.caloriesKcal : Math.max(12, Math.round((distanceMeters / 1000) * 65));
  const peakBpm = activityType === 'outdoor_run' ? Math.min(182, restingBpm + 88) : Math.min(148, restingBpm + 48);
  const waypoints: GpsWaypoint[] = buffer.waypoints.map((wp, idx) => {
    const phase = buffer.waypoints.length > 1 ? idx / (buffer.waypoints.length - 1) : 0;
    const elev = Math.round((1335 + Math.sin(phase * Math.PI) * 14 + (idx % 3) * 0.6) * 10) / 10;
    const hr = Math.round(restingBpm + (peakBpm - restingBpm) * (0.45 + 0.55 * Math.sin(phase * Math.PI)));
    return { ...wp, elevationMeters: wp.elevationMeters ?? elev, heartRateBpm: wp.heartRateBpm ?? hr };
  });
  const hrs = waypoints.map((w) => w.heartRateBpm).filter((v): v is number => typeof v === 'number');
  const elevs = waypoints.map((w) => w.elevationMeters).filter((v): v is number => typeof v === 'number');
  const elevationGainMeters = elevs.length >= 2
    ? Math.round(elevs.reduce((g, v, i) => (i > 0 && v > elevs[i - 1]! ? g + v - elevs[i - 1]! : g), 0) * 10) / 10
    : undefined;
  const startedAt = buffer.startedAt.toISOString();
  const lastWp = waypoints[waypoints.length - 1]!;
  const endedAt = new Date(buffer.startedAt.getTime() + durationSec * 1000).toISOString();
  return {
    id: `crp-gps-${watchSec}`, ...(deviceId ? { deviceId } : {}), name: `${routeLabel} (${startedAt.slice(0, 10)})`,
    activityType, startedAt, endedAt: lastWp.timestamp > endedAt ? lastWp.timestamp : endedAt, distanceMeters, durationSec, caloriesKcal,
    ...(hrs.length > 0 ? { avgHeartRateBpm: Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length), maxHeartRateBpm: Math.max(...hrs) } : {}),
    ...(elevationGainMeters !== undefined ? { elevationGainMeters } : {}), waypoints,
  };
}

/** Coordinates CRREPA 0xFEEA watch TX frames, RX decoding, vitals reducers, and multi-chunk GPS route sync. */
export class WatchController {
  private pendingCrpStepChunk0: Uint8Array | null = null;
  private pendingCrpFollowups: PendingCrpFollowup[] = [];
  private pendingGpsRouteBuffers = new Map<number, PendingGpsRouteBuffer>();
  private pendingMovementSummaries = new Map<number, CrpMovementWorkoutRecord>();
  private pendingGpsExpectedWatchSecs = new Set<number>();
  private gpsHistoryResponseSeen = false;
  private drainingCrpFollowups = false;
  private activeGpsPersistPromise: Promise<void> | null = null;
  private pendingGpsSyncResolver: (() => void) | null = null;
  private pendingGpsSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly liveGpsSyncTimeoutMs: number;

  constructor(liveGpsSyncTimeoutMs = 8000) { this.liveGpsSyncTimeoutMs = liveGpsSyncTimeoutMs; }
  resetForConnect(): void { this.pendingCrpStepChunk0 = null; }
  resetForLiveDisconnect(): void { this.pendingCrpFollowups = []; this.resolvePendingGpsSync(); }
  resetAll(): void {
    this.pendingCrpStepChunk0 = null; this.pendingCrpFollowups = []; this.drainingCrpFollowups = false;
    this.pendingGpsExpectedWatchSecs.clear(); this.gpsHistoryResponseSeen = false;
    this.pendingGpsRouteBuffers.clear(); this.pendingMovementSummaries.clear(); this.resolvePendingGpsSync();
  }

  async sendFrame(host: WatchTransportHost, frame: Uint8Array, summary: string): Promise<void> {
    const parsed = parseCrpFrame(frame);
    const watch = host.getState();
    host.logPacket(PACKET_DIRECTION.TX, PACKET_PROTOCOL.CRREPA, watch.deviceId ?? 'watch', watch.name, frame, summary, parsed?.cmd);
    if (host.isSimulator()) {
      for (const rx of host.sendSimulatorWatch(frame)) await this.handleRxBytesAndFollowups(host, rx);
    } else await host.writeLiveBytes(frame);
  }

  async sendSequence(host: WatchTransportHost, frames: readonly Uint8Array[], summaryPrefix: string): Promise<void> {
    for (const frame of frames) {
      const parsed = parseCrpFrame(frame);
      await this.sendFrame(host, frame, `${summaryPrefix} (${parsed ? `0x${parsed.cmd.toString(16).padStart(2, '0')}` : 'raw'})`);
    }
  }

  async syncTime(host: WatchTransportHost): Promise<void> {
    const { timeCmd, tzCmd } = encodeTimeSync();
    await this.sendFrame(host, timeCmd, 'SyncTime (0x31)');
    await this.sendFrame(host, tzCmd, 'SyncTimezone (0xBB)');
  }

  async syncExtendedVitals(host: WatchTransportHost): Promise<void> {
    await this.sendFrame(host, encodeSyncStepCategory(0), 'QueryStepCategory chunk 0 (0x59)');
    await this.sendFrame(host, encodeSyncNapSleep(0), 'QueryNapSleep (0xBC)');
    await this.sendFrame(host, encodeQueryTodayHeartRate(1), 'QueryTimingHeartRate (0x35)');
    await this.sendFrame(host, encodeQuery24hSpO2(0), 'Query24hSpO2 (0x3E)');
    await this.sendFrame(host, encodeQuery24hBp(0), 'Query24hBP (0x3D)');
    await this.sendFrame(host, encodeQueryTimingStress(CRP_STRESS_DATE.TODAY), 'QueryTimingStress (0xB9)');
    for (const qf of encodeQueryAllSettings()) {
      const parsed = parseCrpFrame(qf);
      if (parsed && (parsed.cmd === CRP_CMD.QUERY_SUPPORTED_FUNCTIONS || parsed.cmd === CRP_CMD.QUERY_DEVICE_VERSION)) {
        await this.sendFrame(host, qf, `QueryWatchMetadata (0x${parsed.cmd.toString(16)})`);
      }
    }
  }

  async syncAll(host: WatchTransportHost): Promise<void> {
    await this.syncTime(host);
    await this.sendSequence(host, encodeSyncStepsAndSleep(), 'SyncStepsAndSleep');
    await this.sendFrame(host, encodeQueryNewAlarms(), 'QueryNewAlarms (0xB9)');
    await this.syncExtendedVitals(host);
    await this.persistHealthDay(host);
  }

  async syncGpsRoutes(host: WatchTransportHost): Promise<void> {
    this.resolvePendingGpsSync();
    this.pendingCrpFollowups = []; this.pendingGpsRouteBuffers.clear();
    this.pendingMovementSummaries.clear(); this.pendingGpsExpectedWatchSecs.clear();
    this.gpsHistoryResponseSeen = false;
    host.setState(syncWatchState({ ...host.getState(), gpsSyncing: true }));
    host.emit();
    const liveWaiter = host.isLiveBle() ? this.createPendingGpsSyncWaiter() : null;
    try {
      await this.sendFrame(host, encodeQueryMovementWorkouts(), 'QueryMovementWorkouts (0x37)');
      await this.sendFrame(host, encodeQueryGpsHistory(), 'QueryGpsHistory (0xB3 0x00)');
      await this.sendFrame(host, encodeQueryGpsLiveLocation(), 'QueryGpsLiveLocation (0xB3 0x02)');
      await this.drainPendingCrpFollowups(host);
      if (liveWaiter) await liveWaiter;
      await this.persistPendingGpsRoutes(host, true);
      host.setState(syncWatchState({ ...host.getState(), gpsRoutes: host.getStore().getGpsRoutes(), gpsSyncing: false, lastSyncedAt: Date.now() }));
      host.emit();
    } catch (err) {
      this.resolvePendingGpsSync();
      host.setState(syncWatchState({ ...host.getState(), gpsSyncing: false }));
      host.emit();
      throw err;
    }
  }

  async persistHealthDay(host: WatchTransportHost): Promise<void> {
    await host.getStore().upsertHealthDay(buildWatchHealthDayInput(host.getState()));
    host.emit();
  }

  async measureVital(host: WatchTransportHost, kind: 'hr' | 'spo2' | 'bp', start: boolean): Promise<void> {
    const label = start ? 'start' : 'stop';
    const patch = (w: WatchLiveState): WatchLiveState => kind === 'hr'
      ? ({ ...w, heartRate: { ...w.heartRate, measuring: start }, measuringHr: start })
      : kind === 'spo2'
        ? ({ ...w, spo2: { ...w.spo2, measuring: start }, measuringSpo2: start })
        : ({ ...w, bloodPressure: { ...w.bloodPressure, measuring: start }, measuringBp: start });
    const frame = kind === 'hr' ? encodeMeasureHeartRate(start) : kind === 'spo2' ? encodeMeasureSpO2(start) : encodeMeasureBloodPressure(start);
    const summary = kind === 'hr' ? `MeasureHeartRate (${label})` : kind === 'spo2' ? `MeasureSpO2 (${label})` : `MeasureBloodPressure (${label})`;
    host.setState(syncWatchState(patch(host.getState())));
    host.emit();
    await this.sendFrame(host, frame, summary);
    await this.persistHealthDay(host);
  }

  async queryStress(host: WatchTransportHost): Promise<void> {
    await this.sendFrame(host, encodeQueryTimingStress(CRP_STRESS_DATE.TODAY), 'QueryTimingStress (0xB9 [0x11])');
    await this.persistHealthDay(host);
  }

  async saveAlarm(host: WatchTransportHost, alarm: WatchAlarmRecord): Promise<void> {
    const n: WatchAlarmRecord = {
      id: clampInt(alarm.id, 0, 7), enabled: Boolean(alarm.enabled), hour: clampInt(alarm.hour, 0, 23), minute: clampInt(alarm.minute, 0, 59),
      repeatMask: clampInt(alarm.repeatMask, 0, 255), year: clampInt(alarm.year, 0, 9999), month: clampInt(alarm.month, 0, 12), day: clampInt(alarm.day, 0, 31), label: alarm.label,
    };
    const prevLabels = new Map<number, string>(host.getState().alarms.map((a) => [a.id, a.label]));
    prevLabels.set(n.id, n.label);
    await this.sendFrame(host, encodeNewAlarm(n), `SaveAlarm (#${n.id} ${String(n.hour).padStart(2, '0')}:${String(n.minute).padStart(2, '0')})`);
    const updatedAlarms = host.getState().alarms.map((a) => ({ ...a, label: prevLabels.get(a.id) ?? a.label }));
    host.setState(syncWatchState({ ...host.getState(), alarms: updatedAlarms }));
    await host.getStore().setWatchAlarms(updatedAlarms);
    host.emit();
  }

  async deleteAlarm(host: WatchTransportHost, id: number): Promise<void> {
    const safeId = clampInt(id, 0, 7);
    await this.sendFrame(host, encodeDeleteNewAlarm(safeId), `DeleteAlarm (#${safeId})`);
    const updatedAlarms = host.getState().alarms.filter((a) => a.id !== safeId);
    host.setState(syncWatchState({ ...host.getState(), alarms: updatedAlarms }));
    await host.getStore().setWatchAlarms(updatedAlarms);
    host.emit();
  }

  async pushNotification(host: WatchTransportHost, messageType: number, text: string): Promise<void> {
    await this.sendFrame(host, encodePushNotification(messageType, text), `PushNotification (type=0x${(messageType & 0xff).toString(16)})`);
    const notif = { messageType, text, sentAt: Date.now() };
    host.setState(syncWatchState({ ...host.getState(), lastNotification: notif, lastNotificationSent: notif }));
    host.emit();
  }

  async findWatch(host: WatchTransportHost): Promise<void> { await this.sendFrame(host, encodeFindWatch(), 'FindWatch (0x61)'); }

  async handleRxBytesAndFollowups(host: WatchTransportHost, raw: Uint8Array): Promise<void> {
    const nextCmd = this.decodeAndApplyRxFrame(host, raw);
    if (nextCmd) await this.sendFrame(host, nextCmd, 'QueryStepCategory next chunk (0x59)');
    await this.drainPendingCrpFollowups(host);
    await this.persistPendingGpsRoutes(host, false);
    this.checkAndResolvePendingGpsSync();
  }

  private createPendingGpsSyncWaiter(): Promise<void> {
    this.resolvePendingGpsSync();
    return new Promise<void>((resolve) => {
      this.pendingGpsSyncResolver = resolve;
      this.pendingGpsSyncTimer = setTimeout(() => this.resolvePendingGpsSync(), this.liveGpsSyncTimeoutMs);
    });
  }

  private resolvePendingGpsSync(): void {
    if (this.pendingGpsSyncTimer !== null) { clearTimeout(this.pendingGpsSyncTimer); this.pendingGpsSyncTimer = null; }
    if (this.pendingGpsSyncResolver) { const resolve = this.pendingGpsSyncResolver; this.pendingGpsSyncResolver = null; resolve(); }
  }

  private checkAndResolvePendingGpsSync(): void {
    if (!this.pendingGpsSyncResolver || !this.gpsHistoryResponseSeen || this.pendingCrpFollowups.length > 0 || this.drainingCrpFollowups) return;
    for (const watchSec of this.pendingGpsExpectedWatchSecs) {
      const buf = this.pendingGpsRouteBuffers.get(watchSec);
      if (!buf || !buf.completed || !buf.persisted) return;
    }
    this.resolvePendingGpsSync();
  }

  private async drainPendingCrpFollowups(host: WatchTransportHost): Promise<void> {
    if (this.drainingCrpFollowups) return;
    this.drainingCrpFollowups = true;
    try {
      while (this.pendingCrpFollowups.length > 0) {
        const nextReq = this.pendingCrpFollowups.shift()!;
        await this.sendFrame(host, nextReq.frame, nextReq.summary);
      }
    } finally { this.drainingCrpFollowups = false; }
  }

  private findMatchingMovementSummary(watchTimeSec: number): CrpMovementWorkoutRecord | undefined {
    const exact = this.pendingMovementSummaries.get(watchTimeSec);
    if (exact) return exact;
    let best: CrpMovementWorkoutRecord | undefined;
    let bestDiff = 180;
    for (const s of this.pendingMovementSummaries.values()) {
      const diff = Math.abs(s.startTimeSeconds - watchTimeSec);
      if (diff <= bestDiff) { bestDiff = diff; best = s; }
    }
    return best;
  }

  private async persistPendingGpsRoutes(host: WatchTransportHost, includeIncomplete: boolean): Promise<void> {
    const run = async (): Promise<void> => {
      let savedAny = false;
      const watch = host.getState();
      const store = host.getStore();
      for (const [watchSec, buf] of this.pendingGpsRouteBuffers.entries()) {
        if (buf.persisted || buf.waypoints.length === 0 || (!buf.completed && !includeIncomplete)) continue;
        buf.persisted = true;
        try {
          await store.saveGpsRoute(buildEnrichedGpsRoute(watchSec, buf, this.findMatchingMovementSummary(watchSec), watch.heartRate.restingBpm || 68, watch.deviceId));
          savedAny = true;
        } catch (err) { buf.persisted = false; throw err; }
      }
      if (!savedAny) return;
      const current = host.getState();
      const routes = store.getGpsRoutes();
      let updatedLoc = current.lastKnownLocation;
      if (!updatedLoc && routes.length > 0) {
        const latestWp = routes[0]!.waypoints[Math.max(0, routes[0]!.waypoints.length - 1)];
        if (latestWp && current.deviceId) {
          const updatedStore = await store.setLastKnownLocation(current.deviceId, { lat: latestWp.lat, lng: latestWp.lng, note: `Last Watch GPS Fix (${routes[0]!.name})` });
          updatedLoc = updatedStore.pairedDevices.find((d) => d.id === current.deviceId)?.lastKnownLocation ?? updatedLoc;
        }
      }
      host.setState(syncWatchState({ ...current, gpsRoutes: routes, lastKnownLocation: updatedLoc }));
      host.emit();
    };
    const previous = this.activeGpsPersistPromise ?? Promise.resolve();
    const chained = previous.then(run, run);
    this.activeGpsPersistPromise = chained.finally(() => { if (this.activeGpsPersistPromise === chained) this.activeGpsPersistPromise = null; });
    await chained;
  }

  private decodeAndApplyRxFrame(host: WatchTransportHost, raw: Uint8Array): Uint8Array | undefined {
    const current = host.getState();
    const frame = parseCrpFrame(raw);
    host.logPacket(PACKET_DIRECTION.RX, PACKET_PROTOCOL.CRREPA, current.deviceId ?? 'watch', current.name, raw, frame ? `CRREPA RX cmd=0x${frame.cmd.toString(16).padStart(2, '0')} (${frame.payload.length} B)` : `CRREPA RX (${raw.length} B)`, frame?.cmd);
    if (!frame || !frame.isComplete) return undefined;

    let nextCommand: Uint8Array | undefined;
    const { cmd, payload } = frame;
    const next: Mutable<WatchLiveState> = { ...current, lastSyncedAt: Date.now() };
    const updatedSettings = applyWatchSettingFrame(next.settings, cmd, payload);
    if (updatedSettings) { next.settings = updatedSettings; host.setState(syncWatchState(next)); host.emit(); return undefined; }

    if (cmd === CRP_CMD.QUERY_HISTORY_DAY) {
      const sleep = payload.length >= 4 && (payload[0] === 3 || payload[0] === 4) ? decodeSleepSegments(payload, { cmd }) : null;
      if (sleep) applySleepSummary(next, sleep); else applyStepSummary(next, payload);
    } else if (cmd === CRP_CMD.SYNC_SLEEP) {
      const s = decodeSleepSegments(payload, { cmd }); if (s) applySleepSummary(next, s);
    } else if (cmd === CRP_CMD.QUERY_DAY_HISTORY_V2) {
      if (payload[0] === 0x00) applyStepSummary(next, payload, '4byte');
      else if (payload[0] === 0x01) { const s = decodeSleepSegments(payload, { cmd }); if (s) applySleepSummary(next, s); }
      else if (payload[0] === 0x02) { const hr = decodeHeartRate24h(payload); if (hr && hr.values.length > 0) applyHrSeries(next, hr.values); }
    } else if (cmd === CRP_CMD.QUERY_STEPS_CATEGORY) {
      const first = this.pendingCrpStepChunk0;
      const chunkIdx = payload[0] ?? 0;
      if (chunkIdx === 0 || chunkIdx === 2) {
        const partial = decodeStepCategory(payload);
        if (partial?.nextChunkCmd) { this.pendingCrpStepChunk0 = new Uint8Array(payload); nextCommand = partial.nextChunkCmd; }
      } else if (first) {
        const merged = decodeStepCategory(first, payload);
        this.pendingCrpStepChunk0 = null;
        if (merged) next.stepBuckets48 = merged.buckets;
      } else { const single = decodeStepCategory(payload); if (single) next.stepBuckets48 = single.buckets; }
    } else if (cmd === CRP_CMD.SYNC_NAP_SLEEP) {
      const nap = decodeNapSleep(payload); if (nap) next.sleep = { ...next.sleep, napMinutes: nap.totalMinutes };
    } else if (cmd === CRP_CMD.QUERY_TIMING_HEART_RATE || cmd === CRP_CMD.QUERY_24H_HEART_RATE) {
      const hr = decodeHeartRate24h(payload, { kind: cmd === CRP_CMD.QUERY_TIMING_HEART_RATE ? 'timing_5min' : 'continuous_1min' });
      if (hr && hr.values.length > 0) applyHrSeries(next, hr.values);
    } else if (cmd === CRP_CMD.MEASURE_HEART_RATE || cmd === CRP_CMD.DYNAMIC_HEART_RATE) {
      const singleHr = decodeHeartRateSingle(payload);
      if (singleHr && singleHr.bpm > 0) next.heartRate = { ...next.heartRate, currentBpm: singleHr.bpm, samples24h: [...next.heartRate.samples24h, singleHr.bpm] };
    } else if (cmd === CRP_CMD.QUERY_24H_SPO2 || cmd === CRP_CMD.MEASURE_SPO2) {
      const spo2 = decodeSpO2(payload, cmd === CRP_CMD.MEASURE_SPO2 ? { kind: 'single' } : { kind: 'chunk' });
      if (spo2?.kind === 'single' && spo2.spo2 && spo2.spo2 > 0) next.spo2 = { ...next.spo2, percent: spo2.spo2, samples24h: [...next.spo2.samples24h, spo2.spo2] };
      else if (spo2 && spo2.values.length > 0) { const valid = spo2.values.filter((v) => v > 0); if (valid.length > 0) next.spo2 = { ...next.spo2, percent: valid[valid.length - 1]!, samples24h: valid }; }
    } else if (cmd === CRP_CMD.QUERY_24H_BP || cmd === CRP_CMD.MEASURE_BLOOD_PRESSURE) {
      const bp = decodeBloodPressure(payload, cmd === CRP_CMD.MEASURE_BLOOD_PRESSURE ? { kind: 'single' } : { kind: '24h_chunk' });
      if (bp) {
        const valid = bp.readings.filter((r) => r.systolic > 0 && r.diastolic > 0);
        if (valid.length > 0) { const last = valid[valid.length - 1]!; next.bloodPressure = { ...next.bloodPressure, systolic: last.systolic, diastolic: last.diastolic }; }
        if (bp.nextChunkCmd) nextCommand = bp.nextChunkCmd;
      }
    } else if (cmd === CRP_CMD.NEW_PROTOCOL_EXT) this.applyNewProtocolExtRx(next, payload);
    else if (cmd === CRP_CMD.QUERY_ALARMS) { const legacy = decodeAlarms(payload, { isNewProtocol: false }); if (legacy) next.alarms = mapDecodedAlarms(legacy); }
    else if (cmd === CRP_CMD.QUERY_DEVICE_VERSION) { const fw = decodeUtf8(payload).replace(/\0+$/g, '').trim(); if (fw.length > 0) next.firmwareVersion = fw; }
    else if (cmd === CRP_CMD.QUERY_SUPPORTED_FUNCTIONS) {
      if (payload.length >= 2) next.functionMask = payload[0]! | (payload[1]! << 8);
      if (payload.length >= 3) next.batteryPercent = clampInt(payload[2]!, 0, 100);
    } else if (cmd === CRP_CMD.FIND_WATCH) next.finding = (payload[0] ?? 1) !== 0;
    else if (cmd === CRP_CMD.HEART_RATE_24H_CHUNK && payload.length >= 24 && payload.length % 24 === 0) {
      for (const rec of decodeMovementWorkouts(payload)) this.pendingMovementSummaries.set(rec.startTimeSeconds, rec);
    } else if (cmd === CRP_CMD.GPS_PATH) this.applyGpsPathRx(next, payload);

    host.setState(syncWatchState(next));
    host.emit();
    return nextCommand;
  }

  private applyNewProtocolExtRx(next: Mutable<WatchLiveState>, payload: Uint8Array): void {
    const subCmd = payload[0] ?? 0;
    if (subCmd === 0x15) {
      if (payload.length === 3) { next.alarms = []; return; }
      const decodedAlarms = decodeAlarms(payload, { isNewProtocol: true });
      if (decodedAlarms) next.alarms = mapDecodedAlarms(decodedAlarms, new Map(next.alarms.map((a) => [a.id, a.label])));
    } else if (subCmd === 0x11) {
      const stress = decodeStress(payload, { kind: 'timing_30min' });
      if (stress && stress.values.length > 0) {
        const nonZero = stress.values.filter((v) => v > 0);
        next.stress = { score: nonZero.length > 0 ? nonZero[nonZero.length - 1]! : next.stress.score, samples30m: stress.values };
      }
    }
  }

  private applyGpsPathRx(next: { lastKnownLocation: WatchLiveState['lastKnownLocation'] }, payload: Uint8Array): void {
    const subCmd = payload[0] ?? 0;
    if (subCmd === CRP_GPS_SUBCMD.QUERY_HISTORY && payload.length % 4 === 1) {
      this.gpsHistoryResponseSeen = true;
      for (const entry of decodeGpsHistoryTimestamps(payload)) {
        this.pendingGpsExpectedWatchSecs.add(entry.watchTimeSeconds);
        this.pendingCrpFollowups.push({ frame: encodeQueryGpsPath(entry.watchTimeSeconds, 0), summary: `QueryGpsPath (${entry.watchTimeSeconds} #0)` });
      }
    } else if (subCmd === CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION) {
      const loc = decodeGpsLiveLocation(payload);
      if (loc && !loc.isPause && !loc.isNoSignal && isValidGpsCoordinate(loc.lat, loc.lng) && !next.lastKnownLocation) {
        next.lastKnownLocation = { lat: loc.lat, lng: loc.lng, note: 'Live Watch GPS Fix', savedAt: Date.now() };
      }
    } else if (subCmd === CRP_GPS_SUBCMD.QUERY_PATH) {
      const path = decodeGpsPath(payload);
      if (!path) return;
      let buf = this.pendingGpsRouteBuffers.get(path.workoutTimeSeconds);
      if (!buf) { buf = { startedAt: path.workoutTime, waypoints: [], completed: false, persisted: false }; this.pendingGpsRouteBuffers.set(path.workoutTimeSeconds, buf); }
      const baseIdx = buf.waypoints.length;
      const startMs = buf.startedAt.getTime();
      for (let i = 0; i < path.validPoints.length; i++) {
        const wp = path.validPoints[i]!;
        buf.waypoints.push({ lat: wp.lat, lng: wp.lng, timestamp: new Date(startMs + (baseIdx + i) * CRP_GPS_SENTINEL.DEFAULT_POINT_INTERVAL_MS).toISOString() });
      }
      if (path.isEndOfPath) buf.completed = true;
      else this.pendingCrpFollowups.push({ frame: encodeQueryGpsPath(path.workoutTimeSeconds, path.chunkIndex + 1), summary: `QueryGpsPath (${path.workoutTimeSeconds} #${path.chunkIndex + 1})` });
    }
  }
}
