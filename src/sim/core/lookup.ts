/**
 * Spatial lookups over live entities (buildings, resources, units).
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  Health,
  Owner,
  Position,
  Resource,
  type ResourceKind,
  UnitKind,
} from '../components';
import { compareDeterministicEids } from './entities';
import { distToBuildingEdge } from './grid';
import { buildingQuery, positionQuery, resourceQuery, townCenterQuery } from './queries';
import type { SimWorld } from './types';

export function findOwnedTownCenter(world: SimWorld, playerId: number): number | null {
  for (const eid of townCenterQuery(world.ecs)) {
    if (Owner.player[eid] === playerId && Health.hp[eid] > 0) return eid;
  }
  return null;
}

export function hasMapFeatureAt(world: SimWorld, x: number, y: number, radius: number): boolean {
  for (const feature of world.map.features) {
    if (Math.hypot(feature.x - x, feature.y - y) <= radius) return true;
  }
  return false;
}

/**
 * Nearest-wins with exact ties going to the lower deterministic key: the
 * same pick as scanning in sortedEids order with a strict `<`, but without
 * sorting every node on every call (these lookups run per candidate tile).
 */
function isCloser(
  world: SimWorld,
  d: number,
  eid: number,
  bestDist: number,
  bestEid: number | null
): boolean {
  if (d < bestDist) return true;
  return d === bestDist && bestEid !== null && compareDeterministicEids(world, eid, bestEid) < 0;
}

/** Find the building entity (any) at or near (x, y). Used for placement checks. */
export function findBuildingAt(
  world: SimWorld,
  x: number,
  y: number,
  radius = 0.7
): number | null {
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of buildingQuery(world.ecs)) {
    const d = distToBuildingEdge(world, x, y, eid);
    if (isCloser(world, d, eid, bestDist, bestEid)) {
      bestDist = d;
      bestEid = eid;
    }
  }
  return bestEid;
}

/** Find the resource entity at exactly (or near) tile (x, y). */
export function findResourceAt(
  world: SimWorld,
  x: number,
  y: number,
  radius = 0.6
): number | null {
  let bestEid: number | null = null;
  let bestDist = radius;
  const px = Position.x;
  const py = Position.y;
  for (const eid of resourceQuery(world.ecs)) {
    const dx = px[eid] - x;
    if (dx > bestDist || dx < -bestDist) continue;
    const dy = py[eid] - y;
    if (dy > bestDist || dy < -bestDist) continue;
    const d = Math.hypot(dx, dy);
    if (isCloser(world, d, eid, bestDist, bestEid)) {
      bestDist = d;
      bestEid = eid;
    }
  }
  return bestEid;
}

/** Nearest resource of `kind` to (x, y) within `maxRange` tiles. */
export function findNearestResource(
  world: SimWorld,
  x: number,
  y: number,
  kind: ResourceKind,
  maxRange: number
): number | null {
  let bestEid: number | null = null;
  let bestDist = maxRange;
  // Hot (every worksite, every tick, over every node): arrays through locals,
  // and a node further than the best along one axis cannot be closer.
  const kinds = Resource.kind;
  const amounts = Resource.amount;
  const px = Position.x;
  const py = Position.y;
  for (const eid of resourceQuery(world.ecs)) {
    if (kinds[eid] !== kind) continue;
    if (amounts[eid] <= 0) continue;
    const dx = px[eid] - x;
    if (dx > bestDist || dx < -bestDist) continue;
    const dy = py[eid] - y;
    if (dy > bestDist || dy < -bestDist) continue;
    const d = Math.hypot(dx, dy);
    if (isCloser(world, d, eid, bestDist, bestEid)) {
      bestDist = d;
      bestEid = eid;
    }
  }
  return bestEid;
}

export function findEntityNear(
  world: SimWorld,
  x: number,
  y: number,
  radius: number
): number | null {
  const ents = positionQuery(world.ecs);
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const isUnit = hasComponent(world.ecs, UnitKind, eid);
    const isBuilding = hasComponent(world.ecs, Building, eid);
    if (!isUnit && !isBuilding) continue;
    const d = isBuilding
      ? distToBuildingEdge(world, x, y, eid)
      : Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
    const effective = isUnit ? d : d + 0.02;
    if (effective < bestDist) {
      bestDist = effective;
      bestEid = eid;
    }
  }
  return bestEid;
}

/** Lookup helper for render - does this eid belong to an enemy of `myPlayer`? */
export function isEnemyOf(
  world: SimWorld,
  eid: number,
  myPlayer: number
): boolean {
  if (!hasComponent(world.ecs, Owner, eid)) return false;
  const p = Owner.player[eid];
  if (p === 0) return false; // gaia is neutral
  return p !== myPlayer;
}
