/**
 * Read-only economy queries shared by the command layer and the HUD:
 * affordability, population room, producer counts, cost formatting.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Building, Owner, ResourceKindId, ResourceWorksite } from '@sim/components';
import { AgeId, BuildingDefId, UNIT_TABLE, UnitDefId, getUnitDef, type CostTuple } from '@sim/defs';
import { TechId, type TechIdValue } from '@sim/tech-tree';
import { buildingQuery, type SimWorld } from '@sim/world';

export interface Cost {
  food: number;
  wood: number;
  gold: number;
  stone: number;
}

export function canAffordCost(world: SimWorld, playerId: number, cost: Cost): boolean {
  const bank = world.resources[playerId];
  return Boolean(
    bank &&
    bank[ResourceKindId.FOOD] >= cost.food &&
    bank[ResourceKindId.WOOD] >= cost.wood &&
    bank[ResourceKindId.GOLD] >= cost.gold &&
    bank[ResourceKindId.STONE] >= cost.stone
  );
}

export function affordableCountForCost(
  world: SimWorld,
  playerId: number,
  cost: CostTuple,
  requestedCount: number
): number {
  const bank = world.resources[playerId];
  if (!bank) return 0;
  let count = Math.max(0, Math.trunc(requestedCount));
  if (cost.food > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.FOOD] / cost.food));
  if (cost.wood > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.WOOD] / cost.wood));
  if (cost.gold > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.GOLD] / cost.gold));
  if (cost.stone > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.STONE] / cost.stone));
  return count;
}

export function formatCost(cost: Cost): string {
  const parts: string[] = [];
  if (cost.food) parts.push(`${cost.food} food`);
  if (cost.wood) parts.push(`${cost.wood} wood`);
  if (cost.gold) parts.push(`${cost.gold} gold`);
  if (cost.stone) parts.push(`${cost.stone} stone`);
  return parts.join(' ');
}

export function formatTrainTime(ticks: number): string {
  return `${Math.ceil(ticks / SIM.TICK_HZ)}s`;
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
      total += getUnitDef(defId)?.popCost ?? 0;
    }
  }
  return total;
}

export function hasPopulationRoomForUnit(world: SimWorld, playerId: number, unitDefId: number): boolean {
  const unit = UNIT_TABLE[unitDefId];
  const pop = world.population[playerId];
  if (!unit || !pop) return false;
  return pop.current + countQueuedPopCost(world, playerId) + unit.popCost <= pop.cap;
}

export function populationRoomForUnitCount(
  world: SimWorld,
  playerId: number,
  unitDefId: number,
  requestedCount: number
): number {
  const unit = UNIT_TABLE[unitDefId];
  const pop = world.population[playerId];
  if (!unit || !pop) return 0;
  if (unit.popCost <= 0) return Math.max(0, Math.trunc(requestedCount));
  const room = pop.cap - pop.current - countQueuedPopCost(world, playerId);
  return Math.max(0, Math.min(Math.trunc(requestedCount), Math.floor(room / unit.popCost)));
}

export function isArmyProducerDefId(defId: number): boolean {
  return defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.ARCHERY_RANGE ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY;
}

export function countOwnedArmyProducers(world: SimWorld, playerId: number): number {
  let count = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (isArmyProducerDefId(Building.defId[eid])) count++;
  }
  return count;
}

/** Tech that advances `playerId` to the next reachable age, or null at the cap. */
export function nextAgeTechId(world: SimWorld, playerId: number): TechIdValue | null {
  const current = world.ages[playerId]?.current ?? AgeId.DARK;
  if (current === AgeId.DARK) return TechId.CASTLE_AGE;
  if (current === AgeId.CASTLE) return TechId.GUNPOWDER_AGE;
  return null;
}
