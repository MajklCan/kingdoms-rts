/**
 * AI difficulty profiles and per-player AI state.
 */

import { SIM } from '../../config';
import { AI_PLAYER_ID, MAX_PLAYERS } from '../core/constants';
import type { AiDifficulty, AiPlayerState, SimWorld } from '../core/types';
import { currentAiThinkScope } from './context';

interface AiDifficultySettings {
  thinkIntervalTicks: number;
  firstAttackDelayTicks: number;
  attackCooldownTicks: number;
  attackStageTimeoutTicks: number;
  gatherFraction: number;
  maxArmyUnits: number;
  maxWaveUnits: number;
  darkWaveSize: number;
  castleWaveSize: number;
  waveGrowthPerMinute: number;
  baseFarms: number;
  farmGrowthPerMinute: number;
  maxFarmsDark: number;
  maxFarmsCastle: number;
  maxFarmsGunpowder: number;
  baseLumberCamps: number;
  lumberGrowthPerMinute: number;
  maxLumberCamps: number;
  stoneQuarries: number;
  stoneGrowthPerMinute: number;
  maxStoneQuarries: number;
  goldMinesDark: number;
  goldMinesCastle: number;
  goldGrowthPerMinute: number;
  maxGoldMinesGunpowder: number;
  economyMirrorFraction: number;
  economyPlacementsPerThink: number;
  maxWorksiteWorkersDarkWood: number;
  maxWorksiteWorkersDarkMine: number;
  maxWorksiteWorkersCastle: number;
  maxHouseCount: number;
  houseHeadroom: number;
  barracksCastleTarget: number;
  barracksHardLateTarget: number;
}

const AI_DIFFICULTY_SETTINGS: Record<AiDifficulty, AiDifficultySettings> = {
  easy: {
    thinkIntervalTicks: SIM.TICK_HZ * 2,
    firstAttackDelayTicks: SIM.TICK_HZ * 225,
    attackCooldownTicks: SIM.TICK_HZ * 145,
    attackStageTimeoutTicks: SIM.TICK_HZ * 34,
    gatherFraction: 0.58,
    maxArmyUnits: 18,
    maxWaveUnits: 9,
    darkWaveSize: 5,
    castleWaveSize: 7,
    waveGrowthPerMinute: 0.25,
    baseFarms: 2,
    farmGrowthPerMinute: 0.35,
    maxFarmsDark: 4,
    maxFarmsCastle: 6,
    maxFarmsGunpowder: 8,
    baseLumberCamps: 1,
    lumberGrowthPerMinute: 0.18,
    maxLumberCamps: 2,
    stoneQuarries: 1,
    stoneGrowthPerMinute: 0,
    maxStoneQuarries: 1,
    goldMinesDark: 1,
    goldMinesCastle: 1,
    goldGrowthPerMinute: 0.08,
    maxGoldMinesGunpowder: 2,
    economyMirrorFraction: 0.35,
    economyPlacementsPerThink: 1,
    maxWorksiteWorkersDarkWood: 2,
    maxWorksiteWorkersDarkMine: 1,
    maxWorksiteWorkersCastle: 2,
    maxHouseCount: 8,
    houseHeadroom: 2,
    barracksCastleTarget: 1,
    barracksHardLateTarget: 1,
  },
  medium: {
    thinkIntervalTicks: SIM.TICK_HZ,
    firstAttackDelayTicks: SIM.TICK_HZ * 180,
    attackCooldownTicks: SIM.TICK_HZ * 110,
    attackStageTimeoutTicks: SIM.TICK_HZ * 28,
    gatherFraction: 0.68,
    maxArmyUnits: 36,
    maxWaveUnits: 16,
    darkWaveSize: 7,
    castleWaveSize: 9,
    waveGrowthPerMinute: 0.45,
    baseFarms: 2,
    farmGrowthPerMinute: 0.8,
    maxFarmsDark: 10,
    maxFarmsCastle: 14,
    maxFarmsGunpowder: 16,
    baseLumberCamps: 1,
    lumberGrowthPerMinute: 0.45,
    maxLumberCamps: 5,
    stoneQuarries: 2,
    stoneGrowthPerMinute: 0.18,
    maxStoneQuarries: 3,
    goldMinesDark: 1,
    goldMinesCastle: 2,
    goldGrowthPerMinute: 0.18,
    maxGoldMinesGunpowder: 3,
    economyMirrorFraction: 0.65,
    economyPlacementsPerThink: 1,
    maxWorksiteWorkersDarkWood: 3,
    maxWorksiteWorkersDarkMine: 1,
    maxWorksiteWorkersCastle: 3,
    maxHouseCount: 14,
    houseHeadroom: 4,
    barracksCastleTarget: 2,
    barracksHardLateTarget: 2,
  },
  hard: {
    thinkIntervalTicks: Math.round(SIM.TICK_HZ * 0.75),
    firstAttackDelayTicks: SIM.TICK_HZ * 155,
    attackCooldownTicks: SIM.TICK_HZ * 85,
    attackStageTimeoutTicks: SIM.TICK_HZ * 22,
    gatherFraction: 0.74,
    maxArmyUnits: 68,
    maxWaveUnits: 34,
    darkWaveSize: 9,
    castleWaveSize: 12,
    waveGrowthPerMinute: 0.7,
    baseFarms: 4,
    farmGrowthPerMinute: 1.35,
    maxFarmsDark: 18,
    maxFarmsCastle: 30,
    maxFarmsGunpowder: 40,
    baseLumberCamps: 2,
    lumberGrowthPerMinute: 0.75,
    maxLumberCamps: 14,
    stoneQuarries: 2,
    stoneGrowthPerMinute: 0.25,
    maxStoneQuarries: 7,
    goldMinesDark: 1,
    goldMinesCastle: 3,
    goldGrowthPerMinute: 0.32,
    maxGoldMinesGunpowder: 8,
    economyMirrorFraction: 0.6,
    economyPlacementsPerThink: 2,
    maxWorksiteWorkersDarkWood: 3,
    maxWorksiteWorkersDarkMine: 2,
    maxWorksiteWorkersCastle: 3,
    maxHouseCount: 26,
    houseHeadroom: 8,
    barracksCastleTarget: 3,
    barracksHardLateTarget: 7,
  },
};

