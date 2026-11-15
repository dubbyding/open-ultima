import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRP_CMD,
  CRP_MCU_PLATFORM,
  CRP_SLEEP_STATE,
  CRP_STRESS_DATE,
  CRREPA_UUIDS,
  buildCrpFrame,
  decodeBloodPressure,
  decodeCrpWatchTimestamp,
  decodeHeartRate24h,
  decodeHeartRateSingle,
  decodeNapSleep,
  decodeSleepSegments,
  decodeSpO2,
  decodeStepCategory,
  decodeStepInfo,
  decodeStress,
  encodeCrpScanRecord,
  encodeDynamicHeartRate,
  encodeTrainingStart,
  encodeTrainingState,
  decodeTrainingNotification,
  encodeMeasureBloodPressure,
  encodeMeasureHeartRate,
  encodeMeasureSpO2,
  encodeQuery24hBp,
  encodeQuery24hSpO2,
  encodeQueryHistoryDay,
  encodeQueryHistoryDayV2,
  encodeQueryHistoryStress,
  encodeQueryHistoryVitals,
  encodeQuerySleepHistory,
  encodeQueryTimingStress,
  encodeQueryTodayHeartRate,
  encodeSyncStepsAndSleep,
  encodeTimeSync,
  encodeTimingBp,
  encodeTimingHeartRateInterval,
  encodeTimingSpO2,
  encodeTimingStress,
  parseCrpFrame,
  parseCrpScanRecord,
} from '../../../src/protocols/ultimaFitCrrepa.ts';

// ---------------------------------------------------------------------------
// 5. ULTIMA Fit CRREPA (0xFEEA) Protocol
// ---------------------------------------------------------------------------

test('5.1 CRREPA ScanRecord round-trip and FE EA frame builder/parser (MTU 20 vs larger MTU)', () => {
  assert.equal(CRREPA_UUIDS.SERVICE, '0000feea-0000-1000-8000-00805f9b34fb');

  const scanBytes = encodeCrpScanRecord({
    name: 'ULTIMA Watch Pro',
    firmwareType: 'MOY',
    platform: CRP_MCU_PLATFORM.REALTEK,
    chipId: 0x42,
    functionMask: 0x5a3c,
  });
  const parsedScan = parseCrpScanRecord(scanBytes);
  assert.ok(parsedScan);
  assert.equal(parsedScan.name, 'ULTIMA Watch Pro');
  assert.equal(parsedScan.firmwareType, 'MOY');
  assert.equal(parsedScan.platform, CRP_MCU_PLATFORM.REALTEK);
  assert.equal(parsedScan.chipId, 0x42);
  assert.equal(parsedScan.functionMask, 0x5a3c);
  assert.equal(parsedScan.rawServiceData[0], 0xea);
  assert.equal(parsedScan.rawServiceData[1], 0xfe);

  // Short name fallback (0x08) & invalid scan records
  const shortNameRecord = Uint8Array.of(
    4, 0x08, 0x46, 0x49, 0x54,
    10, 0x16, 0xea, 0xfe, 0x4d, 0x4f, 0x59, 0x06, 0x11, 0x02, 0x00,
  );
  assert.equal(parseCrpScanRecord(shortNameRecord)?.name, 'FIT');
  assert.equal(parseCrpScanRecord(new Uint8Array(0)), null);
  assert.equal(parseCrpScanRecord(Uint8Array.of(3, 0x09, 0x41, 0x42)), null);

  // Frame builder: MTU 20 -> protoByte 0x10; larger MTU -> protoByte 0x20 / 0x20+(len>>8)
  const smallPayload = Uint8Array.of(0x01, 0x02, 0x03);
  const mtu20Frame = buildCrpFrame(CRP_CMD.SYNC_TIME, smallPayload, 20);
  assert.equal(mtu20Frame[0], 0xfe);
  assert.equal(mtu20Frame[1], 0xea);
  assert.equal(mtu20Frame[2], 0x10);
  assert.equal(mtu20Frame[3], (smallPayload.length + 5) & 0xff);
  assert.equal(mtu20Frame[4], CRP_CMD.SYNC_TIME);

  const largeMtuFrame = buildCrpFrame(CRP_CMD.SYNC_TIME, smallPayload, 247);
  assert.equal(largeMtuFrame[2], 0x20);
  assert.equal(largeMtuFrame[3], 8);
  const parsedSmall = parseCrpFrame(largeMtuFrame);
  assert.ok(parsedSmall);
  assert.equal(parsedSmall.cmd, CRP_CMD.SYNC_TIME);
  assert.equal(parsedSmall.protoByte, 0x20);
  assert.equal(parsedSmall.totalLength, 8);
  assert.equal(parsedSmall.isComplete, true);
  assert.deepEqual(parsedSmall.payload, smallPayload);

  // Extended > 255B frame with larger MTU
  const bigPayload = new Uint8Array(300).fill(0x7e); // totalLen = 305 = 0x0131
  const extFrame = buildCrpFrame(CRP_CMD.QUERY_DAY_HISTORY_V2, bigPayload, 512);
  assert.equal(extFrame[2], 0x21);
  assert.equal(extFrame[3], 0x31);
  const parsedExt = parseCrpFrame(extFrame);
  assert.ok(parsedExt);
  assert.equal(parsedExt.totalLength, 305);
  assert.equal(parsedExt.isComplete, true);
  assert.deepEqual(parsedExt.payload, bigPayload);

  // Incomplete or malformed frame checks
  assert.equal(parseCrpFrame(Uint8Array.of(0x00, 0xea, 0x20, 5, 0x10)), null);
  assert.equal(parseCrpFrame(Uint8Array.of(0xfe, 0xea, 0x20, 5)), null);
  const truncated = parseCrpFrame(largeMtuFrame.subarray(0, 6));
  assert.ok(truncated);
  assert.equal(truncated.isComplete, false);
});

