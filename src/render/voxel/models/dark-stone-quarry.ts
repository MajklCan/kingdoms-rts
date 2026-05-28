/**
 * Stone quarry - cut stone blocks, crane arm, and rough outcrop. This is the
 * specialist stone income building.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkStoneQuarryVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  for (let x = 0; x <= 13; x++)
    for (let y = 0; y <= 11; y++)
      if (x < 2 || x > 11 || y < 2 || y > 9) put(x, y, 0, (x + y) % 2 ? P.DIRT_M : P.STONE_ORE_D);

  // Rough quarry wall.
  box(1, 5, 1, 11, 10, 3, P.STONE_ORE_M);
  box(3, 6, 4, 10, 10, 5, P.STONE_ORE_D);
  box(6, 7, 6, 9, 10, 6, P.STONE_ORE_L);

  // Cut blocks in the yard.
  box(2, 2, 1, 4, 4, 2, P.STONE_ORE_L);
  box(6, 2, 1, 8, 4, 2, P.STONE_ORE_M);
  box(9, 2, 1, 11, 3, 2, P.STONE_ORE_L);
  box(2, 1, 3, 4, 3, 4, P.STONE_ORE_M);

  // Timber crane and hanging stone.
  box(10, 4, 1, 10, 4, 9, P.WOOD_D);
  box(7, 4, 8, 11, 4, 8, P.WOOD_L);
  put(7, 4, 7, P.IRON);
  put(7, 4, 6, P.IRON);
  box(6, 4, 4, 8, 5, 5, P.STONE_ORE_L);

  // Chisel rack.
  box(1, 2, 1, 1, 6, 1, P.WOOD_D);
  put(1, 3, 2, P.STEEL);
  put(1, 5, 2, P.STEEL);

  return out;
}
