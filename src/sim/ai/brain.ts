/**
 * AI system entry point and per-player think loop.
 */

import { SIM } from '../../config';
import { AGE_TABLE, AgeId, BuildingDefId, canAfford, getAgeDef } from '../defs';
import { TechId, type TechIdValue, hasTech, techDef, techStatus } from '../tech-tree';
import { AI_PLAYER_ID } from '../core/constants';
import { pushAiEvent } from '../core/events';
import { countQueuedPopCost } from '../core/population';
import type { AiPlayerState, SimWorld } from '../core/types';
import { applyAdvanceAge, applyResearchTech } from '../systems/age-tech';
import { aiHandleDefense, aiManageAttackPlan, findAiDefenseTarget } from './attack';
import { aiSettings, createAiPlayerState } from './difficulty';
import { aiMaintainEconomy } from './economy';
import { aiMaintainMilitaryInfrastructure, aiTrainArmy } from './military';
import { type AiSnapshot, aiHasAnyBuilding, collectAiSnapshot, countAiBuildings } from './snapshot';

export function aiSystem(world: SimWorld): void {
  // In multiplayer the second player is human; their commands arrive over the
  // wire, so the AI controller must stay silent for them.
  if (world.humanPlayers.has(AI_PLAYER_ID)) return;
  const settings = aiSettings(world);
  if (world.tick % settings.thinkIntervalTicks !== 0) return;
  // Player 2 is the only AI for now.
  aiPlayerTick(world, AI_PLAYER_ID);
}

function aiPlayerTick(world: SimWorld, playerId: number): void {
  const bank = world.resources[playerId];
  const pop = world.population[playerId];
  if (!bank || !pop) return;

  const state = ensureAiPlayerState(world, playerId);
  const snapshot = collectAiSnapshot(world, playerId);
  if (!snapshot) return;

  if (world.campaign?.enemyAiMode === 'defensive') {
    aiDefensiveCampaignTick(world, playerId, state, snapshot);
    return;
  }

  aiResearchTechs(world, playerId, snapshot);
  aiMaintainMilitaryInfrastructure(world, playerId, snapshot);
  aiMaintainEconomy(world, playerId, snapshot);
  aiTrainArmy(world, playerId, snapshot);
  aiMaybeAdvanceAge(world, playerId, state, snapshot);

  const refreshed = collectAiSnapshot(world, playerId) ?? snapshot;
  const defenseTarget = findAiDefenseTarget(world, playerId, refreshed);
  if (defenseTarget !== null && refreshed.myMilitary.length > 0) {
    aiHandleDefense(world, playerId, state, refreshed, defenseTarget);
    return;
  }
  if (state.plan === 'defending') {
    state.plan = 'recovering';
    state.nextAttackTick = Math.max(state.nextAttackTick, world.tick + aiSettings(world).attackCooldownTicks / 2);
  }

  aiManageAttackPlan(world, playerId, state, refreshed);
}

function ensureAiPlayerState(world: SimWorld, playerId: number): AiPlayerState {
  let state = world.aiPlayers[playerId];
  if (!state) {
    state = createAiPlayerState(world.tick, world.aiDifficulty);
    world.aiPlayers[playerId] = state;
  }
  return state;
}

function aiDefensiveCampaignTick(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot
): void {
  const defenseTarget = findAiDefenseTarget(world, playerId, snapshot);
  if (defenseTarget !== null && snapshot.myMilitary.length > 0) {
    aiHandleDefense(world, playerId, state, snapshot, defenseTarget);
    return;
  }
  state.plan = 'massing';
  state.nextAttackTick = Number.MAX_SAFE_INTEGER;
  state.rallyPoint = null;
  state.waveUnitEids = [];
}

