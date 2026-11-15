import {
  CRP_ALARM_REPEAT, CRP_CMD, CRP_GPS_SUBCMD, CRP_SLEEP_STATE, CRP_STRESS_DATE,
  buildCrpFrame, decodeAlarms, encodeCrpWatchTimestamp, encodeGpsHistoryResponse,
  encodeGpsPathChunkFrame, encodeNewAlarm, parseCrpFrame,
} from '../../../protocols/ultimaFitCrrepa.ts';
import type { CrpDecodedFrame } from '../../../protocols/ultimaFitCrrepa.ts';
import type { WatchAlarmRecord, WatchSettings } from '../../../storage/offlineStore.ts';
import { totalPathDistanceMeters } from '../../../utils/geoMath.ts';
import { clampInt, concatBytes, encodeUtf8 } from '../controllers/liveBleAdapter.ts';
import type { SimWatchFixture } from './simDiscovery.ts';

interface SimGpsRouteFixture {
  readonly id: string;
  readonly name: string;
  readonly activityType: string;
  readonly workoutType: number;
  readonly startedAtMs: number;
  readonly steps: number;
  readonly caloriesKcal: number;
  readonly avgHeartRateBpm: number;
  readonly maxHeartRateBpm: number;
  readonly points: readonly { readonly lat: number; readonly lng: number }[];
}

const SLEEP_TRANSITIONS: readonly [number, number, number][] = [
  [CRP_SLEEP_STATE.LIGHT, 23, 0],
  [CRP_SLEEP_STATE.DEEP, 23, 45],
  [CRP_SLEEP_STATE.LIGHT, 1, 15],
  [CRP_SLEEP_STATE.REM, 2, 45],
  [CRP_SLEEP_STATE.DEEP, 3, 30],
  [CRP_SLEEP_STATE.AWAKE, 4, 30],
  [CRP_SLEEP_STATE.LIGHT, 4, 45],
  [CRP_SLEEP_STATE.AWAKE, 6, 30],
];

const ACTIVE_STEP_SLOTS = [14, 15, 16, 17, 18, 20, 22, 24, 25, 26, 28, 30, 32, 34, 35, 36, 38, 40];

function buildUint32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value >>> 0, false);
  return buf;
}

function buildUint24LE(value: number): Uint8Array {
  const v = Math.max(0, Math.trunc(value));
  return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff);
}

function buildUint32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value >>> 0, true);
  return buf;
}

function createSimGpsRoutes(anchorSec: number): readonly SimGpsRouteFixture[] {
  return [
    {
      id: 'sim-gps-patan-run',
      name: 'Patan Heritage Morning Run',
      activityType: 'outdoor_run',
      workoutType: 1,
      startedAtMs: (anchorSec - 4 * 3600) * 1000,
      steps: 2340,
      caloriesKcal: 158,
      avgHeartRateBpm: 146,
      maxHeartRateBpm: 164,
      points: [
        { lat: 27.67312, lng: 85.32491 }, { lat: 27.67418, lng: 85.32564 },
        { lat: 27.67542, lng: 85.32631 }, { lat: 27.67665, lng: 85.32672 },
        { lat: 27.67784, lng: 85.32615 }, { lat: 27.67855, lng: 85.32482 },
        { lat: 27.67841, lng: 85.32318 }, { lat: 27.67758, lng: 85.32175 },
        { lat: 27.67624, lng: 85.32098 }, { lat: 27.67478, lng: 85.32112 },
        { lat: 27.67346, lng: 85.32189 }, { lat: 27.67258, lng: 85.32305 },
        { lat: 27.67239, lng: 85.32422 }, { lat: 27.67298, lng: 85.32484 },
      ],
    },
    {
      id: 'sim-gps-boudha-walk',
      name: 'Boudha Stupa Evening Walk',
      activityType: 'outdoor_walk',
      workoutType: 2,
      startedAtMs: (anchorSec - 26 * 3600) * 1000,
      steps: 1080,
      caloriesKcal: 68,
      avgHeartRateBpm: 108,
      maxHeartRateBpm: 121,
      points: [
        { lat: 27.72112, lng: 85.36124 }, { lat: 27.72195, lng: 85.36115 },
        { lat: 27.72248, lng: 85.36192 }, { lat: 27.72242, lng: 85.36278 },
        { lat: 27.72162, lng: 85.36312 }, { lat: 27.72094, lng: 85.36248 },
        { lat: 27.72106, lng: 85.36142 },
      ],
    },
  ];
}

