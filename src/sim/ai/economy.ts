/**
 * AI economy: worksite targets, houses and worker training.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  Position,
  type ResourceKind,
  ResourceKindId,
  ResourceWorksite,
} from '../components';
import {
  AgeId,
  BuildingDefId,
  type CostTuple,
  UnitDefId,
  canAfford,
  getBuildingDef,
  getUnitDef,
} from '../defs';
import { TechId, hasTech, isUnitUnlocked } from '../tech-tree';
import { POP_CAP_HARD_LIMIT } from '../core/constants';
import { countPendingPopCap, countQueuedPopCost } from '../core/population';
import type { SimWorld } from '../core/types';
import {
  countQueuedWorksiteWorkers,
  countWorksiteWorkers,
  getWorksiteWorkerSlots,
  worksiteUsesResourceNodes,
} from '../systems/worksites';
import { aiRequiredWaveSize } from './attack';
import { aiDifficultyOf, aiElapsedMinutes, aiSettings } from './difficulty';
import { aiPlaceBuilding, aiQueueUnit } from './placement';
import {
  type AiSnapshot,
  aiCompletedBuildingCount,
  aiHasAnyBuilding,
  aiIsCompletedBuilding,
  aiResourceWorksiteCanStillProduce,
  countAiBuildings,
  countAiEffectiveEconomyBuildings,
  countEnemyBuildings,
} from './snapshot';

export interface AiProductionMacro {
  producerCount: number;
  activeProducers: number;
  idleProducers: number;
  fullProducers: number;
  affordableIdleProducers: number;
  popBlockedProducers: number;
  productionUptime: number;
  bottleneck: ResourceKind | null;
}

interface AiEconomyTargets {
  farms: number;
  lumber: number;
  stone: number;
  gold: number;
  mills: number;
}

export const AI_PRODUCER_QUEUE_TARGET = 2;

export function aiIsArmyProducerDef(defId: number): boolean {
  return defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY;
}

export function aiTrainableUnitsForProducer(world: SimWorld, playerId: number, producerEid: number): number[] {
  const defId = Building.defId[producerEid];
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const candidates =
    defId === BuildingDefId.BARRACKS
      ? [UnitDefId.SPEARMAN, UnitDefId.ARCHER]
      : defId === BuildingDefId.STABLE
        ? [UnitDefId.SCOUT_CAVALRY]
        : defId === BuildingDefId.FOUNDRY
          ? [UnitDefId.GUNMAN, UnitDefId.CANNON]
          : [];
  return candidates.filter((unitDefId) => {
    const unitDef = getUnitDef(unitDefId);
    if (!unitDef) return false;
    if (!isUnitUnlocked(world, playerId, unitDefId)) return false;
    if (unitDefId === UnitDefId.SCOUT_CAVALRY && age < AgeId.CASTLE) return false;
    return true;
  });
}

export function aiAnalyzeProductionMacro(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot
): AiProductionMacro {
  const bank = world.resources[playerId];
  const pop = world.population[playerId];
  if (!bank || !pop) {
    return {
      producerCount: 0,
      activeProducers: 0,
      idleProducers: 0,
      fullProducers: 0,
      affordableIdleProducers: 0,
      popBlockedProducers: 0,
      productionUptime: 1,
      bottleneck: null,
    };
  }

  let producerCount = 0;
  let activeProducers = 0;
  let idleProducers = 0;
  let fullProducers = 0;
  let affordableIdleProducers = 0;
  let popBlockedProducers = 0;
  const deficits: Record<ResourceKind, number> = {
    [ResourceKindId.FOOD]: 0,
    [ResourceKindId.WOOD]: 0,
    [ResourceKindId.GOLD]: 0,
    [ResourceKindId.STONE]: 0,
  };

  for (const producerEid of snapshot.myBuildings) {
    if (!aiIsCompletedBuilding(world, producerEid)) continue;
    if (!aiIsArmyProducerDef(Building.defId[producerEid])) continue;
    producerCount++;
    const queue = world.productionQueues.get(producerEid) ?? [];
    if (queue.length > 0) activeProducers++;
    if (queue.length === 0) idleProducers++;
    if (queue.length >= AI_PRODUCER_QUEUE_TARGET) fullProducers++;
    if (queue.length >= AI_PRODUCER_QUEUE_TARGET) continue;

    const candidates = aiTrainableUnitsForProducer(world, playerId, producerEid);
    if (candidates.length === 0) continue;
    let hasAffordableCandidate = false;
    let isPopBlocked = false;
    let bestShortage: { score: number; cost: CostTuple } | null = null;
    for (const unitDefId of candidates) {
      const unitDef = getUnitDef(unitDefId);
      if (!unitDef) continue;
      const queuedPop = countQueuedPopCost(world, playerId);
      const hasPop = pop.current + queuedPop + unitDef.popCost <= pop.cap;
      if (!hasPop) {
        isPopBlocked = true;
        continue;
      }
      if (canAfford(bank, unitDef.cost)) {
        hasAffordableCandidate = true;
        break;
      }
      const score =
        Math.max(0, unitDef.cost.food - bank[ResourceKindId.FOOD]) +
        Math.max(0, unitDef.cost.wood - bank[ResourceKindId.WOOD]) +
        Math.max(0, unitDef.cost.gold - bank[ResourceKindId.GOLD]) +
        Math.max(0, unitDef.cost.stone - bank[ResourceKindId.STONE]);
      if (score > 0 && (!bestShortage || score < bestShortage.score)) {
        bestShortage = { score, cost: unitDef.cost };
      }
    }
    if (hasAffordableCandidate) {
      affordableIdleProducers++;
      continue;
    }
    if (isPopBlocked && !bestShortage) {
      popBlockedProducers++;
      continue;
    }
    if (bestShortage) {
      deficits[ResourceKindId.FOOD] += Math.max(
        0,
        bestShortage.cost.food - bank[ResourceKindId.FOOD]
      );
      deficits[ResourceKindId.WOOD] += Math.max(
        0,
        bestShortage.cost.wood - bank[ResourceKindId.WOOD]
      );
      deficits[ResourceKindId.GOLD] += Math.max(
        0,
        bestShortage.cost.gold - bank[ResourceKindId.GOLD]
      );
      deficits[ResourceKindId.STONE] += Math.max(
        0,
        bestShortage.cost.stone - bank[ResourceKindId.STONE]
      );
    }
  }

  let bottleneck: ResourceKind | null = null;
  let bottleneckScore = 0;
  for (const kind of [
    ResourceKindId.FOOD,
    ResourceKindId.WOOD,
    ResourceKindId.GOLD,
    ResourceKindId.STONE,
  ] as ResourceKind[]) {
    if (deficits[kind] > bottleneckScore) {
      bottleneckScore = deficits[kind];
      bottleneck = kind;
    }
  }

  return {
    producerCount,
    activeProducers,
    idleProducers,
    fullProducers,
    affordableIdleProducers,
    popBlockedProducers,
    productionUptime: producerCount > 0 ? activeProducers / producerCount : 1,
    bottleneck,
  };
}

function aiHardEconomyTargets(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot,
  macro: AiProductionMacro
): AiEconomyTargets {
  const settings = aiSettings(world);
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const farmCap = age >= AgeId.GUNPOWDER
    ? settings.maxFarmsGunpowder
    : age >= AgeId.CASTLE
      ? settings.maxFarmsCastle
      : settings.maxFarmsDark;
  const hasCompletedBarracks = aiCompletedBuildingCount(world, snapshot, BuildingDefId.BARRACKS) > 0;
  const currentFarms = countAiBuildings(snapshot, BuildingDefId.FARM);
  const currentLumber = countAiEffectiveEconomyBuildings(world, snapshot, BuildingDefId.LUMBER_CAMP);
  const currentStone = countAiEffectiveEconomyBuildings(world, snapshot, BuildingDefId.STONE_QUARRY);
  const currentGold = countAiEffectiveEconomyBuildings(world, snapshot, BuildingDefId.GOLD_MINE);

  if (!hasCompletedBarracks) {
    return {
      farms: Math.min(farmCap, Math.max(currentFarms, 1)),
      lumber: Math.min(settings.maxLumberCamps, Math.max(currentLumber, 3)),
      stone: 0,
      gold: 0,
      mills: 0,
    };
  }

  const queuesAreSaturated = macro.producerCount > 0 &&
    macro.productionUptime >= 0.75 &&
    macro.fullProducers >= Math.max(1, Math.ceil(macro.producerCount * 0.5));
  const pressureProducers = Math.ceil(snapshot.enemyMilitary.length / 12);
  const supportProducers = Math.max(
    1,
    macro.producerCount,
    pressureProducers,
    queuesAreSaturated ? macro.producerCount + 1 : 0
  );

  let farms = Math.max(currentFarms, supportProducers * 3);
  let lumber = Math.max(currentLumber, 3, supportProducers + 2, Math.ceil(farms / 4));
  let stone = Math.max(currentStone, 1);
  let gold = currentGold;
  if (age >= AgeId.CASTLE) {
    gold = Math.max(gold, settings.goldMinesCastle);
  }

  if (macro.bottleneck === ResourceKindId.FOOD) farms += Math.max(2, macro.idleProducers * 2);
  else if (macro.bottleneck === ResourceKindId.WOOD) lumber += 2;
  else if (macro.bottleneck === ResourceKindId.STONE) stone += 1;
  else if (macro.bottleneck === ResourceKindId.GOLD) gold += 1;

  farms = Math.min(farmCap, farms);
  lumber = Math.min(settings.maxLumberCamps, lumber);
  stone = Math.min(settings.maxStoneQuarries, stone);
  gold = Math.min(settings.maxGoldMinesGunpowder, gold);

  return {
    farms,
    lumber,
    stone,
    gold,
    mills: aiDesiredMillCount(world, playerId, snapshot),
  };
}

function aiDesiredFarmCount(world: SimWorld, playerId: number, snapshot: AiSnapshot): number {
  const settings = aiSettings(world);
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const cap = age >= AgeId.GUNPOWDER
    ? settings.maxFarmsGunpowder
    : age >= AgeId.CASTLE
      ? settings.maxFarmsCastle
      : settings.maxFarmsDark;
  const timeTarget = settings.baseFarms +
    Math.floor(aiElapsedMinutes(world) * settings.farmGrowthPerMinute);
  const mirrorTarget = Math.floor(
    countEnemyBuildings(snapshot, BuildingDefId.FARM) * settings.economyMirrorFraction
  );
  const armyTarget = Math.ceil(aiRequiredWaveSize(world, playerId) / 3);
  return Math.min(cap, Math.max(timeTarget, mirrorTarget, armyTarget));
}

function aiDesiredLumberCampCount(
  world: SimWorld,
  snapshot: AiSnapshot,
  desiredFarms: number
): number {
  const settings = aiSettings(world);
  const timeTarget = settings.baseLumberCamps +
    Math.floor(aiElapsedMinutes(world) * settings.lumberGrowthPerMinute);
  const mirrorTarget = Math.floor(
    countEnemyBuildings(snapshot, BuildingDefId.LUMBER_CAMP) * settings.economyMirrorFraction
  );
  const farmSupportTarget = Math.ceil(desiredFarms / 3);
  return Math.min(settings.maxLumberCamps, Math.max(timeTarget, mirrorTarget, farmSupportTarget));
}

function aiDesiredStoneQuarryCount(world: SimWorld, playerId: number, snapshot: AiSnapshot): number {
  const settings = aiSettings(world);
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const lateStart = age >= AgeId.CASTLE ? 3 : 5;
  const timeTarget = settings.stoneQuarries +
    Math.floor(Math.max(0, aiElapsedMinutes(world) - lateStart) * settings.stoneGrowthPerMinute);
  const mirrorTarget = Math.floor(
    countEnemyBuildings(snapshot, BuildingDefId.STONE_QUARRY) * settings.economyMirrorFraction
  );
  const techTarget = !hasTech(world, playerId, TechId.ARCHERS) ||
    !hasTech(world, playerId, TechId.MILLS) ||
    !hasTech(world, playerId, TechId.FARMS) ||
    !hasTech(world, playerId, TechId.HOUSING_I)
    ? settings.stoneQuarries
    : 1;
  return Math.min(settings.maxStoneQuarries, Math.max(timeTarget, mirrorTarget, techTarget));
}

function aiDesiredGoldMineCount(world: SimWorld, playerId: number, snapshot: AiSnapshot): number {
  if ((world.ages[playerId]?.current ?? AgeId.DARK) < AgeId.CASTLE) return 0;
  const settings = aiSettings(world);
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const cap = age >= AgeId.GUNPOWDER
    ? settings.maxGoldMinesGunpowder
    : settings.goldMinesCastle;
  const timeTarget = settings.goldMinesCastle +
    Math.floor(Math.max(0, aiElapsedMinutes(world) - 8) * settings.goldGrowthPerMinute);
  const mirrorTarget = Math.floor(
    countEnemyBuildings(snapshot, BuildingDefId.GOLD_MINE) * settings.economyMirrorFraction
  );
  return Math.min(cap, Math.max(timeTarget, mirrorTarget, settings.goldMinesDark));
}

function aiDesiredMillCount(world: SimWorld, playerId: number, snapshot: AiSnapshot): number {
  if (!hasTech(world, playerId, TechId.MILLS)) return 0;
  const farms = countAiBuildings(snapshot, BuildingDefId.FARM);
  if (farms < 3) return 0;
  if (aiDifficultyOf(world) === 'hard' && farms >= 14) return 3;
  if (farms >= 8 && aiDifficultyOf(world) !== 'easy') return 2;
  return 1;
}

function aiBottleneckBuildingDef(kind: ResourceKind | null): number | null {
  if (kind === ResourceKindId.FOOD) return BuildingDefId.FARM;
  if (kind === ResourceKindId.WOOD) return BuildingDefId.LUMBER_CAMP;
  if (kind === ResourceKindId.STONE) return BuildingDefId.STONE_QUARRY;
  if (kind === ResourceKindId.GOLD) return BuildingDefId.GOLD_MINE;
  return null;
}

export function aiMaintainEconomy(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  if (aiDifficultyOf(world) !== 'easy') {
    aiMaintainAdaptiveEconomy(world, playerId, snapshot);
    return;
  }

  const tcX = Position.x[snapshot.tcEid];
  const tcY = Position.y[snapshot.tcEid];
  const hasBarracks = aiHasAnyBuilding(snapshot, BuildingDefId.BARRACKS);
  const desiredFarms = aiDesiredFarmCount(world, playerId, snapshot);
  const desiredLumber = aiDesiredLumberCampCount(world, snapshot, desiredFarms);
  const desiredStone = aiDesiredStoneQuarryCount(world, playerId, snapshot);
  const desiredGold = aiDesiredGoldMineCount(world, playerId, snapshot);
  const economyPlan = [
    { defId: BuildingDefId.FARM, target: 1, enabled: true },
    { defId: BuildingDefId.LUMBER_CAMP, target: 1, enabled: true },
    { defId: BuildingDefId.LUMBER_CAMP, target: Math.min(desiredLumber, 2), enabled: hasBarracks },
    { defId: BuildingDefId.STONE_QUARRY, target: Math.min(desiredStone, 1), enabled: hasBarracks },
    { defId: BuildingDefId.FARM, target: Math.min(desiredFarms, 3), enabled: hasBarracks },
    { defId: BuildingDefId.LUMBER_CAMP, target: desiredLumber, enabled: hasBarracks },
    { defId: BuildingDefId.FARM, target: desiredFarms, enabled: hasBarracks },
    { defId: BuildingDefId.STONE_QUARRY, target: desiredStone, enabled: hasBarracks },
    { defId: BuildingDefId.GOLD_MINE, target: desiredGold, enabled: hasBarracks },
    { defId: BuildingDefId.MILL, target: aiDesiredMillCount(world, playerId, snapshot), enabled: hasBarracks },
  ];
  const currentCounts = new Map<number, number>();
  for (const item of economyPlan) {
    if (!currentCounts.has(item.defId)) {
      currentCounts.set(item.defId, countAiEffectiveEconomyBuildings(world, snapshot, item.defId));
    }
  }
  let placementsRemaining = aiSettings(world).economyPlacementsPerThink;
  while (placementsRemaining > 0) {
    let placed = false;
    for (const item of economyPlan) {
      if (!item.enabled) continue;
      const current = currentCounts.get(item.defId) ?? 0;
      if (current >= item.target) continue;
      if (!aiPlaceBuilding(world, item.defId, tcX, tcY, playerId)) continue;
      currentCounts.set(item.defId, current + 1);
      placementsRemaining--;
      placed = true;
      break;
    }
    if (!placed) break;
  }

  aiTrainWorksiteWorkers(world, playerId, snapshot);

  aiTryPlaceHouseIfNeeded(world, playerId, snapshot, tcX, tcY, 0);
}

function aiMaintainAdaptiveEconomy(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  const tcX = Position.x[snapshot.tcEid];
  const tcY = Position.y[snapshot.tcEid];
  const macro = aiAnalyzeProductionMacro(world, playerId, snapshot);
  const targets = aiHardEconomyTargets(world, playerId, snapshot, macro);
  const hasBarracksTech = hasTech(world, playerId, TechId.BARRACKS_PIKEMEN);
  const hasBarracks = aiHasAnyBuilding(snapshot, BuildingDefId.BARRACKS);
  const bottleneckDefId = aiBottleneckBuildingDef(macro.bottleneck);
  const adaptiveEconomyPlan = [
    { defId: BuildingDefId.FARM, target: 1, enabled: true },
    { defId: BuildingDefId.LUMBER_CAMP, target: Math.min(targets.lumber, 3), enabled: true },
    {
      defId: bottleneckDefId ?? BuildingDefId.FARM,
      target: bottleneckDefId === BuildingDefId.FARM
        ? targets.farms
        : bottleneckDefId === BuildingDefId.LUMBER_CAMP
          ? targets.lumber
          : bottleneckDefId === BuildingDefId.STONE_QUARRY
            ? targets.stone
            : bottleneckDefId === BuildingDefId.GOLD_MINE
              ? targets.gold
              : 0,
      enabled: bottleneckDefId !== null && (hasBarracksTech || hasBarracks),
    },
    { defId: BuildingDefId.FARM, target: Math.min(targets.farms, 5), enabled: hasBarracksTech || hasBarracks },
    { defId: BuildingDefId.STONE_QUARRY, target: Math.min(targets.stone, 1), enabled: hasBarracksTech || hasBarracks },
    { defId: BuildingDefId.LUMBER_CAMP, target: targets.lumber, enabled: hasBarracksTech || hasBarracks },
    { defId: BuildingDefId.FARM, target: targets.farms, enabled: hasBarracksTech || hasBarracks },
    { defId: BuildingDefId.STONE_QUARRY, target: targets.stone, enabled: hasBarracksTech || hasBarracks },
    { defId: BuildingDefId.GOLD_MINE, target: targets.gold, enabled: hasBarracksTech || hasBarracks },
    { defId: BuildingDefId.MILL, target: targets.mills, enabled: hasBarracksTech || hasBarracks },
  ];
  const currentCounts = new Map<number, number>();
  for (const item of adaptiveEconomyPlan) {
    if (!currentCounts.has(item.defId)) {
      currentCounts.set(item.defId, countAiEffectiveEconomyBuildings(world, snapshot, item.defId));
    }
  }

  let placementsRemaining = aiSettings(world).economyPlacementsPerThink;
  if (aiTryPlaceHouseIfNeeded(
    world,
    playerId,
    snapshot,
    tcX,
    tcY,
    macro.popBlockedProducers > 0 ? 4 : 0
  )) {
    placementsRemaining--;
  }

  while (placementsRemaining > 0) {
    let placed = false;
    for (const item of adaptiveEconomyPlan) {
      if (!item.enabled) continue;
      const current = currentCounts.get(item.defId) ?? 0;
      if (current >= item.target) continue;
      if (!aiPlaceBuilding(world, item.defId, tcX, tcY, playerId)) continue;
      currentCounts.set(item.defId, current + 1);
      placementsRemaining--;
      placed = true;
      break;
    }
    if (!placed) break;
  }

  aiTrainWorksiteWorkers(world, playerId, snapshot);
}

function aiTryPlaceHouseIfNeeded(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot,
  nearX: number,
  nearY: number,
  extraHeadroom: number
): boolean {
  const bank = world.resources[playerId];
  const pop = world.population[playerId];
  if (!bank || !pop) return false;
  const queuedPop = countQueuedPopCost(world, playerId);
  const effectiveCap = pop.cap + countPendingPopCap(world, playerId);
  const houseCount = snapshot.myBuildings.filter(
    (eid) => Building.defId[eid] === BuildingDefId.HOUSE
  ).length;
  if (
    effectiveCap - (pop.current + queuedPop) <= aiSettings(world).houseHeadroom + extraHeadroom &&
    pop.cap < POP_CAP_HARD_LIMIT &&
    houseCount < aiSettings(world).maxHouseCount
  ) {
    return aiPlaceBuilding(world, BuildingDefId.HOUSE, nearX, nearY, playerId);
  }
  return false;
}

function aiTrainWorksiteWorkers(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  for (const siteEid of snapshot.myBuildings) {
    if (!aiIsCompletedBuilding(world, siteEid)) continue;
    if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) continue;
    const def = getBuildingDef(Building.defId[siteEid]);
    if (def && worksiteUsesResourceNodes(def) && !aiResourceWorksiteCanStillProduce(world, siteEid, def)) {
      continue;
    }
    const slots = getWorksiteWorkerSlots(world, siteEid);
    const desired = Math.min(slots, aiDesiredWorksiteWorkers(world, playerId, siteEid));
    const occupied = countWorksiteWorkers(world, siteEid) + countQueuedWorksiteWorkers(world, siteEid);
    if (occupied < desired) {
      aiQueueUnit(world, siteEid, UnitDefId.VILLAGER);
    }
  }
}

function aiDesiredWorksiteWorkers(world: SimWorld, playerId: number, siteEid: number): number {
  const kind = ResourceWorksite.kind[siteEid];
  const age = world.ages[playerId]?.current ?? AgeId.DARK;
  const settings = aiSettings(world);
  if (age >= AgeId.CASTLE) return settings.maxWorksiteWorkersCastle;
  if (kind === ResourceKindId.WOOD) return settings.maxWorksiteWorkersDarkWood;
  if (kind === ResourceKindId.FOOD) return 1;
  return settings.maxWorksiteWorkersDarkMine;
}
