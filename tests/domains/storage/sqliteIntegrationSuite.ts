import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEVICE_KIND,
  OfflineStore,
  STORAGE_BACKEND_TYPE,
} from '../../../src/storage/offlineStore.ts';
import {
  ExpoSqliteStorageBackend,
  SQLITE_TABLE_NAMES,
  UltimaSqliteDatabase,
  createNodeSqliteDriver,
} from '../../../src/storage/sqliteEngine.ts';
import type { SqliteDriver } from '../../../src/storage/sqliteEngine.ts';
import { UltimaBleManager } from '../../../src/services/bleManager.ts';
import { REPO_ROOT, readCombinedText, resolveSourceFiles } from '../testUtils.ts';

test('9.2 OfflineStore SQLite integration, SQL queryHealthDateRange, queryHealthAggregates, and gps_waypoints FK/index queries', async () => {
  const driver = createNodeSqliteDriver(':memory:');
  const backend = new ExpoSqliteStorageBackend(driver);
  const store = new OfflineStore({ backend });

  try {
    assert.deepEqual(store.getStorageEngineInfo(), {
      backendType: STORAGE_BACKEND_TYPE.NODE_SQLITE,
      relationalTablesActive: true,
    });
    const db = store.getSqliteDb();
    assert.ok(db, 'OfflineStore should auto-attach UltimaSqliteDatabase');

    await store.load();
    await store.upsertPairedDevice({
      id: 'watch-sql-92',
      name: 'ULTIMA Fit Watch',
      kind: DEVICE_KIND.WATCH,
      lastConnectedAt: 1763176000000,
    });
    await store.saveCustomEqProfile({
      id: 'eq-92',
      name: 'Clear Acoustic',
      gains: [1, 2, 1, 0, -1, 0, 2, 3, 2, 1],
      createdAt: 1763176001000,
    });
    await store.setWatchAlarms([
      {
        id: 2,
        enabled: true,
        hour: 7,
        minute: 30,
        repeatMask: 0x7f,
        year: 2026,
        month: 11,
        day: 15,
        label: 'Hydrate',
      },
    ]);

    await store.upsertHealthDay({
      date: '2026-11-10',
      steps: 4000,
      distanceMeters: 3000,
      caloriesKcal: 200,
      deepSleepMin: 80,
      lightSleepMin: 200,
      remSleepMin: 60,
      awakeMin: 20,
      restingHr: 64,
      hrSamples: [64, 68],
      spo2Percent: 96,
      systolicBp: 120,
      diastolicBp: 80,
      stressScore: 40,
    });
    await store.upsertHealthDay({
      date: '2026-11-12',
      steps: 8000,
      distanceMeters: 6000,
      caloriesKcal: 400,
      deepSleepMin: 100,
      lightSleepMin: 220,
      remSleepMin: 80,
      awakeMin: 10,
      restingHr: 60,
      hrSamples: [60, 62],
      spo2Percent: 98,
      systolicBp: 118,
      diastolicBp: 76,
      stressScore: 30,
    });
    await store.upsertHealthDay({
      date: '2026-11-14',
      steps: 10000,
      distanceMeters: 7800,
      caloriesKcal: 500,
      deepSleepMin: 120,
      lightSleepMin: 240,
      remSleepMin: 90,
      awakeMin: 12,
      restingHr: 56,
      hrSamples: [56, 59],
      spo2Percent: 99,
      systolicBp: 114,
      diastolicBp: 72,
      stressScore: 20,
    });
    await store.upsertHealthDay({
      date: '2026-11-16',
      steps: 12000,
      distanceMeters: 9200,
      caloriesKcal: 600,
      deepSleepMin: 110,
      lightSleepMin: 250,
      remSleepMin: 100,
      awakeMin: 8,
      restingHr: 58,
      hrSamples: [57, 60],
      spo2Percent: 99,
      systolicBp: 116,
      diastolicBp: 74,
      stressScore: 24,
    });

    await store.saveGpsRoute({
      id: 'route-fk-1',
      deviceId: 'watch-sql-92',
      name: 'Riverside 5K',
      activityType: 'outdoor_run',
      startedAt: '2026-11-14T02:00:00.000Z',
      endedAt: '2026-11-14T02:30:00.000Z',
      distanceMeters: 5000,
      durationSec: 1800,
      caloriesKcal: 360,
      avgHeartRateBpm: 150,
      maxHeartRateBpm: 168,
      waypoints: [
        { lat: 27.671, lng: 85.321, timestamp: '2026-11-14T02:00:00.000Z', heartRateBpm: 130 },
        { lat: 27.673, lng: 85.323, timestamp: '2026-11-14T02:15:00.000Z', heartRateBpm: 152 },
        { lat: 27.675, lng: 85.325, timestamp: '2026-11-14T02:30:00.000Z', heartRateBpm: 168 },
      ],
    });

    // Verify SQL WHERE date >= ? AND date <= ? ORDER BY date ASC
    const midRange = await store.queryHealthDateRange('2026-11-11', '2026-11-15');
    assert.deepEqual(
      midRange.map((d) => d.date),
      ['2026-11-12', '2026-11-14'],
    );
    assert.equal(midRange[0]!.steps, 8000);
    assert.equal(midRange[1]!.steps, 10000);

    // Verify SQL COUNT / SUM / AVG aggregates (all days + date-filtered)
    const allAgg = await store.queryHealthAggregates();
    assert.deepEqual(allAgg, {
      daysCount: 4,
      totalSteps: 34000,
      avgSteps: 8500,
      totalCaloriesKcal: 1700,
      avgSleepMin: (340 + 400 + 450 + 460) / 4,
      avgRestingHr: (64 + 60 + 56 + 58) / 4,
      avgSpo2Percent: (96 + 98 + 99 + 99) / 4,
      avgStressScore: (40 + 30 + 20 + 24) / 4,
    });

    const rangedAgg = await store.queryHealthAggregates('2026-11-12', '2026-11-14');
    assert.deepEqual(rangedAgg, {
      daysCount: 2,
      totalSteps: 18000,
      avgSteps: 9000,
      totalCaloriesKcal: 900,
      avgSleepMin: (400 + 450) / 2,
      avgRestingHr: 58,
      avgSpo2Percent: 98.5,
      avgStressScore: 25,
    });

    const emptyAgg = await store.queryHealthAggregates('2099-01-01', '2099-01-02');
    assert.deepEqual(emptyAgg, {
      daysCount: 0,
      totalSteps: 0,
      avgSteps: 0,
      totalCaloriesKcal: 0,
      avgSleepMin: 0,
      avgRestingHr: 0,
      avgSpo2Percent: 0,
      avgStressScore: 0,
    });

    // Verify SQL indexes exist and EXPLAIN QUERY PLAN utilizes idx_gps_waypoints_route
    const healthIndexes = await driver.all<{ name: string }>(
      "PRAGMA index_list('daily_health_records');",
    );
    assert.ok(
      healthIndexes.some((idx) => idx.name === 'idx_daily_health_date'),
      'Expected idx_daily_health_date index',
    );
    const waypointIndexes = await driver.all<{ name: string }>(
      "PRAGMA index_list('gps_waypoints');",
    );
    assert.ok(
      waypointIndexes.some((idx) => idx.name === 'idx_gps_waypoints_route'),
      'Expected idx_gps_waypoints_route index',
    );

    const queryPlan = await driver.all<{ detail: string }>(
      'EXPLAIN QUERY PLAN SELECT * FROM gps_waypoints WHERE route_id = ? ORDER BY seq_idx ASC;',
      ['route-fk-1'],
    );
    assert.ok(
      queryPlan.some((step) => step.detail.includes('idx_gps_waypoints_route')),
      `Expected query plan to use idx_gps_waypoints_route, got ${JSON.stringify(queryPlan)}`,
    );

    // Verify queryGpsRouteWithWaypoints + parameterized SQL injection immunity
    const fetchedRoute = await db.queryGpsRouteWithWaypoints('route-fk-1');
    assert.ok(fetchedRoute);
    assert.equal(fetchedRoute.waypoints.length, 3);
    assert.equal(fetchedRoute.waypoints[0]!.lat, 27.671);
    assert.equal(fetchedRoute.waypoints[2]!.heartRateBpm, 168);

    const sqliProbe = await db.queryGpsRouteWithWaypoints("' OR '1'='1");
    assert.equal(sqliProbe, null);

    // Verify FOREIGN KEY constraint enforcement & ON DELETE CASCADE
    await assert.rejects(async () => {
      await driver.run(
        `INSERT INTO gps_waypoints (route_id, seq_idx, lat, lng, timestamp, hr_bpm, is_paused)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ['nonexistent-route', 0, 27.7, 85.3, 1763176000000, 120, 0],
      );
    }, /FOREIGN KEY constraint failed/);

    await driver.run('DELETE FROM gps_workout_routes WHERE id = ?;', ['route-fk-1']);
    const remainingWaypoints = await driver.all<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM gps_waypoints WHERE route_id = ?;',
      ['route-fk-1'],
    );
    assert.equal(remainingWaypoints[0]?.cnt, 0);

    // Verify resetAll() clears both kv_store and relational tables
    await store.resetAll();
    const clearedCounts = await db.getTableRowCounts();
    for (const table of SQLITE_TABLE_NAMES) {
      assert.equal(clearedCounts[table], 0, `Expected ${table} to be cleared after resetAll`);
    }
  } finally {
    await driver.close?.();
  }
});

test('9.3 OfflineStore SQLite file-backed persistence across restarts, UltimaBleManager E2E, and Inspector/manifest audit', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-sqlite-test-'));
  const dbPath = path.join(tmpDir, 'ultima_open_test.db');
  let driver1: SqliteDriver | null = null;
  let driver2: SqliteDriver | null = null;
  let driver3: SqliteDriver | null = null;

  try {
    // Session 1: initialize OfflineStore({ sqliteDb }) without manual backend -> auto-wires KV + relational SQLite
    driver1 = createNodeSqliteDriver(dbPath);
    const db1 = new UltimaSqliteDatabase(driver1);
    const store1 = new OfflineStore({ sqliteDb: db1 });
    assert.deepEqual(store1.getStorageEngineInfo(), {
      backendType: STORAGE_BACKEND_TYPE.NODE_SQLITE,
      relationalTablesActive: true,
    });

    const manager1 = new UltimaBleManager(store1);
    await manager1.init();
    const scanned = await manager1.startScan();
    const earbuds = scanned.find((d) => d.kind === DEVICE_KIND.EARBUDS)!;
    const watch = scanned.find((d) => d.kind === DEVICE_KIND.WATCH)!;
    await manager1.connectDevice(earbuds.id);
    await manager1.connectDevice(watch.id);
    await manager1.syncWatchAll();
    await manager1.syncWatchGpsRoutes();
    await store1.saveCustomEqProfile({
      id: 'eq-persist-1',
      name: 'Studio Warm',
      gains: [2, 3, 1, 0, -1, 0, 1, 2, 1, 0],
    });
    manager1.destroy();

    const expectedCounts = await db1.getTableRowCounts();
    assert.ok((expectedCounts.kv_store ?? 0) >= 1);
    assert.equal(expectedCounts.paired_devices, 2);
    assert.equal(expectedCounts.custom_eq_profiles, 1);
    assert.ok((expectedCounts.daily_health_records ?? 0) >= 1);
    assert.equal(expectedCounts.gps_workout_routes, 2);
    assert.ok((expectedCounts.gps_waypoints ?? 0) >= 20);
    await driver1.close?.();
    driver1 = null;

    // Session 2: reopen same SQLite file on disk and verify KV + relational queries match
    driver2 = createNodeSqliteDriver(dbPath);
    const store2 = new OfflineStore({
      backend: new ExpoSqliteStorageBackend(driver2),
    });
    const loadedState = await store2.load();
    assert.equal(loadedState.pairedDevices.length, 2);
    assert.equal(loadedState.customEqProfiles[0]?.name, 'Studio Warm');
    assert.equal(loadedState.gpsRoutes.length, 2);

    const aggs2 = await store2.queryHealthAggregates();
    assert.ok(aggs2.daysCount >= 1);
    assert.ok(aggs2.totalSteps > 0);

    // Session 3: clear kv_store and verify OfflineStore.load() still hydrates from relational SQLite tables
    await driver2.run('DELETE FROM kv_store;');
    await driver2.close?.();
    driver2 = null;

    driver3 = createNodeSqliteDriver(dbPath);
    const store3 = new OfflineStore({
      backend: new ExpoSqliteStorageBackend(driver3),
    });
    const relationalHydrated = await store3.load();
    assert.equal(relationalHydrated.pairedDevices.length, 2);
    assert.equal(relationalHydrated.customEqProfiles.length, 1);
    assert.equal(relationalHydrated.gpsRoutes.length, 2);
    await driver3.close?.();
    driver3 = null;

    // Manifest & UI audit: package.json, app.json, InspectorBackupScreen.tsx, and zero-network check
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    assert.equal(pkgJson.dependencies?.['expo-sqlite'], '~15.0.6');

    const appJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'app.json'), 'utf8'),
    ) as { expo?: { plugins?: unknown[] } };
    assert.ok(
      appJson.expo?.plugins?.includes('expo-sqlite'),
      'app.json expo.plugins must include expo-sqlite',
    );

    const inspectorSrc = readCombinedText([
      'src/screens/InspectorBackupScreen.tsx',
      'src/domains/storage/ui',
    ]);
    assert.match(inspectorSrc, /getStorageEngineInfo/);
    assert.match(inspectorSrc, /getTableRowCounts/);
    assert.match(inspectorSrc, /queryHealthAggregates/);

    const forbiddenNetworkPattern =
      /https?:\/\/|wss?:\/\/|\bfetch\(|XMLHttpRequest|\bWebSocket\b|home\/index/;
    for (const rel of resolveSourceFiles([
      'src/storage',
      'src/domains/storage',
      'src/screens/InspectorBackupScreen.tsx',
    ])) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.equal(
        forbiddenNetworkPattern.test(src),
        false,
        `Network URL/API leak detected in ${rel}`,
      );
    }
  } finally {
    await driver1?.close?.();
    await driver2?.close?.();
    await driver3?.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
