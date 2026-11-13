/**
 * AI military production: barracks targets and army composition.
 */

import { hasComponent } from 'bitecs';
import {
  ArcherTag,
  Building,
  CannonTag,
  ConstructionSite,
  Position,
  ScoutCavalryTag,
  SpearmanTag,
} from '../components';
import { AgeId, BuildingDefId, UnitDefId } from '../defs';
import { TechId, hasTech } from '../tech-tree';
import type { SimWorld } from '../core/types';
import { aiRequiredWaveSize } from './attack';
import { aiDifficultyOf, aiSettings } from './difficulty';
import {
  AI_PRODUCER_QUEUE_TARGET,
  type AiProductionMacro,
  aiAnalyzeProductionMacro,
  aiIsArmyProducerDef,
  aiTrainableUnitsForProducer,
} from './economy';
import { aiPlaceBuilding, aiQueueUnit } from './placement';
import {
  type AiSnapshot,
  aiCompletedBuildingCount,
  aiHasAnyBuilding,
  aiIsCompletedBuilding,
  countAiBuildings,
} from './snapshot';

function aiHardDesiredBarracksCount(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot,
  macro: AiProductionMacro
): number {
  if (!hasTech(world, playerId, TechId.BARRACKS_PIKEMEN)) return 0;
  const settings = aiSettings(world);
  const farms = aiCompletedBuildingCount(world, snapshot, BuildingDefId.FARM);
  const lumber = aiCompletedBuildingCount(world, snapshot, BuildingDefId.LUMBER_CAMP);
  let target = 1;
  if (farms >= 5 && lumber >= 3) target = 2;
  if (farms >= 8 && lumber >= 4) target = 3;
  if (farms >= 12 && lumber >= 5) target = 4;
  if (farms >= 16 && lumber >= 7) target = 5;
  if (farms >= 22 && lumber >= 9) target = 6;

  const playerPressureTarget = Math.ceil(snapshot.enemyMilitary.length / 12);
  target = Math.max(target, playerPressureTarget);

  const queuesAreSaturated = macro.producerCount > 0 &&
    macro.productionUptime >= 0.75 &&
    macro.fullProducers >= Math.max(1, Math.ceil(macro.producerCount * 0.5));
  if (queuesAreSaturated) target++;

  const isResourceStarved = macro.producerCount > 0 &&
    macro.productionUptime < 0.45 &&
    macro.bottleneck !== null;
  if (isResourceStarved) target = Math.min(target, Math.max(1, macro.producerCount));

  return Math.min(settings.barracksHardLateTarget, Math.max(1, target));
}

export function aiMaintainMilitaryInfrastructure(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot
): void {
  const tcX = Position.x[snapshot.tcEid];
  const tcY = Position.y[snapshot.tcEid];
  const hasBarracks = aiHasAnyBuilding(snapshot, BuildingDefId.BARRACKS);
  const hasStable = aiHasAnyBuilding(snapshot, BuildingDefId.STABLE);
  const hasFoundry = aiHasAnyBuilding(snapshot, BuildingDefId.FOUNDRY);
  const hasFoodEconomy = aiHasAnyBuilding(snapshot, BuildingDefId.FARM);
  const hasWoodEconomy = aiHasAnyBuilding(snapshot, BuildingDefId.LUMBER_CAMP);
  const settings = aiSettings(world);
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const macro = aiDifficultyOf(world) === 'hard'
    ? aiAnalyzeProductionMacro(world, playerId, snapshot)
    : null;
  const desiredBarracks = macro
    ? aiHardDesiredBarracksCount(world, playerId, snapshot, macro)
    : age >= AgeId.CASTLE
      ? settings.barracksCastleTarget
      : 1;

  if (!hasBarracks && hasFoodEconomy && hasWoodEconomy) {
    aiPlaceBuilding(world, BuildingDefId.BARRACKS, tcX, tcY, playerId);
  }
  if (hasBarracks && countAiBuildings(snapshot, BuildingDefId.BARRACKS) < desiredBarracks) {
    aiPlaceBuilding(world, BuildingDefId.BARRACKS, tcX, tcY, playerId);
  }
  if (
    hasBarracks &&
    !hasStable &&
    age >= AgeId.CASTLE
  ) {
    aiPlaceBuilding(world, BuildingDefId.STABLE, tcX, tcY, playerId);
  }
  if (
    age >= AgeId.CASTLE &&
    !aiHasAnyBuilding(snapshot, BuildingDefId.DEFENSIVE_TOWER)
  ) {
    aiPlaceBuilding(world, BuildingDefId.DEFENSIVE_TOWER, tcX, tcY, playerId);
  }
  if (
    age >= AgeId.GUNPOWDER &&
    hasStable &&
    !hasFoundry
  ) {
    aiPlaceBuilding(world, BuildingDefId.FOUNDRY, tcX, tcY, playerId);
  }
}

