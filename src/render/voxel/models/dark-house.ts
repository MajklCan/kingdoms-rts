/**
 * Dark Age peasant house — a small thatched cottage with sandstone base,
 * timber-framed walls, a steep thatched roof, and a small chimney.
 *
 * Footprint: 12×10. Height: ~14 voxels.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkHouseVoxels(): Voxel[] {
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

  // Grass apron
  for (let x = 0; x <= 13; x++)
    for (let y = 0; y <= 11; y++) {
      if (x < 2 || x > 11 || y < 2 || y > 9) {
        put(x, y, 0, (x + y) % 3 === 0 ? P.GRASS_D : P.GRASS_L);
      }
    }

  // Sandstone plinth
  box(2, 2, 0, 11, 9, 0, P.STONE_BASE);

  // Half-timbered walls (sandstone with wooden beams at corners + horizontal mid-band).
  hollow(2, 2, 1, 11, 9, 6, P.STONE_M);
  // Tonal banding on stone
  for (let z = 1; z <= 6; z++) {
    if (z === 3) {
      for (let x = 2; x <= 11; x++) {
        put(x, 2, z, P.STONE_L);
        put(x, 9, z, P.STONE_L);
      }
      for (let y = 3; y <= 8; y++) {
        put(2, y, z, P.STONE_L);
        put(11, y, z, P.STONE_L);
      }
    }
  }
  // Corner timbers
  for (let z = 1; z <= 6; z++) {
    put(2, 2, z, P.WOOD_D);
    put(11, 2, z, P.WOOD_D);
    put(2, 9, z, P.WOOD_D);
    put(11, 9, z, P.WOOD_D);
  }
  // Top wood beam (eaves line)
  for (let x = 2; x <= 11; x++) {
    put(x, 2, 7, P.WOOD_D);
    put(x, 9, 7, P.WOOD_D);
  }
  for (let y = 2; y <= 9; y++) {
    put(2, y, 7, P.WOOD_D);
    put(11, y, 7, P.WOOD_D);
  }

  // Door on south face
  for (let z = 1; z <= 4; z++) {
    put(6, 2, z, P.WOOD_DOOR);
    put(7, 2, z, P.WOOD_DOOR);
  }
  put(6, 2, 2, P.IRON);
  put(7, 2, 3, P.IRON);

  // Small windows on east/west walls
  put(2, 5, 4, P.WOOD_D);
  put(11, 5, 4, P.WOOD_D);
  put(2, 6, 4, P.WOOD_D);
  put(11, 6, 4, P.WOOD_D);

  // Steep thatched roof (gabled). Two slopes meeting at a ridge.
  const thatchTone = (i: number) =>
    i % 3 === 0 ? P.THATCH_L : i % 3 === 1 ? P.THATCH_M : P.THATCH_D;
  // Eaves overhang
  for (let x = 1; x <= 12; x++)
    for (let y = 1; y <= 10; y++) put(x, y, 7, P.WOOD_D);
  // Slope tiers
  for (let x = 2; x <= 11; x++)
    for (let y = 2; y <= 9; y++) put(x, y, 8, thatchTone(x + y));
  for (let x = 3; x <= 10; x++)
    for (let y = 3; y <= 8; y++) put(x, y, 9, thatchTone(x + y + 1));
  for (let x = 4; x <= 9; x++)
    for (let y = 4; y <= 7; y++) put(x, y, 10, thatchTone(x + y));
  for (let x = 5; x <= 8; x++)
    for (let y = 5; y <= 6; y++) put(x, y, 11, P.THATCH_D);
  // Ridge
  for (let x = 5; x <= 8; x++) put(x, 5, 12, P.WOOD_D);

  // Chimney on the back-right corner
  for (let z = 8; z <= 13; z++) {
    put(9, 8, z, P.STONE_D);
    put(9, 9, z, P.STONE_D);
    put(10, 8, z, P.STONE_M);
    put(10, 9, z, P.STONE_M);
  }
  // Chimney cap (slightly darker)
  put(9, 8, 13, P.STONE_BASE);
  put(9, 9, 13, P.STONE_BASE);
  put(10, 8, 13, P.STONE_BASE);
  put(10, 9, 13, P.STONE_BASE);

  return out;
}
