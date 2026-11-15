/**
 * Jieli RCSP device authentication.
 *
 * Jieli earbuds ignore every RCSP command until the app passes a two-way
 * challenge/response. Reverse engineered from Ultima Link 1.0.31
 * (`com.jieli.bluetooth.impl.RcspAuth` + `libjl_bluetooth.so`):
 *
 *   app  → dev  FE DC BA C0 06 00 02 00 01 EF        reset auth flag
 *   app  → dev  00 + rand[16]                       our challenge
 *   dev  → app  01 + E1(rand)                       device answer (checked)
 *   app  → dev  02 'p' 'a' 's' 's'                  "your answer is OK"
 *   dev  → app  00 + rand'[16]                      device challenge
 *   app  → dev  01 + E1(rand')                      our answer
 *   dev  → app  02 'p' 'a' 's' 's'                  authenticated
 *
 * Auth messages are raw (not RCSP framed) and travel on the same AE01/AE02
 * characteristics. `E1` is the Bluetooth BR/EDR E1 function (SAFER+ Ar/Ar')
 * with a fixed link key and a fixed address baked into the native library.
 * The 16-byte output is the full Ar' block (SRES ‖ ACO), not just SRES.
 */

/** Link key from `libjl_bluetooth.so` .data @0x9be0. */
export const JIELI_AUTH_LINK_KEY = Uint8Array.of(0x06, 0x77, 0x5f, 0x87, 0x91, 0x8d, 0xd4, 0x23, 0x00, 0x5d, 0xf1, 0xd8, 0xcf, 0x0c, 0x14, 0x2b);
/** Address used for E1, `libjl_bluetooth.so` .data @0x9bf0. */
export const JIELI_AUTH_ADDRESS = Uint8Array.of(0x11, 0x22, 0x33, 0x33, 0x22, 0x11);

export const JIELI_AUTH_RESET_FLAG = Uint8Array.of(0xfe, 0xdc, 0xba, 0xc0, 0x06, 0x00, 0x02, 0x00, 0x01, 0xef);
export const JIELI_AUTH_OK = Uint8Array.of(0x02, 0x70, 0x61, 0x73, 0x73);

// --- SAFER+ (Bluetooth variant) -------------------------------------------

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
{
  let v = 1;
  for (let i = 0; i < 256; i++) {
    EXP[i] = v & 0xff; // 45^128 mod 257 = 256 → stored as 0
    LOG[v & 0xff] = i;
    v = (v * 45) % 257;
  }
}

/** Byte positions using XOR in key-add 1 / exp in the S-layer (mask 0x9999). */
const XOR_POS = [true, false, false, true, true, false, false, true, true, false, false, true, true, false, false, true];
const SHUFFLE = [8, 11, 12, 15, 2, 1, 6, 5, 10, 9, 14, 13, 0, 7, 4, 3];
/** Key offsets for K̃ in Ar' (added at even, XORed at odd byte positions in the low half; swapped in the high half). */
const KEY_OFFSETS = [233, 229, 223, 193, 179, 167, 149, 131];

export function saferBias(round: number, j: number): number {
  // B_round[j] = 45^(45^(17·round + j + 1) mod 257) mod 257, round = 2..17, j = 0..15
  // 45 has order 256 mod 257, so exponents wrap mod 256 (EXP[0] stands for 45^0 and 45^256).
  const inner = EXP[(17 * round + j + 1) % 256]!;
  return EXP[inner]!;
}

function keySchedule(key: Uint8Array): Uint8Array[] {
  const reg = new Uint8Array(17);
  reg.set(key.subarray(0, 16));
  reg[16] = key.subarray(0, 16).reduce((a, b) => a ^ b, 0);
  const keys: Uint8Array[] = [Uint8Array.from(key.subarray(0, 16))];
  for (let p = 2; p <= 17; p++) {
    for (let i = 0; i < 17; i++) reg[i] = ((reg[i]! << 3) | (reg[i]! >> 5)) & 0xff;
    const k = new Uint8Array(16);
    for (let j = 0; j < 16; j++) k[j] = (reg[(p - 1 + j) % 17]! + saferBias(p, j)) & 0xff;
    keys.push(k);
  }
  return keys;
}

