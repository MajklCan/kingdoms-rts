/**
 * Dark Age farm - a low 2 by 2 crop plot with tilled rows, wheat patches,
 * and a simple timber border. It intentionally reads as land being worked,
 * not a mill building.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkFarmVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  // Tilled square.
  for (let x = 0; x <= 15; x++) {
    for (let y = 0; y <= 15; y++) {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      if (border) {
        put(x, y, 0, P.WOOD_D);
      } else {
        const row = y % 4;
        put(x, y, 0, row === 0 ? P.DIRT_D : row === 1 ? P.DIRT_M : P.DIRT_L);
      }
    }
  }

  // Crop rows: mixed green shoots and ripe wheat heads.
  for (const y of [3, 6, 9, 12]) {
    for (let x = 2; x <= 13; x += 2) {
      const ripe = (x + y) % 3 === 0;
      put(x, y, 1, ripe ? P.THATCH_M : P.GRASS_L);
      put(x, y, 2, ripe ? P.THATCH_L : P.GRASS_M);
      if (ripe) put(x, y, 3, P.THATCH_L);
    }
  }

  // Low fence posts and a small hay stack for scale.
  for (const [x, y] of [
    [0, 0], [5, 0], [10, 0], [15, 0],
    [0, 5], [15, 5], [0, 10], [15, 10],
    [0, 15], [5, 15], [10, 15], [15, 15],
  ]) {
    box(x, y, 1, x, y, 3, P.WOOD_M);
  }
  box(11, 2, 1, 13, 4, 2, P.THATCH_M);
  put(12, 3, 3, P.THATCH_L);

  return out;
}

/** Stages of the farm under construction in the voxel fallback art. */
export const DARK_FARM_SITE_STAGES = 4;

/** The finished farm's extents, so every stage bakes to the same frame. */
export const DARK_FARM_SITE_BOUNDS = { minX: 0, maxX: 15, minY: 0, maxY: 15, minZ: 0, maxZ: 3 };

/**
 * The farm being laid out (voxel fallback of the atlas's construction.farm):
 * the plot staked out with string, then tilled row by row from the back,
 * with a spade at the working row and a seed sack. No timber frame.
 */
export function buildDarkFarmSiteVoxels(stage: number): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const last = DARK_FARM_SITE_STAGES - 1;
  const step = Math.max(0, Math.min(last, Math.round(stage)));
  /** Rows 1..tilled are turned; the bed is rows 1..14. */
  const tilled = Math.round((14 * step) / last);

  for (let y = 1; y <= tilled; y++) {
    for (let x = 1; x <= 14; x++) {
      const row = y % 4;
      const fresh = step < last && y === tilled;
      put(x, y, 0, fresh || row === 0 ? P.DIRT_D : row === 1 ? P.DIRT_M : P.DIRT_L);
    }
  }

  // Corner stakes with a string run between them.
  for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]] as const) {
    for (let z = 0; z <= 3; z++) put(x, y, z, z === 3 ? P.WOOD_L : P.WOOD_M);
  }
  for (let i = 1; i <= 14; i++) {
    for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) put(x, y, 2, P.THATCH_L);
  }

  if (step < last) {
    // Spade stood in the next row, seed sack waiting on the grass.
    const work = Math.min(14, tilled + 1);
    put(10, work, 0, P.STONE_ORE_D);
    put(10, work, 1, P.WOOD_L);
    put(10, work, 2, P.WOOD_L);
    put(10, work, 3, P.WOOD_M);
    const rest = Math.min(13, tilled + 3);
    put(4, rest, 0, P.THATCH_M);
    put(5, rest, 0, P.THATCH_M);
    put(4, rest, 1, P.THATCH_L);
  }
  return out;
}
