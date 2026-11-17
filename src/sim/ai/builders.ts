/**
 * AI builders: keep a few free villagers around and send the idle ones to
 * unfinished foundations. Buildings only go up while a villager works on
 * them, the same rule the human player has, so killing an AI's villagers
 * stalls its construction until the town center trains new ones.
 */

import { hasComponent } from 'bitecs';
import {
  AttackTarget,
  BuildOrder,
  Building,
  Gatherer,
  GathererStateId,
  Owner,
  Position,
  TownCenterTag,
  WorksiteHelper,
} from '../components';
import { BuildingDefId, UnitDefId } from '../defs';
import { POP_CAP_HARD_LIMIT } from '../core/constants';
import { countQueuedPopCost } from '../core/population';
import { sortedEids } from '../core/entities';
import { distToBuildingEdge } from '../core/grid';
import { isIdleVillager } from '../core/idle-villagers';
import { foundationQuery, unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { canBuild, isOpenFoundation } from '../systems/builders';
import { aiSettings } from './difficulty';
import { activeAiActuator } from './direct-actuator';
import { aiPutIdleBuildersToWork } from './idle-builders';
import { aiQueueUnit } from './placement';
import { type AiSnapshot, aiIsCompletedBuilding } from './snapshot';

/** Free villagers the AI keeps for construction. */
export const AI_BUILDER_TARGET = 3;
/** Builders the AI puts on one foundation. */
export const AI_BUILDERS_PER_SITE = 2;

function freeVillagers(world: SimWorld, playerId: number): number[] {
  return sortedEids(world, unitQuery(world.ecs)).filter(
    (eid) => Owner.player[eid] === playerId && canBuild(world, eid)
  );
}

/**
 * Send free villagers to the player's open foundations; with none to build,
 * idle builders help at worksites or hunt and gather instead.
 */
export function aiManageBuilders(world: SimWorld, playerId: number): void {
  const villagers = freeVillagers(world, playerId);
  const sites = housesFirstAtCap(
    world,
    playerId,
    sortedEids(world, foundationQuery(world.ecs)).filter((eid) => isOpenFoundation(world, eid, playerId))
  );
  if (sites.length === 0) {
    aiPutIdleBuildersToWork(world, playerId, villagers);
    return;
  }

  const assigned = new Map<number, number>();
  for (const eid of villagers) {
    const site = BuildOrder.targetEid[eid];
    if (site >= 0) assigned.set(site, (assigned.get(site) ?? 0) + 1);
  }
  const idle = villagers.filter((eid) => isIdleVillager(world, eid, playerId));
  // Builders helping at a worksite or gathering by hand come back for a new
  // foundation (their work memory sends them back once it is up), but only
  // after the idle ones are used.
  const busy = villagers.filter((eid) => !idle.includes(eid) && isPullableWorker(world, eid));
  // First one builder on every site, then a second where villagers are left.
  for (let wanted = 1; wanted <= AI_BUILDERS_PER_SITE && idle.length + busy.length > 0; wanted++) {
    for (const site of sites) {
      if (idle.length + busy.length === 0) break;
      if ((assigned.get(site) ?? 0) >= wanted) continue;
      const builder = takeNearest(world, idle.length > 0 ? idle : busy, site);
      activeAiActuator().build(world, playerId, [builder], site);
      assigned.set(site, (assigned.get(site) ?? 0) + 1);
    }
  }
}

/**
 * Keep AI_BUILDER_TARGET free villagers. Runs before the economy and the army
 * queue anything: worksite crews and soldiers take population places too, and
 * an AI at its cap without a builder could never raise the house it needs.
 */
export function aiTrainBuilders(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  const villagerCount = freeVillagers(world, playerId).length;
  const townCenter = snapshot.myBuildings.find(
    (eid) => hasComponent(world.ecs, TownCenterTag, eid) && aiIsCompletedBuilding(world, eid)
  );
  if (townCenter === undefined) return;
  const queued = (world.productionQueues.get(townCenter) ?? []).filter(
    (defId) => defId === UnitDefId.VILLAGER
  ).length;
  if (villagerCount + queued >= AI_BUILDER_TARGET) return;
  aiQueueUnit(world, townCenter, UnitDefId.VILLAGER);
}

/**
 * At (or close to) the population cap the town waits on its houses, so their
 * foundations get builders first; otherwise NetId order. Before Housing I
 * the AI places its few houses after the first worksites, and without this
 * the builders finished those first while the cap held everything else.
 */
function housesFirstAtCap(world: SimWorld, playerId: number, sites: number[]): number[] {
  const pop = world.population[playerId];
  if (!pop || pop.cap >= POP_CAP_HARD_LIMIT) return sites;
  const room = pop.cap - (pop.current + countQueuedPopCost(world, playerId));
  if (room > aiSettings(world).houseHeadroom) return sites;
  const isHouse = (eid: number) => Building.defId[eid] === BuildingDefId.HOUSE;
  return [...sites.filter(isHouse), ...sites.filter((eid) => !isHouse(eid))];
}

/** A free villager working (helping a worksite or gathering), not fighting or building. */
function isPullableWorker(world: SimWorld, eid: number): boolean {
  if (BuildOrder.targetEid[eid] >= 0) return false;
  if (hasComponent(world.ecs, AttackTarget, eid) && AttackTarget.targetEid[eid] >= 0) return false;
  return hasComponent(world.ecs, WorksiteHelper, eid) || Gatherer.state[eid] !== GathererStateId.IDLE;
}

/** Remove and return the villager in `idle` closest to `site` (first in NetId order on a tie). */
function takeNearest(world: SimWorld, idle: number[], site: number): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < idle.length; i++) {
    const eid = idle[i];
    const dist = hasComponent(world.ecs, Building, site)
      ? distToBuildingEdge(world, Position.x[eid], Position.y[eid], site)
      : Infinity;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return idle.splice(bestIndex, 1)[0];
}
