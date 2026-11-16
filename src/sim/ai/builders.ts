/**
 * AI builders: keep a few free villagers around and send the idle ones to
 * unfinished foundations. Buildings only go up while a villager works on
 * them, the same rule the human player has, so killing an AI's villagers
 * stalls its construction until the town center trains new ones.
 */

import { hasComponent } from 'bitecs';
import { BuildOrder, Building, Owner, Position, TownCenterTag } from '../components';
import { UnitDefId } from '../defs';
import { sortedEids } from '../core/entities';
import { distToBuildingEdge } from '../core/grid';
import { isIdleVillager } from '../core/idle-villagers';
import { foundationQuery, unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { canBuild, isOpenFoundation } from '../systems/builders';
import { activeAiActuator } from './direct-actuator';
import { aiQueueUnit } from './placement';
import { type AiSnapshot, aiIsCompletedBuilding } from './snapshot';

/** Free villagers the AI keeps for construction. */
export const AI_BUILDER_TARGET = 3;
/** Builders the AI puts on one foundation. */
export const AI_BUILDERS_PER_SITE = 2;

export function aiManageBuilders(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  const villagers = sortedEids(world, unitQuery(world.ecs)).filter(
    (eid) => Owner.player[eid] === playerId && canBuild(world, eid)
  );
  aiTrainBuilders(world, snapshot, villagers.length);

  const sites = sortedEids(world, foundationQuery(world.ecs)).filter((eid) =>
    isOpenFoundation(world, eid, playerId)
  );
  if (sites.length === 0) return;

  const assigned = new Map<number, number>();
  for (const eid of villagers) {
    const site = BuildOrder.targetEid[eid];
    if (site >= 0) assigned.set(site, (assigned.get(site) ?? 0) + 1);
  }
  const idle = villagers.filter((eid) => isIdleVillager(world, eid, playerId));
  // First one builder on every site, then a second where villagers are left.
  for (let wanted = 1; wanted <= AI_BUILDERS_PER_SITE && idle.length > 0; wanted++) {
    for (const site of sites) {
      if (idle.length === 0) break;
      if ((assigned.get(site) ?? 0) >= wanted) continue;
      const builder = takeNearest(world, idle, site);
      activeAiActuator().build(world, playerId, [builder], site);
      assigned.set(site, (assigned.get(site) ?? 0) + 1);
    }
  }
}

function aiTrainBuilders(world: SimWorld, snapshot: AiSnapshot, villagerCount: number): void {
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
