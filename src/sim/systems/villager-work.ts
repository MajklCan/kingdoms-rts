/**
 * Work memory of free villagers: what a villager last worked at (gathering a
 * resource kind, hunting, helping a worksite), so a builder whose foundation
 * is done goes back to it instead of standing around.
 *
 *   set     when he starts gathering or hunting by hand, or joins a worksite
 *   kept    through build orders (that is the point)
 *   cleared by move, stop and attack orders: the player gave him a new plan
 *
 * The site is stored by NetId, which is never reused, so a memory of a
 * destroyed worksite can never point at a different building.
 */

import { addComponent, hasComponent } from 'bitecs';
import {
  Gatherer,
  GathererStateId,
  Position,
  type ResourceKind,
  ResourceCarry,
  VillagerJobId,
  VillagerWork,
} from '../components';
import { entityForNetId, netIdForEntity } from '../core/entities';
import type { SimWorld } from '../core/types';
import { routeToNearestDropOff } from './dropoff';
import { routeToNearestReachableResource } from './gathering';
import { HERD_RETARGET_RADIUS, routeToNearestGame } from './hunting';
import { helpRefusal, joinWorksite } from './worksite-helpers';

/** How far around the remembered spot a returning villager looks for work (tiles). */
export const RESUME_WORK_RADIUS = 12;

/** Remember that `eid` works at `job`. `at` is the node or worksite worked. */
export function rememberWork(world: SimWorld, eid: number, job: number, kind: number, at: number): void {
  if (!hasComponent(world.ecs, VillagerWork, eid)) addComponent(world.ecs, VillagerWork, eid);
  VillagerWork.job[eid] = job;
  VillagerWork.kind[eid] = kind;
  VillagerWork.siteNetId[eid] = job === VillagerJobId.HELP ? (netIdForEntity(world, at) ?? 0) : 0;
  VillagerWork.x[eid] = Position.x[at];
  VillagerWork.y[eid] = Position.y[at];
}

export function forgetWork(world: SimWorld, eid: number): void {
  if (!hasComponent(world.ecs, VillagerWork, eid)) return;
  VillagerWork.job[eid] = VillagerJobId.NONE;
  VillagerWork.kind[eid] = 0;
  VillagerWork.siteNetId[eid] = 0;
}

export function rememberedJob(world: SimWorld, eid: number): number {
  return hasComponent(world.ecs, VillagerWork, eid) ? VillagerWork.job[eid] : VillagerJobId.NONE;
}

/**
 * Send idle free villager `eid` back to the work he remembers, if it still
 * exists. False (he stays idle) when there is nothing to go back to.
 */
export function resumeWork(world: SimWorld, eid: number, playerId: number): boolean {
  const job = rememberedJob(world, eid);
  if (job === VillagerJobId.NONE) return false;
  if (job === VillagerJobId.HELP) {
    const site = entityForNetId(world, VillagerWork.siteNetId[eid]);
    if (site === null || helpRefusal(world, site, playerId) !== null) return false;
    joinWorksite(world, eid, site);
    return true;
  }
  const x = VillagerWork.x[eid];
  const y = VillagerWork.y[eid];
  const kind = VillagerWork.kind[eid] as ResourceKind;
  const routed = job === VillagerJobId.HUNT
    ? routeToNearestGame(world, eid, x, y, HERD_RETARGET_RADIUS) ||
      routeToNearestReachableResource(world, eid, kind, RESUME_WORK_RADIUS, x, y, new Set(), false)
    : routeToNearestReachableResource(world, eid, kind, RESUME_WORK_RADIUS, x, y, new Set(), false);
  if (!routed) return false;
  if (ResourceCarry.amount[eid] > 0 && ResourceCarry.kind[eid] !== kind) {
    // Deliver the old load first; the drop-off system sends him back to his target.
    Gatherer.state[eid] = GathererStateId.RETURNING;
    Gatherer.cooldown[eid] = 0;
    routeToNearestDropOff(world, eid);
  }
  return true;
}
