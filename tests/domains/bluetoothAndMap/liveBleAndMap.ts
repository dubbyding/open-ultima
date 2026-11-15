import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bytesToHex } from '../../../src/protocols/ultimaLinkAdvParser.ts';
import {
  CRP_CMD,
  CRREPA_UUIDS,
  buildCrpFrame,
  CRP_GPS_SUBCMD,
  decodeGpsPath,
  encodeGpsHistoryResponse,
  encodeGpsPathChunkFrame,
  parseCrpFrame,
} from '../../../src/protocols/ultimaFitCrrepa.ts';
import {
  compassBearingDegrees,
  computeGeoBounds,
  formatCompassCardinal,
  formatDistanceMeters,
  formatPaceMinPerKm,
  haversineDistanceMeters,
  projectLatLngToCanvas,
  totalPathDistanceMeters,
} from '../../../src/utils/geoMath.ts';
import {
  DEVICE_KIND,
  MemoryStorageBackend,
  OfflineStore,
} from '../../../src/storage/offlineStore.ts';
import {
  PACKET_PROTOCOL,
  UltimaBleManager,
} from '../../../src/services/bleManager.ts';
import type {
  BlePlxDeviceLike,
  BlePlxManagerLike,
} from '../../../src/services/bleManager.ts';
import { REPO_ROOT, readCombinedText, resolveSourceFiles } from '../testUtils.ts';
import { createTestManager } from '../../fixtures/fakeBlePlx.ts';

// ---------------------------------------------------------------------------
// 8.2, 8.4, 8.5 Geo Math, Live BLE GPS & Map Pin Parity
// ---------------------------------------------------------------------------

test('8.2 Haversine distance, compass bearing, pace & offline vector projection math', () => {
  const patan = { lat: 27.67312, lng: 85.32491 };
  const boudha = { lat: 27.7215, lng: 85.362 };

  assert.equal(haversineDistanceMeters(patan, patan), 0);
  const distKm = haversineDistanceMeters(patan, boudha) / 1000;
  assert.ok(distKm > 6.3 && distKm < 6.7, `Unexpected distance ${distKm} km`);

  // One degree of latitude is ~111.19 km everywhere
  const oneDegLat = haversineDistanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(oneDegLat - 111_195) < 150);

  assert.ok(Math.abs(compassBearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 0) < 0.01);
  assert.ok(Math.abs(compassBearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 90) < 0.01);
  assert.ok(Math.abs(compassBearingDegrees({ lat: 1, lng: 0 }, { lat: 0, lng: 0 }) - 180) < 0.01);
  assert.ok(Math.abs(compassBearingDegrees({ lat: 0, lng: 1 }, { lat: 0, lng: 0 }) - 270) < 0.01);
  assert.equal(formatCompassCardinal(42), 'NE');
  assert.equal(formatCompassCardinal(225), 'SW');
  assert.equal(formatDistanceMeters(48), '48 m');
  assert.equal(formatDistanceMeters(3420), '3.42 km');
  assert.equal(formatPaceMinPerKm(2000, 600), '5:00 /km');

  const totalDist = totalPathDistanceMeters([
    patan,
    { lat: 0, lng: 0 }, // pause ignored
    boudha,
  ]);
  assert.ok(Math.abs(totalDist - haversineDistanceMeters(patan, boudha)) < 0.01);

  const bounds = computeGeoBounds([patan, boudha]);
  const projected = projectLatLngToCanvas(patan, {
    centerLat: bounds.centerLat,
    centerLng: bounds.centerLng,
    latSpan: bounds.latSpan,
    lngSpan: bounds.lngSpan,
    width: 300,
    height: 220,
    padding: 20,
    zoom: 1,
  });
  assert.ok(projected.x >= 20 && projected.x <= 280);
  assert.ok(projected.y >= 20 && projected.y <= 200);
});

