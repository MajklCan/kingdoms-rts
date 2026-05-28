/**
 * Campaign palisade segment. It uses a square stake cluster so horizontal and
 * vertical wall runs read as connected without sprite rotation support.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export type WallAxis = 'x' | 'y';

export function buildWallVoxels(axis: WallAxis = 'x'): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, color: number) =>
    out.push({ x, y, z, color });
  const box = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    color: number
  ) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, color);
  };

  const along = axis === 'x' ? 'x' : 'y';
  const postHeights = [8, 10, 9, 10, 8];
  const postTones = [P.WOOD_D, P.WOOD_M, P.WOOD_L, P.WOOD_M, P.WOOD_D];
  const centers = [-1, 3, 8, 13, 17];
  const cross = 8;

  if (along === 'x') {
    box(-1, cross, 0, 17, cross, 0, P.DIRT_D);
  } else {
    box(cross, -1, 0, cross, 17, 0, P.DIRT_D);
  }

  centers.forEach((center, i) => {
    const x = along === 'x' ? center : cross;
    const y = along === 'x' ? cross : center;
    const h = postHeights[i];
    const tone = postTones[i];
    box(x, y, 1, x, y, h, tone);
    put(x, y, h + 1, P.WOOD_L);
  });

  if (along === 'x') {
    box(-1, cross, 3, 17, cross, 3, P.WOOD_D);
    box(-1, cross, 6, 17, cross, 6, P.WOOD_M);
    for (const x of centers) {
      put(x, cross, 4, P.LEATHER_D);
      put(x, cross, 7, P.LEATHER);
    }
  } else {
    box(cross, -1, 3, cross, 17, 3, P.WOOD_D);
    box(cross, -1, 6, cross, 17, 6, P.WOOD_M);
    for (const y of centers) {
      put(cross, y, 4, P.LEATHER_D);
      put(cross, y, 7, P.LEATHER);
    }
  }

  return out;
}