function aiResearchTechs(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  const farmCount = countAiBuildings(snapshot, BuildingDefId.FARM);
  const hasLumber = aiHasAnyBuilding(snapshot, BuildingDefId.LUMBER_CAMP);
  const hasStone = aiHasAnyBuilding(snapshot, BuildingDefId.STONE_QUARRY);
  const hasBarracks = aiHasAnyBuilding(snapshot, BuildingDefId.BARRACKS);
  const houseCount = countAiBuildings(snapshot, BuildingDefId.HOUSE);
  const pop = world.population[playerId];
  const capPressure = pop
    ? pop.cap - (pop.current + countQueuedPopCost(world, playerId)) <= aiSettings(world).houseHeadroom + 2
    : false;

  if (!hasTech(world, playerId, TechId.BARRACKS_PIKEMEN) && hasLumber && farmCount >= 1) {
    if (aiTryResearchTech(world, playerId, TechId.BARRACKS_PIKEMEN)) return;
  }
  if (hasBarracks && hasTech(world, playerId, TechId.BARRACKS_PIKEMEN) && hasLumber) {
    if (aiTryResearchTech(world, playerId, TechId.LUMBER_CREWS)) return;
  }
  if (hasBarracks && hasTech(world, playerId, TechId.LUMBER_CREWS) && hasStone) {
    if (aiTryResearchTech(world, playerId, TechId.MINING_CREWS)) return;
  }
  if (hasBarracks && hasStone) {
    if (aiTryResearchTech(world, playerId, TechId.ARCHERS)) return;
  }
  if (
    hasBarracks &&
    hasStone &&
    houseCount >= 3 &&
    (capPressure || houseCount >= 5 || world.aiDifficulty === 'hard')
  ) {
    if (aiTryResearchTech(world, playerId, TechId.HOUSING_I)) return;
  }
  if (hasTech(world, playerId, TechId.BARRACKS_PIKEMEN) && farmCount >= 3) {
    if (aiTryResearchTech(world, playerId, TechId.MILLS)) return;
  }
  if (hasTech(world, playerId, TechId.MILLS) && farmCount >= 3) {
    if (aiTryResearchTech(world, playerId, TechId.FARMS)) return;
  }
  if (hasTech(world, playerId, TechId.FARMS) && farmCount >= 5) {
    if (aiTryResearchTech(world, playerId, TechId.FARMS_II)) return;
  }
  if (
    hasTech(world, playerId, TechId.HOUSING_I) &&
    hasTech(world, playerId, TechId.FARMS) &&
    houseCount >= 6 &&
    (capPressure || world.aiDifficulty === 'hard')
  ) {
    if (aiTryResearchTech(world, playerId, TechId.HOUSING_II)) return;
  }
}

function aiTryResearchTech(world: SimWorld, playerId: number, techId: TechIdValue): boolean {
  const tech = techDef(techId);
  if (!tech) return false;
  if (techStatus(world, playerId, techId) !== 'available') return false;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, tech.cost)) return false;
  applyResearchTech(world, playerId, techId);
  return hasTech(world, playerId, techId);
}

function aiMaybeAdvanceAge(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot
): void {
  const age = world.ages[playerId];
  if (!age || age.progress >= 0 || age.current >= AGE_TABLE.length - 1) return;
  if (!aiHasAnyBuilding(snapshot, BuildingDefId.BARRACKS)) return;
  if (!aiHasEconomyForAgeAdvance(world, snapshot, age.current + 1)) return;
  const nextAge = getAgeDef(age.current + 1);
  const before = age.progress;
  applyAdvanceAge(world, playerId);
  if (before < 0 && age.progress >= 0) {
    pushAiEvent(world, playerId, `Frankia has started advancing to ${nextAge?.name ?? 'the next age'}`);
    state.nextAttackTick = Math.max(state.nextAttackTick, world.tick + SIM.TICK_HZ * 45);
  }
}

function aiHasEconomyForAgeAdvance(
  world: SimWorld,
  snapshot: AiSnapshot,
  nextAge: number
): boolean {
  const farms = countAiBuildings(snapshot, BuildingDefId.FARM);
  const lumber = countAiBuildings(snapshot, BuildingDefId.LUMBER_CAMP);
  const stone = countAiBuildings(snapshot, BuildingDefId.STONE_QUARRY);
  const gold = countAiBuildings(snapshot, BuildingDefId.GOLD_MINE);
  if (world.aiDifficulty === 'easy') {
    return nextAge === AgeId.CASTLE
      ? farms >= 2 && lumber >= 1
      : farms >= 5 && lumber >= 2 && gold >= 1;
  }
  if (world.aiDifficulty === 'hard') {
    return nextAge === AgeId.CASTLE
      ? farms >= 8 && lumber >= 4 && stone >= 2
      : farms >= 12 && lumber >= 5 && stone >= 3 && gold >= 3;
  }
  return nextAge === AgeId.CASTLE
    ? farms >= 4 && lumber >= 2 && stone >= 1
    : farms >= 8 && lumber >= 3 && stone >= 2 && gold >= 2;
}
