/**
 * Resource delivery at drop-off buildings.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  DropOff,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  Position,
  ResourceCarry,
  type ResourceKind,
  ResourceKindId,
  Resource,
  ResourceWorksite,
  VillagerJobId,
  VillagerWork,
} from '../components';
import { BuildingDefId, getBuildingDef } from '../defs';
import { compareDeterministicEids, sortedEids } from '../core/entities';
import { distToBuildingEdge } from '../core/grid';
import { recordGathered } from '../core/match-stats';
import { pathTo, pathToBuildingContact } from '../core/navigation';
import { dropOffQuery, gathererQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { worksiteOf } from '../core/worksite-membership';
import {
  routeFarmWorkerToNextPatch,
  routeToNearestReachableResource,
  startGatheringResource,
} from './gathering';
import { HERD_RETARGET_RADIUS, isGameAnimal, routeToNearestGame } from './hunting';
import { rememberedJob } from './villager-work';
import { worksiteUsesResourceNodes } from './worksites';

const MILL_FOOD_DEPOSIT_BONUS_MULTIPLIER = 0.5;

/**
 * Drop-off system. For each gatherer in DEPOSITING state, credit the player bank
 * with their carry and bounce them back to the resource (if it still exists) or IDLE.
 */
export function dropoffSystem(world: SimWorld): void {
  const ents = sortedEids(world, gathererQuery(world.ecs));
  for (const eid of ents) {
    if (Gatherer.state[eid] !== GathererStateId.DEPOSITING) continue;
    if (Gatherer.cooldown[eid] > 0) {
      Gatherer.cooldown[eid] -= 1;
      if (Gatherer.cooldown[eid] > 0) continue;
    }
    const carryAmt = ResourceCarry.amount[eid];
    const carryKind = ResourceCarry.kind[eid] as ResourceKind;
    const playerId = Owner.player[eid];
    if (carryAmt > 0 && world.resources[playerId]) {
      const delivered = carryAmt + millDropOffFoodBonus(world, eid, carryKind, carryAmt);
      world.resources[playerId][carryKind] += delivered;
      recordGathered(world, playerId, carryKind, delivered);
    }
    ResourceCarry.amount[eid] = 0;

    if (routeWorksiteWorkerAfterDropoff(world, eid, carryKind)) continue;
    if (routeBackToHandWork(world, eid, carryKind)) continue;

    // Decide next state: stick with the same resource kind, but only if a
    // node exists within a reasonable radius of the drop-off - not across
    // the map. Stops post-deposit villagers from wandering into enemy
    // territory.
    if (!routeToNearestReachableResource(world, eid, carryKind, 15)) {
      Gatherer.state[eid] = GathererStateId.IDLE;
      Gatherer.targetEid[eid] = -1;
    }
  }
}

function millDropOffFoodBonus(
  world: SimWorld,
  worker: number,
  carryKind: ResourceKind,
  carryAmt: number
): number {
  if (carryKind !== ResourceKindId.FOOD || carryAmt <= 0) return 0;
  const dropOff = findNearestDropOffEid(world, worker);
  if (dropOff === null) return 0;
  if (!hasComponent(world.ecs, Building, dropOff)) return 0;
  if (Building.defId[dropOff] !== BuildingDefId.MILL) return 0;
  return Math.max(1, Math.floor(carryAmt * MILL_FOOD_DEPOSIT_BONUS_MULTIPLIER));
}

function routeWorksiteWorkerAfterDropoff(
  world: SimWorld,
  worker: number,
  kind: ResourceKind
): boolean {
  const siteEid = worksiteOf(world, worker);
  if (siteEid < 0 || !hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  if (ResourceWorksite.kind[siteEid] !== kind) {
    // A helper who delivered what he carried before joining: his site
    // routes him next tick.
    Gatherer.state[worker] = GathererStateId.IDLE;
    Gatherer.targetEid[worker] = -1;
    return true;
  }
  if (Building.defId[siteEid] === BuildingDefId.FARM) {
    return kind === ResourceKindId.FOOD && routeFarmWorkerToNextPatch(world, worker, siteEid);
  }
  const def = getBuildingDef(Building.defId[siteEid]);
  if (def && !worksiteUsesResourceNodes(def)) {
    // Back from delivering his load to a mint, brickworks or forester's
    // lodge: no node to walk to, his site walks him back next tick.
    Gatherer.state[worker] = GathererStateId.IDLE;
    Gatherer.targetEid[worker] = -1;
    return true;
  }
  return routeWorksiteWorkerToResource(world, worker, kind);
}

export function routeWorksiteWorkerToResource(
  world: SimWorld,
  worker: number,
  kind: ResourceKind
): boolean {
  const siteEid = worksiteOf(world, worker);
  if (siteEid < 0 || !hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  if (ResourceWorksite.kind[siteEid] !== kind) return false;
  const def = getBuildingDef(Building.defId[siteEid]);
  if (!def || !worksiteUsesResourceNodes(def)) return false;
  return routeToNearestReachableResource(
    world,
    worker,
    kind,
    def.harvestRadius ?? 6,
    Position.x[siteEid],
    Position.y[siteEid]
  );
}

/**
 * A free villager back from a drop-off returns to the node he was sent to
 * when it is game he hunts, or a different kind than he delivered (ordered
 * to gather while carrying something else). A hunter whose carcass is gone
 * looks for the next animal of the herd.
 */
function routeBackToHandWork(world: SimWorld, eid: number, carryKind: ResourceKind): boolean {
  const target = Gatherer.targetEid[eid];
  if (target >= 0 && hasComponent(world.ecs, Resource, target) && Resource.amount[target] > 0) {
    if (Resource.kind[target] !== carryKind || isGameAnimal(world, target)) {
      if (startGatheringResource(world, eid, target)) return true;
    }
  }
  if (rememberedJob(world, eid) !== VillagerJobId.HUNT) return false;
  return routeToNearestGame(world, eid, VillagerWork.x[eid], VillagerWork.y[eid], HERD_RETARGET_RADIUS);
}

export function findNearestDropOffEid(world: SimWorld, eid: number): number | null {
  const player = Owner.player[eid];
  const carryKind = ResourceCarry.kind[eid] as ResourceKind;
  const mask = 1 << carryKind;
  const ents = sortedEids(world, dropOffQuery(world.ecs));
  let best: number | null = null;
  let bestDist = Infinity;
  for (const cand of ents) {
    if (Owner.player[cand] !== player) continue;
    if ((DropOff.acceptsMask[cand] & mask) === 0) continue;
    const d = distToBuildingEdge(world, Position.x[eid], Position.y[eid], cand);
    if (
      d < bestDist ||
      (best !== null && Math.abs(d - bestDist) < 0.000001 &&
        compareDeterministicEids(world, cand, best) < 0)
    ) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

export function routeToNearestDropOff(world: SimWorld, eid: number): void {
  const target = findNearestDropOffEid(world, eid);
  if (target === null) {
    Gatherer.state[eid] = GathererStateId.IDLE;
    return;
  }
  if (!pathToBuildingContact(world, eid, target)) {
    pathTo(world, eid, Position.x[target], Position.y[target]);
  }
}
