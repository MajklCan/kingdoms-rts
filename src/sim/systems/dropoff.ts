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
  ResourceWorksite,
  WorksiteWorker,
} from '../components';
import { BuildingDefId, getBuildingDef } from '../defs';
import { compareDeterministicEids, sortedEids } from '../core/entities';
import { distToBuildingEdge } from '../core/grid';
import { recordGathered } from '../core/match-stats';
import { pathTo, pathToBuildingContact } from '../core/navigation';
import { dropOffQuery, gathererQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { routeFarmWorkerToNextPatch, routeToNearestReachableResource } from './gathering';
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
  if (!hasComponent(world.ecs, WorksiteWorker, worker)) return false;
  const siteEid = WorksiteWorker.siteEid[worker];
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  if (Building.defId[siteEid] === BuildingDefId.FARM) {
    return kind === ResourceKindId.FOOD && routeFarmWorkerToNextPatch(world, worker, siteEid);
  }
  return routeWorksiteWorkerToResource(world, worker, kind);
}

export function routeWorksiteWorkerToResource(
  world: SimWorld,
  worker: number,
  kind: ResourceKind
): boolean {
  if (!hasComponent(world.ecs, WorksiteWorker, worker)) return false;
  const siteEid = WorksiteWorker.siteEid[worker];
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
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
