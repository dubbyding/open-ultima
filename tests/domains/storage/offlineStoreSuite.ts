import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ANC_MODE } from '../../../src/protocols/ultimaLinkConstants.ts';
import {
  ANC_MODE as STORE_ANC_MODE,
  BACKUP_ARCHIVE_SCHEMA,
  DEVICE_KIND,
  EARBUD_CHIP,
  EARBUD_GESTURE,
  EARBUD_KEY_FUNCTION,
  EQ_BAND_COUNT,
  HEALTH_CSV_HEADERS,
  IMPORT_MODE,
  MAX_WATCH_ALARMS,
  MemoryStorageBackend,
  OFFLINE_STATE_VERSION,
  OfflineStore,
  VOICE_LANGUAGE as STORE_VOICE_LANGUAGE,
} from '../../../src/storage/offlineStore.ts';
import { REPO_ROOT, resolveSourceFiles } from '../testUtils.ts';

// ---------------------------------------------------------------------------
// 6. Offline Store
// ---------------------------------------------------------------------------

test('6.1 OfflineStore persistence across instances sharing MemoryStorageBackend, EQ CRUD, and Find-My pin', async () => {
  const backend = new MemoryStorageBackend();
  const storeA = new OfflineStore({ backend });
  await storeA.load();

  await storeA.upsertPairedDevice({
    id: 'earbuds-xh68',
    name: 'XH-68B ANC',
    kind: DEVICE_KIND.EARBUDS,
    chip: EARBUD_CHIP.BT,
    pid: 0x000a,
    mac: 'AA:BB:CC:DD:EE:FF',
    lastConnectedAt: 1_700_000_000_000,
  });
  await storeA.setLastKnownLocation('earbuds-xh68', {
    lat: 27.7172,
    lng: 85.324,
    note: 'Desk drawer',
    savedAt: 1_700_000_000_500,
  });

  // Upserting device again without lastKnownLocation must preserve existing pin
  await storeA.upsertPairedDevice({
    id: 'earbuds-xh68',
    name: 'XH-68B ANC Renamed',
    kind: DEVICE_KIND.EARBUDS,
    lastConnectedAt: 1_700_000_001_000,
  });
  const pinnedDevice = storeA
    .getState()
    .pairedDevices.find((d) => d.id === 'earbuds-xh68');
  assert.equal(pinnedDevice?.name, 'XH-68B ANC Renamed');
  assert.equal(pinnedDevice?.chip, EARBUD_CHIP.BT);
  assert.deepEqual(pinnedDevice?.lastKnownLocation, {
    lat: 27.7172,
    lng: 85.324,
    note: 'Desk drawer',
    savedAt: 1_700_000_000_500,
  });

  await storeA.updateEarbudPrefs('earbuds-xh68', {
    ancMode: STORE_ANC_MODE.ANC,
    gameMode: true,
    voiceLanguage: STORE_VOICE_LANGUAGE.EN,
    keyMappings: {
      left: { [EARBUD_GESTURE.DOUBLE]: EARBUD_KEY_FUNCTION.ANC_MODE },
    },
  });

  // Custom EQ CRUD
  await storeA.saveCustomEqProfile({
    id: 'eq-punchy',
    name: 'Punchy Bass',
    gains: [6, 5, 3, 0, -1, 0, 2, 4, 3, 2],
    createdAt: 1000,
  });
  await storeA.saveCustomEqProfile({
    id: 'eq-vocal',
    name: 'Vocal Clear',
    gains: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
    createdAt: 2000,
  });
  await storeA.saveCustomEqProfile({
    id: 'eq-punchy',
    name: 'Punchy Bass v2',
    gains: [7, 5, 3, 0, -1, 0, 2, 4, 3, 2],
  });
  assert.equal(
    storeA.getState().customEqProfiles.find((p) => p.id === 'eq-punchy')?.createdAt,
    1000,
  );
  await storeA.deleteCustomEqProfile('eq-vocal');
  assert.equal(storeA.getState().customEqProfiles.length, 1);
  await assert.rejects(() =>
    storeA.saveCustomEqProfile({
      id: 'bad-eq',
      name: 'Invalid',
      gains: [1, 2, 3],
    }),
  );

  // Separate OfflineStore instance loading from same backend sees identical state
  const storeB = new OfflineStore({ backend });
  const loaded = await storeB.load();
  assert.deepEqual(loaded, storeA.getState());
  assert.equal(loaded.customEqProfiles[0]!.name, 'Punchy Bass v2');
  assert.equal(loaded.earbudPrefs['earbuds-xh68']!.ancMode, STORE_ANC_MODE.ANC);

  // Clearing location pin works and invalid coords reject
  await assert.rejects(() =>
    storeB.setLastKnownLocation('earbuds-xh68', { lat: 99, lng: 0 }),
  );
  await storeB.setLastKnownLocation('earbuds-xh68', null);
  assert.equal(storeB.getState().pairedDevices[0]!.lastKnownLocation, undefined);
});

