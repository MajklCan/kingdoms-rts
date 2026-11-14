/**
 * AI unit queueing and building placement scoring.
 */

import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  Building,
  Health,
  Owner,
  Position,
  type ResourceKind,
  ResourceKindId,
  ResourceWorksite,
  UnitKind,
} from '../components';
import {
  AgeId,
  type BuildingDef,
  BuildingDefId,
  UnitDefId,
  canAfford,
  getBuildingDef,
  getUnitDef,
} from '../defs';
import type { GridPos } from '../pathfinding';
import { isBuildingUnlocked, isUnitUnlocked } from '../tech-tree';
import { distToBuildingEdge } from '../core/grid';
import { ResourceProbe } from '../core/placement-probe';
import { sortedEids } from '../core/entities';
import { countQueuedPopCost } from '../core/population';
import { buildingQuery, positionQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { canPlaceBuildingAt } from '../input/buildings';
import { currentAiThinkScope } from './context';
import { activeAiActuator } from './direct-actuator';
import {
  countQueuedWorksiteWorkers,
  countWorksiteWorkers,
  getWorksiteWorkerSlots,
  worksiteUsesResourceNodes,
} from '../systems/worksites';

export function aiQueueUnit(world: SimWorld, atEid: number, defId: number): boolean {
  const unitDef = getUnitDef(defId);
  if (!unitDef) return false;
  if (!hasComponent(world.ecs, Building, atEid)) return false;
  const producerDef = getBuildingDef(Building.defId[atEid]);
  if (!producerDef) return false;
  const playerId = Owner.player[atEid];
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, unitDef.cost)) return false;
  const queue = world.productionQueues.get(atEid) ?? [];
  // Don't pile up queue.
  if (queue.length >= 2) return false;

  if (defId === UnitDefId.VILLAGER && hasComponent(world.ecs, ResourceWorksite, atEid)) {
    const slots = getWorksiteWorkerSlots(world, atEid);
    const occupied = countWorksiteWorkers(world, atEid) + countQueuedWorksiteWorkers(world, atEid);
    if (occupied >= slots) return false;
    activeAiActuator().commitQueueUnit(world, atEid, defId);
    return true;
  }

  if (!producerDef.trains.includes(unitDef.id)) return false;
  if (!isUnitUnlocked(world, playerId, defId)) return false;
  const reserve = currentAiThinkScope()?.reserve;
  if (
    reserve &&
    ((unitDef.cost.gold > 0 && bank[ResourceKindId.GOLD] - unitDef.cost.gold < reserve.gold) ||
      (unitDef.cost.stone > 0 && bank[ResourceKindId.STONE] - unitDef.cost.stone < reserve.stone))
  ) {
    return false;
  }
  if (
    defId === UnitDefId.SCOUT_CAVALRY &&
    (world.ages[playerId]?.current ?? AgeId.DARK) < AgeId.CASTLE
  ) {
    return false;
  }
  const pop = world.population[playerId];
  if (!pop) return false;
  if (pop.current + countQueuedPopCost(world, playerId) + unitDef.popCost > pop.cap) return false;
  activeAiActuator().commitQueueUnit(world, atEid, defId);
  return true;
}

export function aiPlaceBuilding(
  world: SimWorld,
  defId: number,
  nearX: number,
  nearY: number,
  playerId: number
): boolean {
  const def = getBuildingDef(defId);
  if (!def) return false;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, def.cost)) return false;
  if (!isBuildingUnlocked(world, playerId, defId)) return false;
  if (
    defId === BuildingDefId.STABLE &&
    (world.ages[playerId]?.current ?? AgeId.DARK) < AgeId.CASTLE
  ) {
    return false;
  }
  const spot = aiFindBuildingSpot(world, defId, def, nearX, nearY, playerId);
  if (!spot) return false;
  activeAiActuator().commitPlaceBuilding(world, defId, spot.x, spot.y, playerId);
  return true;
}

function aiFindBuildingSpot(
  world: SimWorld,
  defId: number,
  def: BuildingDef,
  nearX: number,
  nearY: number,
  playerId: number
): GridPos | null {
  const cx = Math.round(nearX);
  const cy = Math.round(nearY);
  const maxR = aiBuildingPlacementSearchRadius(def);
  // Nothing changes while we scan, so index resources and enemies once
  // instead of rescanning every entity for each candidate spot.
  const probe = new ResourceProbe(world);
  const enemies = aiEnemyPoints(world, playerId);
  const actuator = activeAiActuator();
  let bestSpot: GridPos | null = null;
  let bestScore = Infinity;
  for (let r = 2; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (!canPlaceBuildingAt(world, def, x, y, probe)) continue;
        if (actuator.isSpotClaimed(defId, x, y)) continue;
        if (hasPointNear(enemies, x, y, 8)) continue;
        const score = aiBuildingPlacementScore(world, def, x, y, nearX, nearY, playerId, probe);
        if (score < bestScore) {
          bestScore = score;
          bestSpot = { x, y };
        }
      }
    }
  }
  return bestSpot;
}

