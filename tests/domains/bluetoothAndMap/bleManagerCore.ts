import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANC_MODE,
  DEVICE_CHIP,
  EQ_PRESETS,
  KEY_FUNCTION,
  getFactoryPresetsForProduct,
} from '../../../src/protocols/ultimaLinkConstants.ts';
import { CRP_MCU_PLATFORM } from '../../../src/protocols/ultimaFitCrrepa.ts';
import {
  DEVICE_KIND,
  MemoryStorageBackend,
  OfflineStore,
} from '../../../src/storage/offlineStore.ts';
import {
  CONNECTION_MODE,
  PACKET_DIRECTION,
  PACKET_PROTOCOL,
  UltimaBleManager,
} from '../../../src/services/bleManager.ts';

// ---------------------------------------------------------------------------
// 7. UltimaBleManager Simulator Integration Tests
// ---------------------------------------------------------------------------

test('7.1 UltimaBleManager startScan() discovers both Earbuds and Watch with decoded ADV fields & logs RX ADV packets', async () => {
  const backend = new MemoryStorageBackend();
  const store = new OfflineStore({ backend });
  const manager = new UltimaBleManager(store);

  const snapshots: number[] = [];
  const unsubscribe = manager.subscribe((snap) => {
    snapshots.push(snap.discovered.length);
  });

  await manager.init();
  assert.equal(manager.getSnapshot().initialized, true);
  assert.equal(manager.getSnapshot().mode, CONNECTION_MODE.SIMULATOR);

  const discovered = await manager.startScan();
  assert.ok(discovered.length >= 4);
  assert.equal(manager.getSnapshot().scanning, false);
  assert.ok(snapshots.length >= 2);

  // Verify Bluetrum Earbuds ADV decoding (XH68B PID 0x000A)
  const btEarbuds = discovered.find((d) => d.id === 'sim-earbuds-xh68b');
  assert.ok(btEarbuds, 'Expected Bluetrum earbuds sim-earbuds-xh68b in scan results');
  assert.equal(btEarbuds.kind, DEVICE_KIND.EARBUDS);
  assert.equal(btEarbuds.chip, DEVICE_CHIP.BT);
  assert.equal(btEarbuds.pid, 0x000a);
  assert.equal(btEarbuds.bid, 0x5953);
  assert.equal(btEarbuds.edrMac, 'AA:BB:CC:11:22:0A');
  assert.equal(btEarbuds.license, 'ultimaxh68banc0a');
  assert.equal(btEarbuds.offlineVerified, true);
  assert.equal(btEarbuds.isSimulated, true);
  assert.ok(btEarbuds.rawAdvHex.length > 0);

  // Verify Jieli Earbuds ADV decoding (Prime 1.0 PID 0x0001)
  const jlEarbuds = discovered.find((d) => d.id === 'sim-earbuds-prime1');
  assert.ok(jlEarbuds, 'Expected Jieli earbuds sim-earbuds-prime1 in scan results');
  assert.equal(jlEarbuds.kind, DEVICE_KIND.EARBUDS);
  assert.equal(jlEarbuds.chip, DEVICE_CHIP.JL);
  assert.equal(jlEarbuds.pid, 0x0001);
  assert.equal(jlEarbuds.edrMac, 'AA:BB:CC:11:22:01');
  assert.equal(jlEarbuds.offlineVerified, true);

  // Verify CRREPA Watch ADV decoding (ULTIMA Watch Magic)
  const watch = discovered.find((d) => d.id === 'sim-watch-magic');
  assert.ok(watch, 'Expected CRREPA watch sim-watch-magic in scan results');
  assert.equal(watch.kind, DEVICE_KIND.WATCH);
  assert.equal(watch.name, 'ULTIMA Watch Magic');
  assert.equal(watch.crpFirmware, 'MOY');
  assert.equal(watch.crpPlatform, CRP_MCU_PLATFORM.REALTEK);
  assert.equal(watch.crpChipId, 0x31);
  assert.equal(watch.crpFunctionMask, 0x07ff);
  assert.equal(watch.offlineVerified, true);
  assert.ok(watch.rawAdvHex.length > 0);

  // Verify RX ADV packet logs were recorded for discovered devices
  const advLogs = manager
    .getSnapshot()
    .packetLogs.filter((p) => p.protocol === PACKET_PROTOCOL.ADV);
  assert.equal(advLogs.length, discovered.length);
  for (const entry of advLogs) {
    assert.equal(entry.direction, PACKET_DIRECTION.RX);
    assert.ok(entry.hex.length > 0);
    assert.ok(entry.length > 0);
    assert.equal(entry.length, entry.byteLength);
  }

  unsubscribe();
  manager.destroy();
});

