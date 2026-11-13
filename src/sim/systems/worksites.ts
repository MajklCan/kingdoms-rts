/**
 * Resource worksites (farms, camps, mines): crews, harvest orders and self-production.
 */

import { addComponent, hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  Building,
  ConstructionSite,
  DeadTag,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  Position,
  Resource,
  ResourceCarry,
  type ResourceKind,
  ResourceKindId,
  ResourceWorksite,
  VILLAGER_CARRY_CAPACITY,
  WorksiteWorker,
} from '../components';
import { type BuildingDef, BuildingDefId, UnitDefId, getBuildingDef } from '../defs';
import { TechId, hasTech, worksiteWorkerSlotsForKind } from '../tech-tree';
import { aiResourceWorksiteCanStillProduce } from '../ai/snapshot';
import {
  AI_PLAYER_ID,
  DROP_OFF_EDGE_DISTANCE,
  FARM_WORK_EDGE_DISTANCE,
  RESOURCE_GATHER_DISTANCE,
} from '../core/constants';
import { sortedEids } from '../core/entities';
import { distToBuildingEdge, findSpawnSpot } from '../core/grid';
import { findNearestResource } from '../core/lookup';
import { recordGathered } from '../core/match-stats';
import { pathToBuildingContact } from '../core/navigation';
import { resourceWorksiteQuery, worksiteWorkerQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnVillager } from '../factories/units';
import { clearFormationSpeedCap } from '../input/unit-orders';
import { findNearestDropOffEid, routeToNearestDropOff } from './dropoff';
import { routeFarmWorkerToNextPatch, routeToNearestReachableResource } from './gathering';

const FARM_WORK_CYCLE_TICKS = Math.round(SIM.TICK_HZ * 2.4);
const FARM_MIN_WORK_CYCLE_TICKS = Math.round(SIM.TICK_HZ * 2);
const FARM_BASE_FOOD_PER_WORK_CYCLE = 2;
const FARM_YIELDS_I_FOOD_PER_WORK_CYCLE = 3;
const FARM_YIELDS_II_FOOD_PER_WORK_CYCLE = 4;

export function resourceWorksiteSystem(world: SimWorld): void {
  const sites = sortedEids(world, resourceWorksiteQuery(world.ecs));
  for (const siteEid of sites) {
    if (hasComponent(world.ecs, ConstructionSite, siteEid)) continue;
    if (Health.hp[siteEid] <= 0) continue;

    const def = getBuildingDef(Building.defId[siteEid]);
    if (!def || def.harvestKind === undefined) continue;

    trySpawnInitialWorksiteWorker(world, siteEid);
    ResourceWorksite.assignedWorkers[siteEid] = countWorksiteWorkers(world, siteEid);

    const kind = def.harvestKind as ResourceKind;
    const radius = def.harvestRadius ?? 6;
    if (Building.defId[siteEid] === BuildingDefId.FARM) {
      runFarmWorksite(world, siteEid, def);
      continue;
    }
    if (!worksiteUsesResourceNodes(def)) {
      runSelfProducingWorksite(world, siteEid, def, kind);
      continue;
    }

    const target = findNearestResource(
      world,
      Position.x[siteEid],
      Position.y[siteEid],
      kind,
      radius
    );
    if (target === null) {
      continue;
    }

    assignWorksiteHarvestOrders(world, siteEid, kind, radius);
  }
}

export function worksiteUsesResourceNodes(def: BuildingDef): boolean {
  return def.harvestKind !== undefined && def.requiresNearbyResource !== false;
}

