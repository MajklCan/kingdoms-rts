/**
 * Elevation-aware tile <-> screen projection. Screen coordinates here are
 * local to the world container (tile 0,0 at the origin); add the container
 * offset to get camera world coordinates.
 */

import { ISO, MAP } from '../config';
import { Building, Position } from '@sim/components';
import { BUILDING_TABLE, type BuildingDef } from '@sim/defs';
import type { SimWorld } from '@sim/world';
import { screenToTile, tileToScreen, type ScreenPos } from './iso';

/** Elevation at integer tile (tx, ty); 3 (default ground) if out of bounds. */
export function elevationAt(world: SimWorld, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return 3;
  return world.map.elevation[ty * MAP.WIDTH + tx];
}

/**
 * Tile -> screen WITH terrain elevation applied. Everything drawn on a tile
 * must use this rather than raw `tileToScreen` so it sits on the visible
 * terrain. Fractional tiles are fine; elevation is sampled at the rounded tile.
 */
export function tileToScreenElev(world: SimWorld, tileX: number, tileY: number): ScreenPos {
  const c = tileToScreen(tileX, tileY);
  const e = elevationAt(world, Math.round(tileX), Math.round(tileY));
  return { x: c.x, y: c.y - e * ISO.VPER };
}

/** Visual anchor tile of a building footprint (even footprints sit between tiles). */
export function buildingAnchorTileForDef(
  def: BuildingDef,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: x - (def.footprint.w % 2 === 0 ? 0.5 : 0),
    y: y - (def.footprint.h % 2 === 0 ? 0.5 : 0),
  };
}

export function buildingAnchorTile(eid: number): { x: number; y: number } {
  const def = BUILDING_TABLE[Building.defId[eid]];
  if (!def) return { x: Position.x[eid], y: Position.y[eid] };
  return buildingAnchorTileForDef(def, Position.x[eid], Position.y[eid]);
}

export function buildingScreenPosition(world: SimWorld, eid: number): ScreenPos {
  const anchor = buildingAnchorTile(eid);
  return tileToScreenElev(world, anchor.x, anchor.y);
}

export interface SelectionEllipse {
  yOffset: number;
  width: number;
  height: number;
}

export const UNIT_SELECTION_ELLIPSE: SelectionEllipse = { yOffset: 2, width: 20, height: 8 };

export function buildingSelectionEllipse(defId: number): SelectionEllipse {
  const def = BUILDING_TABLE[defId];
  if (!def) return { yOffset: 6, width: 60, height: 16 };
  return {
    yOffset: 6,
    width: Math.max(54, def.footprint.w * ISO.TILE_W * 0.68),
    height: Math.max(16, def.footprint.h * ISO.TILE_H * 0.45),
  };
}

export interface PickedTile {
  /** Rounded tile under the point. */
  tx: number;
  ty: number;
  /** Fractional tile coords (sub-tile picking). */
  tileX: number;
  tileY: number;
}

/**
 * Container-local screen point -> tile, compensating for the elevation of the
 * tile under the point: the terrain bake lifts each tile by `elev * VPER`, so
 * one elevation lookup + re-projection lands on the visible tile.
 */
export function screenToTileElev(world: SimWorld, localX: number, localY: number): PickedTile {
  let tile = screenToTile(localX, localY);
  let tx = Math.round(tile.x);
  let ty = Math.round(tile.y);
  const e = elevationAt(world, tx, ty);
  if (e !== 0) {
    tile = screenToTile(localX, localY + e * ISO.VPER);
    tx = Math.round(tile.x);
    ty = Math.round(tile.y);
  }
  return { tx, ty, tileX: tile.x, tileY: tile.y };
}

export function isInsideMap(tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < MAP.WIDTH && ty < MAP.HEIGHT;
}