function aiBuildingPlacementScore(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number,
  baseX: number,
  baseY: number,
  playerId: number,
  probe: ResourceProbe
): number {
  const baseDist = Math.hypot(x - baseX, y - baseY);
  const spacingPenalty = aiOwnedBuildingSpacingPenalty(world, def, x, y, playerId);
  if (worksiteUsesResourceNodes(def)) {
    const radius = def.harvestRadius ?? 6;
    const resourceDist = probe.nearestDistance(x, y, def.harvestKind as ResourceKind, radius) ?? radius;
    return resourceDist * 5 + baseDist * 0.08 + spacingPenalty;
  }
  if (def.id === 'FARM') {
    return aiPreferredBaseDistanceScore(baseDist, 7) +
      aiNearestOwnedBuildingTypeDistance(world, x, y, playerId, BuildingDefId.FARM) * 0.2 +
      spacingPenalty;
  }
  if (def.id === 'MILL') {
    return aiPreferredBaseDistanceScore(baseDist, 8) +
      aiNearestOwnedBuildingTypeDistance(world, x, y, playerId, BuildingDefId.FARM) * 1.8 +
      spacingPenalty;
  }
  if (def.id === 'DEFENSIVE_TOWER') {
    return aiPreferredBaseDistanceScore(baseDist, 11) + spacingPenalty;
  }
  if (def.trains.length > 0) {
    return aiPreferredBaseDistanceScore(baseDist, 9) + spacingPenalty;
  }
  if (def.id === 'HOUSE') {
    return aiPreferredBaseDistanceScore(baseDist, 8) + spacingPenalty;
  }
  return aiPreferredBaseDistanceScore(baseDist, 7) + spacingPenalty;
}

function aiPreferredBaseDistanceScore(distance: number, preferred: number): number {
  const tooClosePenalty = distance < 4 ? (4 - distance) * (4 - distance) * 5 : 0;
  return Math.abs(distance - preferred) * 0.75 + tooClosePenalty;
}

function aiOwnedBuildingSpacingPenalty(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number,
  playerId: number
): number {
  const desiredGap = aiDesiredBuildingGap(def);
  let penalty = 0;
  // NetId order: a float sum in query order can differ in the last bit after a load.
  for (const eid of sortedEids(world, buildingQuery(world.ecs))) {
    if (Owner.player[eid] !== playerId) continue;
    if (Health.hp[eid] <= 0) continue;
    const edgeDist = distToBuildingEdge(world, x, y, eid);
    if (edgeDist >= desiredGap) continue;
    const deficit = desiredGap - edgeDist;
    penalty += deficit * deficit * 8;
  }
  return penalty;
}

function aiDesiredBuildingGap(def: BuildingDef): number {
  if (worksiteUsesResourceNodes(def)) return 1.8;
  if (def.id === 'FARM') return 2.1;
  if (def.id === 'MILL') return 2.4;
  if (def.id === 'HOUSE') return 1.7;
  if (def.id === 'DEFENSIVE_TOWER') return 3.2;
  if (def.trains.length > 0) return 2.8;
  return 2.2;
}

function aiNearestOwnedBuildingTypeDistance(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number,
  defId: number
): number {
  let best = 20;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Building.defId[eid] !== defId) continue;
    if (Health.hp[eid] <= 0) continue;
    best = Math.min(best, distToBuildingEdge(world, x, y, eid));
  }
  return best;
}

function aiBuildingPlacementSearchRadius(def: BuildingDef): number {
  if (def.id === 'FARM') return 24;
  if (def.id === 'MILL') return 20;
  if (def.id === 'LUMBER_CAMP') return 52;
  if (worksiteUsesResourceNodes(def)) return 34;
  return 12;
}

/** Live enemy units and buildings, as points (what hasEnemyEntityNear scans). */
function aiEnemyPoints(world: SimWorld, playerId: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const eid of positionQuery(world.ecs)) {
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] === playerId || Owner.player[eid] === 0) continue;
    if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
    if (!hasComponent(world.ecs, UnitKind, eid) && !hasComponent(world.ecs, Building, eid)) continue;
    out.push({ x: Position.x[eid], y: Position.y[eid] });
  }
  return out;
}

/** Same test as hasEnemyEntityNear over a precomputed point list. */
function hasPointNear(points: ReadonlyArray<{ x: number; y: number }>, x: number, y: number, radius: number): boolean {
  for (const p of points) {
    if (Math.hypot(p.x - x, p.y - y) < radius) return true;
  }
  return false;
}
