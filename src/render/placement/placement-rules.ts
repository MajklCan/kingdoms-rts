/**
 * Read-only placement checks the build ghost uses to colour itself: free
 * footprint, nearby resource for worksites. The sim re-validates every
 * placement; these only predict what it will say.
 */

import { MAP } from '../../config';
import { Building, Position, Resource } from '@sim/components';
import { BUILDING_TABLE, type BuildingDef } from '@sim/defs';
import { buildingQuery, findResourceAt, resourceQuery, type SimWorld } from '@sim/world';

export function isBuildFootprintBlocked(world: SimWorld, def: BuildingDef, x: number, y: number): boolean {
  const x0 = x - Math.floor(def.footprint.w / 2);
  const y0 = y - Math.floor(def.footprint.h / 2);
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return true;
      if (world.map.walkability[ty][tx] !== 0) return true;
      if (findResourceAt(world, tx, ty, 0.6) !== null) return true;
      if (findBuildingNear(world, tx, ty, 0.01) !== null) return true;
    }
  }
  return false;
}

export function hasNearbyResource(world: SimWorld, x: number, y: number, kind: number, radius: number): boolean {
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] !== kind) continue;
    if (Resource.amount[eid] <= 0) continue;
    if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) <= radius) return true;
  }
  return false;
}

/** Closest building whose footprint is within `radius` tiles of (x, y). */
function findBuildingNear(world: SimWorld, x: number, y: number, radius: number): number | null {
  let best: number | null = null;
  let bestDist = radius;
  for (const eid of buildingQuery(world.ecs)) {
    const d = distToBuildingFootprint(x, y, eid);
    if (d < bestDist) {
      bestDist = d;
      best = eid;
    }
  }
  return best;
}

function distToBuildingFootprint(x: number, y: number, eid: number): number {
  const def = BUILDING_TABLE[Building.defId[eid]];
  if (!def) return Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
  const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
  const minX = x0 - 0.5;
  const maxX = x0 + def.footprint.w - 0.5;
  const minY = y0 - 0.5;
  const maxY = y0 + def.footprint.h - 0.5;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}