test('7.2 UltimaBleManager simultaneous dual connection (Earbuds + Watch) and Bluetrum Earbuds full control pipeline', async () => {
  const backend = new MemoryStorageBackend();
  const store = new OfflineStore({ backend });
  const manager = new UltimaBleManager(store);
  await manager.init();
  await manager.startScan();

  // Connect Bluetrum Earbuds (XH68B) and CRREPA Watch (ULTIMA Watch Magic) simultaneously
  await manager.connectDevice('sim-earbuds-xh68b');
  await manager.connectDevice('sim-watch-magic');

  let snap = manager.getSnapshot();
  assert.equal(snap.earbuds.connected && snap.watch.connected, true);
  assert.equal(snap.earbuds.deviceId, 'sim-earbuds-xh68b');
  assert.equal(snap.earbuds.chip, DEVICE_CHIP.BT);
  assert.equal(snap.earbuds.productId, 0x000a);
  assert.ok(snap.earbuds.leftBattery > 0);
  assert.ok(snap.earbuds.rightBattery > 0);
  assert.ok(snap.earbuds.caseBattery > 0);
  assert.equal(snap.earbuds.caseCharging, true);
  assert.equal(snap.watch.deviceId, 'sim-watch-magic');
  assert.ok(snap.watch.batteryPercent > 0);

  // Earbuds ANC Mode + ANC/Transparency Gain
  await manager.setEarbudsAncMode('transparency');
  assert.equal(manager.getSnapshot().earbuds.ancMode, 'transparency');
  await manager.setEarbudsAncMode('anc');
  assert.equal(manager.getSnapshot().earbuds.ancMode, 'anc');
  await manager.setEarbudsAncGain(9);
  assert.equal(manager.getSnapshot().earbuds.ancGain, 9);
  await manager.setEarbudsTransparencyGain(7);
  assert.equal(manager.getSnapshot().earbuds.transparencyGain, 7);

  // Earbuds 10-band EQ
  const customCurve = [4, 3, 2, 0, -2, -2, 0, 2, 4, 5];
  await manager.setEarbudsEq(customCurve, 'Bass Punch', 0x20);
  snap = manager.getSnapshot();
  assert.deepEqual(snap.earbuds.eqGains, customCurve);
  assert.equal(snap.earbuds.eqPresetName, 'Bass Punch');

  // Earbuds Game Mode, Spatial Audio, LDAC, In-Ear, Dual Connect, LED, Voice Language
  await manager.setEarbudsGameMode(true);
  assert.equal(manager.getSnapshot().earbuds.gameMode, true);
  await manager.setEarbudsSpatialAudio(true);
  assert.equal(manager.getSnapshot().earbuds.spatialAudio, true);
  await manager.setEarbudsLdac(true);
  assert.equal(manager.getSnapshot().earbuds.ldacEnabled, true);
  await manager.setEarbudsInEarDetect(true);
  assert.equal(manager.getSnapshot().earbuds.inEarDetect, true);
  await manager.setEarbudsDualConnect(true);
  assert.equal(manager.getSnapshot().earbuds.dualConnect, true);
  await manager.setEarbudsLed(false);
  assert.equal(manager.getSnapshot().earbuds.ledEnabled, false);
  await manager.setEarbudsLanguage('zh');
  assert.equal(manager.getSnapshot().earbuds.voiceLanguage, 'zh');

  // Earbuds L/R Key Mapping & Case Key Mapping
  await manager.setEarbudsKeyMapping('left', 'double', KEY_FUNCTION.ASSISTANT);
  await manager.setEarbudsKeyMapping('right', 'triple', KEY_FUNCTION.GAME_MODE);
  await manager.setEarbudsCaseKeyMapping('rotation', KEY_FUNCTION.VOLUME_UP);
  snap = manager.getSnapshot();
  assert.equal(snap.earbuds.keyMappings.left.double, KEY_FUNCTION.ASSISTANT);
  assert.equal(snap.earbuds.keyMappings.right.triple, KEY_FUNCTION.GAME_MODE);
  assert.equal(Number(snap.earbuds.keyMappings.caseKeys.rotation), KEY_FUNCTION.VOLUME_UP);

  // Rename, Find My Earbuds, and Offline Location Pin
  await manager.renameEarbuds('XH68B Studio');
  assert.equal(manager.getSnapshot().earbuds.deviceName, 'XH68B Studio');

  await manager.findEarbuds(true);
  assert.equal(manager.getSnapshot().earbuds.findingActive, true);
  await manager.findEarbuds(false);
  assert.equal(manager.getSnapshot().earbuds.findingActive, false);

  await manager.pinLastKnownEarbudsLocation('Backpack front pocket', 27.7172, 85.324);
  snap = manager.getSnapshot();
  assert.ok(snap.earbuds.lastKnownLocation);
  assert.equal(snap.earbuds.lastKnownLocation.note, 'Backpack front pocket');
  assert.equal(snap.earbuds.lastKnownLocation.lat, 27.7172);
  assert.equal(snap.earbuds.lastKnownLocation.lng, 85.324);

  // Watch must still be connected after all Earbuds operations
  assert.equal(snap.earbuds.connected && snap.watch.connected, true);

  // Factory reset earbuds restores default state while keeping connection & watch intact
  await manager.factoryResetEarbuds();
  snap = manager.getSnapshot();
  assert.equal(snap.earbuds.connected, true);
  assert.equal(snap.watch.connected, true);
  assert.equal(snap.earbuds.gameMode, false);
  assert.deepEqual(snap.earbuds.eqGains, [...EQ_PRESETS.FLAT]);

  manager.destroy();
});

