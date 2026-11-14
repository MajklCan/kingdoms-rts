/**
 * Population cap and queued population accounting.
 */

import { hasComponent } from 'bitecs';
import { Building, ConstructionSite, Owner, ResourceWorksite } from '../components';
import { BUILDING_TABLE, BuildingDefId, UnitDefId, getUnitDef } from '../defs';
import { TechId, hasTech } from '../tech-tree';
import { POP_CAP_HARD_LIMIT } from './constants';
import { sortedEids } from './entities';
import { buildingQuery } from './queries';
import type { SimWorld } from './types';

export function getHousePopProvided(world: SimWorld, playerId: number): number {
  if (hasTech(world, playerId, TechId.HOUSING_II)) return 8;
  if (hasTech(world, playerId, TechId.HOUSING_I)) return 5;
  return BUILDING_TABLE[BuildingDefId.HOUSE].popProvided;
}

export function getBuildingPopProvided(
  world: SimWorld,
  playerId: number,
  defId: number
): number {
  if (defId === BuildingDefId.HOUSE) return getHousePopProvided(world, playerId);
  return BUILDING_TABLE[defId]?.popProvided ?? 0;
}

export function recalculatePlayerPopCap(world: SimWorld, playerId: number): void {
  const pop = world.population[playerId];
  if (!pop) return;
  let cap = 0;
  for (const eid of sortedEids(world, buildingQuery(world.ecs))) {
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    cap += getBuildingPopProvided(world, playerId, Building.defId[eid]);
  }
  pop.cap = Math.min(POP_CAP_HARD_LIMIT, cap);
}

export function countQueuedPopCost(world: SimWorld, playerId: number): number {
  let total = 0;
  for (const [producerEid, queue] of world.productionQueues) {
    if (!hasComponent(world.ecs, Owner, producerEid)) continue;
    if (Owner.player[producerEid] !== playerId) continue;
    for (const defId of queue) {
      if (defId === UnitDefId.VILLAGER && hasComponent(world.ecs, ResourceWorksite, producerEid)) {
        continue;
      }
      const def = getUnitDef(defId);
      total += def?.popCost ?? 0;
    }
  }
  return total;
}

/**
 * Houses a player may raise before the Barracks tech: enough to grow the
 * Dark Age economy past the town center's cap. The Barracks tech lifts it.
 */
export const EARLY_HOUSE_ALLOWANCE = 4;

/** Own houses, finished or under construction. */
export function countOwnHouses(world: SimWorld, playerId: number): number {
  let n = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Building.defId[eid] === BuildingDefId.HOUSE) n++;
  }
  return n;
}

/** Houses the player may still start, or null when there is no limit. */
export function remainingHouseAllowance(world: SimWorld, playerId: number): number | null {
  if (hasTech(world, playerId, TechId.BARRACKS_PIKEMEN)) return null;
  return Math.max(0, EARLY_HOUSE_ALLOWANCE - countOwnHouses(world, playerId));
}

/** True when `defId` is a house and the early allowance is used up. */
export function houseLimitReached(world: SimWorld, playerId: number, defId: number): boolean {
  if (defId !== BuildingDefId.HOUSE) return false;
  return remainingHouseAllowance(world, playerId) === 0;
}

export function countPendingPopCap(world: SimWorld, playerId: number): number {
  let total = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (!hasComponent(world.ecs, ConstructionSite, eid)) continue;
    total += getBuildingPopProvided(world, playerId, Building.defId[eid]);
  }
  return total;
}
