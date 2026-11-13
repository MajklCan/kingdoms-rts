/**
 * Deterministic render-only noise. Everything here is a pure function of tile
 * coordinates (and an optional seed), so the look is stable across frames,
 * reloads and identical for every multiplayer peer. Never feeds the sim.
 */

/** 32-bit integer hash of a tile coordinate pair plus a salt. */
export function tileHash(x: number, y: number, salt = 0): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + 0x3c6ef372, 0x27d4eb2f);
  h = Math.imul(h ^ (salt | 0) ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash mapped to [0, 1). */
export function tileHash01(x: number, y: number, salt = 0): number {
  return tileHash(x, y, salt) / 4294967296;
}

/** Smooth value noise in [0, 1) with features about `cell` tiles wide. */
export function valueNoise(x: number, y: number, cell: number, salt = 0): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smooth(gx - x0);
  const fy = smooth(gy - y0);
  const a = tileHash01(x0, y0, salt);
  const b = tileHash01(x0 + 1, y0, salt);
  const c = tileHash01(x0, y0 + 1, salt);
  const d = tileHash01(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** Order-dependent hash of a byte array (map tiles, elevation) for render seeds. */
export function hashBytes(bytes: ArrayLike<number>, seed = 0x9e3779b9): number {
  let h = seed | 0;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return h >>> 0;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
