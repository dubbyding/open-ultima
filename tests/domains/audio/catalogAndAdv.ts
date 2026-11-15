import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADV_COMPANY_IDS,
  ALL_ADV_COMPANY_IDS,
  BLUETRUM_ADV_COMPANY_IDS,
  DEVICE_CHIP,
  EQ_FREQUENCIES,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_PRESETS,
  HEADSET_TYPE,
  PRODUCT_CATALOG,
  getFactoryPresetsForProduct,
  getProductById,
} from '../../../src/protocols/ultimaLinkConstants.ts';
import {
  bytesToHex,
  encodeUltimaLinkAdv,
  hexToBytes,
  parseUltimaLinkAdv,
} from '../../../src/protocols/ultimaLinkAdvParser.ts';
import { concatUint8Arrays } from '../testUtils.ts';

// ---------------------------------------------------------------------------
// 1. Ultima Link Catalog & Constants
// ---------------------------------------------------------------------------

test('1.1 Ultima Link catalog covers all 14 SKUs (0x0001..0x000F minus 0x0007)', () => {
  assert.equal(PRODUCT_CATALOG.length, 14);
  const expectedPids = [
    0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0008,
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x000e, 0x000f,
  ];
  assert.deepEqual(
    PRODUCT_CATALOG.map((p) => p.id),
    expectedPids,
  );
  assert.equal(getProductById(0x0007), undefined);
  assert.equal(getProductById(0x0000), undefined);

  for (const pid of expectedPids) {
    const product = getProductById(pid);
    assert.ok(product, `Expected product for PID 0x${pid.toString(16)}`);
    assert.equal(product.id, pid);
  }

  assert.deepEqual(ADV_COMPANY_IDS, [0xd222, 0xfe22]);
  assert.deepEqual(BLUETRUM_ADV_COMPANY_IDS, [0x0642, 0x0301, 0x4301]);
  assert.deepEqual(ALL_ADV_COMPANY_IDS, [0xd222, 0xfe22, 0x0642, 0x0301, 0x4301]);
});

test('1.2 Ultima Link chip assignments (BT vs JL) and per-SKU capability flags', () => {
  const btPids = PRODUCT_CATALOG.filter((p) => p.chip === DEVICE_CHIP.BT).map((p) => p.id);
  const jlPids = PRODUCT_CATALOG.filter((p) => p.chip === DEVICE_CHIP.JL).map((p) => p.id);

  assert.deepEqual(btPids, [0x0005, 0x000a, 0x000d, 0x000e]);
  assert.deepEqual(jlPids, [
    0x0001, 0x0002, 0x0003, 0x0004, 0x0006, 0x0008, 0x0009, 0x000b, 0x000c, 0x000f,
  ]);

  const xh68 = getProductById(0x000a)!;
  assert.equal(xh68.code, 'XH68');
  assert.equal(xh68.name, 'XH-68B ANC');
  assert.equal(xh68.chip, DEVICE_CHIP.BT);
  assert.equal(xh68.headsetType, HEADSET_TYPE.TWS);
  assert.equal(xh68.supportsAnc, true);
  assert.equal(xh68.supportsGameMode, true);
  assert.equal(xh68.supportsCaseKeys, true);
  assert.equal(xh68.supportsDualConnect, true);
  assert.equal(xh68.supportsLdac, true);
  assert.equal(xh68.supportsSpatialAudio, true);
  assert.equal(xh68.supportsSignatureBalanceEq, false);
  assert.equal(xh68.supportsOta, false);

  const boom311 = getProductById(0x0003)!;
  assert.equal(boom311.code, 'BOOM_311');
  assert.equal(boom311.name, 'BOOM_311');
  assert.equal(boom311.chip, DEVICE_CHIP.JL);
  assert.equal(boom311.supportsAnc, false);
  assert.equal(boom311.supportsGameMode, true);
  assert.equal(boom311.supportsSignatureBalanceEq, true);
  assert.equal(boom311.supportsOta, true);

  const prime1 = getProductById(0x0001)!;
  assert.equal(prime1.code, 'TW_538');
  assert.equal(prime1.name, 'Ultima Prime1');
  assert.equal(prime1.chip, DEVICE_CHIP.JL);
  assert.equal(prime1.supportsAnc, true);
  assert.equal(prime1.supportsSignatureBalanceEq, true);

  const hnc69 = getProductById(0x000c)!;
  assert.equal(hnc69.headsetType, HEADSET_TYPE.HEAD_MOUNTED);
  assert.equal(hnc69.supportsGameMode, true);

  const melody = getProductById(0x000f)!;
  assert.equal(melody.code, 'GL06');
  assert.equal(melody.name, 'Melody');
  assert.equal(melody.chip, DEVICE_CHIP.JL);
  assert.equal(melody.headsetType, HEADSET_TYPE.SPEAKER);
  assert.equal(melody.supportsAnc, false);
  assert.equal(melody.supportsGameMode, false);
  assert.equal(melody.supportsCaseKeys, false);
  assert.equal(melody.supportsDualConnect, false);
  assert.equal(melody.supportsLdac, false);
  assert.equal(melody.supportsSpatialAudio, false);
  assert.equal(melody.supportsSignatureBalanceEq, false);
  assert.equal(melody.supportsOta, false);
});

