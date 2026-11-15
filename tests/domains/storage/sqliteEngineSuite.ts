import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANC_MODE as STORE_ANC_MODE,
  CASE_GESTURE,
  DEVICE_KIND,
  EARBUD_CHIP,
  EARBUD_GESTURE,
  EARBUD_KEY_FUNCTION,
  OFFLINE_STATE_VERSION,
  OfflineStore,
  VOICE_LANGUAGE as STORE_VOICE_LANGUAGE,
  createDefaultEarbudPrefs,
  createDefaultWatchSettings,
} from '../../../src/storage/offlineStore.ts';
import type { OfflineAppState } from '../../../src/storage/offlineStore.ts';
import {
  ExpoSqliteStorageBackend,
  SQLITE_DRIVER_KIND,
  SQLITE_TABLE_NAMES,
  UltimaSqliteDatabase,
  createExpoSqliteDriver,
  createNodeSqliteDriver,
} from '../../../src/storage/sqliteEngine.ts';
import type {
  ExpoSqliteModuleLike,
  SqliteDriver,
} from '../../../src/storage/sqliteEngine.ts';

// ---------------------------------------------------------------------------
// 9. Expo-SQLite & Node:sqlite Relational Engine + OfflineStore Integration
// ---------------------------------------------------------------------------

