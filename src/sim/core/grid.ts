/**
 * Walkability grid occupancy and building footprint geometry.
 */

import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import { Building, Gatherer, Position, WorksiteWorker } from '../components';
import { BUILDING_TABLE, type BuildingDef, BuildingDefId } from '../defs';
import type { GridPos } from '../pathfinding';
import { FARM_WORK_EDGE_DISTANCE, isTileInMap } from '../world';
import type { SimWorld } from './types';

/** Distance from (fromX, fromY) to the EDGE of the building's occupied tile
 *  rectangle. Returns 0 inside the footprint. This mirrors markFootprintBlocked,
 *  including its even-footprint convention where a 2×2 building at (x,y)
 *  occupies tiles (x-1..x, y-1..y). */
export function distToBuildingEdge(
  world: SimWorld,
  fromX: number,
  fromY: number,
  buildingEid: number
): number {
  if (!hasComponent(world.ecs, Building, buildingEid)) {
    return Math.hypot(
      fromX - Position.x[buildingEid],
      fromY - Position.y[buildingEid]
    );
  }
  const def = BUILDING_TABLE[Building.defId[buildingEid]];
  if (!def) {
    return Math.hypot(
      fromX - Position.x[buildingEid],
      fromY - Position.y[buildingEid]
    );
  }
  const x0 = Math.round(Position.x[buildingEid]) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(Position.y[buildingEid]) - Math.floor(def.footprint.h / 2);
  const minX = x0 - 0.5;
  const maxX = x0 + def.footprint.w - 0.5;
  const minY = y0 - 0.5;
  const maxY = y0 + def.footprint.h - 0.5;
  const dx = fromX < minX ? minX - fromX : fromX > maxX ? fromX - maxX : 0;
  const dy = fromY < minY ? minY - fromY : fromY > maxY ? fromY - maxY : 0;
  return Math.hypot(dx, dy);
}

/** Find a walkable tile near (cx, cy) for spawning units. Searches outward
 *  in concentric rings up to maxR. Returns the requested tile if walkable,
 *  the nearest walkable otherwise, or null if nothing within range. */
export function findSpawnSpot(
  world: SimWorld,
  cx: number,
  cy: number,
  maxR = 5
): { x: number; y: number } | null {
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  if (
    ix >= 0 && iy >= 0 && ix < MAP.WIDTH && iy < MAP.HEIGHT &&
    world.map.walkability[iy][ix] === 0
  ) {
    return { x: ix, y: iy };
  }
  return world.pathfinder.nearestWalkable(
    Math.max(0, Math.min(MAP.WIDTH - 1, ix)),
    Math.max(0, Math.min(MAP.HEIGHT - 1, iy)),
    maxR
  );
}

/** Mark / unmark a tile as blocked in the walkability grid. Mutating the
 *  array also updates EasyStar (same array reference). */
function markTileBlocked(world: SimWorld, x: number, y: number, blocked: boolean): void {
  const ix = Math.round(x), iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= MAP.WIDTH || iy >= MAP.HEIGHT) return;
  world.map.walkability[iy][ix] = blocked ? 1 : 0;
}

/** Mark / unmark a building's full footprint in the walkability grid.
 *  Footprint is centred on (cx, cy). For even widths the extra tile is to
 *  the south/east. Buildings with a 3×3 footprint block 9 tiles total. */
export function markFootprintBlocked(
  world: SimWorld,
  cx: number,
  cy: number,
  fw: number,
  fh: number,
  blocked: boolean
): void {
  const x0 = Math.round(cx) - Math.floor(fw / 2);
  const y0 = Math.round(cy) - Math.floor(fh / 2);
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      markTileBlocked(world, x0 + dx, y0 + dy, blocked);
    }
  }
}

export function canUnitOccupy(world: SimWorld, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
  return world.map.walkability[ty][tx] === 0;
}

export function canUnitSqueezeAlongDiagonalPath(
  world: SimWorld,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  waypoint: GridPos
): boolean {
  if (Math.abs(dirX) < 0.2 || Math.abs(dirY) < 0.2) return false;
  if (!isTileInMap(Math.round(x), Math.round(y))) return false;
  return canUnitOccupy(world, waypoint.x, waypoint.y);
}

export function canUnitOccupyMovementTarget(world: SimWorld, eid: number, x: number, y: number): boolean {
  if (canUnitOccupy(world, x, y)) return true;
  if (!hasComponent(world.ecs, WorksiteWorker, eid)) return false;
  const siteEid = WorksiteWorker.siteEid[eid];
  if (!hasComponent(world.ecs, Building, siteEid)) return false;
  if (Building.defId[siteEid] !== BuildingDefId.FARM) return false;
  if (Gatherer.targetEid[eid] !== siteEid) return false;
  return distToBuildingEdge(world, x, y, siteEid) <= FARM_WORK_EDGE_DISTANCE;
}

export function buildingFootprintRect(
  buildingEid: number,
  def: BuildingDef
): {
  tileX0: number;
  tileY0: number;
  tileX1: number;
  tileY1: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const tileX0 = Math.round(Position.x[buildingEid]) - Math.floor(def.footprint.w / 2);
  const tileY0 = Math.round(Position.y[buildingEid]) - Math.floor(def.footprint.h / 2);
  const tileX1 = tileX0 + def.footprint.w - 1;
  const tileY1 = tileY0 + def.footprint.h - 1;
  return {
    tileX0,
    tileY0,
    tileX1,
    tileY1,
    minX: tileX0 - 0.5,
    maxX: tileX0 + def.footprint.w - 0.5,
    minY: tileY0 - 0.5,
    maxY: tileY0 + def.footprint.h - 0.5,
  };
}