test('5.2 CRREPA TimeSync (0x31 GMT+8 & 0xBB signed timezone) and timestamp decoding', () => {
  const targetDate = new Date('2026-11-14T10:30:00Z');
  const utcSec = Math.floor(targetDate.getTime() / 1000);

  // GMT+8 (480 min) -> crpTimeSeconds equals utcSec, tzOffset = +28800
  const gmt8Sync = encodeTimeSync(targetDate, 480);
  const gmt8TimeFrame = parseCrpFrame(gmt8Sync.timeCmd)!;
  const gmt8TzFrame = parseCrpFrame(gmt8Sync.tzCmd)!;
  assert.equal(gmt8TimeFrame.cmd, CRP_CMD.SYNC_TIME);
  assert.equal(gmt8TzFrame.cmd, CRP_CMD.SYNC_TIMEZONE);
  const gmt8View = new DataView(
    gmt8TimeFrame.payload.buffer,
    gmt8TimeFrame.payload.byteOffset,
    gmt8TimeFrame.payload.byteLength,
  );
  assert.equal(gmt8View.getUint32(0, false), utcSec);
  assert.equal(gmt8TimeFrame.payload[4], 0x08);
  assert.equal(gmt8TzFrame.payload[0], 0x07);
  assert.equal(gmt8TzFrame.payload[1], 0x00);
  const gmt8TzView = new DataView(
    gmt8TzFrame.payload.buffer,
    gmt8TzFrame.payload.byteOffset,
    gmt8TzFrame.payload.byteLength,
  );
  assert.equal(gmt8TzView.getInt32(2, true), 28800);

  // Negative timezone (UTC-5 = -300 min = -18000s)
  const nySync = encodeTimeSync(targetDate, -300);
  const nyTimeFrame = parseCrpFrame(nySync.timeCmd)!;
  const nyTzFrame = parseCrpFrame(nySync.tzCmd)!;
  const nyWatchSec = new DataView(
    nyTimeFrame.payload.buffer,
    nyTimeFrame.payload.byteOffset,
    nyTimeFrame.payload.byteLength,
  ).getUint32(0, false);
  const nyTzSec = new DataView(
    nyTzFrame.payload.buffer,
    nyTzFrame.payload.byteOffset,
    nyTzFrame.payload.byteLength,
  ).getInt32(2, true);
  assert.equal(nyTzSec, -18000);
  assert.equal(nyWatchSec, utcSec - 18000 - 28800);
  // decodeCrpWatchTimestamp inverts watchSeconds back to exact UTC instant
  assert.equal(decodeCrpWatchTimestamp(nyWatchSec, -300).getTime(), targetDate.getTime());
});

