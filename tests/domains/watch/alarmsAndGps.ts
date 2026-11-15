import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  CRP_ALARM_REPEAT,
  CRP_CMD,
  CRP_LANGUAGE,
  CRP_MESSAGE_TYPE,
  buildCrpFrame,
  decodeAlarms,
  encodeClearNotification,
  encodeDeleteAllNewAlarms,
  encodeDeleteNewAlarm,
  encodeFindWatch,
  encodeGoalSteps,
  encodeLegacyAlarm,
  encodeMetricSystem,
  encodeNewAlarm,
  encodeOtherMessageReminder,
  encodePeriodReminder,
  encodePushNotification,
  encodeQueryAllSettings,
  encodeQueryLegacyAlarms,
  encodeQueryNewAlarms,
  encodeQuickView,
  encodeSedentaryReminder,
  encodeTimeSystem,
  encodeWatchFace,
  encodeWatchLanguage,
  CRP_GPS_SENTINEL,
  CRP_GPS_SUBCMD,
  decodeGpsHistoryTimestamps,
  decodeGpsLiveLocation,
  decodeGpsPath,
  decodeMovementWorkouts,
  encodeGpsHistoryResponse,
  encodeGpsPathChunkFrame,
  encodeQueryGpsHistory,
  encodeQueryGpsLiveLocation,
  encodeQueryGpsPath,
  encodeQueryMovementWorkouts,
  encodeSendLocalLocation,
  filterCrpEmoji,
  mapCrpMessageType,
  parseCrpFrame,
} from '../../../src/protocols/ultimaFitCrrepa.ts';
import { concatUint8Arrays } from '../testUtils.ts';