export function aiTrainArmy(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  if (aiDifficultyOf(world) === 'hard') {
    aiTrainHardArmy(world, playerId, snapshot);
    return;
  }

  const pop = world.population[playerId];
  if (!pop) return;
  const queued = aiQueuedUnitCounts(world, snapshot.myBuildings);
  const armyCount =
    snapshot.myMilitary.length +
    queued.spearmen +
    queued.archers +
    queued.scouts +
    queued.gunmen +
    queued.cannons;
  if (armyCount >= aiSettings(world).maxArmyUnits) return;

  const desired = aiDesiredArmyMix(world, playerId, snapshot);
  for (const producerEid of snapshot.myBuildings) {
    if (!aiIsCompletedBuilding(world, producerEid)) continue;
    const defId = Building.defId[producerEid];
    if (defId === BuildingDefId.BARRACKS) {
      const spearNeed = desired.spearmen - (snapshot.mySpearmen.length + queued.spearmen);
      const archerNeed = desired.archers - (snapshot.myArchers.length + queued.archers);
      const producerQueue = world.productionQueues.get(producerEid) ?? [];
      const hasQueuedSpear = producerQueue.includes(UnitDefId.SPEARMAN);
      const hasQueuedArcher = producerQueue.includes(UnitDefId.ARCHER);
      const preferArcher = archerNeed > 0 && (
        archerNeed > spearNeed ||
        (hasQueuedSpear && !hasQueuedArcher)
      );
      if (preferArcher && aiQueueUnit(world, producerEid, UnitDefId.ARCHER)) {
        queued.archers++;
      } else if (spearNeed > 0 && aiQueueUnit(world, producerEid, UnitDefId.SPEARMAN)) {
        queued.spearmen++;
      } else if (archerNeed > 0 && aiQueueUnit(world, producerEid, UnitDefId.ARCHER)) {
        queued.archers++;
      }
    } else if (defId === BuildingDefId.STABLE && snapshot.myScouts.length + queued.scouts < desired.scouts) {
      if (aiQueueUnit(world, producerEid, UnitDefId.SCOUT_CAVALRY)) queued.scouts++;
    } else if (defId === BuildingDefId.FOUNDRY && snapshot.myCannons.length + queued.cannons < desired.cannons) {
      if (aiQueueUnit(world, producerEid, UnitDefId.CANNON)) queued.cannons++;
    } else if (defId === BuildingDefId.FOUNDRY && snapshot.myGunmen.length + queued.gunmen < desired.gunmen) {
      if (aiQueueUnit(world, producerEid, UnitDefId.GUNMAN)) queued.gunmen++;
    }
  }
}

function aiTrainHardArmy(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  const pop = world.population[playerId];
  if (!pop) return;
  const queued = aiQueuedUnitCounts(world, snapshot.myBuildings);
  let armyCount =
    snapshot.myMilitary.length +
    queued.spearmen +
    queued.archers +
    queued.scouts +
    queued.gunmen +
    queued.cannons;
  const settings = aiSettings(world);
  if (armyCount >= settings.maxArmyUnits) return;

  const desired = aiDesiredArmyMix(world, playerId, snapshot);
  for (const producerEid of snapshot.myBuildings) {
    if (!aiIsCompletedBuilding(world, producerEid)) continue;
    if (!aiIsArmyProducerDef(Building.defId[producerEid])) continue;
    let producerQueue = world.productionQueues.get(producerEid) ?? [];
    while (producerQueue.length < AI_PRODUCER_QUEUE_TARGET && armyCount < settings.maxArmyUnits) {
      const candidates = aiHardUnitCandidateOrder(world, playerId, producerEid, snapshot, queued, desired);
      let queuedUnit: number | null = null;
      for (const unitDefId of candidates) {
        if (aiQueueUnit(world, producerEid, unitDefId)) {
          queuedUnit = unitDefId;
          break;
        }
      }
      if (queuedUnit === null) break;
      aiIncrementQueuedArmyCount(queued, queuedUnit);
      armyCount++;
      producerQueue = world.productionQueues.get(producerEid) ?? [];
    }
  }
}

function aiHardUnitCandidateOrder(
  world: SimWorld,
  playerId: number,
  producerEid: number,
  snapshot: AiSnapshot,
  queued: { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number },
  desired: { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number }
): number[] {
  return aiTrainableUnitsForProducer(world, playerId, producerEid)
    .sort((a, b) =>
      aiHardUnitScore(world, b, snapshot, queued, desired) -
      aiHardUnitScore(world, a, snapshot, queued, desired)
    );
}

