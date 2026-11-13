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
import { compareDeterministicEids, sortedEids } from './entities';
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

/** Find the building entity (any) at or near (x, y). Used for placement checks. */
export function findBuildingAt(
  world: SimWorld,
  x: number,
  y: number,
  radius = 0.7
): number | null {
  const ents = sortedEids(world, buildingQuery(world.ecs));
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const d = distToBuildingEdge(world, x, y, eid);
    if (
      d < bestDist ||
      (bestEid !== null && Math.abs(d - bestDist) < 0.000001 &&
        compareDeterministicEids(world, eid, bestEid) < 0)
    ) {
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
  const ents = sortedEids(world, resourceQuery(world.ecs));
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const d = Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
    if (
      d < bestDist ||
      (bestEid !== null && Math.abs(d - bestDist) < 0.000001 &&
        compareDeterministicEids(world, eid, bestEid) < 0)
    ) {
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
  const ents = sortedEids(world, resourceQuery(world.ecs));
  let bestEid: number | null = null;
  let bestDist = maxRange;
  for (const eid of ents) {
    if (Resource.kind[eid] !== kind) continue;
    if (Resource.amount[eid] <= 0) continue;
    const d = Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
    if (
      d < bestDist ||
      (bestEid !== null && Math.abs(d - bestDist) < 0.000001 &&
        compareDeterministicEids(world, eid, bestEid) < 0)
    ) {
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

/** Lookup helper for render — does this eid belong to an enemy of `myPlayer`? */
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