test('7.3 UltimaBleManager Jieli RCSP Earbuds pipeline (Ultima Signature/Balance EQ 0xFF, Custom EQ CRC-16, ANC, Work Mode, Keys, SearchDev)', async () => {
  const backend = new MemoryStorageBackend();
  const store = new OfflineStore({ backend });
  const manager = new UltimaBleManager(store);
  await manager.init();
  await manager.startScan();

  // Connect Jieli Earbuds (Ultima Prime 1.0 PID 0x0001) + Watch (Ultima Chronos)
  await manager.connectDevice('sim-earbuds-prime1');
  await manager.connectDevice('sim-watch-chronos');

  let snap = manager.getSnapshot();
  assert.equal(snap.earbuds.connected && snap.watch.connected, true);
  assert.equal(snap.earbuds.chip, DEVICE_CHIP.JL);
  assert.equal(snap.earbuds.productId, 0x0001);
  assert.equal(snap.earbuds.leftBattery, 90);
  assert.equal(snap.earbuds.rightBattery, 91);
  assert.equal(snap.earbuds.caseBattery, 80);

  // Ultima Custom 0xFF Balance Sound & Signature Sound presets
  const primePresets = getFactoryPresetsForProduct(0x0001);
  await manager.setEarbudsEq([...primePresets.balanceSound], 'Balance Sound');
  snap = manager.getSnapshot();
  assert.equal(snap.earbuds.eqPresetName, 'Balance Sound');
  assert.deepEqual(snap.earbuds.eqGains, [...primePresets.balanceSound]);
  assert.ok(snap.earbuds.eqCrcHex && snap.earbuds.eqCrcHex.length === 4);

  await manager.setEarbudsEq([...primePresets.signatureSound], 'Signature Sound');
  snap = manager.getSnapshot();
  assert.equal(snap.earbuds.eqPresetName, 'Signature Sound');
  assert.deepEqual(snap.earbuds.eqGains, [...primePresets.signatureSound]);

  // Jieli RCSP SetSysInfo (0x08) Custom 10-band EQ with CRC-16 verification
  const customJlGains = [5, 4, 2, 0, -1, -1, 0, 2, 4, 6];
  await manager.setEarbudsEq(customJlGains, 'Jieli V-Shape', 6);
  snap = manager.getSnapshot();
  assert.equal(snap.earbuds.eqPresetName, 'Jieli V-Shape');
  assert.deepEqual(snap.earbuds.eqGains, customJlGains);
  assert.ok(snap.earbuds.eqCrcHex && /^[0-9a-fA-F]{4}$/.test(snap.earbuds.eqCrcHex));

  // Jieli ANC, Game Mode, Key Mapping, Rename, SearchDev (0x19)
  await manager.setEarbudsAncMode('transparency');
  assert.equal(manager.getSnapshot().earbuds.ancMode, 'transparency');

  await manager.setEarbudsGameMode(true);
  assert.equal(manager.getSnapshot().earbuds.gameMode, true);

  await manager.setEarbudsKeyMapping('left', 'longPress', KEY_FUNCTION.ANC_MODE);
  assert.equal(
    manager.getSnapshot().earbuds.keyMappings.left.longPress,
    KEY_FUNCTION.ANC_MODE,
  );

  await manager.renameEarbuds('Prime 1.0 Pro');
  assert.equal(manager.getSnapshot().earbuds.deviceName, 'Prime 1.0 Pro');

  await manager.findEarbuds(true);
  assert.equal(manager.getSnapshot().earbuds.findingActive, true);
  await manager.findEarbuds(false);
  assert.equal(manager.getSnapshot().earbuds.findingActive, false);

  manager.destroy();
});
