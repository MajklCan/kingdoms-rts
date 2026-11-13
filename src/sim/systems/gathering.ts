/**
 * Gatherer state machine: walk to node, harvest, return.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  Building,
  DropOff,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  PathTarget,
  Position,
  Resource,
  ResourceCarry,
  type ResourceKind,
  ResourceWorksite,
  VILLAGER_CARRY_CAPACITY,
  VILLAGER_GATHER_COOLDOWN,
  WorksiteWorker,
} from '../components';
import { BUILDING_TABLE } from '../defs';
import type { GridPos } from '../pathfinding';
import { DROP_OFF_EDGE_DISTANCE, RESOURCE_GATHER_DISTANCE } from '../core/constants';
import {
  clamp,
  compareDeterministicEids,
  compareGridPos,
  sortedEids,
} from '../core/entities';
import { gatherCueForKind, pushSoundCue } from '../core/events';
import { buildingFootprintRect, distToBuildingEdge } from '../core/grid';
import { buildingApproachCandidates, pathToResourceContact } from '../core/navigation';
import { gathererQuery, resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import {
  findNearestDropOffEid,
  routeToNearestDropOff,
  routeWorksiteWorkerToResource,
} from './dropoff';

const WORKSITE_FALLBACK_DROP_OFF_RADIUS = 4;
const DROP_OFF_DEPOSIT_TICKS = Math.round(SIM.TICK_HZ * 0.5);
const FARM_WORK_PATCH_INSET = 0.38;

/**
 * Gatherer state machine. Drives the canonical AoE2 villager loop:
 *   IDLE → (assigned) → WALKING_TO → (arrived) → GATHERING →
 *     (full or depleted) → RETURNING → (at drop-off) → DEPOSITING →
 *       (0.5s handoff) → WALKING_TO (if resource alive) or IDLE
 */
export function gatheringSystem(world: SimWorld): void {
  const ents = sortedEids(world, gathererQuery(world.ecs));
  for (const eid of ents) {
    const state = Gatherer.state[eid];
    switch (state) {
      case GathererStateId.IDLE:
        // Nothing to do. Sit still.
        break;

      case GathererStateId.WALKING_TO:
        gatheringWalkingTo(world, eid);
        break;

      case GathererStateId.GATHERING:
        gatheringActive(world, eid);
        break;

      case GathererStateId.RETURNING:
        gatheringReturning(world, eid);
        break;

      case GathererStateId.DEPOSITING:
        // Handled by dropoffSystem, which transitions us forward.
        break;
    }
  }
}

function gatheringWalkingTo(world: SimWorld, eid: number): void {
  const target = Gatherer.targetEid[eid];
  if (target < 0 || !hasComponent(world.ecs, Resource, target)) {
    Gatherer.state[eid] = GathererStateId.IDLE;
    return;
  }
  if (Resource.amount[target] <= 0) {
    // Resource depleted en route - try to retarget to nearest of same kind.
    const kind = Resource.kind[target] as ResourceKind;
    // Auto-retarget after a node depletes: stay within ~15 tiles of the
    // villager rather than scouring the whole map. This is what stops the
    // AI's berry-gatherers from walking across the river to the human's
    // berries once their own deplete.
    if (
      !routeWorksiteWorkerToResource(world, eid, kind) &&
      !routeToNearestReachableResource(world, eid, kind, 15)
    ) {
      Gatherer.state[eid] = GathererStateId.IDLE;
      Gatherer.targetEid[eid] = -1;
    }
    return;
  }

  const dx = Position.x[eid] - Position.x[target];
  const dy = Position.y[eid] - Position.y[target];
  if (Math.hypot(dx, dy) <= RESOURCE_GATHER_DISTANCE) {
    // Arrived at the resource node. Keep this tight so harvesting animations
    // visually connect with the trunk / rock / bush rather than swinging at air.
    Gatherer.state[eid] = GathererStateId.GATHERING;
    Gatherer.cooldown[eid] = VILLAGER_GATHER_COOLDOWN;
    world.paths.delete(eid);
  }
  // Otherwise the path is in motion via movementSystem.
}