/** Deterministic CRREPA 0xFEEA watch responder simulating vitals, alarms, steps/sleep, and GPS routes. */
export class SimCrrepaWatch {
  private readonly fixture: SimWatchFixture;
  private settings: WatchSettings;
  private alarms: WatchAlarmRecord[];
  private readonly gpsRoutes: readonly SimGpsRouteFixture[];
  private currentHr: number;
  private spo2: number;
  private systolic: number;
  private diastolic: number;
  private stress: number;

  constructor(
    fixture: SimWatchFixture,
    initialSettings: WatchSettings,
    initialAlarms: readonly WatchAlarmRecord[],
    hasPairedWatch: boolean,
  ) {
    this.fixture = fixture;
    this.gpsRoutes = createSimGpsRoutes(Math.floor(Date.now() / 1000));
    this.settings = {
      ...initialSettings,
      drinkReminderPeriod: { ...initialSettings.drinkReminderPeriod },
      notificationRules: { ...initialSettings.notificationRules },
    };
    if (hasPairedWatch || initialAlarms.length > 0) {
      this.alarms = initialAlarms.map((a) => ({ ...a }));
    } else {
      this.alarms = [
        {
          id: 0,
          enabled: false,
          hour: 7,
          minute: 0,
          repeatMask: CRP_ALARM_REPEAT.EVERYDAY,
          year: 2026,
          month: 1,
          day: 1,
          label: 'Morning Alarm',
        },
      ];
    }
    this.currentHr = fixture.restingHr;
    this.spo2 = fixture.spo2;
    this.systolic = fixture.systolic;
    this.diastolic = fixture.diastolic;
    this.stress = fixture.stress;
  }

  receivePacket(raw: Uint8Array): Uint8Array[] {
    const frame = parseCrpFrame(raw);
    if (!frame) {
      return raw.length >= 1 ? [buildCrpFrame(raw[raw.length - 1]!, Uint8Array.of(0x00))] : [];
    }
    return this.handleFrame(frame);
  }

