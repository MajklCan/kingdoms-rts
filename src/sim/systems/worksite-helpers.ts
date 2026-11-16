/**
 * Free villagers helping at a completed worksite (farm, lumber hut, quarry,
 * gold mine). A helper works exactly like a crew member, driven by the
 * worksite system, but stays a free villager: selectable, commandable, and
 * any other order takes him off the site (see clearWorkOrders).
 *
 * Rules:
 *   - A helper first fills the site's open crew slots (slots - crew) and then
 *     works at the full crew rate: the player saves the worker's cost.
 *   - Beyond the slots up to WORKSITE_EXTRA_HELPERS more may help, each at
 *     60 % (works 3 of every 5 ticks, see worksThisTick).
 *   - Helpers are ranked by NetId: the first ones fill open slots. When a
 *     trained crew member takes a slot, the last helper becomes extra; a
 *     helper beyond slots + extras is sent off (idle).
 *   - Helpers never count as crew: countWorksiteWorkers, training slots and
 *     the AI re-crew rule see the trained crew only. Population is untouched
 *     (a free villager already holds his place).
 *   - A worksite that is removed or destroyed frees its helpers.
 */

import { addComponent, hasComponent, removeComponent } from 'bitecs';
import {
  BuildOrder,
  Building,
  ConstructionSite,
  DeadTag,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  ResourceCarry,
  ResourceWorksite,
  VillagerJobId,
  WorksiteHelper,
} from '../components';
import { getBuildingDef } from '../defs';
import { sortedEids } from '../core/entities';
import { worksiteHelperQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { canBuild } from './builders';
import { routeToNearestDropOff } from './dropoff';
import { rememberWork } from './villager-work';
import { countWorksiteWorkers, getWorksiteWorkerSlots } from './worksites';

/** Helpers a worksite takes beyond its crew slots. */
export const WORKSITE_EXTRA_HELPERS = 2;
/** Work rate of an extra helper relative to a crew member, in percent. */
export const WORKSITE_EXTRA_HELPER_RATE_PERCENT = 60;

export type HelpRefusal = 'not-worksite' | 'unfinished' | 'foreign' | 'full' | null;

/** A completed, living worksite of `playerId`. */
export function isHelpableWorksite(world: SimWorld, siteEid: number, playerId: number): boolean {
  const refusal = helpRefusal(world, siteEid, playerId);
  return refusal === null || refusal === 'full';
}

/** Why free villagers of `playerId` cannot help at `siteEid` right now, or null. */
export function helpRefusal(world: SimWorld, siteEid: number, playerId: number): HelpRefusal {
  const ecs = world.ecs;
  if (siteEid < 0 || !hasComponent(ecs, Building, siteEid)) return 'not-worksite';
  if (getBuildingDef(Building.defId[siteEid])?.harvestKind === undefined) return 'not-worksite';
  if (hasComponent(ecs, DeadTag, siteEid) || Health.hp[siteEid] <= 0) return 'not-worksite';
  if (Owner.player[siteEid] !== playerId) return 'foreign';
  if (hasComponent(ecs, ConstructionSite, siteEid)) return 'unfinished';
  if (!hasComponent(ecs, ResourceWorksite, siteEid)) return 'not-worksite';
  if (getWorksiteWorkerSlots(world, siteEid) <= 0) return 'not-worksite';
  if (countWorksiteHelpers(world, siteEid) >= worksiteHelperCapacity(world, siteEid)) return 'full';
  return null;
}

/** How many helpers `siteEid` takes: its open crew slots plus the extras. */
export function worksiteHelperCapacity(world: SimWorld, siteEid: number): number {
  const open = Math.max(0, getWorksiteWorkerSlots(world, siteEid) - countWorksiteWorkers(world, siteEid));
  return open + WORKSITE_EXTRA_HELPERS;
}

/** Living helpers of `siteEid`, in NetId order. */
export function worksiteHelpersOf(world: SimWorld, siteEid: number): number[] {
  return sortedEids(
    world,
    worksiteHelperQuery(world.ecs).filter(
      (eid) => WorksiteHelper.siteEid[eid] === siteEid && Health.hp[eid] > 0
    )
  );
}

export function countWorksiteHelpers(world: SimWorld, siteEid: number): number {
  let count = 0;
  for (const eid of worksiteHelperQuery(world.ecs)) {
    if (WorksiteHelper.siteEid[eid] === siteEid && Health.hp[eid] > 0) count++;
  }
  return count;
}

/**
 * Put free villager `eid` on worksite `siteEid` (validated by the caller).
 * His other work is dropped; the worksite system walks him there next tick.
 */
export function joinWorksite(world: SimWorld, eid: number, siteEid: number): void {
  if (hasComponent(world.ecs, BuildOrder, eid)) BuildOrder.targetEid[eid] = -1;
  Gatherer.state[eid] = GathererStateId.IDLE;
  Gatherer.targetEid[eid] = -1;
  Gatherer.cooldown[eid] = 0;
  world.paths.delete(eid);
  if (!hasComponent(world.ecs, WorksiteHelper, eid)) addComponent(world.ecs, WorksiteHelper, eid);
  WorksiteHelper.siteEid[eid] = siteEid;
  WorksiteHelper.extra[eid] = 0;
  rememberWork(world, eid, VillagerJobId.HELP, ResourceWorksite.kind[siteEid], siteEid);
  sendHelperHomeWithForeignLoad(world, eid, siteEid);
}

/** Take `eid` off his worksite, if he helps at one. Leaves his gatherer state alone. */
export function leaveWorksite(world: SimWorld, eid: number): void {
  if (hasComponent(world.ecs, WorksiteHelper, eid)) removeComponent(world.ecs, WorksiteHelper, eid);
}

/**
 * True when helper `eid` carries something his site does not produce: he
 * walks it to a drop-off first (the drop-off system hands him back to the
 * site, see routeWorksiteWorkerAfterDropoff).
 */
export function sendHelperHomeWithForeignLoad(world: SimWorld, eid: number, siteEid: number): boolean {
  if (ResourceCarry.amount[eid] <= 0) return false;
  if (ResourceCarry.kind[eid] === ResourceWorksite.kind[siteEid]) return false;
  const state = Gatherer.state[eid];
  if (state !== GathererStateId.RETURNING && state !== GathererStateId.DEPOSITING) {
    Gatherer.state[eid] = GathererStateId.RETURNING;
    Gatherer.cooldown[eid] = 0;
    world.paths.delete(eid);
    routeToNearestDropOff(world, eid);
  }
  return true;
}

/**
 * Rank the helpers of `siteEid` (worksite system, every tick): the first
 * fill open slots at full rate, the next WORKSITE_EXTRA_HELPERS work as
 * extras, any further one is sent off.
 */
export function refreshWorksiteHelpers(world: SimWorld, siteEid: number): void {
  const helpers = worksiteHelpersOf(world, siteEid);
  if (helpers.length === 0) return;
  const open = Math.max(0, getWorksiteWorkerSlots(world, siteEid) - countWorksiteWorkers(world, siteEid));
  helpers.forEach((eid, index) => {
    if (index < open) {
      WorksiteHelper.extra[eid] = 0;
    } else if (index < open + WORKSITE_EXTRA_HELPERS) {
      WorksiteHelper.extra[eid] = 1;
    } else {
      dismissHelper(world, eid);
    }
  });
}

/** Free every helper of `siteEid` (the site is being removed or was destroyed). */
export function releaseWorksiteHelpers(world: SimWorld, siteEid: number): void {
  for (const eid of worksiteHelpersOf(world, siteEid)) dismissHelper(world, eid);
}

/** Free helpers whose site is gone, unfinished, someone else's, or who can no longer work. */
export function releaseStrandedHelpers(world: SimWorld): void {
  for (const eid of sortedEids(world, worksiteHelperQuery(world.ecs))) {
    const siteEid = WorksiteHelper.siteEid[eid];
    if (isHelpableWorksite(world, siteEid, Owner.player[eid]) && canBuild(world, eid)) continue;
    dismissHelper(world, eid);
  }
}

function dismissHelper(world: SimWorld, eid: number): void {
  leaveWorksite(world, eid);
  world.paths.delete(eid);
  Gatherer.targetEid[eid] = -1;
  Gatherer.cooldown[eid] = 0;
  if (ResourceCarry.amount[eid] > 0 && Health.hp[eid] > 0) {
    Gatherer.state[eid] = GathererStateId.RETURNING;
    routeToNearestDropOff(world, eid);
    return;
  }
  Gatherer.state[eid] = GathererStateId.IDLE;
}
