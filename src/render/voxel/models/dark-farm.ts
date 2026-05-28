/**
 * Dark Age farm - a low 2 by 2 crop plot with tilled rows, wheat patches,
 * and a simple timber border. It intentionally reads as land being worked,
 * not a mill building.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkFarmVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, c);
  };

  // Tilled square.
  for (let x = 0; x <= 15; x++) {
    for (let y = 0; y <= 15; y++) {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      if (border) {
        put(x, y, 0, P.WOOD_D);
      } else {
        const row = y % 4;
        put(x, y, 0, row === 0 ? P.DIRT_D : row === 1 ? P.DIRT_M : P.DIRT_L);
      }
    }
  }

  // Crop rows: mixed green shoots and ripe wheat heads.
  for (const y of [3, 6, 9, 12]) {
    for (let x = 2; x <= 13; x += 2) {
      const ripe = (x + y) % 3 === 0;
      put(x, y, 1, ripe ? P.THATCH_M : P.GRASS_L);
      put(x, y, 2, ripe ? P.THATCH_L : P.GRASS_M);
      if (ripe) put(x, y, 3, P.THATCH_L);
    }
  }

  // Low fence posts and a small hay stack for scale.
  for (const [x, y] of [
    [0, 0], [5, 0], [10, 0], [15, 0],
    [0, 5], [15, 5], [0, 10], [15, 10],
    [0, 15], [5, 15], [10, 15], [15, 15],
  ]) {
    box(x, y, 1, x, y, 3, P.WOOD_M);
  }
  box(11, 2, 1, 13, 4, 2, P.THATCH_M);
  put(12, 3, 3, P.THATCH_L);

  return out;
}
