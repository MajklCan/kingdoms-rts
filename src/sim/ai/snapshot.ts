/**
 * Per-think snapshot of what an AI player owns and sees.
 */

import { hasComponent } from 'bitecs';
import {
  ArcherTag,
  Building,
  CannonTag,
  ConstructionSite,
  GunmanTag,
  Health,
  Owner,
  Position,
  type ResourceKind,
  ScoutCavalryTag,
  SpearmanTag,
  VillagerTag,
} from '../components';
import { type BuildingDef, getBuildingDef } from '../defs';
import { isRivalPlayer } from '../core/players';
import { findNearestResource } from '../core/lookup';
import { buildingQuery, townCenterQuery, unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { worksiteUsesResourceNodes } from '../systems/worksites';

export interface AiSnapshot {
  tcEid: number;
  myBuildings: number[];
  myMilitary: number[];
  mySpearmen: number[];
  myArchers: number[];
  myScouts: number[];
  myGunmen: number[];
  myCannons: number[];
  enemyBuildings: number[];
  enemyMilitary: number[];
}

export function collectAiSnapshot(world: SimWorld, playerId: number): AiSnapshot | null {
  let tcEid = -1;
  for (const eid of townCenterQuery(world.ecs)) {
    if (Owner.player[eid] === playerId && Health.hp[eid] > 0) {
      tcEid = eid;
      break;
    }
  }
  if (tcEid < 0) return null;

  const myBuildings: number[] = [];
  const enemyBuildings: number[] = [];
  for (const eid of buildingQuery(world.ecs)) {
    if (Health.hp[eid] <= 0) continue;
    if (Owner.player[eid] === playerId) myBuildings.push(eid);
    else if (isRivalPlayer(Owner.player[eid], playerId)) enemyBuildings.push(eid);
  }

  const myMilitary: number[] = [];
  const mySpearmen: number[] = [];
  const myArchers: number[] = [];
  const myScouts: number[] = [];
  const myGunmen: number[] = [];
  const myCannons: number[] = [];
  const enemyMilitary: number[] = [];
  for (const eid of unitQuery(world.ecs)) {
    if (Health.hp[eid] <= 0) continue;
    if (hasComponent(world.ecs, VillagerTag, eid)) continue;
    if (Owner.player[eid] === playerId) {
      myMilitary.push(eid);
      if (hasComponent(world.ecs, SpearmanTag, eid)) mySpearmen.push(eid);
      else if (hasComponent(world.ecs, ArcherTag, eid)) myArchers.push(eid);
      else if (hasComponent(world.ecs, ScoutCavalryTag, eid)) myScouts.push(eid);
      else if (hasComponent(world.ecs, GunmanTag, eid)) myGunmen.push(eid);
      else if (hasComponent(world.ecs, CannonTag, eid)) myCannons.push(eid);
    } else if (isRivalPlayer(Owner.player[eid], playerId)) {
      enemyMilitary.push(eid);
    }
  }

  return {
    tcEid,
    myBuildings,
    myMilitary,
    mySpearmen,
    myArchers,
    myScouts,
    myGunmen,
    myCannons,
    enemyBuildings,
    enemyMilitary,
  };
}

export function aiHasAnyBuilding(snapshot: AiSnapshot, defId: number): boolean {
  return snapshot.myBuildings.some((eid) => Building.defId[eid] === defId);
}

export function countAiBuildings(snapshot: AiSnapshot, defId: number): number {
  return countBuildings(snapshot.myBuildings, defId);
}

export function countAiEffectiveEconomyBuildings(
  world: SimWorld,
  snapshot: AiSnapshot,
  defId: number
): number {
  const def = getBuildingDef(defId);
  if (!def || !worksiteUsesResourceNodes(def)) return countAiBuildings(snapshot, defId);
  return snapshot.myBuildings.filter((eid) =>
    Building.defId[eid] === defId && aiResourceWorksiteCanStillProduce(world, eid, def)
  ).length;
}

export function aiResourceWorksiteCanStillProduce(
  world: SimWorld,
  eid: number,
  def: BuildingDef
): boolean {
  if (hasComponent(world.ecs, ConstructionSite, eid)) return true;
  if (Health.hp[eid] <= 0) return false;
  if (def.harvestKind === undefined) return true;
  return findNearestResource(
    world,
    Position.x[eid],
    Position.y[eid],
    def.harvestKind as ResourceKind,
    def.harvestRadius ?? 6
  ) !== null;
}

export function countEnemyBuildings(snapshot: AiSnapshot, defId: number): number {
  return countBuildings(snapshot.enemyBuildings, defId);
}

function countBuildings(buildings: number[], defId: number): number {
  return buildings.filter((eid) => Building.defId[eid] === defId).length;
}

export function aiIsCompletedBuilding(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, Building, eid) &&
    !hasComponent(world.ecs, ConstructionSite, eid);
}

export function aiCompletedBuildingCount(world: SimWorld, snapshot: AiSnapshot, defId: number): number {
  return snapshot.myBuildings.filter((eid) =>
    Building.defId[eid] === defId && aiIsCompletedBuilding(world, eid)
  ).length;
}
