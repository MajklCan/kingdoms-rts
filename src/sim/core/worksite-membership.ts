/**
 * Which worksite a villager works for: its crew (WorksiteWorker) or a free
 * villager helping there (WorksiteHelper). Read-only helpers shared by the
 * worksite, gathering and drop-off systems.
 */

import { hasComponent } from 'bitecs';
import { WorksiteHelper, WorksiteWorker } from '../components';
import type { SimWorld } from './types';

/** The worksite `eid` works for, or -1. */
export function worksiteOf(world: SimWorld, eid: number): number {
  if (hasComponent(world.ecs, WorksiteWorker, eid)) return WorksiteWorker.siteEid[eid];
  if (hasComponent(world.ecs, WorksiteHelper, eid)) return WorksiteHelper.siteEid[eid];
  return -1;
}

export function isWorksiteHelper(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, WorksiteHelper, eid);
}

/** Extra helpers (beyond the crew slots) work this share of ticks: 3 in 5. */
export const HELPER_EXTRA_WORK_TICKS = 3;
export const HELPER_EXTRA_WORK_PERIOD = 5;

/**
 * Does `eid` work this tick? Crews and slot-filling helpers always do; an
 * extra helper works on exactly 3 of every 5 ticks (60 %). Spread by the tick
 * number, so nothing extra is saved.
 */
export function worksThisTick(world: SimWorld, eid: number): boolean {
  if (!hasComponent(world.ecs, WorksiteHelper, eid) || WorksiteHelper.extra[eid] === 0) return true;
  const t = world.tick;
  const n = HELPER_EXTRA_WORK_TICKS;
  const d = HELPER_EXTRA_WORK_PERIOD;
  return Math.floor((n * (t + 1)) / d) - Math.floor((n * t) / d) === 1;
}