function gatheringActive(world: SimWorld, eid: number): void {
  const target = Gatherer.targetEid[eid];
  if (target < 0 || !hasComponent(world.ecs, Resource, target)) {
    // Resource removed under us - pick nearest of same kind if we have a hint.
    const carryKind = ResourceCarry.amount[eid] > 0
      ? (ResourceCarry.kind[eid] as ResourceKind)
      : null;
    if (carryKind !== null) {
      if (
        routeWorksiteWorkerToResource(world, eid, carryKind) ||
        routeToNearestReachableResource(world, eid, carryKind, 15)
      ) return;
    }
    Gatherer.state[eid] = GathererStateId.IDLE;
    Gatherer.targetEid[eid] = -1;
    return;
  }

  // Emptied earlier this tick by another gatherer: resourceDepletionSystem
  // removes it and moves this gatherer on later in the same tick.
  if (Resource.amount[target] <= 0) return;

  // Tick down the cooldown; emit a gather increment when it hits 0.
  if (Gatherer.cooldown[eid] > 0) {
    Gatherer.cooldown[eid] -= 1;
    return;
  }

  const kind = Resource.kind[target] as ResourceKind;
  // Refill or initialise carry slot.
  if (ResourceCarry.amount[eid] === 0) {
    ResourceCarry.kind[eid] = kind;
  }
  ResourceCarry.amount[eid] += 1;
  Resource.amount[target] -= 1;
  Gatherer.cooldown[eid] = VILLAGER_GATHER_COOLDOWN;
  pushSoundCue(world, gatherCueForKind(kind), Position.x[eid], Position.y[eid], Owner.player[eid]);

  // An emptied node stays until resourceDepletionSystem removes it later this
  // tick and retargets everyone still bound to it (this gatherer included).

  // If carry full, head home.
  if (ResourceCarry.amount[eid] >= VILLAGER_CARRY_CAPACITY) {
    Gatherer.state[eid] = GathererStateId.RETURNING;
    Gatherer.cooldown[eid] = 0;
    routeToNearestDropOff(world, eid);
  }
}

function gatheringReturning(world: SimWorld, eid: number): void {
  // Make sure we have an active path toward a drop-off.
  if (!world.paths.has(eid)) {
    routeToNearestDropOff(world, eid);
    if (!world.paths.has(eid) && tryFallbackWorksiteDeposit(world, eid)) return;
  }
  const dropOff = findNearestDropOffEid(world, eid);
  if (dropOff === null) {
    tryFallbackWorksiteDeposit(world, eid);
    return;
  }
  // Footprint-aware arrival: require the worker to reach a final contact point
  // close to the wall, not merely the center of an adjacent tile.
  const dist = distToBuildingEdge(world, Position.x[eid], Position.y[eid], dropOff);
  if (dist <= DROP_OFF_EDGE_DISTANCE) {
    Gatherer.state[eid] = GathererStateId.DEPOSITING;
    Gatherer.cooldown[eid] = DROP_OFF_DEPOSIT_TICKS;
    world.paths.delete(eid);
  }
}

