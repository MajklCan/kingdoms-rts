/**
 * What a villager looks like, derived from sim state. Pure and read-only, for
 * the render layer (sprite choice) and the HUD.
 *
 *   builder      every free villager (trained at the town center), also while
 *                he gathers by hand, hunts or helps at a worksite
 *   lumberjack   crew of a lumber hut
 *   farmer       crew of a farm
 *   quarryman    crew of a stone quarry
 *   gold-miner   crew of a gold mine
 *   miller       crew of a mill (no mill crews today; kept for the art)
 *
 * Hunting is a job, not a look: see villagerJob in ./villager-job.ts.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  ResourceKindId,
  ResourceWorksite,
  VillagerTag,
  WorksiteWorker,
} from '../components';
import { BuildingDefId } from '../defs';
import type { SimWorld } from './types';

export type VillagerRole =
  | 'builder'
  | 'lumberjack'
  | 'farmer'
  | 'quarryman'
  | 'gold-miner'
  | 'miller';

export const VILLAGER_ROLES: readonly VillagerRole[] = [
  'builder',
  'lumberjack',
  'farmer',
  'quarryman',
  'gold-miner',
  'miller',
];

/** Look of villager `eid`; null when `eid` is not a villager. */
export function villagerRole(world: SimWorld, eid: number): VillagerRole | null {
  const ecs = world.ecs;
  if (!hasComponent(ecs, VillagerTag, eid)) return null;
  if (!hasComponent(ecs, WorksiteWorker, eid)) return 'builder';
  return worksiteCrewRole(world, WorksiteWorker.siteEid[eid]);
}

/** The crew look a worksite building gives the workers it trains. */
export function worksiteCrewRole(world: SimWorld, siteEid: number): VillagerRole {
  const ecs = world.ecs;
  if (siteEid >= 0 && hasComponent(ecs, Building, siteEid)) {
    switch (Building.defId[siteEid]) {
      case BuildingDefId.FARM:
        return 'farmer';
      case BuildingDefId.LUMBER_CAMP:
        return 'lumberjack';
      case BuildingDefId.STONE_QUARRY:
        return 'quarryman';
      case BuildingDefId.GOLD_MINE:
        return 'gold-miner';
      case BuildingDefId.MILL:
        return 'miller';
    }
  }
  if (siteEid >= 0 && hasComponent(ecs, ResourceWorksite, siteEid)) {
    switch (ResourceWorksite.kind[siteEid]) {
      case ResourceKindId.WOOD:
        return 'lumberjack';
      case ResourceKindId.STONE:
        return 'quarryman';
      case ResourceKindId.GOLD:
        return 'gold-miner';
      case ResourceKindId.FOOD:
        return 'farmer';
    }
  }
  // Site gone this tick (the crew dies with it): keep a neutral look.
  return 'builder';
}