function aiHardUnitScore(
  world: SimWorld,
  unitDefId: number,
  snapshot: AiSnapshot,
  queued: { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number },
  desired: { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number }
): number {
  if (unitDefId === UnitDefId.SPEARMAN) {
    const current = snapshot.mySpearmen.length + queued.spearmen;
    return (desired.spearmen - current) * 100 + 25 - current;
  }
  if (unitDefId === UnitDefId.ARCHER) {
    const current = snapshot.myArchers.length + queued.archers;
    return (desired.archers - current) * 100 + 25 - current;
  }
  if (unitDefId === UnitDefId.SCOUT_CAVALRY) {
    const current = snapshot.myScouts.length + queued.scouts;
    return (desired.scouts - current) * 100 + 18 - current;
  }
  if (unitDefId === UnitDefId.GUNMAN) {
    const current = snapshot.myGunmen.length + queued.gunmen;
    return (desired.gunmen - current) * 100 + 18 - current;
  }
  if (unitDefId === UnitDefId.CANNON) {
    const current = snapshot.myCannons.length + queued.cannons;
    const enemyBuildings = snapshot.enemyBuildings.filter((eid) =>
      !hasComponent(world.ecs, ConstructionSite, eid)
    ).length;
    return (desired.cannons - current) * 100 + Math.min(20, enemyBuildings) - current * 3;
  }
  return 0;
}

function aiIncrementQueuedArmyCount(
  queued: { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number },
  unitDefId: number
): void {
  if (unitDefId === UnitDefId.SPEARMAN) queued.spearmen++;
  else if (unitDefId === UnitDefId.ARCHER) queued.archers++;
  else if (unitDefId === UnitDefId.SCOUT_CAVALRY) queued.scouts++;
  else if (unitDefId === UnitDefId.GUNMAN) queued.gunmen++;
  else if (unitDefId === UnitDefId.CANNON) queued.cannons++;
}

function aiQueuedUnitCounts(
  world: SimWorld,
  buildings: number[]
): { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number } {
  const counts = { spearmen: 0, archers: 0, scouts: 0, gunmen: 0, cannons: 0 };
  for (const eid of buildings) {
    const queue = world.productionQueues.get(eid);
    if (!queue) continue;
    for (const defId of queue) {
      if (defId === UnitDefId.SPEARMAN) counts.spearmen++;
      else if (defId === UnitDefId.ARCHER) counts.archers++;
      else if (defId === UnitDefId.SCOUT_CAVALRY) counts.scouts++;
      else if (defId === UnitDefId.GUNMAN) counts.gunmen++;
      else if (defId === UnitDefId.CANNON) counts.cannons++;
    }
  }
  return counts;
}

function aiDesiredArmyMix(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot
): { spearmen: number; archers: number; scouts: number; gunmen: number; cannons: number } {
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const settings = aiSettings(world);
  const baseTargetArmy = Math.min(
    settings.maxArmyUnits,
    aiRequiredWaveSize(world, playerId) + Math.ceil(settings.maxWaveUnits * 0.55)
  );
  const playerPressureTarget = aiDifficultyOf(world) === 'hard'
    ? Math.min(
      settings.maxArmyUnits,
      snapshot.enemyMilitary.length + Math.min(18, Math.ceil(snapshot.enemyMilitary.length * 0.35) + 6)
    )
    : 0;
  const targetArmy = Math.max(baseTargetArmy, playerPressureTarget);
  let scouts = age >= AgeId.CASTLE ? Math.min(5, Math.max(2, Math.floor(targetArmy * 0.2))) : 0;
  let gunmen = 0;
  let cannons = 0;
  if (age >= AgeId.GUNPOWDER) {
    cannons = Math.min(4, Math.max(2, Math.floor(targetArmy * 0.12)));
    gunmen = Math.min(8, Math.max(4, Math.floor(targetArmy * 0.24)));
    scouts = Math.min(5, Math.max(2, Math.floor(targetArmy * 0.16)));
  }
  const infantrySlots = Math.max(4, targetArmy - scouts - gunmen - cannons);
  let spearmen = Math.ceil(infantrySlots / 2);
  let archers = Math.floor(infantrySlots / 2);
  const enemySpears = snapshot.enemyMilitary.filter((eid) => hasComponent(world.ecs, SpearmanTag, eid)).length;
  const enemyArchers = snapshot.enemyMilitary.filter((eid) => hasComponent(world.ecs, ArcherTag, eid)).length;
  const enemyScouts = snapshot.enemyMilitary.filter((eid) => hasComponent(world.ecs, ScoutCavalryTag, eid)).length;
  const enemyCannons = snapshot.enemyMilitary.filter((eid) => hasComponent(world.ecs, CannonTag, eid)).length;
  if (enemyScouts > enemySpears + 1) spearmen += 3;
  if (enemySpears > enemyArchers + 1) archers += 3;
  if (scouts > 0 && enemyArchers > enemySpears) scouts += 2;
  if (enemyCannons > 0) scouts += 2;
  return { spearmen, archers, scouts, gunmen, cannons };
}
