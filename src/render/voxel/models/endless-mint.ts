/**
 * Mint - a stone strike-house with a red tile roof, a smelting chimney, and
 * stacks of struck coin by the door. The endless gold worksite (2x2).
 *
 * Footprint: 16x14. Height: ~17 voxels (the chimney top).
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildMintVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  // Paved yard.
  for (let x = 0; x <= 15; x++)
    for (let y = 0; y <= 13; y++)
      if (x < 2 || x > 13 || y < 3 || y > 12) put(x, y, 0, (x + y) % 3 === 0 ? P.STONE_D : P.STONE_BASE);

  // Strike-house: stone walls with darker corner quoins.
  box(2, 3, 0, 13, 12, 6, P.STONE_M);
  for (const [x, y] of [[2, 3], [13, 3], [2, 12], [13, 12]] as const) box(x, y, 0, x, y, 6, P.STONE_D);
  // Door and two barred windows on the front (low y) face.
  box(7, 3, 1, 8, 3, 4, P.WOOD_DOOR);
  box(4, 3, 3, 5, 3, 4, P.IRON);
  box(10, 3, 3, 11, 3, 4, P.IRON);

  // Stepped tile roof along x.
  box(1, 2, 7, 14, 13, 7, P.ROOF_D);
  box(1, 3, 8, 14, 12, 8, P.ROOF_M);
  box(1, 5, 9, 14, 10, 9, P.ROOF_L);
  box(1, 7, 10, 14, 8, 10, P.ROOF_RIDGE);

  // Smelting chimney at the back with a glowing mouth.
  box(11, 10, 7, 12, 11, 15, P.STONE_D);
  box(11, 10, 16, 12, 11, 16, P.IRON);
  put(11, 10, 14, P.GOLD_ORE);

  // Struck coin: chests and stacks by the door.
  box(3, 1, 1, 5, 2, 2, P.WOOD_M);
  box(3, 1, 3, 5, 2, 3, P.GOLD);
  put(4, 1, 4, P.GOLD_ORE);
  box(10, 1, 1, 11, 1, 2, P.GOLD_ORE_D);
  put(10, 1, 3, P.GOLD_ORE);
  put(12, 2, 1, P.GOLD_ORE);

  return out;
}