test('8.4 UltimaBleManager.syncWatchGpsRoutes() multi-chunk 0xB3 sync + Find-My L/R/Case & Watch pinning', async () => {
  const backend = new MemoryStorageBackend();
  const store = new OfflineStore({ backend });
  const manager = createTestManager(store);
  await manager.init();

  const discovered = await manager.startScan();
  const earbudsDev = discovered.find((d) => d.kind === DEVICE_KIND.EARBUDS)!;
  const watchDev = discovered.find((d) => d.kind === DEVICE_KIND.WATCH)!;

  await manager.connectDevice(earbudsDev.id);
  await manager.connectDevice(watchDev.id);

  await manager.pinLastKnownEarbudsLocation('Cafe Patio', 27.7172, 85.324);
  await manager.pinEarbudSideLocation('left', 'Dropped near sofa', 27.7175, 85.3243);
  await manager.syncWatchGpsRoutes();
  await manager.pinLastKnownWatchLocation('Watch Studio Desk', 27.67312, 85.32491);

  const snap = manager.getSnapshot();
  assert.equal(snap.watch.gpsSyncing, false);
  assert.equal(snap.watch.gpsRoutes.length, 2);
  assert.ok(snap.watch.gpsRoutes[0]!.waypoints.length >= 10);
  assert.ok(snap.watch.gpsRoutes[0]!.distanceMeters > 400);
  assert.equal(snap.storeState.gpsRoutes.length, 2);

  assert.ok(snap.earbuds.sideLocations.left);
  assert.ok(snap.earbuds.sideLocations.right);
  assert.ok(snap.earbuds.sideLocations.casePin);
  assert.equal(snap.earbuds.sideLocations.left!.lat, 27.7175);
  assert.equal(snap.watch.lastKnownLocation?.lat, 27.67312);

  // Confirm 0xB3 and 0x37 CRREPA TX/RX packets executed in simulator logs
  const crpCmds = snap.packetLogs
    .filter((p) => p.protocol === PACKET_PROTOCOL.CRREPA)
    .map((p) => p.cmd);
  assert.ok(crpCmds.includes(CRP_CMD.GPS_PATH));
  assert.ok(crpCmds.includes(CRP_CMD.HEART_RATE_24H_CHUNK));

  // Verify GPX 1.1 export from synced routes
  const gpxAll = store.exportGpx();
  assert.equal((gpxAll.match(/<trk>/g) ?? []).length, 2);
  assert.match(gpxAll, /<trkpt lat="/);

  // Persistence across fresh UltimaBleManager instance
  const manager2 = createTestManager(new OfflineStore({ backend }));
  await manager2.init();
  assert.equal(manager2.getSnapshot().watch.gpsRoutes.length, 2);
  assert.equal(manager2.getSnapshot().watch.lastKnownLocation?.note, 'Watch Studio Desk');

  // Verify zero network strings across all new/updated map modules & screens
  const forbiddenNetworkPattern = /https?:\/\/|wss?:\/\/|\bfetch\(|XMLHttpRequest|\bWebSocket\b|home\/index|baidu|amap/;
  for (const rel of resolveSourceFiles([
    'src/utils/geoMath.ts',
    'src/domains/map',
    'src/app',
  ])) {
    // Online map tiles are opt-in by design and isolated to this one component.
    if (rel.replace(/\\/g, '/') === 'src/app/components/OsmRouteMap.tsx') continue;
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.equal(
      forbiddenNetworkPattern.test(src),
      false,
      `Network/map URL leak detected in ${rel}`,
    );
  }

  manager.destroy();
  manager2.destroy();
});

test('8.5 Reviewer fixes: 0xB3 subcommand guard, LIVE_BLE async GPS followups & settlement, and map pin parity', async () => {
  // 1) Guarded 0xB3 subcommand: subcmds 0x03 / 0x04 with 6 + 8*N payload lengths must NOT decode as GPS paths
  const simStore = new OfflineStore();
  const simMgr = createTestManager(simStore);
  await simMgr.init();
  const scanned = await simMgr.startScan();
  const watch = scanned.find((d) => d.kind === DEVICE_KIND.WATCH)!;
  await simMgr.connectDevice(watch.id);

  // Build 15-byte 0xB3 payload (1 + 6 + 8 = 15) with subcmd 0x03 and 0x04
  const spurious03 = new Uint8Array(15);
  spurious03[0] = 0x03;
  new DataView(spurious03.buffer).setUint32(1, 1700000000, true);
  const spurious04 = new Uint8Array(15);
  spurious04[0] = CRP_GPS_SUBCMD.SEND_LOCAL_LOCATION;
  new DataView(spurious04.buffer).setUint32(1, 1700000100, true);

  await simMgr.sendRawHex('watch', bytesToHex(buildCrpFrame(CRP_CMD.GPS_PATH, spurious03), ' '));
  await simMgr.sendRawHex('watch', bytesToHex(buildCrpFrame(CRP_CMD.GPS_PATH, spurious04), ' '));
  assert.equal(simMgr.getSnapshot().watch.gpsRoutes.length, 0);
  assert.equal(simStore.getGpsRoutes().length, 0);
  simMgr.destroy();

  // 2) LIVE_BLE async GPS sync & followups via mock BlePlxManagerLike
  const fee1Listeners: Array<(err: Error | null, ch: { uuid: string; value: string | null } | null) => void> = [];
  const writtenCmds: Array<{ cmd: number; payload: Uint8Array }> = [];
  const tWorkout = new Date('2026-11-15T04:00:00.000Z');
  const routePts = [
    { lat: 27.67312, lng: 85.32491 },
    { lat: 27.67418, lng: 85.32564 },
    { lat: 27.67542, lng: 85.32631 },
    { lat: 27.67665, lng: 85.32672 },
  ];

  const emitLiveRx = (frame: Uint8Array): void => {
    const b64 = Buffer.from(frame).toString('base64');
    setTimeout(() => {
      for (const listener of fee1Listeners) {
        listener(null, { uuid: CRREPA_UUIDS.FEE1, value: b64 });
      }
    }, 4);
  };

  const handleTx = (base64Value: string): void => {
    const raw = new Uint8Array(Buffer.from(base64Value, 'base64'));
    const parsed = parseCrpFrame(raw);
    if (!parsed) return;
    writtenCmds.push({ cmd: parsed.cmd, payload: parsed.payload });
    if (parsed.cmd === CRP_CMD.HEART_RATE_24H_CHUNK && parsed.payload.length === 0) {
      const mov = new Uint8Array(24);
      const view = new DataView(mov.buffer);
      const chunkStart = decodeGpsPath(
        encodeGpsPathChunkFrame({ workoutTime: tWorkout, chunkIndex: 0, points: [routePts[0]!] }),
      )!.workoutTimeSeconds;
      view.setUint32(0, chunkStart, true);
      view.setUint32(4, chunkStart + 420, true);
      view.setUint16(8, 420, true);
      mov[11] = 1;
      view.setUint32(12, 850, true);
      view.setUint32(16, 480, true);
      view.setUint16(20, 42, true);
      emitLiveRx(buildCrpFrame(CRP_CMD.HEART_RATE_24H_CHUNK, mov));
      return;
    }
    if (parsed.cmd === CRP_CMD.GPS_PATH) {
      const sub = parsed.payload[0] ?? 0;
      if (sub === CRP_GPS_SUBCMD.QUERY_HISTORY) {
        emitLiveRx(encodeGpsHistoryResponse([tWorkout]));
      } else if (sub === CRP_GPS_SUBCMD.QUERY_PATH) {
        const chunkIdx = parsed.payload.length >= 7 ? parsed.payload[5]! | (parsed.payload[6]! << 8) : 0;
        if (chunkIdx === 0) {
          emitLiveRx(
            encodeGpsPathChunkFrame({
              workoutTime: tWorkout,
              chunkIndex: 0,
              points: routePts.slice(0, 2),
              isEndOfPath: false,
            }),
          );
        } else {
          emitLiveRx(
            encodeGpsPathChunkFrame({
              workoutTime: tWorkout,
              chunkIndex: 1,
              points: routePts.slice(2),
              isEndOfPath: true,
            }),
          );
        }
      } else if (sub === CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION) {
        const chunkPayload = parseCrpFrame(
          encodeGpsPathChunkFrame({ workoutTime: tWorkout, chunkIndex: 0, points: [routePts[0]!] }),
        )!.payload;
        emitLiveRx(
          buildCrpFrame(
            CRP_CMD.GPS_PATH,
            Uint8Array.of(CRP_GPS_SUBCMD.QUERY_LIVE_LOCATION, ...chunkPayload.subarray(7, 15)),
          ),
        );
      } else if (sub === CRP_GPS_SUBCMD.SEND_LOCAL_LOCATION) {
        emitLiveRx(buildCrpFrame(CRP_CMD.GPS_PATH, Uint8Array.of(sub, 0x00)));
      }
      return;
    }
    emitLiveRx(buildCrpFrame(parsed.cmd, Uint8Array.of(0x00)));
  };

  const mockDevice: BlePlxDeviceLike = {
    id: 'live-watch-01',
    name: 'ULTIMA APEX Live',
    localName: 'ULTIMA APEX Live',
    rssi: -58,
    manufacturerData: null,
    serviceData: null,
    serviceUUIDs: [CRREPA_UUIDS.SERVICE],
    async connect() {
      return mockDevice;
    },
    async discoverAllServicesAndCharacteristics() {
      return mockDevice;
    },
    async requestMTU() {
      return mockDevice;
    },
    async writeCharacteristicWithResponseForService(_svc, _char, val) {
      handleTx(val);
    },
    async writeCharacteristicWithoutResponseForService(_svc, _char, val) {
      handleTx(val);
    },
    monitorCharacteristicForService(_svc, charUuid, listener) {
      if (charUuid === CRREPA_UUIDS.FEE1) {
        fee1Listeners.push(listener);
      }
      return { remove: () => undefined };
    },
    async cancelConnection() {
      return mockDevice;
    },
    onDisconnected() {
      return { remove: () => undefined };
    },
  };

  const mockBleManager: BlePlxManagerLike = {
    startDeviceScan(_uuids, _opts, listener) {
      setTimeout(() => listener(null, mockDevice), 1);
    },
    stopDeviceScan() {},
    async connectToDevice() {
      return mockDevice;
    },
    destroy() {},
  };

  const liveStore = new OfflineStore();
  const liveManager = new UltimaBleManager(liveStore, {
    liveBleManager: mockBleManager,
    liveGpsSyncTimeoutMs: 2500,
  });
  await liveManager.init();

  const scanPromise = liveManager.startScan();
  await new Promise((r) => setTimeout(r, 10));
  liveManager.stopScan();
  const liveScanned = await scanPromise;
  assert.equal(liveScanned.length, 1);

  await liveManager.connectDevice('live-watch-01');
  await liveManager.syncWatchGpsRoutes();

  // Verify async follow-up chunk queries (#0 and #1) both fired and both chunks assembled
  const gpsPathQueries = writtenCmds.filter(
    (w) => w.cmd === CRP_CMD.GPS_PATH && w.payload[0] === CRP_GPS_SUBCMD.QUERY_PATH,
  );
  assert.ok(
    gpsPathQueries.some((q) => (q.payload[5]! | (q.payload[6]! << 8)) === 0),
    'Expected LIVE_BLE chunk 0 query followup',
  );
  assert.ok(
    gpsPathQueries.some((q) => (q.payload[5]! | (q.payload[6]! << 8)) === 1),
    'Expected LIVE_BLE chunk 1 query followup',
  );

  const liveSnap = liveManager.getSnapshot();
  assert.equal(liveSnap.watch.gpsSyncing, false);
  assert.equal(liveSnap.watch.gpsRoutes.length, 1);
  assert.equal(liveSnap.watch.gpsRoutes[0]!.waypoints.length, 4);
  assert.equal(liveStore.getGpsRoutes().length, 1);
  assert.match(liveStore.exportGpx(liveSnap.watch.gpsRoutes[0]!.id), /<trkpt lat="27\.67665/);

  liveManager.destroy();

});