test('5.4 CRREPA 8-slot Alarms (0xB9 subcmd 0x05, year-2015 BE) and Notification Push (0x41)', () => {
  // Single-date alarm on slot 7 (year 2026 => 2026 - 2015 = 11 => 0xB, month 11 => 0xB, day 14 => 0x0E => 0xBB0E)
  const newAlarmFrame = parseCrpFrame(
    encodeNewAlarm({
      id: 7,
      enabled: true,
      hour: 7,
      minute: 30,
      repeatMask: 0,
      year: 2026,
      month: 11,
      day: 14,
    }),
  )!;
  assert.equal(newAlarmFrame.cmd, CRP_CMD.NEW_PROTOCOL_EXT);
  assert.equal(newAlarmFrame.payload[0], 0x05);
  assert.equal(newAlarmFrame.payload[1], 0x00);
  // Body: [id=7, en=1, type=0, hour=7, min=30, dateHi=0xBB, dateLo=0x0E, repeat=0]
  assert.deepEqual(
    Array.from(newAlarmFrame.payload.subarray(2)),
    [7, 1, 0, 7, 30, 0xbb, 0x0e, 0],
  );

  // Decode 0xB9 [0x15, 0x00, 0x01, ...8B bodies] round-trip preserving slot id 7
  const alarmResp = concatUint8Arrays([
    Uint8Array.of(0x15, 0x00, 0x01),
    newAlarmFrame.payload.subarray(2),
    parseCrpFrame(
      encodeNewAlarm({
        id: 2,
        enabled: true,
        hour: 9,
        minute: 15,
        repeatMask: CRP_ALARM_REPEAT.MONDAY | CRP_ALARM_REPEAT.FRIDAY,
      }),
    )!.payload.subarray(2),
  ]);
  const decodedAlarms = decodeAlarms(alarmResp, { isNewProtocol: true });
  assert.ok(decodedAlarms);
  assert.equal(decodedAlarms.length, 2);
  assert.equal(decodedAlarms[0]!.id, 7);
  assert.equal(decodedAlarms[0]!.year, 2026);
  assert.equal(decodedAlarms[0]!.month, 11);
  assert.equal(decodedAlarms[0]!.day, 14);
  assert.equal(decodedAlarms[1]!.id, 2);
  assert.equal(decodedAlarms[1]!.type, 2);
  assert.equal(
    decodedAlarms[1]!.repeatMask,
    CRP_ALARM_REPEAT.MONDAY | CRP_ALARM_REPEAT.FRIDAY,
  );

  // Legacy & alarm management encoders
  assert.equal(parseCrpFrame(encodeLegacyAlarm({ id: 0, enabled: true, hour: 8, minute: 0 }))!.cmd, CRP_CMD.SET_ALARM);
  assert.deepEqual(parseCrpFrame(encodeQueryNewAlarms())!.payload, Uint8Array.of(0x15, 0x04));
  assert.equal(parseCrpFrame(encodeQueryLegacyAlarms())!.cmd, CRP_CMD.QUERY_ALARMS);
  assert.deepEqual(parseCrpFrame(encodeDeleteNewAlarm(3))!.payload, Uint8Array.of(0x05, 0x02, 3));
  assert.deepEqual(parseCrpFrame(encodeDeleteAllNewAlarms())!.payload, Uint8Array.of(0x05, 0x03));

  // Emoji filtering & 0x41 Push Notification UTF-8 truncation
  assert.equal(
    filterCrpEmoji('Standup 📹 at 10am 👨‍👩‍👧!'),
    'Standup [Video Camera] at 10am [emoji]!',
  );
  assert.equal(
    filterCrpEmoji('Hi 🎉👨‍👩‍👧'),
    'Hi [emoji][emoji]',
  );
  assert.equal(mapCrpMessageType(CRP_MESSAGE_TYPE.WHATSAPP, 161), 0x08);
  assert.equal(mapCrpMessageType(CRP_MESSAGE_TYPE.WHATSAPP, 120), CRP_MESSAGE_TYPE.WHATSAPP);

  // Title before ':' with 3-byte UTF-8 chars + long body truncated cleanly within maxUtf8Bytes
  const multiByteMsg = `${'न'.repeat(25)}: ${'é'.repeat(30)} 🎉`;
  const pushFrame = parseCrpFrame(
    encodePushNotification(CRP_MESSAGE_TYPE.WHATSAPP, multiByteMsg, 40, 161),
  )!;
  assert.equal(pushFrame.cmd, CRP_CMD.PUSH_NOTIFICATION);
  assert.equal(pushFrame.payload[0], 0x08);
  const bodyBytes = pushFrame.payload.subarray(1);
  assert.ok(bodyBytes.length <= 40);
  const decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
  assert.ok(!decodedText.includes('\ufffd'));
  assert.ok(decodedText.endsWith('\u2026'));

  assert.deepEqual(parseCrpFrame(encodeClearNotification())!.payload, Uint8Array.of(0xff));

  // Misc watch settings encoders sanity
  assert.equal(parseCrpFrame(encodeGoalSteps(10000))!.cmd, CRP_CMD.SET_GOAL_STEPS);
  assert.equal(parseCrpFrame(encodeTimeSystem(true))!.payload[0], 1);
  assert.equal(parseCrpFrame(encodeQuickView(true))!.payload[0], 1);
  assert.equal(parseCrpFrame(encodeWatchFace(3))!.payload[0], 3);
  assert.equal(parseCrpFrame(encodeMetricSystem(false))!.payload[0], 0);
  assert.equal(parseCrpFrame(encodeWatchLanguage(CRP_LANGUAGE.ENGLISH))!.payload[0], 0);
  assert.equal(parseCrpFrame(encodeOtherMessageReminder(true))!.payload[0], 1);
  assert.equal(parseCrpFrame(encodeSedentaryReminder(true))!.payload[0], 1);
  assert.deepEqual(
    parseCrpFrame(encodePeriodReminder(CRP_CMD.SET_DND_PERIOD, 22, 0, 7, 30))!.payload,
    Uint8Array.of(22, 0, 7, 30),
  );
  assert.equal(parseCrpFrame(encodeFindWatch())!.cmd, CRP_CMD.FIND_WATCH);
  assert.equal(encodeQueryAllSettings().length, 19);
});

// ---------------------------------------------------------------------------
// 8.1 CRREPA GPS Path (0xB3) & Movement Workout (0x37)
// ---------------------------------------------------------------------------