  private handleFrame(frame: CrpDecodedFrame): Uint8Array[] {
    const { cmd, payload } = frame;
    const settingResponse = this.handleSettingFrame(cmd, payload);
    if (settingResponse) return settingResponse;

    switch (cmd) {
      case CRP_CMD.SYNC_TIME:
      case CRP_CMD.SYNC_TIMEZONE:
        return [buildCrpFrame(cmd, Uint8Array.of(0x00))];

      case CRP_CMD.SYNC_SLEEP:
        return [buildCrpFrame(CRP_CMD.SYNC_SLEEP, this.buildThreeByteSleep())];

      case CRP_CMD.QUERY_HISTORY_DAY: {
        const dayOffset = payload[0] ?? 0;
        if (dayOffset === 3 || dayOffset === 4) {
          return [buildCrpFrame(CRP_CMD.QUERY_HISTORY_DAY, concatBytes([Uint8Array.of(dayOffset), this.buildThreeByteSleep()]))];
        }
        return [buildCrpFrame(CRP_CMD.QUERY_HISTORY_DAY, concatBytes([
          Uint8Array.of(dayOffset), buildUint24LE(this.fixture.steps),
          buildUint24LE(this.fixture.distanceMeters), buildUint24LE(this.fixture.caloriesKcal), buildUint24LE(3420),
        ]))];
      }

      case CRP_CMD.QUERY_DAY_HISTORY_V2: {
        const metricType = payload[0] ?? 0;
        const dayOffset = payload[1] ?? 0;
        if (metricType === 0x01) {
          return [buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, concatBytes([Uint8Array.of(0x01, dayOffset), this.buildTwoByteSleep()]))];
        }
        if (metricType === 0x02) {
          return [buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, concatBytes([Uint8Array.of(0x02, dayOffset, 0x00), this.buildHrSamples(24)]))];
        }
        return [buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, concatBytes([
          Uint8Array.of(0x00, dayOffset), buildUint32LE(this.fixture.steps),
          buildUint32LE(this.fixture.caloriesKcal * 10000), buildUint32LE(this.fixture.distanceMeters * 100), buildUint32LE(3420),
        ]))];
      }

      case CRP_CMD.QUERY_STEPS_CATEGORY: {
        const chunkIndex = payload[0] ?? 0;
        const all48 = this.buildStepBuckets48();
        const start = (chunkIndex % 2) * 24;
        const chunkBuf = new Uint8Array(1 + 24 * 2);
        chunkBuf[0] = chunkIndex & 0xff;
        for (let i = 0; i < 24; i++) {
          const val = all48[start + i] ?? 0;
          chunkBuf[1 + i * 2] = val & 0xff;
          chunkBuf[1 + i * 2 + 1] = (val >>> 8) & 0xff;
        }
        return [buildCrpFrame(CRP_CMD.QUERY_STEPS_CATEGORY, chunkBuf)];
      }

      case CRP_CMD.SYNC_NAP_SLEEP: {
        const dayOffset = payload[1] === 0x01 ? (payload[2] ?? 1) : 0;
        return [buildCrpFrame(CRP_CMD.SYNC_NAP_SLEEP, Uint8Array.of(0x01, 0x00, dayOffset, 0x01, 13, 30, 0x00, 14, 5))];
      }

      case CRP_CMD.QUERY_TIMING_HEART_RATE:
        return [buildCrpFrame(CRP_CMD.QUERY_TIMING_HEART_RATE, concatBytes([Uint8Array.of(0x00), this.buildHrSamples(24)]))];

      case CRP_CMD.QUERY_24H_SPO2:
        return [buildCrpFrame(CRP_CMD.QUERY_24H_SPO2, Uint8Array.of(0x00, this.spo2 - 1, this.spo2, this.spo2, this.spo2 - 1, this.spo2, this.spo2))];

      case CRP_CMD.QUERY_24H_BP:
        return [buildCrpFrame(CRP_CMD.QUERY_24H_BP, Uint8Array.of(0x13, this.systolic, this.diastolic, this.systolic + 2, this.diastolic + 1))];

      case CRP_CMD.MEASURE_HEART_RATE:
        if ((payload[0] ?? 0) === 0x00) {
          this.currentHr = this.fixture.restingHr + 6;
          return [buildCrpFrame(CRP_CMD.MEASURE_HEART_RATE, Uint8Array.of(this.currentHr))];
        }
        return [buildCrpFrame(CRP_CMD.MEASURE_HEART_RATE, Uint8Array.of(0x00))];

      case CRP_CMD.MEASURE_SPO2:
        if ((payload[0] ?? 0) === 0x00) {
          this.spo2 = this.fixture.spo2;
          return [buildCrpFrame(CRP_CMD.MEASURE_SPO2, Uint8Array.of(this.spo2))];
        }
        return [buildCrpFrame(CRP_CMD.MEASURE_SPO2, Uint8Array.of(0x00))];

      case CRP_CMD.MEASURE_BLOOD_PRESSURE:
        return [
          buildCrpFrame(
            CRP_CMD.MEASURE_BLOOD_PRESSURE,
            (payload[0] ?? 0) === 0x00
              ? Uint8Array.of(0x00, this.systolic, this.diastolic)
              : Uint8Array.of(0x00, 0x00, 0x00),
          ),
        ];

      case CRP_CMD.NEW_PROTOCOL_EXT:
        return this.handleNewProtocolExt(payload);

      case CRP_CMD.QUERY_DEVICE_VERSION:
        return [buildCrpFrame(CRP_CMD.QUERY_DEVICE_VERSION, encodeUtf8(this.fixture.firmwareVersion))];

      case CRP_CMD.QUERY_SUPPORTED_FUNCTIONS:
        return [
          buildCrpFrame(
            CRP_CMD.QUERY_SUPPORTED_FUNCTIONS,
            Uint8Array.of(this.fixture.functionMask & 0xff, (this.fixture.functionMask >>> 8) & 0xff, this.fixture.batteryPercent & 0xff),
          ),
        ];

      case CRP_CMD.PUSH_NOTIFICATION:
        return [buildCrpFrame(CRP_CMD.PUSH_NOTIFICATION, Uint8Array.of(0x00))];

      case CRP_CMD.FIND_WATCH:
        return [buildCrpFrame(CRP_CMD.FIND_WATCH, Uint8Array.of(0x01))];

      case CRP_CMD.HEART_RATE_24H_CHUNK:
        if (payload.length === 0) return [buildCrpFrame(CRP_CMD.HEART_RATE_24H_CHUNK, this.buildMovementWorkoutsPayload())];
        return [buildCrpFrame(cmd, Uint8Array.of(0x00))];

      case CRP_CMD.GPS_PATH:
        return this.handleGpsPathCommand(payload);

      default:
        return [buildCrpFrame(cmd, Uint8Array.of(0x00))];
    }
  }

  private handleNewProtocolExt(payload: Uint8Array): Uint8Array[] {
    const subCmd = payload[0] ?? 0;
    if (subCmd === 0x05) {
      const op = payload[1] ?? 0;
      if (op === 0x00 && payload.length >= 10) {
        const incoming = decodeAlarms(concatBytes([Uint8Array.of(0x15, 0x04, 0x01), payload.subarray(2)]), { isNewProtocol: true })?.[0];
        if (incoming) {
          const existing = this.alarms.find((a) => a.id === incoming.id);
          const next: WatchAlarmRecord = {
            id: incoming.id,
            enabled: incoming.enabled,
            hour: incoming.hour,
            minute: incoming.minute,
            repeatMask: incoming.repeatMask,
            year: incoming.year ?? existing?.year ?? 2026,
            month: incoming.month ?? existing?.month ?? 1,
            day: incoming.day ?? existing?.day ?? 1,
            label: existing?.label ?? `Alarm ${incoming.id + 1}`,
          };
          this.alarms = [...this.alarms.filter((a) => a.id !== next.id), next].sort((a, b) => a.id - b.id);
        }
      } else if (op === 0x02 && payload.length >= 3) {
        this.alarms = this.alarms.filter((a) => a.id !== payload[2]!);
      } else if (op === 0x03) {
        this.alarms = [];
      }
      return [buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, this.buildAlarmsPayload())];
    }

    if (subCmd === 0x15 && payload[1] === 0x04) {
      return [buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, this.buildAlarmsPayload())];
    }

    if (subCmd === 0x11) {
      const dateType = payload[2] ?? CRP_STRESS_DATE.TODAY;
      const samples = new Uint8Array(48);
      for (let i = 0; i < 48; i++) {
        samples[i] = i >= 14 && i <= 42 ? clampInt(this.stress + ((i % 5) - 2) * 3, 15, 95) : 0;
      }
      return [buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, concatBytes([Uint8Array.of(0x11, 0x01, dateType), samples]))];
    }

    return [buildCrpFrame(CRP_CMD.NEW_PROTOCOL_EXT, payload)];
  }

  private handleSettingFrame(cmd: number, payload: Uint8Array): Uint8Array[] | null {
    const boolMap: Readonly<Record<number, { queryCmd: number; isSet: boolean; key: 'is24Hour' | 'quickView' | 'imperialUnits' | 'sedentaryReminder' }>> = {
      [CRP_CMD.SET_TIME_SYSTEM]: { queryCmd: CRP_CMD.QUERY_TIME_SYSTEM, isSet: true, key: 'is24Hour' },
      [CRP_CMD.QUERY_TIME_SYSTEM]: { queryCmd: CRP_CMD.QUERY_TIME_SYSTEM, isSet: false, key: 'is24Hour' },
      [CRP_CMD.SET_QUICK_VIEW]: { queryCmd: CRP_CMD.QUERY_QUICK_VIEW, isSet: true, key: 'quickView' },
      [CRP_CMD.QUERY_QUICK_VIEW]: { queryCmd: CRP_CMD.QUERY_QUICK_VIEW, isSet: false, key: 'quickView' },
      [CRP_CMD.SET_METRIC_SYSTEM]: { queryCmd: CRP_CMD.QUERY_METRIC_SYSTEM, isSet: true, key: 'imperialUnits' },
      [CRP_CMD.QUERY_METRIC_SYSTEM]: { queryCmd: CRP_CMD.QUERY_METRIC_SYSTEM, isSet: false, key: 'imperialUnits' },
      [CRP_CMD.SET_SEDENTARY_REMINDER]: { queryCmd: CRP_CMD.QUERY_SEDENTARY_REMINDER, isSet: true, key: 'sedentaryReminder' },
      [CRP_CMD.QUERY_SEDENTARY_REMINDER]: { queryCmd: CRP_CMD.QUERY_SEDENTARY_REMINDER, isSet: false, key: 'sedentaryReminder' },
    };
    const boolEntry = boolMap[cmd];
    if (boolEntry) {
      if (boolEntry.isSet) this.settings = { ...this.settings, [boolEntry.key]: (payload[0] ?? 0) !== 0 };
      return [buildCrpFrame(boolEntry.queryCmd, Uint8Array.of(this.settings[boolEntry.key] ? 1 : 0))];
    }

    const byteMap: Readonly<Record<number, { queryCmd: number; isSet: boolean; key: 'watchFaceId' | 'languageId' }>> = {
      [CRP_CMD.SET_WATCH_FACE]: { queryCmd: CRP_CMD.QUERY_WATCH_FACE, isSet: true, key: 'watchFaceId' },
      [CRP_CMD.QUERY_WATCH_FACE]: { queryCmd: CRP_CMD.QUERY_WATCH_FACE, isSet: false, key: 'watchFaceId' },
      [CRP_CMD.SET_LANGUAGE]: { queryCmd: CRP_CMD.QUERY_LANGUAGE, isSet: true, key: 'languageId' },
      [CRP_CMD.QUERY_LANGUAGE]: { queryCmd: CRP_CMD.QUERY_LANGUAGE, isSet: false, key: 'languageId' },
    };
    const byteEntry = byteMap[cmd];
    if (byteEntry) {
      if (byteEntry.isSet && payload.length >= 1) this.settings = { ...this.settings, [byteEntry.key]: payload[0]! };
      return [buildCrpFrame(byteEntry.queryCmd, Uint8Array.of(this.settings[byteEntry.key] & 0xff))];
    }

    if (cmd === CRP_CMD.SET_GOAL_STEPS || cmd === CRP_CMD.QUERY_GOAL_STEPS) {
      if (cmd === CRP_CMD.SET_GOAL_STEPS && payload.length >= 4) {
        this.settings = { ...this.settings, goalSteps: new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false) };
      }
      return [buildCrpFrame(CRP_CMD.QUERY_GOAL_STEPS, buildUint32BE(this.settings.goalSteps))];
    }
    if (cmd === CRP_CMD.SET_TIMING_HEART_RATE || cmd === CRP_CMD.QUERY_TIMING_HEART_RATE_INTERVAL) {
      if (cmd === CRP_CMD.SET_TIMING_HEART_RATE) this.settings = { ...this.settings, hrIntervalMinutes: (payload[0] ?? 0) * 5 };
      return [buildCrpFrame(CRP_CMD.QUERY_TIMING_HEART_RATE_INTERVAL, Uint8Array.of(Math.round(this.settings.hrIntervalMinutes / 5)))];
    }
    if (cmd === CRP_CMD.SET_DRINK_WATER_REMINDER || cmd === CRP_CMD.QUERY_DRINK_WATER_PERIOD) {
      if (cmd === CRP_CMD.SET_DRINK_WATER_REMINDER && payload.length >= 5) {
        this.settings = {
          ...this.settings,
          drinkReminderPeriod: {
            enabled: payload[0]! !== 0, startHour: payload[1]!, startMinute: payload[2]!, endHour: payload[3]!, endMinute: payload[4]!,
          },
        };
      }
      const d = this.settings.drinkReminderPeriod;
      return [buildCrpFrame(CRP_CMD.QUERY_DRINK_WATER_PERIOD, Uint8Array.of(d.enabled ? 1 : 0, d.startHour, d.startMinute, d.endHour, d.endMinute))];
    }
    return null;
  }

  private handleGpsPathCommand(payload: Uint8Array): Uint8Array[] {
    const subCmd = payload[0] ?? CRP_GPS_SUBCMD.QUERY_HISTORY;
    if (subCmd === CRP_GPS_SUBCMD.QUERY_HISTORY) {
      return [encodeGpsHistoryResponse(this.gpsRoutes.map((route) => new Date(route.startedAtMs)))];
    }
    if (subCmd === CRP_GPS_SUBCMD.QUERY_PATH) {
      const watchSec =
        payload.length >= 5
          ? ((payload[1]! | (payload[2]! << 8) | (payload[3]! << 16) | (payload[4]! << 24)) >>> 0)
          : encodeCrpWatchTimestamp(new Date(this.gpsRoutes[0]!.startedAtMs));
      const chunkIndex = payload.length >= 7 ? payload[5]! | (payload[6]! << 8) : 0;
      const route =
        this.gpsRoutes.find((r) => encodeCrpWatchTimestamp(new Date(r.startedAtMs)) === watchSec) ??
        this.gpsRoutes[0]!;
      const chunkSize = 8;
      const start = chunkIndex * chunkSize;
      const slice = route.points.slice(start, start + chunkSize);
      return [
        encodeGpsPathChunkFrame({
          workoutTime: new Date(route.startedAtMs),
          chunkIndex,
          points: slice,
          isEndOfPath: start + slice.length >= route.points.length,
        }),
      ];
    }
    if (subCmd === CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION) {
      const livePt = this.gpsRoutes[0]!.points[0]!;
      const tempChunk = encodeGpsPathChunkFrame({
        workoutTime: new Date(this.gpsRoutes[0]!.startedAtMs),
        chunkIndex: 0,
        points: [livePt],
      });
      const chunkPayload = parseCrpFrame(tempChunk)?.payload;
      if (chunkPayload && chunkPayload.length >= 15) {
        return [
          buildCrpFrame(
            CRP_CMD.GPS_PATH,
            concatBytes([Uint8Array.of(CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION), chunkPayload.subarray(7, 15)]),
          ),
        ];
      }
      return [buildCrpFrame(CRP_CMD.GPS_PATH, Uint8Array.of(CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION))];
    }
    return [buildCrpFrame(CRP_CMD.GPS_PATH, Uint8Array.of(subCmd, 0x00))];
  }

  private buildMovementWorkoutsPayload(): Uint8Array {
    const out = new Uint8Array(this.gpsRoutes.length * 24);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (let i = 0; i < this.gpsRoutes.length; i++) {
      const r = this.gpsRoutes[i]!;
      const off = i * 24;
      const startSec = encodeCrpWatchTimestamp(new Date(r.startedAtMs));
      const validSec = Math.max(120, r.points.length * 65);
      view.setUint32(off, startSec, true);
      view.setUint32(off + 4, (startSec + validSec) >>> 0, true);
      view.setUint16(off + 8, validSec, true);
      out[off + 11] = r.workoutType & 0xff;
      view.setUint32(off + 12, r.steps, true);
      view.setUint32(off + 16, Math.round(totalPathDistanceMeters(r.points)), true);
      view.setUint16(off + 20, r.caloriesKcal, true);
    }
    return out;
  }

  private buildThreeByteSleep(): Uint8Array {
    const out = new Uint8Array(SLEEP_TRANSITIONS.length * 3);
    for (let i = 0; i < SLEEP_TRANSITIONS.length; i++) {
      const [state, hour, minute] = SLEEP_TRANSITIONS[i]!;
      out[i * 3] = state;
      out[i * 3 + 1] = hour;
      out[i * 3 + 2] = minute;
    }
    return out;
  }

  private buildTwoByteSleep(): Uint8Array {
    const out = new Uint8Array(SLEEP_TRANSITIONS.length * 2);
    for (let i = 0; i < SLEEP_TRANSITIONS.length; i++) {
      const [state, hour, minute] = SLEEP_TRANSITIONS[i]!;
      const packed = (state & 0x0f) | ((hour & 0x3f) << 4) | ((minute & 0x3f) << 10);
      out[i * 2] = packed & 0xff;
      out[i * 2 + 1] = (packed >>> 8) & 0xff;
    }
    return out;
  }

  private buildStepBuckets48(): number[] {
    const buckets = new Array<number>(48).fill(0);
    const perSlot = Math.floor(this.fixture.steps / ACTIVE_STEP_SLOTS.length);
    let remainder = this.fixture.steps - perSlot * ACTIVE_STEP_SLOTS.length;
    for (const slot of ACTIVE_STEP_SLOTS) {
      buckets[slot] = perSlot + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    return buckets;
  }

  private buildHrSamples(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = clampInt(this.fixture.restingHr + ((i % 6) - 2) * 3, 52, 160);
    return out;
  }

  private buildAlarmsPayload(): Uint8Array {
    const encodedAlarms = this.alarms.map((alarm) => encodeNewAlarm(alarm).subarray(7, 15));
    return concatBytes([Uint8Array.of(0x15, 0x04, this.alarms.length & 0xff), ...encodedAlarms]);
  }
}
