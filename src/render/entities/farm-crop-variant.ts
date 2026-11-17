/**
 * Cosmetic easter egg: about one farm in ten grows hemp instead of grain.
 * Same gameplay, only the sprite differs. The pick is a pure function of the
 * farm's tile and the map seed, so it is stable across frames and reloads and
 * identical for every lockstep peer. Never feeds the sim.
 */

import { tileHash } from '../tile-hash';

export type FarmCrop = 'grain' | 'hemp';

/** One farm in this many grows hemp. */
export const HEMP_ONE_IN = 10;

export function farmCrop(tileX: number, tileY: number, mapSeed: number): FarmCrop {
  const h = tileHash(Math.round(tileX), Math.round(tileY), mapSeed ^ 0x4e6d9);
  return h % HEMP_ONE_IN === 0 ? 'hemp' : 'grain';
}