test('1.3 Ultima Link exact 10-band EQ frequencies, bounds, and factory curves', () => {
  assert.deepEqual(EQ_FREQUENCIES, [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  assert.equal(EQ_GAIN_MIN, -10);
  assert.equal(EQ_GAIN_MAX, 10);

  assert.deepEqual(EQ_PRESETS.FLAT, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(EQ_PRESETS.SIGNATURE_SOUND, [3, 12, 6, -3, 0, 8, 12, -3, 4, 10]);
  assert.deepEqual(EQ_PRESETS.SIGNATURE_SOUND_311, [2, -3, 0, 1, 0, 2, 3, 2, 3, -4]);
  assert.deepEqual(EQ_PRESETS.SIGNATURE_SOUND_BT, [2, 5, 8, 0, -7, -6, 11, 8, 6, -1]);
  assert.deepEqual(EQ_PRESETS.BALANCE_SOUND, [2, 8, 6, -4, 0, 8, 12, -3, 4, 10]);
  assert.deepEqual(EQ_PRESETS.BALANCE_SOUND_311, [1, 2, 1, -2, 1, 2, 5, -2, 5, 0]);
  assert.deepEqual(EQ_PRESETS.BALANCE_SOUND_BT, [1, 1, -1, -2, -7, -6, 11, 8, 6, -1]);

  const presets311 = getFactoryPresetsForProduct(0x0003);
  assert.deepEqual(presets311.flat, EQ_PRESETS.FLAT);
  assert.deepEqual(presets311.signatureSound, EQ_PRESETS.SIGNATURE_SOUND_311);
  assert.deepEqual(presets311.balanceSound, EQ_PRESETS.BALANCE_SOUND_311);

  const presetsBt211 = getFactoryPresetsForProduct(0x0005);
  assert.deepEqual(presetsBt211.signatureSound, EQ_PRESETS.SIGNATURE_SOUND_BT);
  assert.deepEqual(presetsBt211.balanceSound, EQ_PRESETS.BALANCE_SOUND_BT);

  const presetsDefault = getFactoryPresetsForProduct(0x0001);
  assert.deepEqual(presetsDefault.signatureSound, EQ_PRESETS.SIGNATURE_SOUND);
  assert.deepEqual(presetsDefault.balanceSound, EQ_PRESETS.BALANCE_SOUND);
});

// ---------------------------------------------------------------------------
// 2. Ultima Link Advertisement Parser (BleAdvMsg)
// ---------------------------------------------------------------------------

test('2.1 Ultima Link Adv round-trip: BE bid/pid, edrConnectState, XOR 0xAD MAC, offline license', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  (globalThis as { fetch?: unknown }).fetch = () => {
    fetchCalls += 1;
    throw new Error('Network call forbidden during offline BLE adv parsing');
  };

  try {
    const raw = encodeUltimaLinkAdv({
      bid: 0x1234,
      pid: 0x000a,
      edrConnected: true,
      edrMac: 'AA:BB:CC:DD:EE:FF',
      license: 'ultimaopen123456',
    });

    assert.equal(raw.length, 27);
    // BE bid & pid
    assert.equal(raw[0], 0x12);
    assert.equal(raw[1], 0x34);
    assert.equal(raw[2], 0x00);
    assert.equal(raw[3], 0x0a);
    // edrConnectState
    assert.equal(raw[4], 0x01);
    // MAC XOR 0xAD
    assert.deepEqual(Array.from(raw.subarray(5, 11)), [
      0xaa ^ 0xad,
      0xbb ^ 0xad,
      0xcc ^ 0xad,
      0xdd ^ 0xad,
      0xee ^ 0xad,
      0xff ^ 0xad,
    ]);

    const parsedWithCompany = parseUltimaLinkAdv(raw, 0xd222);
    assert.ok(parsedWithCompany);
    assert.equal(parsedWithCompany.companyId, 0xd222);
    assert.equal(parsedWithCompany.bid, 0x1234);
    assert.equal(parsedWithCompany.pid, 0x000a);
    assert.equal(parsedWithCompany.edrConnectState, 1);
    assert.equal(parsedWithCompany.edrConnected, true);
    assert.equal(parsedWithCompany.edrMac, 'AA:BB:CC:DD:EE:FF');
    assert.equal(parsedWithCompany.license, 'ultimaopen123456');
    assert.equal(parsedWithCompany.product?.name, 'XH-68B ANC');
    assert.equal(parsedWithCompany.offlineVerified, true);

    // Also test edrConnected: false + trailing bytes + alternate company IDs
    const rawDisconnected = encodeUltimaLinkAdv({
      bid: 0xabcd,
      pid: 0x0003,
      edrConnected: false,
      edrMac: '01:23:45:67:89:ab',
      license: '0000zzzz9999aaaa',
    });
    const extended = concatUint8Arrays([rawDisconnected, Uint8Array.of(0x99, 0x88)]);
    const parsedExtended = parseUltimaLinkAdv(extended, 0x0642);
    assert.ok(parsedExtended);
    assert.equal(parsedExtended.edrConnectState, 0);
    assert.equal(parsedExtended.edrConnected, false);
    assert.equal(parsedExtended.edrMac, '01:23:45:67:89:AB');
    assert.equal(parsedExtended.product?.code, 'BOOM_311');
    assert.equal(parsedExtended.offlineVerified, true);

    assert.equal(fetchCalls, 0);
  } finally {
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: unknown }).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  }
});

