/**
 * Defensive tower — compact stone watch tower with crenellations, team banner,
 * arrow slits, and a raised firing platform. Built to read as static defense
 * at normal RTS zoom.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

export function buildDarkDefensiveTowerVoxels(teamColor: number): Voxel[] {
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

  // Stone base and a small dirt service path on the south side.
  for (let x = 0; x <= 12; x++) {
    for (let y = 0; y <= 12; y++) {
      const edge = x < 2 || x > 10 || y < 2 || y > 10;
      if (edge) put(x, y, 0, y < 3 ? P.DIRT_M : P.GRASS_M);
    }
  }
  box(2, 2, 0, 10, 10, 0, P.STONE_BASE);

  // Tapered masonry shaft. Alternating courses give the tower a heavier,
  // fortified look without making the silhouette muddy.
  for (let z = 1; z <= 15; z++) {
    const inset = z < 5 ? 0 : z < 10 ? 1 : 2;
    const x0 = 2 + inset;
    const y0 = 2 + inset;
    const x1 = 10 - inset;
    const y1 = 10 - inset;
    const tone = z % 3 === 0 ? P.STONE_D : z % 3 === 1 ? P.STONE_L : P.STONE_M;
    for (let x = x0; x <= x1; x++) {
      put(x, y0, z, tone);
      put(x, y1, z, tone);
    }
    for (let y = y0 + 1; y <= y1 - 1; y++) {
      put(x0, y, z, tone);
      put(x1, y, z, tone);
    }
  }

  // Door, arrow slits, and team-color shield over the entrance.
  box(5, 2, 1, 7, 2, 4, P.WOOD_DOOR);
  put(6, 2, 3, P.IRON);
  put(6, 2, 5, teamColor);
  for (const z of [7, 11]) {
    put(6, 2, z, P.IRON);
    put(6, 10, z, P.IRON);
    put(2, 6, z, P.IRON);
    put(10, 6, z, P.IRON);
  }

  // Firing platform, crenellations, and corner merlons.
  box(3, 3, 16, 9, 9, 16, P.STONE_BASE);
  for (let x = 2; x <= 10; x += 2) {
    put(x, 2, 17, P.STONE_L);
    put(x, 10, 17, P.STONE_L);
  }
  for (let y = 4; y <= 8; y += 2) {
    put(2, y, 17, P.STONE_L);
    put(10, y, 17, P.STONE_L);
  }
  box(3, 3, 17, 4, 4, 18, P.STONE_M);
  box(8, 3, 17, 9, 4, 18, P.STONE_M);
  box(3, 8, 17, 4, 9, 18, P.STONE_M);
  box(8, 8, 17, 9, 9, 18, P.STONE_M);

  // A small roof cap keeps it distinct from the Town Center's large roofs.
  const tileTone = (i: number) =>
    i % 3 === 0 ? P.ROOF_L : i % 3 === 1 ? P.ROOF_M : P.ROOF_D;
  for (let x = 4; x <= 8; x++)
    for (let y = 4; y <= 8; y++) put(x, y, 19, tileTone(x + y));
  for (let x = 5; x <= 7; x++)
    for (let y = 5; y <= 7; y++) put(x, y, 20, tileTone(x + y + 1));
  put(6, 6, 21, P.ROOF_RIDGE);

  // Banner pole and short flag.
  for (let z = 20; z <= 24; z++) put(6, 6, z, P.WOOD_D);
  put(6, 6, 25, P.GOLD);
  put(7, 6, 23, teamColor);
  put(8, 6, 23, teamColor);
  put(7, 6, 22, teamColor);
  put(8, 6, 22, shade24(teamColor, 0.7));

  return out;
}

function shade24(color: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}