function pht(x: Uint8Array): void {
  for (let i = 0; i < 16; i += 2) {
    const a = x[i]!;
    const b = x[i + 1]!;
    x[i] = (2 * a + b) & 0xff;
    x[i + 1] = (a + b) & 0xff;
  }
}

function shuffle(x: Uint8Array): void {
  const y = Uint8Array.from(x);
  for (let i = 0; i < 16; i++) x[i] = y[SHUFFLE[i]!]!;
}

/** SAFER+ Ar (prime=false) or Ar' (prime=true). */
export function saferAr(key: Uint8Array, input: Uint8Array, prime: boolean): Uint8Array {
  const keys = keySchedule(key);
  const x = Uint8Array.from(input.subarray(0, 16));
  for (let r = 0; r < 8; r++) {
    if (prime && r === 2) {
      for (let i = 0; i < 16; i++) x[i] = XOR_POS[i] ? x[i]! ^ input[i]! : (x[i]! + input[i]!) & 0xff;
    }
    const k1 = keys[2 * r]!;
    const k2 = keys[2 * r + 1]!;
    for (let i = 0; i < 16; i++) {
      const v = XOR_POS[i] ? x[i]! ^ k1[i]! : (x[i]! + k1[i]!) & 0xff;
      x[i] = XOR_POS[i] ? EXP[v]! : LOG[v]!;
      x[i] = XOR_POS[i] ? (x[i]! + k2[i]!) & 0xff : x[i]! ^ k2[i]!;
    }
    pht(x); shuffle(x); pht(x); shuffle(x); pht(x); shuffle(x); pht(x);
  }
  const k17 = keys[16]!;
  for (let i = 0; i < 16; i++) x[i] = XOR_POS[i] ? x[i]! ^ k17[i]! : (x[i]! + k17[i]!) & 0xff;
  return x;
}

/** Bluetooth E1, returning the full 16-byte Ar' output (as the Jieli library does). */
export function bluetoothE1(key: Uint8Array, rand: Uint8Array, address: Uint8Array): Uint8Array {
  const first = saferAr(key, rand, false);
  const mid = new Uint8Array(16);
  for (let i = 0; i < 16; i++) mid[i] = ((first[i]! ^ rand[i]!) + address[i % 6]!) & 0xff;
  const keyTilde = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const off = KEY_OFFSETS[i % 8]!;
    const add = i < 8 ? i % 2 === 0 : i % 2 === 1;
    keyTilde[i] = add ? (key[i]! + off) & 0xff : key[i]! ^ off;
  }
  return saferAr(keyTilde, mid, true);
}

/** `getEncryptedAuthData`: answer to a 17-byte `00 + rand` challenge. */
export function jieliAuthResponse(challenge: Uint8Array): Uint8Array {
  const rand = challenge.length === 17 ? challenge.subarray(1) : challenge;
  const out = new Uint8Array(17);
  out[0] = 0x01;
  out.set(bluetoothE1(JIELI_AUTH_LINK_KEY, rand, JIELI_AUTH_ADDRESS), 1);
  return out;
}

/** `getRandomAuthData`: a fresh `00 + rand[16]` challenge. */
export function jieliAuthChallenge(random: () => number = Math.random): Uint8Array {
  const out = new Uint8Array(17);
  for (let i = 1; i < 17; i++) out[i] = Math.floor(random() * 256) & 0xff;
  return out;
}

export function isJieliAuthMessage(bytes: Uint8Array): boolean {
  if (bytes.length === 5) return bytes[0] === 0x02;
  return bytes.length === 17 && (bytes[0] === 0x00 || bytes[0] === 0x01);
}

export function isJieliAuthOk(bytes: Uint8Array): boolean {
  return bytes.length === JIELI_AUTH_OK.length && bytes.every((b, i) => b === JIELI_AUTH_OK[i]);
}
