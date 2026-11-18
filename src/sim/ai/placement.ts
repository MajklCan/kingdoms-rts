/**
 * AI unit queueing and building placement scoring.
 */

import { dhypot } from '../core/dmath';
import { hasComponent } from 'bitecs';
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
  BUILDING_TABLE,
  type BuildingDef,
  BuildingDefId,
  UnitDefId,
  canAfford,
  getBuildingDef,
  getUnitDef,
} from '../defs';
import type { GridPos } from '../pathfinding';
import { isBuildingUnlocked, isUnitUnlocked } from '../tech-tree';
import { PlacementProbe } from '../core/placement-probe';
import { sortedEids } from '../core/entities';
import { unitLimitReached } from '../core/unit-limits';
import { countQueuedPopCost, hasPopulationRoom, houseLimitReached } from '../core/population';
import { buildingQuery, positionQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { isFootprintFree } from '../input/buildings';
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
    if (!hasPopulationRoom(world, playerId, unitDef.popCost)) return false;
    activeAiActuator().commitQueueUnit(world, atEid, defId);
    return true;
  }

  if (!producerDef.trains.includes(unitDef.id)) return false;
  if (!isUnitUnlocked(world, playerId, defId)) return false;
  if (unitLimitReached(world, playerId, defId)) return false;
  const reserve = currentAiThinkScope()?.reserve;
  if (
    reserve &&
    ((unitDef.cost.gold > 0 && bank[ResourceKindId.GOLD] - unitDef.cost.gold < reserve.gold) ||
      (unitDef.cost.stone > 0 && bank[ResourceKindId.STONE] - unitDef.cost.stone < reserve.stone))
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
  if (houseLimitReached(world, playerId, defId)) return false;
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
  // Nothing changes while we scan, so index resources, buildings and enemies
  // once instead of rescanning every entity for each candidate spot.
  const probe = new PlacementProbe(world);
  const own = new OwnBuildingIndex(world, playerId);
  const enemies = aiEnemyPoints(world, playerId);
  const actuator = activeAiActuator();
  const usesNodes = worksiteUsesResourceNodes(def);
  const harvestKind = def.harvestKind as ResourceKind;
  const harvestRadius = def.harvestRadius ?? 6;
  let bestSpot: GridPos | null = null;
  let bestScore = Infinity;
  const consider = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) return;
    // canPlaceBuildingAt, split so the score reuses the node distance.
    const resourceDist = usesNodes ? probe.nearestDistance(x, y, harvestKind, harvestRadius) : null;
    if (usesNodes && resourceDist === null) return;
    if (!isFootprintFree(world, def, x, y, probe)) return;
    if (actuator.isSpotClaimed(defId, x, y)) return;
    if (hasPointNear(enemies, x, y, 8)) return;
    const score = aiBuildingPlacementScore(def, x, y, nearX, nearY, own, resourceDist ?? harvestRadius);
    if (score < bestScore) {
      bestScore = score;
      bestSpot = { x, y };
    }
  };
  // Ring by ring, each ring row by row (dy, then dx ascending): the first of
  // equally scored spots wins, so this order decides ties.
  for (let r = 2; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      if (dy === -r || dy === r) {
        for (let dx = -r; dx <= r; dx++) consider(cx + dx, cy + dy);
      } else {
        consider(cx - r, cy + dy);
        consider(cx + r, cy + dy);
      }
    }
  }
  return bestSpot;
}

/**
 * The player's live buildings, in NetId order, as footprint rectangles: the
 * numbers distToBuildingEdge measures against, read once per spot search.
 */
class OwnBuildingIndex {
  readonly minX: number[] = [];
  readonly maxX: number[] = [];
  readonly minY: number[] = [];
  readonly maxY: number[] = [];
  readonly defId: number[] = [];

  constructor(world: SimWorld, playerId: number) {
    // NetId order: a float sum in query order can differ in the last bit after a load.
    for (const eid of sortedEids(world, buildingQuery(world.ecs))) {
      if (Owner.player[eid] !== playerId) continue;
      if (Health.hp[eid] <= 0) continue;
      const def = BUILDING_TABLE[Building.defId[eid]];
      if (def) {
        const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
        const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
        this.minX.push(x0 - 0.5);
        this.maxX.push(x0 + def.footprint.w - 0.5);
        this.minY.push(y0 - 0.5);
        this.maxY.push(y0 + def.footprint.h - 0.5);
      } else {
        // distToBuildingEdge measures a def-less building from its position: a
        // zero-size rectangle gives the same |dx|, |dy| and so the same hypot.
        this.minX.push(Position.x[eid]);
        this.maxX.push(Position.x[eid]);
        this.minY.push(Position.y[eid]);
        this.maxY.push(Position.y[eid]);
      }
      this.defId.push(Building.defId[eid]);
    }
  }

  get length(): number {
    return this.defId.length;
  }

  /** distToBuildingEdge(world, x, y, eid) for the i-th building. */
  edgeDistance(i: number, x: number, y: number): number {
    const minX = this.minX[i];
    const maxX = this.maxX[i];
    const minY = this.minY[i];
    const maxY = this.maxY[i];
    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
    return dhypot(dx, dy);
  }
}

function aiBuildingPlacementScore(
  def: BuildingDef,
  x: number,
  y: number,
  baseX: number,
  baseY: number,
  own: OwnBuildingIndex,
  resourceDist: number
): number {
  const baseDist = dhypot(x - baseX, y - baseY);
  const spacingPenalty = aiOwnedBuildingSpacingPenalty(def, x, y, own);
  if (worksiteUsesResourceNodes(def)) {
    return resourceDist * 5 + baseDist * 0.08 + spacingPenalty;
  }
  if (def.id === 'FARM') {
    return aiPreferredBaseDistanceScore(baseDist, 7) +
      aiNearestOwnedBuildingTypeDistance(own, x, y, BuildingDefId.FARM) * 0.2 +
      spacingPenalty;
  }
  if (def.id === 'MILL') {
    return aiPreferredBaseDistanceScore(baseDist, 8) +
      aiNearestOwnedBuildingTypeDistance(own, x, y, BuildingDefId.FARM) * 1.8 +
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

function aiOwnedBuildingSpacingPenalty(def: BuildingDef, x: number, y: number, own: OwnBuildingIndex): number {
  const desiredGap = aiDesiredBuildingGap(def);
  let penalty = 0;
  // In the index's NetId order, so the float sum is the same on every peer.
  for (let i = 0; i < own.length; i++) {
    const edgeDist = own.edgeDistance(i, x, y);
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

function aiNearestOwnedBuildingTypeDistance(own: OwnBuildingIndex, x: number, y: number, defId: number): number {
  let best = 20;
  for (let i = 0; i < own.length; i++) {
    if (own.defId[i] !== defId) continue;
    best = Math.min(best, own.edgeDistance(i, x, y));
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
    if (dhypot(p.x - x, p.y - y) < radius) return true;
  }
  return false;
}