function tryFallbackWorksiteDeposit(world: SimWorld, worker: number): boolean {
  if (!hasComponent(world.ecs, WorksiteWorker, worker)) return false;
  const siteEid = WorksiteWorker.siteEid[worker];
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (!hasComponent(world.ecs, DropOff, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  const carryAmt = ResourceCarry.amount[worker];
  if (carryAmt <= 0) return false;
  const carryKind = ResourceCarry.kind[worker] as ResourceKind;
  if ((DropOff.acceptsMask[siteEid] & (1 << carryKind)) === 0) return false;
  const dist = distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid);
  if (dist > WORKSITE_FALLBACK_DROP_OFF_RADIUS) return false;
  Gatherer.state[worker] = GathererStateId.DEPOSITING;
  Gatherer.cooldown[worker] = DROP_OFF_DEPOSIT_TICKS;
  Gatherer.targetEid[worker] = siteEid;
  world.paths.delete(worker);
  return true;
}

export function startGatheringResource(world: SimWorld, eid: number, target: number): boolean {
  if (!hasComponent(world.ecs, Resource, target) || Resource.amount[target] <= 0) {
    return false;
  }
  if (!pathToResourceContact(world, eid, target)) return false;
  Gatherer.targetEid[eid] = target;
  const isClose =
    Math.hypot(Position.x[eid] - Position.x[target], Position.y[eid] - Position.y[target]) <=
    RESOURCE_GATHER_DISTANCE;
  Gatherer.cooldown[eid] = isClose ? VILLAGER_GATHER_COOLDOWN : 0;
  Gatherer.state[eid] = isClose ? GathererStateId.GATHERING : GathererStateId.WALKING_TO;
  return true;
}

export function routeToNearestReachableResource(
  world: SimWorld,
  eid: number,
  kind: ResourceKind,
  maxRange: number,
  originX = Position.x[eid],
  originY = Position.y[eid],
  avoidTargets: Set<number> = new Set()
): boolean {
  const candidates = resourceQuery(world.ecs)
    .filter((target) => Resource.kind[target] === kind && Resource.amount[target] > 0)
    .map((target) => ({
      target,
      dist: Math.hypot(Position.x[target] - originX, Position.y[target] - originY),
    }))
    .filter((candidate) => candidate.dist <= maxRange)
    .sort((a, b) => a.dist - b.dist || compareDeterministicEids(world, a.target, b.target));

  for (const { target } of candidates) {
    if (avoidTargets.has(target)) continue;
    if (startGatheringResource(world, eid, target)) return true;
  }
  for (const { target } of candidates) {
    if (startGatheringResource(world, eid, target)) return true;
  }
  world.paths.delete(eid);
  return false;
}

export function routeFarmWorkerToNextPatch(world: SimWorld, worker: number, siteEid: number): boolean {
  if (!hasComponent(world.ecs, Building, siteEid)) return false;
  const candidates = farmWorkPatchCandidates(world, worker, siteEid);
  if (candidates.length === 0) return false;
  const start = ResourceWorksite.progress[siteEid] % candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const index = (start + i) % candidates.length;
    const candidate = candidates[index];
    const from = {
      x: Math.round(Position.x[worker]),
      y: Math.round(Position.y[worker]),
    };
    const path = world.pathfinder.findPath(from, candidate.tile);
    if (path === null) continue;

    const nextPath: GridPos[] = [...path];
    const final = nextPath[nextPath.length - 1];
    if (
      !final ||
      Math.hypot(final.x - candidate.point.x, final.y - candidate.point.y) > 0.01
    ) {
      nextPath.push(candidate.point);
    }

    if (nextPath.length === 0) {
      world.paths.delete(worker);
    } else {
      world.paths.set(worker, nextPath);
      PathTarget.x[worker] = Math.round(nextPath[0].x);
      PathTarget.y[worker] = Math.round(nextPath[0].y);
    }
    ResourceWorksite.progress[siteEid] = (index + 1) % candidates.length;
    Gatherer.targetEid[worker] = siteEid;
    Gatherer.state[worker] = GathererStateId.WALKING_TO_BUILD;
    Gatherer.cooldown[worker] = 0;
    return true;
  }
  return false;
}

function farmWorkPatchCandidates(
  world: SimWorld,
  worker: number,
  siteEid: number
): Array<{ tile: GridPos; point: GridPos; score: number }> {
  const def = BUILDING_TABLE[Building.defId[siteEid]];
  if (!def) return [];
  const rect = buildingFootprintRect(siteEid, def);
  const candidates: Array<{ tile: GridPos; point: GridPos; score: number }> = [];
  const seen = new Set<string>();

  for (const candidate of buildingApproachCandidates(world, worker, siteEid)) {
    const point = {
      x: clamp(candidate.point.x, rect.minX + FARM_WORK_PATCH_INSET, rect.maxX - FARM_WORK_PATCH_INSET),
      y: clamp(candidate.point.y, rect.minY + FARM_WORK_PATCH_INSET, rect.maxY - FARM_WORK_PATCH_INSET),
    };
    const key = `${candidate.tile.x},${candidate.tile.y}:${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      tile: candidate.tile,
      point,
      score:
        Math.hypot(Position.x[worker] - point.x, Position.y[worker] - point.y) +
        candidate.resourcePenalty,
    });
  }

  candidates.sort((a, b) => a.score - b.score || compareGridPos(a.tile, b.tile));
  return candidates;
}
