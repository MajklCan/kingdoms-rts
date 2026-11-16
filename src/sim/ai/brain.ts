/**
 * AI system entry point and per-player think loop.
 */

import { isAiControlledPlayer } from '../core/players';
import type { AiDifficulty, AiPlayerState, SimWorld } from '../core/types';
import { aiHandleDefense, aiManageAttackPlan, findAiDefenseTarget } from './attack';
import { aiManageBuilders, aiTrainBuilders } from './builders';
import { type AiActuator, currentAiThinkScope, withAiThinkScope } from './context';
import { directAiActuator } from './direct-actuator';
import {
  aiPlayerDifficulty,
  aiSettings,
  aiSettingsFor,
  createAiPlayerState,
} from './difficulty';
import { aiMaintainEconomy } from './economy';
import { aiMaybeTrainCommander } from './commander';
import { aiMaintainMilitaryInfrastructure, aiTrainArmy } from './military';
import { aiResearchReserve, aiResearchTechs } from './research';
import { type AiSnapshot, collectAiSnapshot } from './snapshot';

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
  aiTrainBuilders(world, playerId, snapshot);
  aiMaintainMilitaryInfrastructure(world, playerId, snapshot);
  aiMaintainEconomy(world, playerId, snapshot);
  aiManageBuilders(world, playerId);
  const scope = currentAiThinkScope();
  if (scope) scope.reserve = aiResearchReserve(world, playerId, state, snapshot);
  aiTrainArmy(world, playerId, snapshot);
  aiMaybeTrainCommander(world, playerId, snapshot);

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
