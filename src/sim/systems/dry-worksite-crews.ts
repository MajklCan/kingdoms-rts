/**
 * Crews of a computer player's dried-up mines and quarries move on.
 *
 * A worksite crew outlives the deposits it was trained for: once a mine has
 * nothing left in reach its crew stands idle by it for good, holding
 * population places the AI counts as its workforce, so the AI neither trains
 * nor places anything more. Once a second, idle crew of such a dry site move
 * to an open slot at another of the owner's worksites, the endless ones
 * (mint, brickworks, forester's lodge) first. Only crew with no node to go to
 * move (IDLE: the drop-off and the depletion system set that only when none
 * is in reach), so a crew still working nodes further out stays; one idle
 * with part of a load delivers it first. Human crews are their player's to
 * re-task.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  Building,
  ConstructionSite,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  ResourceCarry,
  ResourceWorksite,
  WorksiteWorker,
} from '../components';
import { BuildingDefId, getBuildingDef, isEndlessWorksite } from '../defs';
import { aiResourceWorksiteCanStillProduce } from '../ai/snapshot';
import { sortedEids } from '../core/entities';
import { isAiControlledPlayer } from '../core/players';
import { worksiteWorkerQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { routeToNearestDropOff } from './dropoff';
import {
  countQueuedWorksiteWorkers,
  countWorksiteWorkers,
  getWorksiteWorkerSlots,
  worksiteUsesResourceNodes,
} from './worksites';

export const DRY_CREW_CHECK_TICKS = SIM.TICK_HZ;

/** `sites`: every resource worksite in deterministic order (the worksite system's list). */
export function reassignIdleDryCrews(world: SimWorld, sites: readonly number[]): void {
  if (world.tick % DRY_CREW_CHECK_TICKS !== 0) return;
  const drySites = new Set<number>();
  for (const siteEid of sites) {
    if (!isAiControlledPlayer(world, Owner.player[siteEid])) continue;
    if (!isWorkingSite(world, siteEid)) continue;
    const def = getBuildingDef(Building.defId[siteEid]);
    if (!def || !worksiteUsesResourceNodes(def)) continue;
    if (!aiResourceWorksiteCanStillProduce(world, siteEid, def)) drySites.add(siteEid);
  }
  if (drySites.size === 0) return;

  const idleByPlayer = new Map<number, number[]>();
  for (const worker of sortedEids(world, worksiteWorkerQuery(world.ecs))) {
    if (!drySites.has(WorksiteWorker.siteEid[worker])) continue;
    if (Health.hp[worker] <= 0) continue;
    if (Gatherer.state[worker] !== GathererStateId.IDLE) continue;
    if (ResourceCarry.amount[worker] > 0) {
      // Left standing with part of a load (its node went while he gathered):
      // he delivers it first and moves on idle and empty-handed.
      deliverLoad(world, worker);
      continue;
    }
    const owner = Owner.player[worker];
    const idle = idleByPlayer.get(owner) ?? [];
    idle.push(worker);
    idleByPlayer.set(owner, idle);
  }

  for (const [playerId, idle] of idleByPlayer) {
    let next = 0;
    for (const siteEid of destinationSites(world, sites, playerId)) {
      let open = getWorksiteWorkerSlots(world, siteEid) -
        countWorksiteWorkers(world, siteEid) -
        countQueuedWorksiteWorkers(world, siteEid);
      while (open > 0 && next < idle.length) {
        moveCrew(world, idle[next], siteEid);
        next++;
        open--;
      }
      if (next >= idle.length) break;
    }
  }
}

/** The owner's completed worksites that can still produce, endless ones first. Farms are left out. */
function destinationSites(world: SimWorld, sites: readonly number[], playerId: number): number[] {
  const endless: number[] = [];
  const nodeSites: number[] = [];
  for (const siteEid of sites) {
    if (Owner.player[siteEid] !== playerId || !isWorkingSite(world, siteEid)) continue;
    if (Building.defId[siteEid] === BuildingDefId.FARM) continue;
    const def = getBuildingDef(Building.defId[siteEid]);
    if (!def || def.harvestKind === undefined) continue;
    if (isEndlessWorksite(def)) endless.push(siteEid);
    else if (worksiteUsesResourceNodes(def) && aiResourceWorksiteCanStillProduce(world, siteEid, def)) {
      nodeSites.push(siteEid);
    }
  }
  return [...endless, ...nodeSites];
}

function isWorkingSite(world: SimWorld, siteEid: number): boolean {
  return hasComponent(world.ecs, ResourceWorksite, siteEid) &&
    !hasComponent(world.ecs, ConstructionSite, siteEid) &&
    Health.hp[siteEid] > 0;
}

function deliverLoad(world: SimWorld, worker: number): void {
  Gatherer.state[worker] = GathererStateId.RETURNING;
  Gatherer.cooldown[worker] = 0;
  world.paths.delete(worker);
  routeToNearestDropOff(world, worker);
}

/** Join `siteEid`'s crew; its worksite routes the worker from the next tick. */
function moveCrew(world: SimWorld, worker: number, siteEid: number): void {
  WorksiteWorker.siteEid[worker] = siteEid;
  Gatherer.state[worker] = GathererStateId.IDLE;
  Gatherer.targetEid[worker] = -1;
  Gatherer.cooldown[worker] = 0;
  world.paths.delete(worker);
}
