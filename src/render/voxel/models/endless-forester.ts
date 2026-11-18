/**
 * Forester's lodge - a small log lodge with a shingle roof, rows of planted
 * saplings and a stack of felled logs. The endless wood worksite (1x1).
 *
 * Footprint: 14x12. Height: ~11 voxels.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildForesterVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  // Tilled nursery ground.
  for (let x = 0; x <= 13; x++)
    for (let y = 0; y <= 11; y++) put(x, y, 0, y % 2 === 0 ? P.DIRT_M : P.GRASS_D);

  // Log lodge: alternating light and dark courses.
  for (let z = 1; z <= 4; z++) box(6, 5, z, 12, 10, z, z % 2 ? P.WOOD_M : P.WOOD_L);
  box(8, 5, 1, 9, 5, 3, P.WOOD_DOOR);
  // Shingle roof along y.
  box(5, 4, 5, 13, 11, 5, P.WOOD_D);
  box(6, 4, 6, 12, 11, 6, P.WOOD_M);
  box(7, 4, 7, 11, 11, 7, P.WOOD_D);
  box(8, 4, 8, 10, 11, 8, P.WOOD_M);
  box(9, 4, 9, 9, 11, 9, P.WOOD_D);

  // Sapling rows: a stem and a little crown each.
  for (const [x, y, h] of [[1, 1, 2], [3, 1, 3], [1, 4, 3], [3, 4, 2], [1, 7, 2], [3, 7, 3], [1, 10, 3], [3, 10, 2]] as const) {
    box(x, y, 1, x, y, h, P.TREE_TRUNK_L);
    put(x, y, h + 1, P.TREE_CANOPY_L);
    put(x, y + 1, h, P.TREE_CANOPY_M);
    put(x + 1, y, h, P.TREE_CANOPY_D);
  }

  // Felled logs stacked by the lodge.
  box(6, 1, 1, 11, 2, 1, P.TREE_TRUNK_D);
  box(7, 1, 2, 10, 2, 2, P.TREE_TRUNK_L);
  put(6, 1, 1, P.WOOD_L);
  put(6, 2, 1, P.WOOD_L);

  return out;
}
