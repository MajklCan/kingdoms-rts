/**
 * Work for villagers fresh out of a town center.
 *
 *   rally on a resource   gather it; once it is gone, the nearest node of
 *                         the same kind around the rally point
 *   rally on the ground   walk there
 *   no rally (human)      gather by hand near the town center, spreading
 *                         villagers over food, wood, stone and gold
 *
 * The computer player runs its own economy, so its villagers without a
 * rally are left to it. Pure sim: deterministic order, no randomness.
 */

import { hasComponent } from 'bitecs';
import {
  Gatherer,
  GathererStateId,
  Owner,
  Position,
  Resource,
  ResourceKindId,
  VillagerTag,
  WorksiteWorker,
  type ResourceKind,
} from '../components';
import { findSpawnSpot } from '../core/grid';
import { pathTo } from '../core/navigation';
import { gathererQuery } from '../core/queries';
import type { SimWorld, VillagerRally } from '../core/types';
import { routeToNearestReachableResource, startGatheringResource } from './gathering';

/** Tiles around the town center searched for automatic work. */
export const AUTO_ASSIGN_RANGE = 14;
/** Tiles around a rally point searched once its own resource is gone. */
export const RALLY_RESOURCE_RANGE = 8;

/**
 * Shares of hand-gathering villagers per resource: food and wood carry the
 * early economy, stone and gold get one villager in four between them.
 */
const AUTO_KIND_WEIGHTS: ReadonlyArray<readonly [ResourceKind, number]> = [
  [ResourceKindId.FOOD as ResourceKind, 3],
  [ResourceKindId.WOOD as ResourceKind, 3],
  [ResourceKindId.STONE as ResourceKind, 1],
  [ResourceKindId.GOLD as ResourceKind, 1],
];

/** Send a villager the town center `producerEid` just trained to work. */
export function assignTrainedVillager(world: SimWorld, producerEid: number, villagerEid: number): void {
  if (!hasComponent(world.ecs, Gatherer, villagerEid)) return;
  const rally = world.villagerRallies.get(producerEid);
  if (rally) {
    followVillagerRally(world, villagerEid, rally);
    return;
  }
  const playerId = Owner.player[producerEid];
  if (!world.humanPlayers.has(playerId)) return;
  autoAssignVillager(world, villagerEid, playerId, Position.x[producerEid], Position.y[producerEid]);
}

function followVillagerRally(world: SimWorld, eid: number, rally: VillagerRally): void {
  const target = rally.targetEid;
  if (
    target >= 0 &&
    hasComponent(world.ecs, Resource, target) &&
    Resource.kind[target] === rally.kind &&
    Resource.amount[target] > 0 &&
    startGatheringResource(world, eid, target)
  ) {
    return;
  }
  if (
    rally.kind >= 0 &&
    routeToNearestReachableResource(world, eid, rally.kind as ResourceKind, RALLY_RESOURCE_RANGE, rally.x, rally.y)
  ) {
    return;
  }
  pathTo(world, eid, rally.x, rally.y);
}

/**
 * Gather the resource kind furthest below its share among the player's
 * hand-gathering villagers, at the node nearest the town center. Kinds with
 * no reachable node in range are skipped. False when nothing was found.
 */
export function autoAssignVillager(
  world: SimWorld,
  eid: number,
  playerId: number,
  originX: number,
  originY: number
): boolean {
  const counts = countHandGatherersByKind(world, playerId, eid);
  const order = AUTO_KIND_WEIGHTS
    .map(([kind, weight], index) => ({ kind, load: (counts.get(kind) ?? 0) / weight, index }))
    .sort((a, b) => a.load - b.load || a.index - b.index);
  for (const { kind } of order) {
    if (routeToNearestReachableResource(world, eid, kind, AUTO_ASSIGN_RANGE, originX, originY, new Set(), true)) {
      return true;
    }
  }
  return false;
}

/** Free villagers of `playerId` by the resource kind they work, `skip` excluded. */
function countHandGatherersByKind(world: SimWorld, playerId: number, skip: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const eid of gathererQuery(world.ecs)) {
    if (eid === skip) continue;
    if (Owner.player[eid] !== playerId) continue;
    if (!hasComponent(world.ecs, VillagerTag, eid)) continue;
    if (hasComponent(world.ecs, WorksiteWorker, eid)) continue;
    if (Gatherer.state[eid] === GathererStateId.IDLE) continue;
    const target = Gatherer.targetEid[eid];
    if (target < 0 || !hasComponent(world.ecs, Resource, target)) continue;
    const kind = Resource.kind[target];
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/**
 * Validate and store a town center's villager rally. A resource target must
 * exist and still hold something; the point snaps to a walkable tile.
 */
export function applySetVillagerRally(
  world: SimWorld,
  tcEid: number,
  x: number,
  y: number,
  targetEid: number | undefined
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (
    targetEid !== undefined &&
    targetEid >= 0 &&
    hasComponent(world.ecs, Resource, targetEid) &&
    Resource.amount[targetEid] > 0
  ) {
    world.villagerRallies.set(tcEid, {
      x: Position.x[targetEid],
      y: Position.y[targetEid],
      targetEid,
      kind: Resource.kind[targetEid],
    });
    return;
  }
  const spot = findSpawnSpot(world, Math.round(x), Math.round(y), 4);
  if (!spot) return;
  world.villagerRallies.set(tcEid, { x: spot.x, y: spot.y, targetEid: -1, kind: -1 });
}