function runFarmWorksite(world: SimWorld, siteEid: number, def: BuildingDef): void {
  const workTicks = farmWorkCycleTicks(world, siteEid, def);
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    Gatherer.targetEid[worker] = siteEid;
    if (ResourceCarry.amount[worker] > 0) {
      ResourceCarry.kind[worker] = ResourceKindId.FOOD;
    }
    if (
      ResourceCarry.amount[worker] >= VILLAGER_CARRY_CAPACITY ||
      Gatherer.state[worker] === GathererStateId.RETURNING ||
      Gatherer.state[worker] === GathererStateId.DEPOSITING
    ) {
      if (Gatherer.state[worker] !== GathererStateId.DEPOSITING) {
        Gatherer.state[worker] = GathererStateId.RETURNING;
        routeToNearestDropOff(world, worker);
      }
      continue;
    }

    if (Gatherer.state[worker] === GathererStateId.BUILDING) {
      const dist = distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid);
      if (dist > FARM_WORK_EDGE_DISTANCE) {
        routeFarmWorkerToNextPatch(world, worker, siteEid);
        continue;
      }
      if (Gatherer.cooldown[worker] > 0) {
        Gatherer.cooldown[worker] -= 1;
        continue;
      }
      ResourceCarry.kind[worker] = ResourceKindId.FOOD;
      ResourceCarry.amount[worker] = Math.min(
        VILLAGER_CARRY_CAPACITY,
        ResourceCarry.amount[worker] + farmFoodPerWorkCycle(world, siteEid)
      );
      if (ResourceCarry.amount[worker] >= VILLAGER_CARRY_CAPACITY) {
        Gatherer.state[worker] = GathererStateId.RETURNING;
        routeToNearestDropOff(world, worker);
      } else {
        routeFarmWorkerToNextPatch(world, worker, siteEid);
      }
      continue;
    }

    const atFarmEdge =
      distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid) <=
      FARM_WORK_EDGE_DISTANCE;
    if (Gatherer.state[worker] === GathererStateId.WALKING_TO_BUILD && world.paths.has(worker)) {
      continue;
    }
    if (Gatherer.state[worker] === GathererStateId.WALKING_TO_BUILD && atFarmEdge) {
      world.paths.delete(worker);
      Gatherer.state[worker] = GathererStateId.BUILDING;
      Gatherer.cooldown[worker] = workTicks;
      continue;
    }
    if (Gatherer.state[worker] !== GathererStateId.WALKING_TO_BUILD || !world.paths.has(worker)) {
      if (!routeFarmWorkerToNextPatch(world, worker, siteEid) && atFarmEdge) {
        Gatherer.state[worker] = GathererStateId.BUILDING;
        Gatherer.cooldown[worker] = workTicks;
      }
    }
  }
}

function farmWorkCycleTicks(_world: SimWorld, _siteEid: number, def: BuildingDef): number {
  const base = Math.max(FARM_WORK_CYCLE_TICKS, def.harvestRateTicks ?? FARM_WORK_CYCLE_TICKS);
  return Math.max(FARM_MIN_WORK_CYCLE_TICKS, base);
}

function farmFoodPerWorkCycle(world: SimWorld, siteEid: number): number {
  const playerId = Owner.player[siteEid];
  if (hasTech(world, playerId, TechId.FARMS_II)) return FARM_YIELDS_II_FOOD_PER_WORK_CYCLE;
  if (hasTech(world, playerId, TechId.FARMS)) return FARM_YIELDS_I_FOOD_PER_WORK_CYCLE;
  return FARM_BASE_FOOD_PER_WORK_CYCLE;
}

function runSelfProducingWorksite(
  world: SimWorld,
  siteEid: number,
  def: BuildingDef,
  kind: ResourceKind
): void {
  const activeWorkers = assignSelfProducingWorksiteWorkers(world, siteEid);
  if (activeWorkers <= 0) return;
  const bank = world.resources[Owner.player[siteEid]];
  if (!bank) return;

  const rateTicks = worksiteProductionRateTicks(world, siteEid, def, kind);
  ResourceWorksite.progress[siteEid] += activeWorkers;
  while (ResourceWorksite.progress[siteEid] >= rateTicks) {
    ResourceWorksite.progress[siteEid] -= rateTicks;
    bank[kind] += 1;
    recordGathered(world, Owner.player[siteEid], kind, 1);
  }
}

function assignSelfProducingWorksiteWorkers(world: SimWorld, siteEid: number): number {
  let activeWorkers = 0;
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    Gatherer.targetEid[worker] = siteEid;
    ResourceCarry.amount[worker] = 0;
    const dist = distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid);
    if (dist > DROP_OFF_EDGE_DISTANCE) {
      Gatherer.state[worker] = GathererStateId.WALKING_TO_BUILD;
      if (!world.paths.has(worker)) {
        pathToBuildingContact(world, worker, siteEid);
      }
      continue;
    }
    world.paths.delete(worker);
    Gatherer.state[worker] = GathererStateId.BUILDING;
    Gatherer.cooldown[worker] = 0;
    activeWorkers++;
  }
  return activeWorkers;
}

function worksiteProductionRateTicks(
  _world: SimWorld,
  _siteEid: number,
  def: BuildingDef,
  _kind: ResourceKind
): number {
  const base = Math.max(1, def.harvestRateTicks ?? SIM.TICK_HZ);
  return base;
}

export function trySpawnInitialWorksiteWorker(world: SimWorld, siteEid: number): void {
  if (ResourceWorksite.freeWorkersSpawned[siteEid] > 0) {
    if (Owner.player[siteEid] !== AI_PLAYER_ID || countWorksiteWorkers(world, siteEid) > 0) return;
    const def = getBuildingDef(Building.defId[siteEid]);
    if (def && worksiteUsesResourceNodes(def) && !aiResourceWorksiteCanStillProduce(world, siteEid, def)) {
      return;
    }
    spawnWorksiteWorker(world, siteEid);
    return;
  }
  const slots = getWorksiteWorkerSlots(world, siteEid);
  if (slots <= 0 || countWorksiteWorkers(world, siteEid) >= slots) {
    ResourceWorksite.freeWorkersSpawned[siteEid] = 1;
    return;
  }
  if (spawnWorksiteWorker(world, siteEid) !== null) {
    ResourceWorksite.freeWorkersSpawned[siteEid] = 1;
  }
}

