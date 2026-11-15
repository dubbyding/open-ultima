/**
 * Factory 10-band equalizer frequencies, slider bounds, and per-SKU curves.
 */

import type { ProductFactoryEqPresets } from './types.ts';

/**
 * Ten-band center frequencies (Hz) used across Jieli and Bluetrum EQ frames.
 */
export const EQ_FREQUENCIES = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

/**
 * Signed custom EQ slider bounds (dB) exposed by Ultima Link UI.
 */
export const EQ_GAIN_MIN = -10;
export const EQ_GAIN_MAX = 10;

/**
 * Exact 10-band EQ gain arrays extracted from EqConstant.
 */
export const EQ_PRESETS = {
  FLAT: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  SIGNATURE_SOUND: [3, 12, 6, -3, 0, 8, 12, -3, 4, 10],
  SIGNATURE_SOUND_311: [2, -3, 0, 1, 0, 2, 3, 2, 3, -4],
  SIGNATURE_SOUND_BT: [2, 5, 8, 0, -7, -6, 11, 8, 6, -1],
  BALANCE_SOUND: [2, 8, 6, -4, 0, 8, 12, -3, 4, 10],
  BALANCE_SOUND_311: [1, 2, 1, -2, 1, 2, 5, -2, 5, 0],
  BALANCE_SOUND_BT: [1, 1, -1, -2, -7, -6, 11, 8, 6, -1],
} as const;

/**
 * Resolve factory Signature Sound and Balance Sound 10-band gains for a product ID.
 */
export function getFactoryPresetsForProduct(pid: number): ProductFactoryEqPresets {
  if (pid === 0x0005) {
    return {
      flat: EQ_PRESETS.FLAT,
      signatureSound: EQ_PRESETS.SIGNATURE_SOUND_BT,
      balanceSound: EQ_PRESETS.BALANCE_SOUND_BT,
    };
  }
  if (pid === 0x0003) {
    return {
      flat: EQ_PRESETS.FLAT,
      signatureSound: EQ_PRESETS.SIGNATURE_SOUND_311,
      balanceSound: EQ_PRESETS.BALANCE_SOUND_311,
    };
  }
  return {
    flat: EQ_PRESETS.FLAT,
    signatureSound: EQ_PRESETS.SIGNATURE_SOUND,
    balanceSound: EQ_PRESETS.BALANCE_SOUND,
  };
}