test('2.2 Ultima Link Adv rejects short payloads, unknown companyIds, and invalid license chars', () => {
  const valid = encodeUltimaLinkAdv({
    bid: 0x0102,
    pid: 0x0001,
    edrConnected: true,
    edrMac: 'AA:BB:CC:DD:EE:FF',
    license: 'abc123def456gh78',
  });

  // Short payloads (< 27 bytes)
  assert.equal(parseUltimaLinkAdv(new Uint8Array(0)), null);
  assert.equal(parseUltimaLinkAdv(valid.subarray(0, 26)), null);

  // Unknown company ID
  assert.equal(parseUltimaLinkAdv(valid, 0x1234), null);

  // Invalid license chars (uppercase, punctuation, space)
  for (const badLicense of ['ABC123DEF456GH78', 'abc-23def456gh78', 'abc 23def456gh78']) {
    const mutated = new Uint8Array(valid);
    for (let i = 0; i < 16; i++) {
      mutated[11 + i] = badLicense.charCodeAt(i);
    }
    assert.equal(parseUltimaLinkAdv(mutated), null);
    assert.throws(() =>
      encodeUltimaLinkAdv({
        bid: 1,
        pid: 1,
        edrConnected: false,
        edrMac: 'AA:BB:CC:DD:EE:FF',
        license: badLicense,
      }),
    );
  }

  // Hex utilities round-trip
  assert.equal(bytesToHex(Uint8Array.of(0x0a, 0xff), ':'), '0a:ff');
  assert.deepEqual(hexToBytes('0xAA:BB-CC DD'), Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd));
  assert.throws(() => hexToBytes('xyz'), RangeError);
});
