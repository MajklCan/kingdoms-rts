/**
 * Dark Age barracks — long rectangular wooden palisade structure with a
 * single-pitch roof, twin doors, training pels (wooden practice posts)
 * visible alongside, and a stone foundation. A weapons rack along one wall.
 *
 * Footprint: 18×12. Height: ~12 voxels.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkBarracksVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };
  // Dirt apron (this is a martial yard, not grass)
  for (let x = 0; x <= 19; x++)
    for (let y = 0; y <= 13; y++) {
      if (x < 2 || x > 17 || y < 2 || y > 11) {
        put(x, y, 0, (x + y) % 3 === 0 ? P.DIRT_D : P.DIRT_M);
      }
    }

  // Stone foundation
  box(2, 2, 0, 17, 11, 0, P.STONE_BASE);

  // Wooden palisade walls — vertical log construction. Alternate light/medium
  // wood per voxel column for a planked look.
  for (let z = 1; z <= 7; z++) {
    for (let x = 2; x <= 17; x++) {
      const tone = (x % 2 === 0) ? P.WOOD_L : P.WOOD_M;
      put(x, 2, z, tone);
      put(x, 11, z, tone);
    }
    for (let y = 3; y <= 10; y++) {
      const tone = (y % 2 === 0) ? P.WOOD_L : P.WOOD_M;
      put(2, y, z, tone);
      put(17, y, z, tone);
    }
  }
  // Stone corner reinforcements
  for (let z = 1; z <= 7; z++) {
    put(2, 2, z, P.STONE_M);
    put(17, 2, z, P.STONE_M);
    put(2, 11, z, P.STONE_M);
    put(17, 11, z, P.STONE_M);
  }
  // Eaves
  for (let x = 1; x <= 18; x++) {
    put(x, 1, 7, P.WOOD_D);
    put(x, 12, 7, P.WOOD_D);
  }
  for (let y = 1; y <= 12; y++) {
    put(1, y, 7, P.WOOD_D);
    put(18, y, 7, P.WOOD_D);
  }

  // Twin doors on south face (wide enough for soldiers to march out in pairs)
  for (let z = 1; z <= 5; z++) {
    put(6, 2, z, P.WOOD_DOOR);
    put(7, 2, z, P.WOOD_DOOR);
    put(12, 2, z, P.WOOD_DOOR);
    put(13, 2, z, P.WOOD_DOOR);
  }
  put(6, 2, 3, P.IRON);
  put(13, 2, 3, P.IRON);

  // Roof — single pitch sloping north. Terracotta tiles (military buildings get tile, not thatch).
  const tileTone = (i: number) =>
    i % 3 === 0 ? P.ROOF_L : i % 3 === 1 ? P.ROOF_M : P.ROOF_D;
  for (let x = 2; x <= 17; x++)
    for (let y = 2; y <= 11; y++) put(x, y, 8, tileTone(x + y));
  for (let x = 3; x <= 16; x++)
    for (let y = 3; y <= 10; y++) put(x, y, 9, tileTone(x + y + 1));
  for (let x = 4; x <= 15; x++)
    for (let y = 4; y <= 9; y++) put(x, y, 10, P.ROOF_D);
  for (let x = 6; x <= 13; x++)
    for (let y = 5; y <= 8; y++) put(x, y, 11, P.ROOF_RIDGE);

  // Training pels (3 wooden posts in the south-front yard)
  for (const px of [3, 9, 15]) {
    put(px, 0, 1, P.WOOD_M);
    put(px, 0, 2, P.WOOD_M);
    put(px, 0, 3, P.WOOD_D);
  }

  // Weapons rack along the east wall — visible spears
  for (const z of [3, 4]) {
    put(18, 5, z, P.WOOD_D);
    put(18, 6, z, P.WOOD_D);
    put(18, 7, z, P.WOOD_D);
    put(18, 8, z, P.WOOD_D);
  }
  // Spear shafts
  for (let z = 4; z <= 6; z++) {
    put(18, 5, z, P.WOOD_L);
    put(18, 7, z, P.WOOD_L);
  }
  // Spear tips
  put(18, 5, 7, P.STEEL);
  put(18, 7, 7, P.STEEL);

  return out;
}