test('6.2 OfflineStore health merge + chronological sort, 8-alarm validation, JSON backup & RFC-4180 CSV', async () => {
  const backend = new MemoryStorageBackend();
  const store = new OfflineStore({ backend });
  await store.load();

  // Out-of-order health records sort chronologically and merge partially
  await store.upsertHealthDay({ date: '2026-11-14', steps: 9500, restingHr: 62 });
  await store.upsertHealthDay({ date: '2026-11-10', steps: 4200, deepSleepMin: 90 });
  await store.upsertHealthDay({
    date: '2026-11-12',
    steps: 7100,
    distanceMeters: 5200,
    caloriesKcal: 310,
    hrSamples: [64, 72, 85],
    stepBuckets48: new Array(48).fill(100),
  });
  await store.upsertHealthDay({ date: '2026-11-12', spo2Percent: 98, stressScore: 28 });

  const history = store.getState().healthHistory;
  assert.deepEqual(
    history.map((d) => d.date),
    ['2026-11-10', '2026-11-12', '2026-11-14'],
  );
  assert.equal(history[1]!.steps, 7100);
  assert.equal(history[1]!.spo2Percent, 98);
  assert.equal(history[1]!.stressScore, 28);
  assert.equal(history[1]!.stepBuckets48?.length, 48);

  // 8-alarm limit validation
  const makeAlarm = (id: number) => ({
    id,
    enabled: true,
    hour: 7,
    minute: id * 5,
    repeatMask: 0x7f,
    year: 2026,
    month: 11,
    day: 14,
    label: `Alarm ${id}`,
  });
  await store.setWatchAlarms(Array.from({ length: MAX_WATCH_ALARMS }, (_, i) => makeAlarm(i)));
  assert.equal(store.getState().watchAlarms.length, 8);
  await assert.rejects(() =>
    store.setWatchAlarms(Array.from({ length: 9 }, (_, i) => makeAlarm(i))),
  );
  await assert.rejects(() => store.setWatchAlarms([makeAlarm(8)]));
  await assert.rejects(() => store.setWatchAlarms([makeAlarm(0), makeAlarm(0)]));

  // JSON export
  const exportedJson = store.exportJson({ exportedAt: '2026-11-14T12:00:00.000Z' });
  const parsedArchive = JSON.parse(exportedJson);
  assert.equal(parsedArchive.schema, BACKUP_ARCHIVE_SCHEMA);
  assert.equal(parsedArchive.schemaVersion, OFFLINE_STATE_VERSION);
  assert.equal(parsedArchive.version, OFFLINE_STATE_VERSION);
  assert.equal(parsedArchive.exportedAt, '2026-11-14T12:00:00.000Z');

  // RFC-4180 CSV export
  const csv = store.exportHealthCsv();
  const lines = csv.split('\r\n');
  assert.equal(lines[0], HEALTH_CSV_HEADERS.join(','));
  assert.equal(lines.length, 4);
  assert.ok(lines[1]!.startsWith('2026-11-10,4200,'));
  assert.ok(lines[2]!.startsWith('2026-11-12,7100,5200,310,'));
  assert.ok(lines[3]!.startsWith('2026-11-14,9500,'));
  assert.equal(store.exportHealthCsv({ lineEnding: '\n' }).split('\n').length, 4);

  // Import merge vs replace + invalid JSON safe rejection
  const store2 = new OfflineStore();
  await store2.upsertPairedDevice({
    id: 'local-earbuds',
    name: 'Local Buds',
    kind: DEVICE_KIND.EARBUDS,
    lastConnectedAt: 100,
  });
  await store2.setLastKnownLocation('local-earbuds', {
    lat: 10,
    lng: 20,
    note: 'Car',
    savedAt: 101,
  });
  await store2.upsertHealthDay({ date: '2026-11-01', steps: 3000 });

  // Merge preserves local-earbuds + 2026-11-01 while adding archived data
  const mergeRes = await store2.tryImportJson(exportedJson, { mode: IMPORT_MODE.MERGE });
  assert.equal(mergeRes.ok, true);
  assert.equal(mergeRes.state.healthHistory.length, 4);
  assert.equal(mergeRes.state.pairedDevices[0]!.id, 'local-earbuds');

  // Invalid JSON never throws and leaves state untouched
  const beforeInvalid = store2.getState();
  const badSyntax = await store2.tryImportJson('{not valid json');
  assert.equal(badSyntax.ok, false);
  assert.ok(badSyntax.errors.length > 0);
  assert.deepEqual(store2.getState(), beforeInvalid);

  const badVersion = await store2.tryImportJson(
    JSON.stringify({ ...parsedArchive, schemaVersion: 99 }),
  );
  assert.equal(badVersion.ok, false);

  const badImportReturn = await store2.importJson('{"version": 1, "bad": true}');
  assert.deepEqual(badImportReturn, beforeInvalid);

  // Replace wipes local-only entries and restores exact archive state
  const replaceRes = await store2.tryImportJson(exportedJson, { mode: IMPORT_MODE.REPLACE });
  assert.equal(replaceRes.ok, true);
  assert.equal(replaceRes.state.healthHistory.length, 3);
  assert.equal(replaceRes.state.pairedDevices.length, 0);
  assert.equal(EQ_BAND_COUNT, 10);
});

