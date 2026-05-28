/**
 * Gold mine - small timber-braced shaft with gold ore, cart, and dark entry.
 * This is the specialist gold income building.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkGoldMineVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  for (let x = 0; x <= 13; x++)
    for (let y = 0; y <= 11; y++)
      if (x < 2 || x > 11 || y < 2 || y > 9) put(x, y, 0, (x + y) % 2 ? P.DIRT_D : P.STONE_ORE_D);

  // Rock face.
  box(2, 4, 1, 11, 9, 4, P.STONE_ORE_M);
  box(3, 5, 5, 10, 9, 6, P.STONE_ORE_D);
  box(5, 6, 7, 8, 9, 7, P.STONE_ORE_D);
  for (const [x, y, z] of [[3, 4, 4], [9, 5, 5], [6, 8, 7], [10, 8, 3], [4, 7, 6]] as const) {
    put(x, y, z, P.GOLD_ORE);
  }

  // Mine opening and timber braces.
  box(5, 3, 1, 8, 4, 5, P.WOOD_D);
  box(6, 2, 1, 7, 4, 4, P.IRON);
  box(5, 3, 5, 8, 3, 5, P.WOOD_L);
  box(5, 3, 1, 5, 3, 5, P.WOOD_L);
  box(8, 3, 1, 8, 3, 5, P.WOOD_L);

  // Ore cart in front.
  box(3, 1, 1, 7, 2, 2, P.WOOD_D);
  put(3, 1, 0, P.IRON);
  put(7, 1, 0, P.IRON);
  put(4, 1, 3, P.GOLD_ORE);
  put(5, 1, 3, P.GOLD);
  put(6, 2, 3, P.GOLD_ORE_D);

  return out;
}
