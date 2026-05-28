/**
 * Lumber camp - compact saw yard with stacked logs, chopping block, and a
 * timber lean-to. This is the specialist wood income building.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkLumberCampVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  for (let x = 0; x <= 13; x++)
    for (let y = 0; y <= 11; y++)
      if (x < 2 || x > 11 || y < 2 || y > 9) put(x, y, 0, (x + y) % 2 ? P.DIRT_M : P.GRASS_D);

  box(2, 2, 0, 11, 9, 0, P.DIRT_D);

  // Lean-to posts and roof.
  for (const [x, y] of [[2, 3], [10, 3], [2, 8], [10, 8]] as const) {
    box(x, y, 1, x, y, 6, P.WOOD_D);
  }
  for (let x = 1; x <= 11; x++)
    for (let y = 2; y <= 9; y++) put(x, y, 7, (x + y) % 3 === 0 ? P.THATCH_L : P.THATCH_M);
  for (let x = 3; x <= 9; x++)
    for (let y = 3; y <= 8; y++) put(x, y, 8, P.THATCH_D);

  // Log piles.
  for (let y = 1; y <= 4; y++) {
    box(3, y, 1, 8, y, 1, P.TREE_TRUNK_L);
    put(2, y, 1, P.TREE_TRUNK_D);
    put(9, y, 1, P.TREE_TRUNK_D);
  }
  for (let y = 5; y <= 7; y++) {
    box(4, y, 2, 9, y, 2, P.TREE_TRUNK_L);
    put(3, y, 2, P.TREE_TRUNK_D);
    put(10, y, 2, P.TREE_TRUNK_D);
  }

  // Chopping block and axe.
  box(11, 2, 1, 12, 3, 3, P.TREE_TRUNK_D);
  put(11, 2, 4, P.STEEL);
  put(12, 2, 4, P.STEEL);
  put(12, 3, 4, P.WOOD_D);

  return out;
}
