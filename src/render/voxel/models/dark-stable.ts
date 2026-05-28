/**
 * Dark Age stable - timber-and-thatch structure with open stall doors, hay,
 * water trough, and tack rack. Wider doorway distinguishes it from barracks.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkStableVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };
  const hollow = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (x === x0 || x === x1 || y === y0 || y === y1) put(x, y, z, c);
        }
  };

  // Yard apron: grass at corners, dirt by the entry.
  for (let x = 0; x <= 19; x++) {
    for (let y = 0; y <= 13; y++) {
      const edge = x < 2 || x > 17 || y < 2 || y > 11;
      if (edge) put(x, y, 0, y < 3 ? P.DIRT_M : P.GRASS_L);
    }
  }

  // Foundation and walls.
  box(2, 2, 0, 17, 11, 0, P.STONE_BASE);
  hollow(2, 2, 1, 17, 11, 7, P.WOOD_M);
  for (let z = 1; z <= 7; z++) {
    for (const x of [2, 6, 11, 17]) {
      put(x, 2, z, P.WOOD_D);
      put(x, 11, z, P.WOOD_D);
    }
    put(2, 6, z, P.WOOD_D);
    put(17, 6, z, P.WOOD_D);
  }

  // Open double doors on south face.
  for (let z = 1; z <= 5; z++) {
    for (let x = 7; x <= 12; x++) put(x, 2, z, P.WOOD_DOOR);
  }
  box(9, 2, 1, 10, 2, 5, P.DIRT_D);
  put(7, 2, 3, P.IRON);
  put(12, 2, 3, P.IRON);

  // Thatched roof, lower and broad.
  const thatchTone = (i: number) =>
    i % 3 === 0 ? P.THATCH_L : i % 3 === 1 ? P.THATCH_M : P.THATCH_D;
  for (let x = 1; x <= 18; x++)
    for (let y = 1; y <= 12; y++) put(x, y, 8, thatchTone(x + y));
  for (let x = 2; x <= 17; x++)
    for (let y = 2; y <= 11; y++) put(x, y, 9, thatchTone(x + y + 1));
  for (let x = 4; x <= 15; x++)
    for (let y = 4; y <= 9; y++) put(x, y, 10, P.THATCH_D);
  box(7, 5, 11, 12, 7, 11, P.WOOD_D);

  // Hay pile and trough in the yard.
  box(3, 0, 1, 6, 1, 2, P.THATCH_M);
  put(4, 0, 3, P.THATCH_L);
  put(5, 1, 3, P.THATCH_L);
  box(13, 0, 1, 17, 1, 1, P.WOOD_D);
  box(14, 0, 2, 16, 1, 2, P.WATER_M);

  // Tack rack on the east wall.
  for (let z = 3; z <= 5; z++) {
    put(18, 5, z, P.LEATHER_D);
    put(18, 6, z, P.LEATHER);
    put(18, 7, z, P.LEATHER_D);
  }

  return out;
}
