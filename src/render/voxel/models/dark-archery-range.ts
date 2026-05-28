/**
 * Dark Age archery range - open timber shed with straw butts, target boards,
 * bow rack, and a low thatched roof. Kept visually lighter than the barracks.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkArcheryRangeVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  // Packed dirt practice yard.
  for (let x = 0; x <= 19; x++) {
    for (let y = 0; y <= 13; y++) {
      put(x, y, 0, (x + y) % 3 === 0 ? P.DIRT_D : P.DIRT_M);
    }
  }

  // Raised timber platform.
  box(2, 3, 1, 17, 11, 1, P.WOOD_M);
  for (let x = 2; x <= 17; x += 2) box(x, 3, 2, x, 11, 2, P.WOOD_D);

  // Open post frame.
  for (const [x, y] of [
    [2, 3],
    [17, 3],
    [2, 11],
    [17, 11],
    [9, 11],
  ] as const) {
    box(x, y, 2, x, y, 9, P.WOOD_D);
  }
  box(2, 3, 9, 17, 3, 9, P.WOOD_D);
  box(2, 11, 9, 17, 11, 9, P.WOOD_D);
  box(2, 3, 9, 2, 11, 9, P.WOOD_D);
  box(17, 3, 9, 17, 11, 9, P.WOOD_D);

  // Thatched roof tiers.
  const thatchTone = (i: number) =>
    i % 3 === 0 ? P.THATCH_L : i % 3 === 1 ? P.THATCH_M : P.THATCH_D;
  for (let x = 1; x <= 18; x++)
    for (let y = 2; y <= 12; y++) put(x, y, 10, thatchTone(x + y));
  for (let x = 2; x <= 17; x++)
    for (let y = 3; y <= 11; y++) put(x, y, 11, thatchTone(x + y + 1));
  for (let x = 4; x <= 15; x++)
    for (let y = 5; y <= 9; y++) put(x, y, 12, P.THATCH_D);
  box(7, 6, 13, 12, 8, 13, P.WOOD_D);

  // Targets along the back wall: straw square, painted rings.
  for (const tx of [5, 10, 15]) {
    box(tx - 1, 12, 2, tx + 1, 12, 5, P.THATCH_M);
    put(tx, 12, 3, P.ROOF_M);
    put(tx, 12, 4, P.ROOF_M);
    put(tx, 12, 5, P.STEEL);
  }

  // Bow rack and arrow bundles on the front edge.
  for (let z = 2; z <= 5; z++) {
    put(4, 2, z, P.BOW_WOOD);
    put(5, 2, z, P.BOW_WOOD);
    put(13, 2, z, P.ARROW_SHAFT);
    put(14, 2, z, P.ARROW_SHAFT);
  }
  put(13, 2, 6, P.FLETCHING);
  put(14, 2, 6, P.FLETCHING);

  return out;
}