test('6.3 Zero network strings and zero runtime network calls across protocols & offlineStore', async () => {
  const sourceFiles = resolveSourceFiles([
    'src/protocols',
    'src/storage',
    'src/services',
    'src/domains',
  ]);
  const forbiddenNetworkPattern = /https?:\/\/|wss?:\/\/|\bfetch\(|XMLHttpRequest|\bWebSocket\b|home\/index/;

  // Opt-in online features (off until the user signs in) live alone in these files.
  const OPT_IN_ONLINE = new Set(['src/domains/healthSync/strava.ts', 'src/domains/sheets/googleSheets.ts']);
  for (const relPath of sourceFiles) {
    if (OPT_IN_ONLINE.has(relPath.replace(/\\/g, '/'))) continue;
    const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    assert.equal(
      forbiddenNetworkPattern.test(content),
      false,
      `Unexpected network string detected in ${relPath}`,
    );
  }

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  (globalThis as { fetch?: unknown }).fetch = () => {
    fetchCount += 1;
    throw new Error('OfflineStore must never make network calls');
  };

  try {
    const store = new OfflineStore();
    await store.load();
    await store.upsertHealthDay({ date: '2026-11-14', steps: 100 });
    const exported = store.exportJson();
    await store.importJson(exported);
    store.exportHealthCsv();
    assert.equal(fetchCount, 0);
  } finally {
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: unknown }).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  }
});

// ---------------------------------------------------------------------------
// 8.3 OfflineStore GPS Route CRUD & GPX Export
// ---------------------------------------------------------------------------

test('8.3 OfflineStore GPS route CRUD, backup backward compatibility, and GPX 1.1 XML export', async () => {
  const backend = new MemoryStorageBackend();
  const storeA = new OfflineStore({ backend });
  await storeA.load();

  await storeA.saveGpsRoute({
    id: 'route-patan-1',
    deviceId: 'watch-ultima-1',
    name: 'Patan <Heritage> & Run',
    activityType: 'outdoor_run',
    startedAt: '2026-11-15T01:30:00.000Z',
    endedAt: '2026-11-15T01:45:00.000Z',
    distanceMeters: 2150,
    durationSec: 900,
    caloriesKcal: 165,
    avgHeartRateBpm: 148,
    maxHeartRateBpm: 166,
    elevationGainMeters: 24.5,
    waypoints: [
      {
        lat: 27.67312,
        lng: 85.32491,
        timestamp: '2026-11-15T01:30:00.000Z',
        elevationMeters: 1335.2,
        heartRateBpm: 132,
      },
      {
        lat: 27.67542,
        lng: 85.32631,
        timestamp: '2026-11-15T01:38:00.000Z',
        elevationMeters: 1349.8,
        heartRateBpm: 158,
      },
    ],
  });

  // Reload in a separate OfflineStore instance sharing the same backend
  const storeB = new OfflineStore({ backend });
  await storeB.load();
  const loadedRoutes = storeB.getGpsRoutes();
  assert.equal(loadedRoutes.length, 1);
  assert.equal(loadedRoutes[0]!.distanceMeters, 2150);

  const gpx = storeB.exportGpx('route-patan-1');
  assert.ok(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(gpx, /<gpx version="1\.1"/);
  assert.match(gpx, /<name>Patan &lt;Heritage&gt; &amp; Run<\/name>/);
  assert.match(gpx, /<trkpt lat="27\.673120" lon="85\.324910">/);
  assert.match(gpx, /<ele>1335\.2<\/ele>/);
  assert.match(gpx, /<gpxtpx:hr>132<\/gpxtpx:hr>/);
  assert.match(gpx, /<\/gpx>$/);

  // Legacy v1 JSON backup without gpsRoutes must still import cleanly
  const backupJson = JSON.parse(storeB.exportJson());
  delete backupJson.state.gpsRoutes;
  const storeC = new OfflineStore();
  await storeC.load();
  const imported = await storeC.importJson(JSON.stringify(backupJson), {
    mode: 'replace',
  });
  assert.deepEqual(imported.gpsRoutes, []);

  await storeB.deleteGpsRoute('route-patan-1');
  assert.equal(storeB.getGpsRoutes().length, 0);
});
