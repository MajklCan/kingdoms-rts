/**
 * Isometric coordinate transforms. Tile (0,0) is at world center. Tiles use a
 * 2:1 diamond projection (TILE_W=64, TILE_H=32).
 */

import { ISO } from '../config';

export interface ScreenPos {
  x: number;
  y: number;
}

export interface TilePos {
  x: number;
  y: number;
}

/** Tile coords (can be fractional) -> screen coords (origin at world center). */
export function tileToScreen(tileX: number, tileY: number): ScreenPos {
  return {
    x: (tileX - tileY) * (ISO.TILE_W / 2),
    y: (tileX + tileY) * (ISO.TILE_H / 2),
  };
}

/** Screen coords (origin at world center) -> tile coords (fractional). */
export function screenToTile(screenX: number, screenY: number): TilePos {
  const halfW = ISO.TILE_W / 2;
  const halfH = ISO.TILE_H / 2;
  return {
    x: (screenX / halfW + screenY / halfH) / 2,
    y: (screenY / halfH - screenX / halfW) / 2,
  };
}
