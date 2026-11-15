import test from 'node:test';
import assert from 'node:assert/strict';
import { ANC_MODE } from '../../../src/protocols/ultimaLinkConstants.ts';
import { bytesToHex } from '../../../src/protocols/ultimaLinkAdvParser.ts';
import {
  encodeBluetrumAncMode,
  encodeBluetrumCommand,
} from '../../../src/protocols/ultimaLinkBluetrum.ts';
import {
  CRP_ALARM_REPEAT,
  CRP_LANGUAGE,
  CRP_MESSAGE_TYPE,
  encodeGoalSteps,
} from '../../../src/protocols/ultimaFitCrrepa.ts';
import {
  MemoryStorageBackend,
  OfflineStore,
} from '../../../src/storage/offlineStore.ts';
import {
  PACKET_DIRECTION,
  PACKET_PROTOCOL,
  UltimaBleManager,
} from '../../../src/services/bleManager.ts';
import { createTestManager } from '../../fixtures/fakeBlePlx.ts';

test('7.4 UltimaBleManager CRREPA Watch pipeline (syncWatchAll, HR/SpO2/BP measurements, 8-slot Alarms, Notification Push, Settings)', async () => {
  const backend = new MemoryStorageBackend();
  const store = new OfflineStore({ backend });
  const manager = createTestManager(store);
  await manager.init();

  await manager.connectDevice('sim-watch-magic');
  await manager.syncWatchAll();

  let snap = manager.getSnapshot();
  assert.equal(snap.watch.connected, true);
  assert.equal(snap.watch.steps, 7840);
  assert.equal(snap.watch.distanceMeters, 5620);
  assert.equal(snap.watch.caloriesKcal, 318);
  assert.equal(snap.watch.stepBuckets48.length, 48);
  assert.equal(
    snap.watch.stepBuckets48.reduce((sum, v) => sum + v, 0),
    7840,
  );
  assert.ok(snap.watch.sleepDeepMin > 0);
  assert.ok(snap.watch.sleepLightMin > 0);
  assert.ok(snap.watch.sleepRemMin > 0);
  assert.ok(snap.watch.sleep.napMinutes > 0);
  assert.ok(snap.watch.stressScore > 0);

  // Single-shot Heart Rate measurement must use 0x6D; 0x68 starts training mode on the watch.
  const hrTx = () => manager.getSnapshot().packetLogs.filter((p) => p.direction === 'TX' && p.target === 'watch').at(-1);
  await manager.measureWatchHeartRate(true);
  assert.equal(hrTx()?.cmd, 0x6d);
  snap = manager.getSnapshot();
  assert.equal(snap.watch.measuringHr, false, 'a reading ends the one-shot measurement');
  assert.equal(snap.watch.heartRateBpm, 74); // restingHr 68 + 6
  await manager.measureWatchHeartRate(false);
  assert.equal(manager.getSnapshot().watch.measuringHr, false);

  // Single-shot SpO2 measurement (0x6B)
  await manager.measureWatchSpO2(true);
  snap = manager.getSnapshot();
  assert.equal(snap.watch.measuringSpo2, false, 'a reading ends the one-shot measurement');
  assert.equal(snap.watch.spo2Percent, 98);
  await manager.measureWatchSpO2(false);
  assert.equal(manager.getSnapshot().watch.measuringSpo2, false);

  // Single-shot Blood Pressure measurement (0x69)
  await manager.measureWatchBloodPressure(true);
  snap = manager.getSnapshot();
  assert.equal(snap.watch.measuringBp, true);
  assert.equal(snap.watch.systolicBp, 118);
  assert.equal(snap.watch.diastolicBp, 76);
  await manager.measureWatchBloodPressure(false);
  assert.equal(manager.getSnapshot().watch.measuringBp, false);

  // 8-slot Alarm save & delete (0xB9 subcmd 0x05)
  const weekdayMask =
    CRP_ALARM_REPEAT.MONDAY |
    CRP_ALARM_REPEAT.TUESDAY |
    CRP_ALARM_REPEAT.WEDNESDAY |
    CRP_ALARM_REPEAT.THURSDAY |
    CRP_ALARM_REPEAT.FRIDAY;
  await manager.saveWatchAlarm({
    id: 2,
    enabled: true,
    hour: 6,
    minute: 45,
    repeatMask: weekdayMask,
    year: 2026,
    month: 11,
    day: 14,
    label: 'Gym Session',
  });
  snap = manager.getSnapshot();
  const savedAlarm = snap.watch.alarms.find((a) => a.id === 2);
  assert.ok(savedAlarm);
  assert.equal(savedAlarm.enabled, true);
  assert.equal(savedAlarm.hour, 6);
  assert.equal(savedAlarm.minute, 45);
  assert.equal(savedAlarm.repeatMask, weekdayMask);
  assert.equal(savedAlarm.label, 'Gym Session');

  await manager.deleteWatchAlarm(2);
  assert.equal(
    manager.getSnapshot().watch.alarms.find((a) => a.id === 2),
    undefined,
  );

  // App Notification Push (0x41)
  await manager.pushWatchNotification(
    CRP_MESSAGE_TYPE.WHATSAPP,
    'Alert: Meeting starts in 5m 🚀',
  );
  snap = manager.getSnapshot();
  assert.ok(snap.watch.lastNotificationSent);
  assert.equal(snap.watch.lastNotificationSent.messageType, CRP_MESSAGE_TYPE.WHATSAPP);
  assert.equal(snap.watch.lastNotificationSent.text, 'Alert: Meeting starts in 5m 🚀');

  // Watch Configuration Settings
  await manager.setWatchGoalSteps(12500);
  await manager.setWatchTimeFormat(false);
  await manager.setWatchQuickView(false);
  await manager.setWatchFace(4);
  await manager.setWatchUnits(true);
  await manager.setWatchLanguage(CRP_LANGUAGE.CHINESE);
  await manager.setWatchSedentaryReminder(true);
  await manager.setWatchHrInterval(20);
  {
    // Official app only accepts 5/10/20/30 min, sent as 5-minute units (1/2/4/6).
    const tx = manager.getSnapshot().packetLogs.filter((p) => p.direction === 'TX' && p.target === 'watch').at(-1);
    assert.equal(tx?.cmd, 0x1f);
    assert.ok(tx?.hex.replace(/\s/g, '').toLowerCase().endsWith('1f04'), `expected 0x1F [04], got ${tx?.hex}`);
  }
  await manager.setWatchDrinkReminder({
    enabled: true,
    startHour: 9,
    startMinute: 0,
    endHour: 20,
    endMinute: 30,
  });
  await manager.findWatch();

  snap = manager.getSnapshot();
  assert.equal(snap.watch.goalSteps, 12500);
  assert.equal(snap.watch.is24Hour, false);
  assert.equal(snap.watch.quickView, false);
  assert.equal(snap.watch.watchFaceId, 4);
  assert.equal(snap.watch.imperialUnits, true);
  assert.equal(snap.watch.languageId, CRP_LANGUAGE.CHINESE);
  assert.equal(snap.watch.sedentaryReminder, true);
  assert.equal(snap.watch.hrIntervalMinutes, 20);
  assert.equal(snap.watch.drinkReminderPeriod.enabled, true);
  assert.equal(snap.watch.drinkReminderPeriod.startHour, 9);
  assert.equal(snap.watch.drinkReminderPeriod.endHour, 20);
  assert.equal(snap.watch.finding, true);

  manager.destroy();
});