export function normalizeAiDifficulty(value: unknown): AiDifficulty {
  return value === 'easy' || value === 'hard' ? value : 'medium';
}

export function createAiPlayerState(startTick = 0, difficulty: AiDifficulty = 'medium'): AiPlayerState {
  const settings = AI_DIFFICULTY_SETTINGS[difficulty];
  return {
    plan: 'opening',
    nextAttackTick: startTick + settings.firstAttackDelayTicks,
    lastAttackTick: -Infinity,
    stageStartedTick: -1,
    rallyPoint: null,
    waveUnitEids: [],
    lastAttackEventTick: -Infinity,
    lastDefenseEventTick: -Infinity,
  };
}

export function createAiPlayers(difficulty: AiDifficulty): Array<AiPlayerState | null> {
  const states: Array<AiPlayerState | null> = Array.from(
    { length: MAX_PLAYERS },
    () => null
  );
  states[AI_PLAYER_ID] = createAiPlayerState(0, difficulty);
  return states;
}

/** Difficulty of the AI that is thinking right now (the world default outside a think). */
export function aiDifficultyOf(world: SimWorld): AiDifficulty {
  return currentAiThinkScope()?.difficulty ?? normalizeAiDifficulty(world.aiDifficulty);
}

/** Difficulty `playerId`'s AI plays at: its own setting, else the world's. */
export function aiPlayerDifficulty(world: SimWorld, playerId: number): AiDifficulty {
  return normalizeAiDifficulty(world.aiPlayers[playerId]?.difficulty ?? world.aiDifficulty);
}

export function aiSettings(world: SimWorld): AiDifficultySettings {
  return AI_DIFFICULTY_SETTINGS[aiDifficultyOf(world)];
}

export function aiSettingsFor(difficulty: AiDifficulty): AiDifficultySettings {
  return AI_DIFFICULTY_SETTINGS[normalizeAiDifficulty(difficulty)];
}

export function aiElapsedMinutes(world: SimWorld): number {
  return world.tick / SIM.TICK_HZ / 60;
}