test('5.3 CRREPA Steps & 48-slot buckets, Sleep midnight wrap, HR, SpO2, BP, and Stress', () => {
  // Sync sequence
  const syncSeq = encodeSyncStepsAndSleep();
  assert.deepEqual(
    syncSeq.map((f) => parseCrpFrame(f)!.cmd),
    [CRP_CMD.SYNC_SLEEP, CRP_CMD.QUERY_HISTORY_DAY, CRP_CMD.QUERY_DAY_HISTORY_V2, CRP_CMD.QUERY_DAY_HISTORY_V2],
  );
  assert.equal(parseCrpFrame(encodeQueryHistoryDay(1))!.payload[0], 1);
  assert.deepEqual(
    parseCrpFrame(encodeQueryHistoryDayV2(1, 'heartRate'))!.payload,
    Uint8Array.of(0x02, 0x01, 0x00),
  );
  assert.equal(parseCrpFrame(encodeQuerySleepHistory(2))!.payload[0], 4);

  // Steps: 3-byte LE (9B) & 4-byte LE with 0xB6 prefix (14B)
  const steps3Payload = Uint8Array.of(
    0x10, 0x27, 0x00, // 10000 steps
    0x40, 0x1f, 0x00, // 8000 m
    0x5e, 0x01, 0x00, // 350 kcal
  );
  const s3 = decodeStepInfo(steps3Payload);
  assert.deepEqual(s3, {
    steps: 10000,
    distanceMeters: 8000,
    caloriesKcal: 350,
    durationSec: 0,
    format: '3byte',
  });

  const steps4Payload = new Uint8Array(14);
  steps4Payload[0] = 0x00;
  steps4Payload[1] = 0x01; // yesterday
  const s4View = new DataView(steps4Payload.buffer);
  s4View.setUint32(2, 12345, true); // steps
  s4View.setUint32(6, 420 * 10000, true); // kcal * 10000
  s4View.setUint32(10, 9100 * 100, true); // dist * 100
  const s4 = decodeStepInfo(steps4Payload);
  assert.deepEqual(s4, {
    steps: 12345,
    distanceMeters: 9100,
    caloriesKcal: 420,
    durationSec: 0,
    dayOffset: 1,
    format: '4byte',
  });

  // 48-slot step buckets across two 0x59 chunks
  const chunk0 = new Uint8Array(49);
  chunk0[0] = 0x00;
  for (let i = 0; i < 24; i++) {
    new DataView(chunk0.buffer).setUint16(1 + i * 2, i * 100, true);
  }
  const chunk1 = new Uint8Array(49);
  chunk1[0] = 0x01;
  for (let i = 0; i < 24; i++) {
    new DataView(chunk1.buffer).setUint16(1 + i * 2, (24 + i) * 100, true);
  }
  const partialCat = decodeStepCategory(chunk0);
  assert.ok(partialCat?.nextChunkCmd);
  assert.equal(partialCat.isComplete, false);
  const fullCat = decodeStepCategory(chunk0, chunk1);
  assert.ok(fullCat);
  assert.equal(fullCat.isComplete, true);
  assert.equal(fullCat.buckets.length, 48);
  assert.equal(fullCat.buckets[0], 0);
  assert.equal(fullCat.buckets[47], 4700);

  // Sleep segments (0x32 3-byte format with midnight wrap)
  const sleep3 = Uint8Array.of(
    CRP_SLEEP_STATE.LIGHT, 23, 30,
    CRP_SLEEP_STATE.DEEP, 0, 15, // +45m light
    CRP_SLEEP_STATE.REM, 2, 0,   // +105m deep
    CRP_SLEEP_STATE.AWAKE, 6, 30,// +270m REM
    CRP_SLEEP_STATE.AWAKE, 7, 0, // +30m awake
  );
  const decodedSleep = decodeSleepSegments(sleep3);
  assert.ok(decodedSleep);
  assert.equal(decodedSleep.format, '3byte');
  assert.equal(decodedSleep.lightMinutes, 45);
  assert.equal(decodedSleep.deepMinutes, 105);
  assert.equal(decodedSleep.remMinutes, 270);
  assert.equal(decodedSleep.awakeMinutes, 30);
  assert.equal(decodedSleep.totalMinutes, 420);
  assert.equal(decodedSleep.segments.length, 4);

  // 0xB6 2-byte packed LE sleep segments ([0x01, dayOffset, ...uint16LE])
  const packSleep2 = (state: number, hour: number, min: number) =>
    (state & 0x0f) | ((hour & 0x3f) << 4) | ((min & 0x3f) << 10);
  const sleep2Payload = new Uint8Array(2 + 4 * 2);
  sleep2Payload[0] = 0x01;
  sleep2Payload[1] = 0x01; // yesterday
  const sleep2View = new DataView(sleep2Payload.buffer);
  sleep2View.setUint16(2, packSleep2(CRP_SLEEP_STATE.LIGHT, 23, 0), true);
  sleep2View.setUint16(4, packSleep2(CRP_SLEEP_STATE.DEEP, 0, 30), true);
  sleep2View.setUint16(6, packSleep2(CRP_SLEEP_STATE.REM, 1, 30), true);
  sleep2View.setUint16(8, packSleep2(CRP_SLEEP_STATE.AWAKE, 2, 0), true);
  const decodedSleep2 = decodeSleepSegments(sleep2Payload, {
    cmd: CRP_CMD.QUERY_DAY_HISTORY_V2,
  });
  assert.equal(decodedSleep2?.format, '2byte');
  assert.equal(decodedSleep2?.dayOffset, 1);
  assert.equal(decodedSleep2?.lightMinutes, 90);
  assert.equal(decodedSleep2?.deepMinutes, 60);
  assert.equal(decodedSleep2?.remMinutes, 30);
  assert.equal(decodedSleep2?.totalMinutes, 180);

  // Nap sleep (0xBC)
  const nap = decodeNapSleep(Uint8Array.of(0x01, 0x00, 0x00, 0x01, 13, 15, 0x00, 14, 0));
  assert.equal(nap?.totalMinutes, 45);

  // Heart Rate (0x68, 0x35, 0xB6, 0xAB)
  assert.equal(parseCrpFrame(encodeMeasureHeartRate(true))!.payload[0], 0x00);
  assert.equal(parseCrpFrame(encodeMeasureHeartRate(false))!.payload[0], 0xff);
  assert.equal(parseCrpFrame(encodeDynamicHeartRate(true))!.payload[0], 0x00);
  // Phone-led workout on the watch (ULTIMA Fit gn3 / z48.q0).
  assert.deepEqual([...parseCrpFrame(encodeTrainingStart(0x01))!.payload], [0x01]);
  assert.equal(parseCrpFrame(encodeTrainingStart(0x01))!.cmd, 0x68);
  assert.deepEqual([...parseCrpFrame(encodeTrainingState('pause'))!.payload], [0xfe]);
  assert.deepEqual([...parseCrpFrame(encodeTrainingState('resume'))!.payload], [0xfd]);
  assert.deepEqual([...parseCrpFrame(encodeTrainingState('stop'))!.payload], [0xff]);
  assert.deepEqual(decodeTrainingNotification(Uint8Array.of(132, 0x01)), { kind: 'heartRate', bpm: 132 });
  assert.deepEqual(decodeTrainingNotification(Uint8Array.of(0xff, 0x01)), { kind: 'startFailed' });
  assert.deepEqual(decodeTrainingNotification(Uint8Array.of(0xfe)), { kind: 'state', state: 'paused' });
  assert.deepEqual(decodeTrainingNotification(Uint8Array.of(0x02)), { kind: 'state', state: 'started', type: 0x02 });
  assert.equal(parseCrpFrame(encodeTimingHeartRateInterval(6))!.payload[0], 6);
  assert.equal(parseCrpFrame(encodeQueryTodayHeartRate(1))!.cmd, CRP_CMD.QUERY_TIMING_HEART_RATE);
  assert.equal(parseCrpFrame(encodeQueryTodayHeartRate(2))!.cmd, CRP_CMD.QUERY_24H_HEART_RATE);
  assert.deepEqual(decodeHeartRateSingle(Uint8Array.of(74)), { bpm: 74 });
  assert.deepEqual(decodeHeartRateSingle(Uint8Array.of(0x06, 82)), {
    bpm: 82,
    sensorContact: true,
  });

  const hrTiming = decodeHeartRate24h(Uint8Array.of(0x02, 0x00, 0x00, 68, 250, 72));
  assert.equal(hrTiming?.kind, 'timing_5min');
  assert.deepEqual(hrTiming?.values, [68, 0, 72]);

  // 0x35 timing HR (partIndex >= 4) & 0xAB history HR
  const hr35 = decodeHeartRate24h(Uint8Array.of(4, 70, 75, 80));
  assert.equal(hr35?.kind, 'timing_5min');
  assert.equal(hr35?.partIndex, 4);
  assert.deepEqual(hr35?.values, [70, 75, 80]);

  const watchTs = Math.floor(new Date('2026-11-14T10:00:00Z').getTime() / 1000);
  const hrHist = new Uint8Array(7);
  hrHist[0] = 0x00;
  hrHist[1] = 0x01;
  hrHist[2] = 77;
  new DataView(hrHist.buffer).setUint32(3, watchTs, true);
  const decodedHrHist = decodeHeartRate24h(hrHist, { tzOffsetMinutes: 480 });
  assert.equal(decodedHrHist?.kind, 'history');
  assert.equal(decodedHrHist?.historySamples?.[0]?.bpm, 77);
  assert.equal(decodedHrHist?.historySamples?.[0]?.rawTimestampSeconds, watchTs);

  // SpO2 (0x6B / 0x3E)
  assert.equal(parseCrpFrame(encodeMeasureSpO2(true))!.payload[0], 0x00);
  assert.equal(parseCrpFrame(encodeTimingSpO2(true))!.cmd, CRP_CMD.TIMING_SPO2_OR_BP);
  assert.equal(parseCrpFrame(encodeQuery24hSpO2(0))!.cmd, CRP_CMD.QUERY_24H_SPO2);
  assert.equal(decodeSpO2(Uint8Array.of(98))?.spo2, 98);
  assert.equal(decodeSpO2(Uint8Array.of(50))?.spo2, 0);
  assert.deepEqual(decodeSpO2(Uint8Array.of(0x00, 97, 98, 99))?.values, [97, 98, 99]);

  // Blood Pressure (0x69 / 0x3D)
  assert.deepEqual(
    parseCrpFrame(encodeMeasureBloodPressure(true))!.payload,
    Uint8Array.of(0, 0, 0),
  );
  assert.deepEqual(
    parseCrpFrame(encodeMeasureBloodPressure(false))!.payload,
    Uint8Array.of(0xff, 0xff, 0xff),
  );
  assert.equal(parseCrpFrame(encodeTimingBp(true))!.cmd, CRP_CMD.TIMING_SPO2_OR_BP);
  const bpSingle = decodeBloodPressure(Uint8Array.of(0x00, 122, 78));
  assert.equal(bpSingle?.kind, 'single');
  assert.equal(bpSingle?.systolic, 122);
  assert.equal(bpSingle?.diastolic, 78);
  const bpChunk = decodeBloodPressure(Uint8Array.of(0x00, 120, 80, 118, 76));
  assert.equal(bpChunk?.kind, '24h_chunk');
  assert.equal(bpChunk?.isLastChunk, false);
  assert.deepEqual(bpChunk?.nextChunkCmd, encodeQuery24hBp(1));

  // Stress (0xB9)
  assert.deepEqual(parseCrpFrame(encodeTimingStress(true))!.payload, Uint8Array.of(0x01, 0x00));
  assert.deepEqual(
    parseCrpFrame(encodeQueryTimingStress(CRP_STRESS_DATE.TODAY))!.payload,
    Uint8Array.of(0x11, 0x01, 0x00),
  );
  assert.deepEqual(
    parseCrpFrame(encodeQueryHistoryStress())!.payload,
    Uint8Array.of(0x11, 0x02),
  );
  const timingStressPayload = new Uint8Array(51);
  timingStressPayload[0] = 0x11;
  timingStressPayload[1] = 0x01;
  timingStressPayload[2] = CRP_STRESS_DATE.TODAY;
  timingStressPayload[3] = 35;
  timingStressPayload[50] = 48;
  const decodedStress = decodeStress(timingStressPayload);
  assert.equal(decodedStress?.kind, 'timing_30min');
  assert.equal(decodedStress?.values.length, 48);
  assert.equal(decodedStress?.values[0], 35);
  assert.equal(decodedStress?.values[47], 48);

  assert.equal(parseCrpFrame(encodeQueryHistoryVitals('bp'))!.payload[0], 0x01);
});
