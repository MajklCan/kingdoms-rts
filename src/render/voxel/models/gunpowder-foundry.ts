/**
 * Gunpowder Age foundry. Clean stone-and-timber military workshop with a
 * furnace, chimney, cooling trough, and cannon parts in the yard.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

const IRON_D = 0x151719;
const IRON_M = 0x34383b;
const GLOW = 0xf06a43;
const FIRE = 0xf4c95a;

export function buildGunpowderFoundryVoxels(): Voxel[] {
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

  // Yard apron.
  for (let x = 0; x <= 20; x++) {
    for (let y = 0; y <= 15; y++) {
      const edge = x < 2 || x > 18 || y < 2 || y > 13;
      if (edge) put(x, y, 0, (x + y) % 3 === 0 ? P.DIRT_M : P.GRASS_M);
    }
  }

  // Stone base and workshop walls.
  box(2, 2, 0, 18, 13, 0, P.STONE_BASE);
  hollow(2, 2, 1, 18, 13, 8, P.STONE_M);
  for (let z = 1; z <= 8; z++) {
    for (const x of [2, 7, 13, 18]) {
      put(x, 2, z, P.STONE_D);
      put(x, 13, z, P.STONE_D);
    }
    put(2, 7, z, P.STONE_D);
    put(18, 7, z, P.STONE_D);
  }

  // Open furnace door on south face.
  box(8, 2, 1, 12, 2, 5, IRON_D);
  box(9, 2, 1, 11, 2, 3, GLOW);
  put(10, 2, 4, FIRE);
  put(7, 2, 3, P.IRON);
  put(13, 2, 3, P.IRON);

  // Roof: dark iron-sheet center with warm stone trim.
  for (let x = 1; x <= 19; x++) {
    for (let y = 1; y <= 14; y++) {
      put(x, y, 9, (x + y) % 2 === 0 ? IRON_M : IRON_D);
    }
  }
  for (let x = 3; x <= 17; x++) {
    for (let y = 3; y <= 12; y++) put(x, y, 10, IRON_M);
  }
  box(6, 5, 11, 14, 9, 11, IRON_D);
  box(1, 1, 9, 19, 1, 10, P.STONE_L);
  box(1, 14, 9, 19, 14, 10, P.STONE_D);

  // Chimney stack and glow.
  box(14, 8, 11, 17, 11, 18, P.STONE_D);
  box(15, 9, 12, 16, 10, 17, IRON_D);
  put(15, 9, 18, P.STEEL);
  put(16, 10, 18, P.STEEL);
  put(15, 10, 16, GLOW);

  // Cooling trough and cannon barrel in the yard.
  box(2, 0, 1, 8, 1, 1, P.WOOD_D);
  box(3, 0, 2, 7, 1, 2, P.WATER_M);
  for (let x = 13; x <= 19; x++) {
    put(x, 0, 1, IRON_D);
    put(x, 1, 1, IRON_M);
  }
  put(19, 0, 2, P.STEEL);
  put(19, 1, 2, P.STEEL);
  box(10, 0, 1, 11, 1, 2, P.WOOD_M);
  box(12, 0, 1, 13, 1, 2, P.WOOD_D);

  // Small gold powder keg marks the gunpowder-tech role.
  box(4, 13, 1, 5, 14, 3, P.WOOD_DOOR);
  put(4, 13, 4, P.GOLD);
  put(5, 14, 4, P.GOLD);

  return out;
}