export function spawnWorksiteWorker(world: SimWorld, siteEid: number): number | null {
  let current = countWorksiteWorkers(world, siteEid);
  const offsets = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let attempt = 0; attempt < offsets.length; attempt++) {
    const [dx, dy] = offsets[current % offsets.length];
    const spot = findSpawnSpot(
      world,
      Position.x[siteEid] + dx,
      Position.y[siteEid] + dy,
      4
    );
    current++;
    if (!spot) continue;
    const worker = spawnVillager(world, spot.x, spot.y, Owner.player[siteEid], 0);
    addComponent(world.ecs, WorksiteWorker, worker);
    WorksiteWorker.siteEid[worker] = siteEid;
    return worker;
  }
  return null;
}

export function countWorksiteWorkers(world: SimWorld, siteEid: number): number {
  let count = 0;
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    count++;
  }
  return count;
}

export function countQueuedWorksiteWorkers(world: SimWorld, siteEid: number): number {
  const queue = world.productionQueues.get(siteEid);
  if (!queue) return 0;
  return queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
}

export function getWorksiteWorkerSlots(world: SimWorld, siteEid: number): number {
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return 0;
  const def = getBuildingDef(Building.defId[siteEid]);
  const baseSlots = def?.workerSlots ?? 1;
  return Math.min(
    baseSlots,
    worksiteWorkerSlotsForKind(
      world,
      Owner.player[siteEid],
      ResourceWorksite.kind[siteEid]
    )
  );
}

function assignWorksiteHarvestOrders(
  world: SimWorld,
  siteEid: number,
  kind: ResourceKind,
  radius: number
): void {
  const claimedTargets = countClaimedWorksiteResourceTargets(world, siteEid, kind);
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    if (ResourceCarry.amount[worker] > 0) {
      const dropOff = findNearestDropOffEid(world, worker);
      if (dropOff !== null && Gatherer.state[worker] === GathererStateId.IDLE) {
        Gatherer.state[worker] = GathererStateId.RETURNING;
        routeToNearestDropOff(world, worker);
      }
      continue;
    }
    const targetValid =
      Gatherer.targetEid[worker] >= 0 &&
      hasComponent(world.ecs, Resource, Gatherer.targetEid[worker]) &&
      Resource.kind[Gatherer.targetEid[worker]] === kind &&
      Resource.amount[Gatherer.targetEid[worker]] > 0;
    if (targetValid && Gatherer.state[worker] !== GathererStateId.IDLE) {
      const target = Gatherer.targetEid[worker];
      const stalled =
        Gatherer.state[worker] === GathererStateId.WALKING_TO &&
        !world.paths.has(worker) &&
        Math.hypot(Position.x[worker] - Position.x[target], Position.y[worker] - Position.y[target]) >
          RESOURCE_GATHER_DISTANCE;
      const duplicateTarget = (claimedTargets.get(target) ?? 0) > 1;
      if (!stalled && !duplicateTarget) continue;
      if (duplicateTarget) {
        claimedTargets.set(target, (claimedTargets.get(target) ?? 1) - 1);
      }
    }

    const avoidedTargets = new Set<number>();
    for (const [target, count] of claimedTargets) {
      if (count > 0) avoidedTargets.add(target);
    }
    if (routeToNearestReachableResource(
      world,
      worker,
      kind,
      radius,
      Position.x[siteEid],
      Position.y[siteEid],
      avoidedTargets
    )) {
      const assignedTarget = Gatherer.targetEid[worker];
      if (assignedTarget >= 0) {
        claimedTargets.set(assignedTarget, (claimedTargets.get(assignedTarget) ?? 0) + 1);
      }
    }
  }
}

function countClaimedWorksiteResourceTargets(
  world: SimWorld,
  siteEid: number,
  kind: ResourceKind
): Map<number, number> {
  const claimed = new Map<number, number>();
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    if (ResourceCarry.amount[worker] > 0) continue;
    if (Gatherer.state[worker] === GathererStateId.IDLE) continue;
    const target = Gatherer.targetEid[worker];
    if (
      target < 0 ||
      !hasComponent(world.ecs, Resource, target) ||
      Resource.kind[target] !== kind ||
      Resource.amount[target] <= 0
    ) {
      continue;
    }
    claimed.set(target, (claimed.get(target) ?? 0) + 1);
  }
  return claimed;
}

export function markWorksiteWorkersDead(world: SimWorld, siteEid: number): void {
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return;
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    addComponent(world.ecs, DeadTag, worker);
    Gatherer.targetEid[worker] = -1;
    Gatherer.state[worker] = GathererStateId.IDLE;
    world.paths.delete(worker);
    clearFormationSpeedCap(world, worker);
  }
  ResourceWorksite.assignedWorkers[siteEid] = 0;
}
