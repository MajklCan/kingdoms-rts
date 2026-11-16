/**
 * What a villager is doing right now, derived from sim state. Pure and
 * read-only, for the HUD status line and the render (hunting is a job, not a
 * look: see villagerRole in ./villager-role.ts for the look).
 */

import { hasComponent } from 'bitecs';
import {
  AttackTarget,
  BuildOrder,
  GameAnimal,
  Gatherer,
  GathererStateId,
  Resource,
  ResourceCarry,
  VillagerTag,
  WorksiteHelper,
  WorksiteWorker,
} from '../components';
import type { SimWorld } from './types';

export type VillagerJob =
  /** Walking to or working on own foundation `siteEid`. */
  | { job: 'building'; siteEid: number }
  /** Free villager helping at worksite `siteEid`; `extra` = beyond the crew slots. */
  | { job: 'helping'; siteEid: number; extra: boolean }
  /** Trained crew of worksite `siteEid`. */
  | { job: 'crew'; siteEid: number }
  /** Hunting game (walking to it, killing, butchering or carrying the meat home). */
  | { job: 'hunting'; targetEid: number }
  /** Gathering resource `kind` by hand (walking, gathering or carrying it home). */
  | { job: 'gathering'; kind: number }
  | { job: 'fighting' }
  | { job: 'walking' }
  | { job: 'idle' };

/** Job of villager `eid`; null when `eid` is not a villager. */
export function villagerJob(world: SimWorld, eid: number): VillagerJob | null {
  const ecs = world.ecs;
  if (!hasComponent(ecs, VillagerTag, eid)) return null;
  if (hasComponent(ecs, WorksiteWorker, eid)) return { job: 'crew', siteEid: WorksiteWorker.siteEid[eid] };
  if (hasComponent(ecs, WorksiteHelper, eid)) {
    return { job: 'helping', siteEid: WorksiteHelper.siteEid[eid], extra: WorksiteHelper.extra[eid] === 1 };
  }
  if (hasComponent(ecs, BuildOrder, eid) && BuildOrder.targetEid[eid] >= 0) {
    return { job: 'building', siteEid: BuildOrder.targetEid[eid] };
  }
  if (hasComponent(ecs, AttackTarget, eid) && AttackTarget.targetEid[eid] >= 0) return { job: 'fighting' };
  if (hasComponent(ecs, Gatherer, eid) && Gatherer.state[eid] !== GathererStateId.IDLE) {
    const target = Gatherer.targetEid[eid];
    if (target >= 0 && hasComponent(ecs, GameAnimal, target)) return { job: 'hunting', targetEid: target };
    if (target >= 0 && hasComponent(ecs, Resource, target)) return { job: 'gathering', kind: Resource.kind[target] };
    if (hasComponent(ecs, ResourceCarry, eid) && ResourceCarry.amount[eid] > 0) {
      return { job: 'gathering', kind: ResourceCarry.kind[eid] };
    }
  }
  const path = world.paths.get(eid);
  if (path && path.length > 0) return { job: 'walking' };
  return { job: 'idle' };
}
