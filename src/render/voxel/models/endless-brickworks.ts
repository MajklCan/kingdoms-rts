/**
 * Brickworks - a domed brick kiln with a fire mouth, a timber drying shed
 * and stacked bricks on a clay yard. The endless stone worksite (2x2).
 *
 * Footprint: 16x14. Height: ~14 voxels (the kiln stack).
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildBrickworksVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  // Clay yard.
  for (let x = 0; x <= 15; x++)
    for (let y = 0; y <= 13; y++) put(x, y, 0, (x * 3 + y) % 4 === 0 ? P.DIRT_M : P.DIRT_L);

  // Domed kiln: a brick drum stepping in towards the top.
  const brick = (x: number, y: number, z: number) => ((x + y + z) % 3 === 0 ? P.ROOF_D : P.ROOF_M);
  for (let z = 1; z <= 9; z++) {
    const r = z <= 5 ? 4.6 : 4.6 - (z - 5) * 0.9;
    for (let y = 4; y <= 13; y++)
      for (let x = 7; x <= 15; x++) {
        if (Math.hypot(x - 11, y - 8.5) <= r) put(x, y, z, brick(x, y, z));
      }
  }
  // Stack on the dome and the fire mouth facing the yard.
  box(10, 8, 10, 12, 9, 13, P.ROOF_D);
  box(10, 8, 14, 12, 9, 14, P.IRON);
  box(10, 4, 1, 12, 4, 3, P.IRON);
  put(11, 4, 1, P.GOLD_ORE);
  put(11, 4, 2, P.GOLD_ORE_D);

  // Drying shed on posts with a thatch roof.
  for (const [x, y] of [[1, 6], [5, 6], [1, 12], [5, 12]] as const) box(x, y, 1, x, y, 5, P.WOOD_D);
  box(0, 5, 6, 6, 13, 6, P.THATCH_M);
  box(1, 7, 7, 5, 11, 7, P.THATCH_L);
  box(2, 7, 1, 4, 11, 2, P.ROOF_L);

  // Stacked finished bricks at the front.
  box(1, 1, 1, 4, 2, 2, P.ROOF_M);
  box(2, 1, 3, 3, 2, 3, P.ROOF_L);
  box(6, 1, 1, 8, 2, 1, P.ROOF_D);

  return out;
}
