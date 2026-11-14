/**
 * The seed a match map was generated from, kept on the world so anything
 * cosmetic (terrain dressing, decal scatter) can be derived from one stable
 * number that survives save/load and is identical on every lockstep peer.
 *
 * Determinism: no system reads it to decide anything. It is not part of the
 * checksum; it never changes after world creation.
 */

import type { SimWorld } from './types';

/** Normalise any number to the uint32 a map seed is stored as. */
export function normalizeMapSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

/**
 * Seed for saves written before the map seed was stored (SAVE_VERSION < 3).
 * Same order-dependent byte hash render used to derive its terrain seed from
 * the map bytes, so an old save keeps its look once render reads mapSeed.
 */
export function legacyMapSeed(tiles: ArrayLike<number>, elevation: ArrayLike<number>): number {
  return hashBytes(elevation, hashBytes(tiles));
}

/** The world's map seed (uint32). */
export function getMapSeed(world: SimWorld): number {
  return world.mapSeed;
}

function hashBytes(bytes: ArrayLike<number>, seed = 0x9e3779b9): number {
  let h = seed | 0;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return h >>> 0;
}