test('9.1 UltimaSqliteDatabase + ExpoSqliteStorageBackend schema, relational round-trip, and rollback safety', async () => {
  const driver = createNodeSqliteDriver(':memory:');
  const backend = new ExpoSqliteStorageBackend(driver);
  const db = new UltimaSqliteDatabase(driver);

  try {
    assert.equal(driver.kind, SQLITE_DRIVER_KIND.NODE_SQLITE);
    assert.equal(backend.getDriverKind(), SQLITE_DRIVER_KIND.NODE_SQLITE);

    // 1) Exercise ExpoSqliteStorageBackend KV operations on kv_store
    assert.equal(await backend.getItem('missing_key'), null);
    await backend.setItem('alpha', 'first-value');
    assert.equal(await backend.getItem('alpha'), 'first-value');
    await backend.setItem('alpha', 'updated-value');
    assert.equal(await backend.getItem('alpha'), 'updated-value');
    await backend.removeItem('alpha');
    assert.equal(await backend.getItem('alpha'), null);
    await backend.setItem('kv_keep', '{"ok":true}');

    // 2) Full relational syncFromAppState -> loadIntoAppState round-trip
    await db.initSchema();
    const prefs = createDefaultEarbudPrefs();
    prefs.ancMode = STORE_ANC_MODE.ANC;
    prefs.ancGain = 7;
    prefs.gameMode = true;
    prefs.voiceLanguage = STORE_VOICE_LANGUAGE.ZH;
    prefs.keyMappings.left[EARBUD_GESTURE.DOUBLE] = EARBUD_KEY_FUNCTION.NEXT;
    prefs.keyMappings.caseKeys[CASE_GESTURE.ROTATION] = {
      keyFunction: EARBUD_KEY_FUNCTION.VOLUME_UP,
      callControl: 1,
    };

    const watchSettings = createDefaultWatchSettings();
    watchSettings.goalSteps = 12000;
    watchSettings.watchFaceId = 4;
    watchSettings.notificationRules = { 1: true, 4: false };

    const fullState: OfflineAppState = {
      version: OFFLINE_STATE_VERSION,
      pairedDevices: [
        {
          id: 'eb-xh68-sql',
          name: 'XH-68B ANC',
          kind: DEVICE_KIND.EARBUDS,
          chip: EARBUD_CHIP.BT,
          pid: 0x000a,
          mac: 'AA:BB:CC:DD:EE:01',
          lastConnectedAt: 1763175000000,
          lastKnownLocation: {
            lat: 27.7172,
            lng: 85.324,
            note: 'Office Desk',
            savedAt: 1763175005000,
          },
        },
        {
          id: 'watch-apex-sql',
          name: 'ULTIMA APEX',
          kind: DEVICE_KIND.WATCH,
          lastConnectedAt: 1763174000000,
        },
      ],
      customEqProfiles: [
        {
          id: 'eq-sql-1',
          name: 'Vocal Boost',
          gains: [0, 1, 2, 4, 5, 4, 2, 1, 0, -1],
          createdAt: 1763170000000,
        },
        {
          id: 'eq-sql-2',
          name: 'Sub Bass',
          gains: [8, 6, 4, 1, 0, 0, 1, 2, 2, 1],
          createdAt: 1763171000000,
        },
      ],
      earbudPrefs: { 'eb-xh68-sql': prefs },
      healthHistory: [
        {
          date: '2026-11-12',
          steps: 7000,
          distanceMeters: 5100,
          caloriesKcal: 310,
          stepBuckets48: new Array<number>(48).fill(100),
          deepSleepMin: 90,
          lightSleepMin: 240,
          remSleepMin: 70,
          awakeMin: 15,
          restingHr: 60,
          hrSamples: [58, 62, 65],
          spo2Percent: 98,
          systolicBp: 118,
          diastolicBp: 76,
          stressScore: 28,
        },
        {
          date: '2026-11-13',
          steps: 11000,
          distanceMeters: 8400,
          caloriesKcal: 490,
          deepSleepMin: 110,
          lightSleepMin: 260,
          remSleepMin: 90,
          awakeMin: 10,
          restingHr: 56,
          hrSamples: [55, 57, 61],
          spo2Percent: 99,
          systolicBp: 115,
          diastolicBp: 74,
          stressScore: 22,
        },
      ],
      watchAlarms: [
        {
          id: 0,
          enabled: true,
          hour: 6,
          minute: 45,
          repeatMask: 0x3e,
          year: 2026,
          month: 11,
          day: 15,
          label: 'Morning Run',
        },
      ],
      watchSettings,
      gpsRoutes: [
        {
          id: 'route-sql-1',
          deviceId: 'watch-apex-sql',
          name: 'Patan Loop',
          activityType: 'outdoor_run',
          startedAt: '2026-11-13T01:00:00.000Z',
          endedAt: '2026-11-13T01:25:00.000Z',
          distanceMeters: 4200,
          durationSec: 1500,
          caloriesKcal: 310,
          avgHeartRateBpm: 152,
          maxHeartRateBpm: 171,
          elevationGainMeters: 38.5,
          waypoints: [
            {
              lat: 27.67312,
              lng: 85.32491,
              timestamp: '2026-11-13T01:00:00.000Z',
              heartRateBpm: 135,
              elevationMeters: 1332.4,
            },
            {
              lat: 0,
              lng: 0,
              timestamp: '2026-11-13T01:10:00.000Z',
            },
            {
              lat: 27.67665,
              lng: 85.32672,
              timestamp: '2026-11-13T01:25:00.000Z',
              heartRateBpm: 164,
              elevationMeters: 1351.0,
            },
          ],
        },
      ],
    };

    await db.syncFromAppState(fullState);

    const counts = await db.getTableRowCounts();
    assert.deepEqual(Object.keys(counts).sort(), [...SQLITE_TABLE_NAMES].sort());
    assert.equal(counts.kv_store, 1);
    assert.equal(counts.paired_devices, 2);
    assert.equal(counts.custom_eq_profiles, 2);
    assert.equal(counts.daily_health_records, 2);
    assert.equal(counts.gps_workout_routes, 1);
    assert.equal(counts.gps_waypoints, 3);
    assert.equal(counts.watch_alarms, 1);

    // Check pause sentinel flag stored in gps_waypoints.is_paused
    const wpFlags = await driver.all<{ seq_idx: number; is_paused: number }>(
      'SELECT seq_idx, is_paused FROM gps_waypoints WHERE route_id = ? ORDER BY seq_idx ASC;',
      ['route-sql-1'],
    );
    assert.deepEqual(wpFlags, [
      { seq_idx: 0, is_paused: 0 },
      { seq_idx: 1, is_paused: 1 },
      { seq_idx: 2, is_paused: 0 },
    ]);

    const loaded = await db.loadIntoAppState();
    assert.deepEqual(loaded, fullState);

    // 3) Verify atomic transaction ROLLBACK on mid-sync error preserves prior rows
    let insertSeen = 0;
    const failingDriver: SqliteDriver = {
      kind: driver.kind,
      exec: (sql) => driver.exec(sql),
      all: (sql, params) => driver.all(sql, params),
      run(sql, params) {
        if (sql.includes('INSERT INTO custom_eq_profiles')) {
          insertSeen += 1;
          if (insertSeen === 1) {
            throw new Error('Simulated disk write failure mid-transaction');
          }
        }
        return driver.run(sql, params);
      },
    };
    const failingDb = new UltimaSqliteDatabase(failingDriver);
    await failingDb.initSchema();
    const emptyReplacement: OfflineAppState = {
      ...fullState,
      pairedDevices: [],
      customEqProfiles: [
        {
          id: 'eq-fail',
          name: 'Broken',
          gains: new Array<number>(10).fill(0),
          createdAt: 1,
        },
      ],
    };
    await assert.rejects(
      () => failingDb.syncFromAppState(emptyReplacement),
      /Simulated disk write failure mid-transaction/,
    );
    // Original 2 paired devices, 2 EQs, 2 health days must still be intact!
    const afterRollbackCounts = await db.getTableRowCounts();
    assert.equal(afterRollbackCounts.paired_devices, 2);
    assert.equal(afterRollbackCounts.custom_eq_profiles, 2);
    assert.equal(afterRollbackCounts.daily_health_records, 2);
    assert.equal(afterRollbackCounts.gps_waypoints, 3);

    // 4) Verify createExpoSqliteDriver with mock openDatabaseSync + openDatabaseAsync
    const recordedCalls: string[] = [];
    const mockExpoSyncMod: ExpoSqliteModuleLike = {
      openDatabaseSync: (name: string) => {
        recordedCalls.push(`sync:${name}`);
        return {
          execAsync: async (sql: string) => {
            driver.exec(sql);
          },
          runAsync: async (sql: string, params?: unknown[]) => {
            driver.run(sql, params);
          },
          getAllAsync: async <T>(sql: string, params?: unknown[]) =>
            driver.all<T>(sql, params),
        };
      },
    };
    const expoSyncDriver = createExpoSqliteDriver('ultima_test.db', mockExpoSyncMod);
    assert.equal(expoSyncDriver.kind, SQLITE_DRIVER_KIND.EXPO_SQLITE);
    assert.deepEqual(recordedCalls, ['sync:ultima_test.db']);
    const expoSyncRows = await expoSyncDriver.all<{ id: string }>(
      'SELECT id FROM paired_devices ORDER BY id ASC;',
    );
    assert.equal(expoSyncRows.length, 2);

    const mockExpoAsyncMod: ExpoSqliteModuleLike = {
      openDatabaseAsync: async (name: string) => {
        recordedCalls.push(`async:${name}`);
        return {
          execAsync: async (sql: string) => {
            driver.exec(sql);
          },
          runAsync: async (sql: string, params?: unknown[]) => {
            driver.run(sql, params);
          },
          getAllAsync: async <T>(sql: string, params?: unknown[]) =>
            driver.all<T>(sql, params),
        };
      },
    };
    const expoAsyncDriver = createExpoSqliteDriver('ultima_async.db', mockExpoAsyncMod);
    const asyncCountRows = await expoAsyncDriver.all<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM custom_eq_profiles;',
    );
    assert.equal(asyncCountRows[0]?.cnt, 2);
    assert.ok(recordedCalls.includes('async:ultima_async.db'));
  } finally {
    await driver.close?.();
  }
});
