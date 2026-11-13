/**
 * AI system entry point and per-player think loop.
 */

import { SIM } from '../../config';
import { AGE_TABLE, AgeId, BuildingDefId, canAfford, getAgeDef } from '../defs';
import { TechId, type TechIdValue, hasTech, techDef, techStatus } from '../tech-tree';
import { isAiControlledPlayer } from '../core/players';
import { countQueuedPopCost } from '../core/population';
import type { AiDifficulty, AiPlayerState, SimWorld } from '../core/types';
import { aiHandleDefense, aiManageAttackPlan, findAiDefenseTarget } from './attack';
import { type AiActuator, withAiThinkScope } from './context';
import { activeAiActuator, directAiActuator } from './direct-actuator';
import {
  aiDifficultyOf,
  aiPlayerDifficulty,
  aiSettings,
  aiSettingsFor,
  createAiPlayerState,
} from './difficulty';
import { aiMaintainEconomy } from './economy';
import { aiMaintainMilitaryInfrastructure, aiTrainArmy } from './military';
import { type AiSnapshot, aiHasAnyBuilding, collectAiSnapshot, countAiBuildings } from './snapshot';

/**
 * Think for every AI-controlled player, in ascending player order. Player 2
 * is the AI of a skirmish (its state is created on demand); any other player
 * is AI-controlled only when it has an AI state and is not human, which is
 * how a headless AI-vs-AI match runs. Humans (every seat in multiplayer) are
 * always left alone: their commands arrive as inputs.
 */
export function aiSystem(world: SimWorld): void {
  for (let playerId = 1; playerId < world.resources.length; playerId++) {
    if (!isAiControlledPlayer(world, playerId)) continue;
    const difficulty = aiPlayerDifficulty(world, playerId);
    if (world.tick % aiSettingsFor(difficulty).thinkIntervalTicks !== 0) continue;
    const state = ensureAiPlayerState(world, playerId);
    aiThink(world, playerId, state, difficulty, directAiActuator);
  }
}

/**
 * One full think of `playerId`'s AI. `state` is the AI's memory (normally
 * world.aiPlayers[playerId]); `actuator` decides how its decisions reach the
 * world. Public so a harness can run the brain as a command-issuing player.
 */
export function aiThink(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  difficulty: AiDifficulty,
  actuator: AiActuator
): void {
  withAiThinkScope({ playerId, difficulty, actuator }, () => aiPlayerTick(world, playerId, state));
}

function aiPlayerTick(world: SimWorld, playerId: number, state: AiPlayerState): void {
  const bank = world.resources[playerId];
  const pop = world.population[playerId];
  if (!bank || !pop) return;

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
    state = createAiPlayerState(world.tick, aiPlayerDifficulty(world, playerId));
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
    (capPressure || houseCount >= 5 || aiDifficultyOf(world) === 'hard')
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
    (capPressure || aiDifficultyOf(world) === 'hard')
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
  return activeAiActuator().researchTech(world, playerId, techId);
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
  if (activeAiActuator().advanceAge(world, playerId)) {
    activeAiActuator().event(world, playerId, `Frankia has started advancing to ${nextAge?.name ?? 'the next age'}`);
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
  if (aiDifficultyOf(world) === 'easy') {
    return nextAge === AgeId.CASTLE
      ? farms >= 2 && lumber >= 1
      : farms >= 5 && lumber >= 2 && gold >= 1;
  }
  if (aiDifficultyOf(world) === 'hard') {
    return nextAge === AgeId.CASTLE
      ? farms >= 8 && lumber >= 4 && stone >= 2
      : farms >= 12 && lumber >= 5 && stone >= 3 && gold >= 3;
  }
  return nextAge === AgeId.CASTLE
    ? farms >= 4 && lumber >= 2 && stone >= 1
    : farms >= 8 && lumber >= 3 && stone >= 2 && gold >= 2;
}
