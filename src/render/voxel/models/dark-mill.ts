/**
 * Dark Age mill — sandstone base with a small grain shed, a wooden windmill
 * tower rising on one side with four sail-blades fixed in an X.
 *
 * Footprint: 14×12. Height: ~22 voxels (the windmill peak).
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkMillVoxels(): Voxel[] {
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
  for (let x = 0; x <= 15; x++)
    for (let y = 0; y <= 13; y++) {
      if (x < 2 || x > 13 || y < 2 || y > 11) {
        put(x, y, 0, (x + y) % 3 === 0 ? P.GRASS_D : P.GRASS_L);
      }
    }

  // Grain shed (low) on the east side: footprint 6x8, walls 5 high
  hollow(8, 3, 1, 13, 10, 5, P.STONE_M);
  for (let z = 1; z <= 5; z++) {
    if (z === 3) {
      for (let x = 8; x <= 13; x++) {
        put(x, 3, z, P.STONE_L);
        put(x, 10, z, P.STONE_L);
      }
    }
  }
  box(8, 3, 0, 13, 10, 0, P.STONE_BASE);
  // Wooden floor
  box(9, 4, 1, 12, 9, 1, P.WOOD_M);
  // Roof — single slope thatched
  for (let x = 8; x <= 13; x++)
    for (let y = 3; y <= 10; y++) put(x, y, 6, P.THATCH_M);
  for (let x = 9; x <= 12; x++)
    for (let y = 4; y <= 9; y++) put(x, y, 7, P.THATCH_L);
  for (let x = 10; x <= 11; x++)
    for (let y = 5; y <= 8; y++) put(x, y, 8, P.THATCH_D);
  // Sacks of grain visible inside the shed door (south face)
  for (let z = 1; z <= 4; z++) put(10, 3, z, P.WOOD_DOOR);
  for (let z = 1; z <= 4; z++) put(11, 3, z, P.WOOD_DOOR);

  // Windmill tower (round-ish, 6×6 footprint, west side)
  box(2, 4, 0, 6, 9, 0, P.STONE_BASE);
  hollow(2, 4, 1, 6, 9, 12, P.STONE_M);
  for (let z = 1; z <= 12; z++) {
    if (z % 3 === 0) {
      for (let x = 2; x <= 6; x++) {
        put(x, 4, z, P.STONE_L);
        put(x, 9, z, P.STONE_L);
      }
      for (let y = 5; y <= 8; y++) {
        put(2, y, z, P.STONE_L);
        put(6, y, z, P.STONE_L);
      }
    }
  }
  // Tower door
  for (let z = 1; z <= 3; z++) put(4, 4, z, P.WOOD_DOOR);
  put(4, 4, 2, P.IRON);

  // Conical wooden cap on the tower
  for (let x = 2; x <= 6; x++)
    for (let y = 4; y <= 9; y++) put(x, y, 13, P.WOOD_M);
  for (let x = 3; x <= 5; x++)
    for (let y = 5; y <= 8; y++) put(x, y, 14, P.WOOD_D);
  put(4, 6, 15, P.WOOD_D);
  put(4, 7, 15, P.WOOD_D);

  // Windmill sail axle (projecting south)
  for (let y = 1; y <= 3; y++) put(4, y, 11, P.WOOD_D);

  // Four sail blades in an X around the axle hub at (4, 1, 11).
  // Blade 1 (up-left)
  put(3, 0, 10, P.WOOD_L);
  put(3, 0, 11, P.WOOD_L);
  put(3, 0, 12, P.WOOD_L);
  put(2, 0, 10, P.WOOD_M);
  put(2, 0, 13, P.WOOD_M);
  // Blade 2 (up-right)
  put(5, 0, 10, P.WOOD_L);
  put(5, 0, 11, P.WOOD_L);
  put(5, 0, 12, P.WOOD_L);
  put(6, 0, 10, P.WOOD_M);
  put(6, 0, 13, P.WOOD_M);
  // Blade 3 (down-left)
  put(3, 0, 9, P.WOOD_L);
  put(2, 0, 8, P.WOOD_M);
  // Blade 4 (down-right)
  put(5, 0, 9, P.WOOD_L);
  put(6, 0, 8, P.WOOD_M);
  // Hub
  put(4, 0, 11, P.IRON);

  return out;
}