test('8.1 CRREPA GPS Path (0xB3) & Movement Workout (0x37) NMEA DDMM.MMMM, sentinels & multi-chunk codec', () => {
  // History list query & decode
  const histQuery = parseCrpFrame(encodeQueryGpsHistory())!;
  assert.equal(histQuery.cmd, CRP_CMD.GPS_PATH);
  assert.deepEqual(histQuery.payload, Uint8Array.of(CRP_GPS_SUBCMD.QUERY_HISTORY));

  const t1 = new Date('2026-11-15T01:30:00.000Z');
  const t2 = new Date('2026-11-14T11:15:00.000Z');
  const histResp = encodeGpsHistoryResponse([t1, t2]);
  const decodedHist = decodeGpsHistoryTimestamps(histResp);
  assert.equal(decodedHist.length, 2);
  assert.ok(Math.abs(decodedHist[0]!.timestamp.getTime() - t1.getTime()) <= 1000);
  assert.ok(Math.abs(decodedHist[1]!.timestamp.getTime() - t2.getTime()) <= 1000);

  // Path query 0xB3 0x01 & phone local location 0xB3 0x04
  const pathReq = parseCrpFrame(encodeQueryGpsPath(t1, 1))!;
  assert.equal(pathReq.cmd, CRP_CMD.GPS_PATH);
  assert.equal(pathReq.payload[0], CRP_GPS_SUBCMD.QUERY_PATH);
  assert.equal(pathReq.payload[5]! | (pathReq.payload[6]! << 8), 1);

  const localLocReq = parseCrpFrame(encodeSendLocalLocation(27.7172, -122.4194))!;
  assert.equal(localLocReq.cmd, CRP_CMD.GPS_PATH);
  assert.equal(localLocReq.payload[0], CRP_GPS_SUBCMD.SEND_LOCAL_LOCATION);
  assert.equal(localLocReq.payload.length, 9);

  // GPS trajectory with northern/eastern, southern/western negative coords, pause, and no-signal
  const chunk0 = encodeGpsPathChunkFrame({
    workoutTime: t1,
    chunkIndex: 0,
    isEndOfPath: false,
    points: [
      { lat: 27.67312, lng: 85.32491 },
      { lat: 0, lng: 0, isPause: true },
      { lat: 200, lng: 200, isNoSignal: true },
      { lat: -33.86882, lng: -122.419416 },
    ],
  });
  const decoded0 = decodeGpsPath(chunk0)!;
  assert.equal(decoded0.chunkIndex, 0);
  assert.equal(decoded0.isEndOfPath, false);
  assert.equal(decoded0.points.length, 4);
  assert.equal(decoded0.validPoints.length, 2);
  assert.ok(Math.abs(decoded0.points[0]!.lat - 27.67312) < 0.00001);
  assert.ok(Math.abs(decoded0.points[0]!.lng - 85.32491) < 0.00001);
  assert.equal(decoded0.points[1]!.isPause, true);
  assert.equal(decoded0.points[1]!.lat, CRP_GPS_SENTINEL.PAUSE);
  assert.equal(decoded0.points[2]!.isNoSignal, true);
  assert.equal(decoded0.points[2]!.lat, CRP_GPS_SENTINEL.NO_SIGNAL);
  assert.ok(Math.abs(decoded0.points[3]!.lat - -33.86882) < 0.00001);
  assert.ok(Math.abs(decoded0.points[3]!.lng - -122.419416) < 0.00001);
  assert.equal(
    decoded0.points[1]!.timestampMs - decoded0.points[0]!.timestampMs,
    2000,
  );

  // End-of-path 0xFFFF and inline sentinel (latRaw=1, lng0=0xff)
  const chunkEnd = encodeGpsPathChunkFrame({
    workoutTime: t1,
    chunkIndex: 1,
    isEndOfPath: true,
    points: [{ lat: 27.675, lng: 85.326 }],
  });
  const decodedEnd = decodeGpsPath(chunkEnd)!;
  assert.equal(decodedEnd.isEndOfPath, true);
  assert.equal(decodedEnd.chunkIndex, CRP_GPS_SENTINEL.END_CHUNK_INDEX);

  // Live location (0xB3 0x02) & 0x37 24-byte Movement Workout summary
  const liveQuery = parseCrpFrame(encodeQueryGpsLiveLocation())!;
  assert.deepEqual(liveQuery.payload, Uint8Array.of(CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION));
  const chunkPayload = parseCrpFrame(chunk0)!.payload;
  const liveResp = buildCrpFrame(
    CRP_CMD.GPS_PATH,
    Uint8Array.of(CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION, ...chunkPayload.subarray(7, 15)),
  );
  const liveDecoded = decodeGpsLiveLocation(liveResp)!;
  assert.ok(Math.abs(liveDecoded.lat - 27.67312) < 0.00001);

  const movQuery = parseCrpFrame(encodeQueryMovementWorkouts())!;
  assert.equal(movQuery.cmd, CRP_CMD.HEART_RATE_24H_CHUNK);
  const movPayload = new Uint8Array(24);
  const movView = new DataView(movPayload.buffer);
  movView.setUint32(0, decoded0.workoutTimeSeconds, true);
  movView.setUint32(4, decoded0.workoutTimeSeconds + 900, true);
  movView.setUint16(8, 880, true);
  movPayload[11] = 1;
  movView.setUint32(12, 1850, true);
  movView.setUint32(16, 1540, true);
  movView.setUint16(20, 128, true);
  const movDecoded = decodeMovementWorkouts(
    buildCrpFrame(CRP_CMD.HEART_RATE_24H_CHUNK, movPayload),
  );
  assert.equal(movDecoded.length, 1);
  assert.equal(movDecoded[0]!.steps, 1850);
  assert.equal(movDecoded[0]!.distanceMeters, 1540);
  assert.equal(movDecoded[0]!.caloriesKcal, 128);
  assert.equal(movDecoded[0]!.workoutType, 1);
});