test('7.5 UltimaBleManager TX/RX packetLogs hex generation, sendRawHex, 250-entry cap, and OfflineStore persistence', async () => {
  const backend = new MemoryStorageBackend();
  const store1 = new OfflineStore({ backend });
  const manager1 = createTestManager(store1);
  await manager1.init();

  await manager1.connectDevice('sim-earbuds-xh68b');
  await manager1.connectDevice('sim-watch-magic');
  await manager1.setEarbudsAncMode('anc');
  await manager1.pinLastKnownEarbudsLocation('Office desk', 37.7749, -122.4194);
  await manager1.saveWatchAlarm({
    id: 1,
    enabled: true,
    hour: 8,
    minute: 15,
    repeatMask: CRP_ALARM_REPEAT.EVERYDAY,
    year: 2026,
    month: 11,
    day: 14,
    label: 'Daily Standup',
  });

  // Verify TX and RX hex packet generation across protocols
  const logs = manager1.getSnapshot().packetLogs;
  assert.ok(logs.length > 10);
  const hasBtTx = logs.some(
    (l) =>
      l.direction === PACKET_DIRECTION.TX &&
      l.protocol === PACKET_PROTOCOL.BLUETRUM &&
      l.target === 'earbuds' &&
      /^[0-9a-fA-F]{2}( [0-9a-fA-F]{2})*$/.test(l.hex),
  );
  const hasBtRx = logs.some(
    (l) =>
      l.direction === PACKET_DIRECTION.RX &&
      l.protocol === PACKET_PROTOCOL.BLUETRUM &&
      l.target === 'earbuds',
  );
  const hasCrpTx = logs.some(
    (l) =>
      l.direction === PACKET_DIRECTION.TX &&
      l.protocol === PACKET_PROTOCOL.CRREPA &&
      l.target === 'watch' &&
      l.hex.toUpperCase().startsWith('FE EA'),
  );
  const hasCrpRx = logs.some(
    (l) =>
      l.direction === PACKET_DIRECTION.RX &&
      l.protocol === PACKET_PROTOCOL.CRREPA &&
      l.target === 'watch' &&
      l.hex.toUpperCase().startsWith('FE EA'),
  );
  assert.equal(hasBtTx, true);
  assert.equal(hasBtRx, true);
  assert.equal(hasCrpTx, true);
  assert.equal(hasCrpRx, true);

  // Raw hex injection for both targets
  const rawBtFrame = encodeBluetrumCommand(encodeBluetrumAncMode(ANC_MODE.TRANSPARENCY), 9)[0]!;
  await manager1.sendRawHex('earbuds', bytesToHex(rawBtFrame, ' '));
  assert.equal(manager1.getSnapshot().earbuds.ancMode, 'transparency');

  const rawCrpFrame = encodeGoalSteps(14000);
  await manager1.sendRawHex('watch', bytesToHex(rawCrpFrame, ' '));
  assert.equal(manager1.getSnapshot().watch.goalSteps, 14000);

  // Verify 250-entry packet log cap & clearPacketLogs()
  for (let i = 0; i < 140; i++) {
    await manager1.findWatch();
  }
  assert.equal(manager1.getSnapshot().packetLogs.length, 250);
  manager1.clearPacketLogs();
  assert.equal(manager1.getSnapshot().packetLogs.length, 0);

  manager1.destroy();

  // Verify OfflineStore persistence across a fresh UltimaBleManager + OfflineStore sharing backend
  const store2 = new OfflineStore({ backend });
  const manager2 = createTestManager(store2);
  await manager2.init();

  const hydrated = manager2.getSnapshot();
  assert.equal(hydrated.storeState.pairedDevices.length, 2);
  assert.equal(hydrated.earbuds.lastKnownLocation?.note, 'Office desk');
  assert.equal(hydrated.earbuds.lastKnownLocation?.lat, 37.7749);
  assert.equal(hydrated.watch.alarms.some((a) => a.id === 1 && a.label === 'Daily Standup'), true);
  assert.ok(hydrated.storeState.healthHistory.length >= 1);
  assert.equal(hydrated.storeState.healthHistory[0]!.steps, 7840);

  manager2.destroy();
});
