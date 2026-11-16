/**
 * Read-only economy queries shared by the command layer and the HUD:
 * affordability, population room, producer counts, cost formatting.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Building, Owner, ResourceKindId } from '@sim/components';
import { BuildingDefId, UNIT_TABLE, getUnitDef, type CostTuple } from '@sim/defs';
import {
  BUILDING_UNLOCK_TECH,
  UNIT_UNLOCK_TECH,
  hasTech,
  techDef,
  techLockedReason,
  type TechIdValue,
} from '@sim/tech-tree';
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
      // Worksite crews count too: they take a population place.
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

/**
 * Why `techId` cannot be researched yet, as text ("Ring II opens when 2 paths
 * are complete in ring I (1 of 2). Needs Bowyers"), or null when it can.
 */
export function missingResearchText(world: SimWorld, playerId: number, techId: TechIdValue): string | null {
  return techLockedReason(world, playerId, techId) ?? null;
}

/**
 * Locked behind research: the research that unlocks building `defId` (or
 * unit `unitDefId`) and what still stands before it, for a disabled button.
 * Null when it is unlocked, or when its research is shut for this mission.
 */
export function unlockResearchFor(
  world: SimWorld,
  playerId: number,
  kind: 'building' | 'unit',
  defId: number
): { techId: TechIdValue; text: string } | null {
  const techId = kind === 'building' ? BUILDING_UNLOCK_TECH[defId] : UNIT_UNLOCK_TECH[defId];
  if (!techId || hasTech(world, playerId, techId)) return null;
  if (world.campaign?.lockedTechs.includes(techId)) return null;
  const name = techDef(techId)?.name ?? techId;
  const missing = techLockedReason(world, playerId, techId);
  return {
    techId,
    text: missing
      ? `Needs the ${name} research. ${missing}. Click to open it in Technology.`
      : `Needs the ${name} research. Click to open it in Technology.`,
  };
}
