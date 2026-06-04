/**
 * Sim world — the source of truth. A bitECS world plus auxiliary state (paths, RNG,
 * input queue, tick counter, per-player resource banks). The world has NO Phaser
 * imports. Render reads from it; input writes commands to its queue; step() advances it.
 */

import {
  addComponent,
  addEntity,
  createWorld,
  defineQuery,
  hasComponent,
  removeComponent,
  removeEntity,
  type IWorld,
} from 'bitecs';
import { MAP, SIM } from '../config';
import {
  ArcherTag,
  AttackMoveGoal,
  AttackTarget,
  Building,
  BuildOrder,
  Combat,
  ConstructionSite,
  Cooldown,
  CannonTag,
  DeadTag,
  DropOff,
  DropOffMask,
  FoundationTag,
  Gatherer,
  GathererStateId,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MortarTag,
  Owner,
  PathTarget,
  PopulationCost,
  Position,
  PrevPosition,
  Producer,
  Resource,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  ScoutCavalryTag,
  Selected,
  SpearmanTag,
  Speed,
  TownCenterTag,
  UnitKind,
  UnitKindId,
  UnitStance,
  UnitStanceId,
  VILLAGER_CARRY_CAPACITY,
  VILLAGER_GATHER_COOLDOWN,
  VillagerTag,
  Velocity,
  WorksiteWorker,
  type ResourceKind,
  type UnitStanceValue,
} from './components';
import {
  AGE_TABLE,
  AgeId,
  BUILDING_TABLE,
  BuildingDefId,
  UnitDefId,
  type AgeIdValue,
  type BuildingDef,
  canAfford,
  getAgeDef,
  getBuildingDef,
  getUnitDef,
  refund,
  spend,
  type CostTuple,
} from './defs';
import {
  CampaignMissionId,
  type CampaignMissionIdValue,
  type CampaignObjectiveDef,
  getCampaignMissionDef,
} from './campaign';
import { MapId, generateMap, TileType, isZborovMudPatch, type MapData, type MapIdValue } from './map-gen';
import { Pathfinder, type GridPos } from './pathfinding';
import { Rng } from './rng';
import {
  TechId,
  type TechIdValue,
  createAllTechSet,
  createStartingTechSet,
  createStartingTechSetForAge,
  hasTech,
  isBuildingUnlocked,
  isUnitUnlocked,
  techDef,
  techPrereqsMet,
  techStatus,
  worksiteWorkerSlotsForKind,
} from './tech-tree';

/** Number of players supported (0=Gaia, 1=human, 2=AI). For Stage 0 we use 0 + 1. */
export const MAX_PLAYERS = 3;
/** The human player's id. All UI commands route through this. */
export const LOCAL_PLAYER_ID = 1;

/** Demo soft pop cap per GDD. */
export const POP_CAP_HARD_LIMIT = 75;
const TREE_RESOURCE_AMOUNT = 100;
const LOCAL_GOLD_DEPOSIT_AMOUNT = 650;
const LOCAL_STONE_DEPOSIT_AMOUNT = 600;
const CENTER_GOLD_DEPOSIT_AMOUNT = 850;
const CENTER_STONE_DEPOSIT_AMOUNT = 750;
const SCATTERED_GOLD_DEPOSIT_AMOUNT = 500;
const SCATTERED_STONE_DEPOSIT_AMOUNT = 450;
const STARTING_RESOURCE_BANKS: Record<AgeIdValue, Readonly<Record<ResourceKind, number>>> = {
  [AgeId.DARK]: {
    [ResourceKindId.FOOD]: 0,
    [ResourceKindId.WOOD]: 300,
    [ResourceKindId.GOLD]: 0,
    [ResourceKindId.STONE]: 0,
  },
  [AgeId.CASTLE]: {
    [ResourceKindId.FOOD]: 600,
    [ResourceKindId.WOOD]: 1800,
    [ResourceKindId.GOLD]: 0,
    [ResourceKindId.STONE]: 1600,
  },
  [AgeId.GUNPOWDER]: {
    [ResourceKindId.FOOD]: 1200,
    [ResourceKindId.WOOD]: 2600,
    [ResourceKindId.GOLD]: 2200,
    [ResourceKindId.STONE]: 2200,
  },
  [AgeId.TOTAL_WAR]: {
    [ResourceKindId.FOOD]: 2400,
    [ResourceKindId.WOOD]: 3600,
    [ResourceKindId.GOLD]: 3600,
    [ResourceKindId.STONE]: 2800,
  },
};
const REGENERATED_TREE_AMOUNT = 80;
const FOREST_TILE_INITIAL_TREE_CHANCE = 0.48;
const FOREST_EDGE_INITIAL_TREE_BONUS = 0.2;
const LOCAL_STARTING_TREE_COUNT = 20;
const INITIAL_SCATTERED_TREE_COUNT = 72;
const INITIAL_EDGE_TREE_COUNT = 48;
const TREE_EDGE_BAND_TILES = 10;
const TREE_REGEN_INTERVAL_TICKS = SIM.TICK_HZ * 4;
const TREE_REGEN_CANDIDATES_PER_PASS = 32;
const TREE_REGEN_RADIUS = 4;
const TREE_REGEN_BUILDING_CLEARANCE = 4;
const TREE_REGEN_MAX_WOOD_NODES = 360;
const TREE_REGEN_BASE_CHANCE = 0.002;
const TREE_REGEN_CHANCE_PER_NEARBY_TREE = 0.006;
const TREE_REGEN_EDGE_PRESSURE_BONUS = 2.5;
const TREE_REGEN_MAX_CHANCE = 0.08;
const RESOURCE_GATHER_DISTANCE = 0.55;
const BUILDING_CONTACT_EDGE_GAP = 0.16;
const DROP_OFF_EDGE_DISTANCE = 0.24;
const WORKSITE_FALLBACK_DROP_OFF_RADIUS = 4;
const DROP_OFF_DEPOSIT_TICKS = Math.round(SIM.TICK_HZ * 0.5);
const FARM_WORK_EDGE_DISTANCE = 0.65;
const FARM_WORK_PATCH_INSET = 0.38;
const FARM_WORK_CYCLE_TICKS = Math.round(SIM.TICK_HZ * 2.4);
const FARM_MIN_WORK_CYCLE_TICKS = Math.round(SIM.TICK_HZ * 2);
const FARM_BASE_FOOD_PER_WORK_CYCLE = 2;
const FARM_YIELDS_I_FOOD_PER_WORK_CYCLE = 3;
const FARM_YIELDS_II_FOOD_PER_WORK_CYCLE = 4;
const MILL_FOOD_DEPOSIT_BONUS_MULTIPLIER = 0.5;
const BILA_HORA_ENEMY_OPENING_WAIT_TICKS = SIM.TICK_HZ * 15;
const KUTNA_HORA_FIRST_WAVE_TICKS = SIM.TICK_HZ * 30;
const KUTNA_HORA_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 65;
const KUTNA_HORA_TOTAL_WAVES = 5;
const SUDOMER_FIRST_WAVE_TICKS = SIM.TICK_HZ * 300;
const SUDOMER_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 55;
const SUDOMER_TOTAL_WAVES = 5;
const SUDOMER_POP_CAP = 120;
const SUDOMER_MUD_INFANTRY_SPEED_MULTIPLIER = 0.62;
const SUDOMER_MUD_CAVALRY_SPEED_MULTIPLIER = 0.34;
const ZBOROV_ENEMY_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 55;
const ZBOROV_ENEMY_FIRST_WAVE_TICKS = SIM.TICK_HZ * 70;
const ZBOROV_ENEMY_WAVE_MIN_SIZE = 3;
const ZBOROV_ENEMY_WAVE_MAX_SIZE = 8;
const ZBOROV_ENEMY_WAVE_WAIT_CAP_TICKS = SIM.TICK_HZ * 35;
const ZBOROV_BASE_DEAD_TREE_COUNT = 18;
const ZBOROV_AMBIENT_DEAD_TREE_COUNT = 28;
const ZBOROV_AMBIENT_DEAD_TREE_AMOUNT = 45;
const ZBOROV_WIRE_SPEED_MULTIPLIER = 0.4;
// Half-width of the playable corridor (must match generateZborovMap); the rest
// of the dirt/mud map is blocked so the assault can't flank around the lines.
const ZBOROV_CORRIDOR_HALF = Math.round(MAP.WIDTH * 0.24);
// Arena layout as fractions of MAP.HEIGHT (south/high = player, north/low =
// enemy). Each wire belt sits just SOUTH of (in front of) its rifle line; the
// forward machine-gun nests sit just NORTH of the forward belt (behind the
// wire, firing south through it). There is a broad no-man's-land between the
// player jump-off and the forward belt so nothing is in range at spawn.
const ZBOROV_FORWARD_LINE_FRAC = 0.48;
const ZBOROV_FORWARD_WIRE_FRAC = 0.55;
const ZBOROV_MID_LINE_FRAC = 0.375;
const ZBOROV_MID_WIRE_FRAC = 0.42;
const ZBOROV_REAR_LINE_FRAC = 0.27;
const ZBOROV_REAR_WIRE_FRAC = 0.31;
const ZBOROV_BUNKER_FRAC = 0.19;
const ZBOROV_PLAYER_BUNKER_FRAC = 0.81;
const ZBOROV_PLAYER_LINE_FRAC = 0.70;
const ZBOROV_MG_OFFSETS = [-13, -4, 4, 13];
const FORMATION_MODE_FREE = 0;
const FORMATION_MODE_LINE = 1;
const FORMATION_MODE_COMPACT = 2;
const FORMATION_MODE_MIN = FORMATION_MODE_FREE;
const FORMATION_MODE_MAX = FORMATION_MODE_COMPACT;
const FORMATION_MODE_DEFAULT = FORMATION_MODE_FREE;
const FORMATION_FACING_STEPS = 8;
const FORMATION_FACING_DEFAULT = 0;
const FORMATION_MAX_COLUMNS = 12;
const ATTACK_RANGE_TOLERANCE = 0.5;
const CANNON_WINDUP_TICKS = Math.round(SIM.TICK_HZ * 0.9);
const CANNON_SPLASH_FULL_DAMAGE_RADIUS = 0.48;
const CANNON_SPLASH_MAX_RADIUS = 2.6;
const CANNON_SPLASH_MIN_DAMAGE_FRACTION = 0.08;
const CANNON_SPLASH_FALLOFF_EXPONENT = 2.3;
const CANNON_BUILDING_DIRECT_HIT_RADIUS = 0.35;
const CANNON_BUILDING_DAMAGE_MULTIPLIER = 2;
const MACHINE_GUN_DEPLOY_TICKS = Math.round(SIM.TICK_HZ * 1.35);
// Mortars reuse the cannon's windup + splash + impact machinery, but lob on a
// higher, slower arc — a longer aim/elevation delay before each shell.
const MORTAR_WINDUP_TICKS = Math.round(SIM.TICK_HZ * 1.2);
export const AI_PLAYER_ID = 2;
const AI_DEFENSE_RADIUS = 11;
const AI_DEFENSE_ORDER_RADIUS = 18;
const AI_STAGE_RADIUS = 3.5;
const AI_EVENT_COOLDOWN_TICKS = SIM.TICK_HZ * 20;
const DEFAULT_UNIT_LINE_OF_SIGHT = 6;
const SCOUT_LINE_OF_SIGHT = 10;
const BUILDING_LINE_OF_SIGHT = 7;
const TOWN_CENTER_LINE_OF_SIGHT = 10;
const TOWER_LINE_OF_SIGHT = 12;
const VISION_TILE_FOOTPRINT_RADIUS = 0.5;
const VISION_EDGE_SOFTENING_TILES = 1;

function applyStartingResources(bank: Int32Array, ageId: AgeIdValue): void {
  const resources = STARTING_RESOURCE_BANKS[ageId] ?? STARTING_RESOURCE_BANKS[AgeId.DARK];
  bank[ResourceKindId.FOOD] = resources[ResourceKindId.FOOD];
  bank[ResourceKindId.WOOD] = resources[ResourceKindId.WOOD];
  bank[ResourceKindId.GOLD] = resources[ResourceKindId.GOLD];
  bank[ResourceKindId.STONE] = resources[ResourceKindId.STONE];
}

function isResourceTerrainTile(tile: number): boolean {
  return (
    tile !== TileType.WATER &&
    tile !== TileType.WATER_SHALLOW &&
    tile !== TileType.BRIDGE &&
    tile !== TileType.MUD &&
    tile !== TileType.ICE &&
    tile !== TileType.PACKED_SNOW
  );
}

const UNIT_SEPARATION_RADIUS = 0.42;
const WORKER_SEPARATION_RADIUS = 0.58;
const UNIT_SEPARATION_MAX_NUDGE = 0.08;
const WORKER_SEPARATION_MAX_NUDGE = 0.12;
const UNIT_SEPARATION_PASSES = 2;
const PATH_WAYPOINT_TOLERANCE = 0.12;
const PATH_CONTACT_FINAL_TOLERANCE = 0.06;
const PATH_FINAL_TOLERANCE = 0.28;
const STUCK_PROGRESS_EPSILON = 0.025;
const STUCK_PROGRESS_TICKS = Math.round(SIM.TICK_HZ * 2.5);
const STUCK_RECOVERY_COOLDOWN_TICKS = Math.round(SIM.TICK_HZ * 3);
const STUCK_REPATH_RADIUS = 4;
const WORKER_RESOURCE_CONTACT_GAP = 0.52;
const WORKER_RESOURCE_CONTACT_SLOT_RADIUS = 0.46;
const WORKER_RESOURCE_CONTACT_SLOT_UNIT_PENALTY = 18;
const WORKER_RESOURCE_CONTACT_SLOT_PATH_PENALTY = 12;
const WORKER_CONTACT_CROWD_RADIUS = 0.72;
const WORKER_CONTACT_UNIT_PENALTY = 8;
const WORKER_CONTACT_PATH_PENALTY = 5;
const HOLD_POSITION_MELEE_LEASH_TILES = 1.6;
const HOLD_POSITION_MELEE_LEASH_BUFFER = 0.3;

export type SimInput =
  // ── Selection-relative commands (local single-player UX). These read the
  //    local Selected component + LOCAL_PLAYER_ID, so they are NOT safe to send
  //    over the wire — a peer has no idea what the sender had selected. The
  //    network layer must translate these into their self-describing `cmd*`
  //    equivalents (which carry an explicit playerId + eid list) before sending.
  | { type: 'moveSelected'; to: GridPos }
  | { type: 'gatherSelected'; targetEid: number }
  | { type: 'stopSelected' }
  | { type: 'toggleSelectedUnitStance' }
  | { type: 'setSelectedUnitStance'; stance: UnitStanceValue }
  | { type: 'setFormationMode'; mode: number }
  | { type: 'adjustFormationMode'; delta: number }
  | { type: 'rotateSelectedFormation'; delta: number }
  | { type: 'reformSelectedFormation' }
  | { type: 'attackSelected'; targetEid: number }
  | { type: 'attackMoveSelected'; to: GridPos }
  // ── Self-describing commands (network-safe). Every field needed to apply the
  //    command on any client is present: the commanding playerId and the exact
  //    actor eids. eids are resolved on the sender; receivers validate ownership.
  | { type: 'cmdMove'; playerId: number; eids: number[]; to: GridPos }
  | { type: 'cmdGather'; playerId: number; eids: number[]; targetEid: number }
  | { type: 'cmdStop'; playerId: number; eids: number[] }
  | { type: 'cmdToggleStance'; playerId: number; eids: number[] }
  | { type: 'cmdAttack'; playerId: number; eids: number[]; targetEid: number }
  | { type: 'cmdAttackMove'; playerId: number; eids: number[]; to: GridPos }
  | { type: 'cmdRemoveBuildings'; playerId: number; eids: number[] }
  | { type: 'cmdSetStance'; playerId: number; eids: number[]; stance: UnitStanceValue }
  | { type: 'cmdSetFormationMode'; playerId: number; eids: number[]; mode: number }
  | { type: 'cmdAdjustFormationMode'; playerId: number; eids: number[]; delta: number }
  | { type: 'cmdRotateFormation'; playerId: number; eids: number[]; delta: number }
  | { type: 'cmdReformFormation'; playerId: number; eids: number[] }
  // ── Already self-describing (carry playerId or a global building eid).
  | { type: 'setArmyRallyPoint'; playerId: number; x: number; y: number }
  | { type: 'placeBuilding'; defId: number; x: number; y: number; playerId: number }
  | { type: 'removeSelectedBuildings'; playerId: number }
  | { type: 'trainUnit'; atEid: number; defId: number; count?: number; playerId?: number }
  | { type: 'cancelProduction'; atEid: number; playerId?: number }
  | { type: 'advanceAge'; playerId: number }
  | { type: 'researchTech'; playerId: number; techId: TechIdValue };

/** Per-player age progression state. */
export interface AgeState {
  current: number;
  /** Ticks of progress on advance to next age. -1 = not advancing. */
  progress: number;
  /** Cached totalTicks for the in-flight advance. 0 when idle. */
  totalTicks: number;
}

/** Outcome of the match — set by winConditionSystem when one player loses or wins. */
export type MatchOutcome =
  | { state: 'playing' }
  | { state: 'victory'; winnerPlayerId: number; mode: 'conquest' };

export interface CampaignObjectiveState {
  id: string;
  label: string;
  optional: boolean;
  completed: boolean;
}

export interface CampaignState {
  missionId: CampaignMissionIdValue;
  name: string;
  description: string;
  briefing: string;
  lockedTechs: TechIdValue[];
  objectives: CampaignObjectiveState[];
  trackedObjectiveEids: Record<string, number[]>;
  enemyAiMode: 'defensive';
  nextReinforcementTick: number;
  scriptedWaveIndex?: number;
  scriptedWaveCount?: number;
  /** Zborov bite-and-hold: how many trench lines the player has taken so far,
   *  and the y the player's reinforcements now muster at (advances as lines
   *  fall). */
  zborovLinesTaken?: number;
  zborovForwardY?: number;
}

export interface PopState {
  current: number;
  cap: number;
}

export interface CombatEvent {
  type: 'attack';
  tick: number;
  attackerEid: number;
  targetEid: number;
  attackerKind: number;
  range: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  phase?: 'windup' | 'fire';
  windupTicks?: number;
  projectileTicks?: number;
}

/** Non-combat sound triggers the render layer plays. Sim appends; render
 *  drains. Output-only (sim never reads it back), so determinism is unaffected
 *  — same contract as combatEvents. Combat fire SFX come from combatEvents;
 *  these cover state transitions that emit no combat event. */
export type SoundCueKind =
  | 'gather_wood'
  | 'gather_stone'
  | 'gather_gold'
  | 'gather_food'
  | 'unit_death'
  | 'building_destroyed'
  | 'cannon_impact'
  | 'build_complete'
  | 'unit_ready'
  | 'age_up';

export interface SoundCue {
  kind: SoundCueKind;
  /** World tile coords for spatial panning. Ignored for non-spatial cues. */
  x: number;
  y: number;
  /** Owning player — render uses this for fog/local-player filtering. */
  player: number;
}

interface CannonWindup {
  targetEid: number;
  ticksRemaining: number;
}

interface PendingCannonImpact {
  impactTick: number;
  attackerEid: number;
  attackerOwner: number;
  impactX: number;
  impactY: number;
  damage: number;
}

interface PendingProjectileImpact {
  impactTick: number;
  attackerEid: number;
  attackerOwner: number;
  targetEid: number;
  damage: number;
}

export type AiPlan = 'opening' | 'massing' | 'staging' | 'attacking' | 'defending' | 'recovering';
export type AiDifficulty = 'easy' | 'medium' | 'hard';

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

export interface AiPlayerState {
  plan: AiPlan;
  nextAttackTick: number;
  lastAttackTick: number;
  stageStartedTick: number;
  rallyPoint: GridPos | null;
  waveUnitEids: number[];
  lastAttackEventTick: number;
  lastDefenseEventTick: number;
}

export interface AiEvent {
  tick: number;
  playerId: number;
  message: string;
}

export interface LastSeenBuilding {
  eid: number;
  owner: number;
  defId: number;
  age: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  isFoundation: boolean;
}

export interface PlayerVisibility {
  explored: Uint8Array;
  visible: Uint8Array;
  lastSeenBuildings: Map<number, LastSeenBuilding>;
}

interface MovementStuckState {
  lastDist: number;
  waypointX: number;
  waypointY: number;
  noProgressTicks: number;
  cooldownTicks: number;
  attempts: number;
}

export interface SimWorld {
  ecs: IWorld;
  rng: Rng;
  tick: number;
  inputs: SimInput[];
  /** Per-entity remaining path waypoints. Cleared as the unit progresses. */
  paths: Map<number, GridPos[]>;
  /** Transient progress tracking used to sidestep/repath blocked movement. */
  movementStuck: Map<number, MovementStuckState>;
  /** Temporary speed caps for selected groups moving as a formation. */
  formationSpeedCaps: Map<number, number>;
  /**
   * Per-player command formation shape: 0 = free, 1 = line, 2 = compact.
   * Indexed by playerId. Each player's choice is independent so it stays correct
   * in multiplayer (a peer changing formation must not reshape your army).
   */
  formationModes: number[];
  /**
   * Per-player command formation facing. Eight 45-degree steps, 0 faces +Y.
   * Indexed by playerId.
   */
  formationFacings: number[];
  pathfinder: Pathfinder;
  /** Static map grid (0 walkable, 1+ blocked). */
  grid: number[][];
  /**
   * Per-player resource banks. resources[playerId] = Int32Array of length 4
   * indexed by ResourceKindId (FOOD/WOOD/GOLD/STONE).
   */
  resources: Int32Array[];
  /** Per-player population state. population[playerId] = { current, cap }. */
  population: PopState[];
  /**
   * Per-building production queues. Each entry is an array of unit defIds
   * (front = currently training). Front entry's progress lives on
   * Producer.currentProgress[eid].
   */
  productionQueues: Map<number, number[]>;
  /** Per-player global rally point for units trained from army buildings. */
  armyRallyPoints: Array<GridPos | null>;
  /** Per-player age progression. ages[playerId] = AgeState. */
  ages: AgeState[];
  /** Per-player researched technologies. */
  researchedTechs: Array<Set<TechIdValue>>;
  /** Player map knowledge. visible is rebuilt each tick; explored persists. */
  visibility: PlayerVisibility[];
  /** Cheat/debug map reveal flags by player. When true, fog stays fully cleared. */
  revealedMapPlayers: boolean[];
  /** Match outcome — set by winConditionSystem. */
  outcome: MatchOutcome;
  /** Active campaign mission state. Null in skirmish mode. */
  campaign: CampaignState | null;
  /** Render-consumed combat events. Sim appends; render drains. */
  combatEvents: CombatEvent[];
  /** Projectile attacks apply damage on impact rather than at fire time. */
  cannonWindups: Map<number, CannonWindup>;
  pendingProjectileImpacts: PendingProjectileImpact[];
  pendingCannonImpacts: PendingCannonImpact[];
  /** Players controlled by a human. Always includes LOCAL_PLAYER_ID. In a
   *  multiplayer match the remote player(s) are added here so the AI controller
   *  is suppressed for them — they're driven by relayed commands instead. */
  humanPlayers: Set<number>;
  /** Per-player AI controller state. Null for human/gaia players. */
  aiPlayers: Array<AiPlayerState | null>;
  /** Controls AI build cadence, economy scale, and attack wave discipline. */
  aiDifficulty: AiDifficulty;
  /** Render-consumed AI event messages. */
  aiEvents: AiEvent[];
  /** Render-consumed non-combat sound cues. Sim appends; render drains. */
  soundCues: SoundCue[];
  /** When true, step() is a no-op (title screen, pause menu). */
  paused: boolean;
  /** Procedurally generated map (terrain tiles + heightmap + bridges + spawns). */
  map: MapData;
}

export interface CreateSimWorldOptions {
  startingAge?: AgeIdValue;
  mapId?: MapIdValue;
  aiDifficulty?: AiDifficulty;
  campaignMissionId?: CampaignMissionIdValue;
}

function normalizeStartingAge(ageId: number | undefined): AgeIdValue {
  if (ageId === AgeId.CASTLE) return AgeId.CASTLE;
  if (ageId === AgeId.GUNPOWDER) return AgeId.GUNPOWDER;
  if (ageId === AgeId.TOTAL_WAR) return AgeId.TOTAL_WAR;
  return AgeId.DARK;
}

function createAgeState(current: AgeIdValue): AgeState {
  return { current, progress: -1, totalTicks: 0 };
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

function createAiPlayers(difficulty: AiDifficulty): Array<AiPlayerState | null> {
  const states: Array<AiPlayerState | null> = Array.from(
    { length: MAX_PLAYERS },
    () => null
  );
  states[AI_PLAYER_ID] = createAiPlayerState(0, difficulty);
  return states;
}

function getHousePopProvided(world: SimWorld, playerId: number): number {
  if (hasTech(world, playerId, TechId.HOUSING_II)) return 8;
  if (hasTech(world, playerId, TechId.HOUSING_I)) return 5;
  return BUILDING_TABLE[BuildingDefId.HOUSE].popProvided;
}

export function getBuildingPopProvided(
  world: SimWorld,
  playerId: number,
  defId: number
): number {
  if (defId === BuildingDefId.HOUSE) return getHousePopProvided(world, playerId);
  return BUILDING_TABLE[defId]?.popProvided ?? 0;
}

function recalculatePlayerPopCap(world: SimWorld, playerId: number): void {
  const pop = world.population[playerId];
  if (!pop) return;
  let cap = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    cap += getBuildingPopProvided(world, playerId, Building.defId[eid]);
  }
  pop.cap = Math.min(POP_CAP_HARD_LIMIT, cap);
}

export function createVisibilityState(): PlayerVisibility {
  const size = MAP.WIDTH * MAP.HEIGHT;
  return {
    explored: new Uint8Array(size),
    visible: new Uint8Array(size),
    lastSeenBuildings: new Map(),
  };
}

export function createVisibilityStates(): PlayerVisibility[] {
  return Array.from({ length: MAX_PLAYERS }, () => createVisibilityState());
}

/**
 * Build a fresh sim world:
 * - 1 Town Center per player
 * - 1 of each combat unit per player
 * - no starter villagers; specialist resource buildings spawn work crews
 * - local wood, gold, and stone patches near each TC; farms generate food
 */
export function createSimWorld(seed: number, options: CreateSimWorldOptions = {}): SimWorld {
  if (options.campaignMissionId) {
    return createCampaignWorld(seed, options.campaignMissionId);
  }
  const startingAge = normalizeStartingAge(options.startingAge);
  const aiDifficulty = normalizeAiDifficulty(options.aiDifficulty);
  const ecs = createWorld();
  const rng = new Rng(seed);
  // Generate the map first — its walkability grid drives the pathfinder.
  const selectedMapId = options.mapId ?? MapId.RIVERLANDS;
  const mapData = generateMap(rng, selectedMapId);
  const grid = mapData.walkability;
  const pathfinder = new Pathfinder(grid);
  const resources: Int32Array[] = Array.from(
    { length: MAX_PLAYERS },
    () => new Int32Array(4)
  );
  // Tech-tree opener: just enough wood to establish lumber and stone worksites.
  applyStartingResources(resources[1], startingAge);

  const population: PopState[] = Array.from(
    { length: MAX_PLAYERS },
    () => ({ current: 0, cap: 0 })
  );

  const ages: AgeState[] = Array.from(
    { length: MAX_PLAYERS },
    () => createAgeState(AgeId.DARK)
  );
  ages[LOCAL_PLAYER_ID] = createAgeState(startingAge);
  ages[AI_PLAYER_ID] = createAgeState(startingAge);
  const researchedTechs: Array<Set<TechIdValue>> = Array.from(
    { length: MAX_PLAYERS },
    () => createStartingTechSetForAge(startingAge)
  );

  // Player 2 (enemy) starts with the same resources.
  applyStartingResources(resources[AI_PLAYER_ID], startingAge);

  const world: SimWorld = {
    ecs,
    rng,
    tick: 0,
    inputs: [],
    paths: new Map(),
    movementStuck: new Map(),
    formationSpeedCaps: new Map(),
    formationModes: new Array(MAX_PLAYERS).fill(FORMATION_MODE_DEFAULT),
    formationFacings: new Array(MAX_PLAYERS).fill(FORMATION_FACING_DEFAULT),
    pathfinder,
    grid,
    resources,
    population,
    productionQueues: new Map(),
    armyRallyPoints: Array.from({ length: MAX_PLAYERS }, () => null),
    ages,
    researchedTechs,
    visibility: createVisibilityStates(),
    revealedMapPlayers: Array.from({ length: MAX_PLAYERS }, () => false),
    outcome: { state: 'playing' },
    campaign: null,
    combatEvents: [],
    cannonWindups: new Map(),
    pendingProjectileImpacts: [],
    pendingCannonImpacts: [],
    humanPlayers: new Set([LOCAL_PLAYER_ID]),
    aiPlayers: createAiPlayers(aiDifficulty),
    aiDifficulty,
    aiEvents: [],
    soundCues: [],
    paused: true,
    map: mapData,
  };

  const canPlaceResourceAt = (x: number, y: number): boolean => {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
    if (mapData.walkability[ty][tx] !== 0) return false;
    if (!isResourceTerrainTile(mapData.tiles[ty * MAP.WIDTH + tx])) return false;
    if (hasMapFeatureAt(world, tx, ty, 0.6)) return false;
    if (findResourceAt(world, tx, ty, 0.6) !== null) return false;
    if (findBuildingAt(world, tx, ty, 0.9) !== null) return false;
    return true;
  };

  const nearestResourceTile = (x: number, y: number, maxR: number): GridPos | null => {
    const cx = Math.max(0, Math.min(MAP.WIDTH - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(MAP.HEIGHT - 1, Math.round(y)));
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (canPlaceResourceAt(tx, ty)) return { x: tx, y: ty };
        }
      }
    }
    return null;
  };

  /** Try to spawn at (x, y). If that tile is water, bridge, occupied, or
   *  otherwise invalid, search outward for the nearest valid land tile. */
  const resolveResourceSpawn = (x: number, y: number): GridPos | null => {
    if (canPlaceResourceAt(x, y)) return { x: Math.round(x), y: Math.round(y) };
    return nearestResourceTile(x, y, 6);
  };

  const safeSpawnResource = (kind: ResourceKind, x: number, y: number, amt: number) => {
    const spot = resolveResourceSpawn(x, y);
    if (!spot) return;
    spawnResource(world, kind, spot.x, spot.y, amt);
  };

  const safeSpawnMirroredResource = (kind: ResourceKind, x: number, y: number, amt: number) => {
    const spot = resolveResourceSpawn(x, y);
    if (!spot) return;
    spawnResource(world, kind, spot.x, spot.y, amt);

    const mirror = { x: MAP.WIDTH - 1 - spot.x, y: MAP.HEIGHT - 1 - spot.y };
    if (mirror.x !== spot.x || mirror.y !== spot.y) {
      if (canPlaceResourceAt(mirror.x, mirror.y)) {
        spawnResource(world, kind, mirror.x, mirror.y, amt);
      } else {
        const fallback = resolveResourceSpawn(mirror.x, mirror.y);
        if (fallback) spawnResource(world, kind, fallback.x, fallback.y, amt);
      }
    }
  };

  const safeSpawnCombatUnit = (
    kind: 'ARCHER' | 'SPEARMAN' | 'SCOUT_CAVALRY',
    vx: number,
    vy: number,
    p: number
  ) => {
    const spot = findSpawnSpot(world, vx, vy, 6);
    if (!spot) return;
    if (kind === 'ARCHER') spawnArcher(world, spot.x, spot.y, p);
    else if (kind === 'SPEARMAN') spawnSpearman(world, spot.x, spot.y, p);
    else spawnScoutCavalry(world, spot.x, spot.y, p);
  };

  const mirroredSnowSkirmish = selectedMapId === MapId.KRKONOSE_WINTER_CROWN;
  const floodedBasinSkirmish = selectedMapId === MapId.FLOODED_BASIN;

  // ── Player 1 (Bohemia, lower-left) ────────────────────────────────────────
  const p1 = mapData.spawns[1];
  const p1x = p1.x;
  const p1y = p1.y;
  spawnTownCenter(world, p1x, p1y, 1);
  safeSpawnCombatUnit('ARCHER', p1x + 1, p1y + 3, 1);
  safeSpawnCombatUnit('SPEARMAN', p1x - 1, p1y + 3, 1);
  safeSpawnCombatUnit('SCOUT_CAVALRY', p1x + 2, p1y + 2, 1);

  // Player 1's local resource patches — denser around the TC so each AI/human
  // has plenty to harvest without crossing the map.
  if (mirroredSnowSkirmish) {
    for (let i = 0; i < LOCAL_STARTING_TREE_COUNT; i++) {
      safeSpawnMirroredResource(
        ResourceKindId.WOOD,
        p1x + 4 + (i % 5),
        p1y - 3 - Math.floor(i / 5) * 2,
        TREE_RESOURCE_AMOUNT
      );
    }
    for (let i = 0; i < 4; i++) {
      safeSpawnMirroredResource(
        ResourceKindId.GOLD,
        p1x - 3 - (i % 2),
        p1y - 2 - Math.floor(i / 2),
        LOCAL_GOLD_DEPOSIT_AMOUNT
      );
    }
    for (let i = 0; i < 3; i++) {
      safeSpawnMirroredResource(
        ResourceKindId.STONE,
        p1x - 4 - i,
        p1y + 3 + (i % 2),
        LOCAL_STONE_DEPOSIT_AMOUNT
      );
    }
  } else {
    for (let i = 0; i < LOCAL_STARTING_TREE_COUNT; i++) {
      safeSpawnResource(
        ResourceKindId.WOOD,
        p1x + 4 + (i % 5),
        p1y - 3 - Math.floor(i / 5) * 2,
        TREE_RESOURCE_AMOUNT
      );
    }
    for (let i = 0; i < 4; i++) {
      safeSpawnResource(
        ResourceKindId.GOLD,
        p1x - 3 - (i % 2),
        p1y - 2 - Math.floor(i / 2),
        LOCAL_GOLD_DEPOSIT_AMOUNT
      );
    }
    for (let i = 0; i < 3; i++) {
      safeSpawnResource(
        ResourceKindId.STONE,
        p1x - 4 - i,
        p1y + 3 + (i % 2),
        LOCAL_STONE_DEPOSIT_AMOUNT
      );
    }
  }

  // ── Player 2 (Frankia, upper-right) ──────────────────────────────────────
  const p2 = mapData.spawns[2];
  const p2x = p2.x;
  const p2y = p2.y;
  spawnTownCenter(world, p2x, p2y, 2);
  safeSpawnCombatUnit('ARCHER', p2x + 1, p2y + 3, 2);
  safeSpawnCombatUnit('SPEARMAN', p2x - 1, p2y + 3, 2);
  safeSpawnCombatUnit('SCOUT_CAVALRY', p2x + 2, p2y + 2, 2);

  // Player 2's local patches mirror player 1.
  if (!mirroredSnowSkirmish) {
    for (let i = 0; i < LOCAL_STARTING_TREE_COUNT; i++) {
      safeSpawnResource(
        ResourceKindId.WOOD,
        p2x - 4 - (i % 5),
        p2y + 3 + Math.floor(i / 5) * 2,
        TREE_RESOURCE_AMOUNT
      );
    }
    for (let i = 0; i < 4; i++) {
      safeSpawnResource(
        ResourceKindId.GOLD,
        p2x + 3 + (i % 2),
        p2y + 2 + Math.floor(i / 2),
        LOCAL_GOLD_DEPOSIT_AMOUNT
      );
    }
    for (let i = 0; i < 3; i++) {
      safeSpawnResource(
        ResourceKindId.STONE,
        p2x + 4 + i,
        p2y - 3 - (i % 2),
        LOCAL_STONE_DEPOSIT_AMOUNT
      );
    }
  }

  if (mirroredSnowSkirmish) {
    const mirroredExpansionResources: Array<[ResourceKind, number, number, number]> = [
      [ResourceKindId.GOLD, Math.round(MAP.WIDTH * 0.42), Math.round(MAP.HEIGHT * 0.46), CENTER_GOLD_DEPOSIT_AMOUNT],
      [ResourceKindId.GOLD, Math.round(MAP.WIDTH * 0.35), Math.round(MAP.HEIGHT * 0.57), SCATTERED_GOLD_DEPOSIT_AMOUNT],
      [ResourceKindId.GOLD, Math.round(MAP.WIDTH * 0.20), Math.round(MAP.HEIGHT * 0.37), SCATTERED_GOLD_DEPOSIT_AMOUNT],
      [ResourceKindId.STONE, Math.round(MAP.WIDTH * 0.45), Math.round(MAP.HEIGHT * 0.59), CENTER_STONE_DEPOSIT_AMOUNT],
      [ResourceKindId.STONE, Math.round(MAP.WIDTH * 0.28), Math.round(MAP.HEIGHT * 0.52), SCATTERED_STONE_DEPOSIT_AMOUNT],
      [ResourceKindId.STONE, Math.round(MAP.WIDTH * 0.16), Math.round(MAP.HEIGHT * 0.57), SCATTERED_STONE_DEPOSIT_AMOUNT],
    ];
    for (const [kind, x, y, amount] of mirroredExpansionResources) {
      safeSpawnMirroredResource(kind, x, y, amount);
    }
  } else {
    // Map-wide resource scatter — gives the bigger 64×64 playfield enough
    // ambient resources that expanding feels rewarding. Deterministic via rng.
    const mx = Math.floor(MAP.WIDTH / 2);
    const my = Math.floor(MAP.HEIGHT / 2);
    if (floodedBasinSkirmish) {
      const basinCenterResources: Array<[ResourceKind, number, number, number]> = [
        [ResourceKindId.GOLD, mx - 2, my - 5, CENTER_GOLD_DEPOSIT_AMOUNT],
        [ResourceKindId.GOLD, mx - 1, my - 6, CENTER_GOLD_DEPOSIT_AMOUNT],
        [ResourceKindId.STONE, mx + 1, my - 5, CENTER_STONE_DEPOSIT_AMOUNT],
        [ResourceKindId.STONE, mx + 2, my - 6, CENTER_STONE_DEPOSIT_AMOUNT],
        [ResourceKindId.GOLD, mx - 2, my + 5, CENTER_GOLD_DEPOSIT_AMOUNT],
        [ResourceKindId.GOLD, mx - 1, my + 6, CENTER_GOLD_DEPOSIT_AMOUNT],
        [ResourceKindId.STONE, mx + 1, my + 5, CENTER_STONE_DEPOSIT_AMOUNT],
        [ResourceKindId.STONE, mx + 2, my + 6, CENTER_STONE_DEPOSIT_AMOUNT],
      ];
      for (const [kind, x, y, amount] of basinCenterResources) {
        safeSpawnResource(kind, x, y, amount);
      }
    } else {
      // Contested centre gold/stone — worth crossing the river for.
      safeSpawnResource(ResourceKindId.GOLD, mx - 1, my, CENTER_GOLD_DEPOSIT_AMOUNT);
      safeSpawnResource(ResourceKindId.GOLD, mx, my, CENTER_GOLD_DEPOSIT_AMOUNT);
      safeSpawnResource(ResourceKindId.GOLD, mx + 1, my, CENTER_GOLD_DEPOSIT_AMOUNT);
      safeSpawnResource(ResourceKindId.STONE, mx - 1, my + 2, CENTER_STONE_DEPOSIT_AMOUNT);
      safeSpawnResource(ResourceKindId.STONE, mx, my + 2, CENTER_STONE_DEPOSIT_AMOUNT);
      safeSpawnResource(ResourceKindId.STONE, mx + 1, my + 2, CENTER_STONE_DEPOSIT_AMOUNT);
    }

    if (selectedMapId === MapId.BOHEMIAN_BORDER_FOREST) {
      const nwX = Math.round(MAP.WIDTH * 0.22);
      const nwY = Math.round(MAP.HEIGHT * 0.22);
      const seX = Math.round(MAP.WIDTH * 0.78);
      const seY = Math.round(MAP.HEIGHT * 0.78);
      for (let i = 0; i < 3; i++) {
        safeSpawnResource(ResourceKindId.GOLD, nwX - 2 + i, nwY - 1, SCATTERED_GOLD_DEPOSIT_AMOUNT);
        safeSpawnResource(ResourceKindId.STONE, nwX + 1 + i, nwY + 2, SCATTERED_STONE_DEPOSIT_AMOUNT);
        safeSpawnResource(ResourceKindId.GOLD, seX + 2 - i, seY + 1, SCATTERED_GOLD_DEPOSIT_AMOUNT);
        safeSpawnResource(ResourceKindId.STONE, seX - 1 - i, seY - 2, SCATTERED_STONE_DEPOSIT_AMOUNT);
      }
    }
  }

  // Real tree resources on generated forest terrain, plus scattered singletons.
  seedInitialForestTrees(world, mirroredSnowSkirmish);
  if (!mirroredSnowSkirmish) {
    for (let i = 0; i < INITIAL_SCATTERED_TREE_COUNT; i++) {
      const x = Math.floor(rng.next() * MAP.WIDTH);
      const y = Math.floor(rng.next() * MAP.HEIGHT);
      safeSpawnResource(ResourceKindId.WOOD, x, y, 80);
    }
    for (let i = 0; i < INITIAL_EDGE_TREE_COUNT; i++) {
      const spot = randomEdgeTile(world);
      safeSpawnResource(ResourceKindId.WOOD, spot.x, spot.y, 80);
    }
    // A few extra gold/stone outcrops far from spawns.
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(rng.next() * MAP.WIDTH);
      const y = Math.floor(rng.next() * MAP.HEIGHT);
      safeSpawnResource(ResourceKindId.GOLD, x, y, SCATTERED_GOLD_DEPOSIT_AMOUNT);
    }
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rng.next() * MAP.WIDTH);
      const y = Math.floor(rng.next() * MAP.HEIGHT);
      safeSpawnResource(ResourceKindId.STONE, x, y, SCATTERED_STONE_DEPOSIT_AMOUNT);
    }
  }

  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
  return world;
}

export function createCampaignWorld(
  seed: number,
  missionId: CampaignMissionIdValue = CampaignMissionId.SIEGE_OF_BRNO
): SimWorld {
  const mission = getCampaignMissionDef(missionId) ?? getCampaignMissionDef(CampaignMissionId.SIEGE_OF_BRNO);
  if (!mission) return createSimWorld(seed);

  const world = createSimWorld(seed, {
    startingAge: mission.startingAge,
    mapId: mission.mapId,
  });

  if (mission.id === CampaignMissionId.SIEGE_OF_BRNO) {
    configureSiegeOfBrno(world, mission.objectives);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_BILA_HORA) {
    configureBattleOfBilaHora(world);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_KUTNA_HORA) {
    configureBattleOfKutnaHora(world);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_SUDOMER) {
    configureBattleOfSudomer(world);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_ZBOROV) {
    configureBattleOfZborov(world);
  }

  const configuredCampaign = world.campaign;
  world.campaign = {
    missionId: mission.id,
    name: mission.name,
    description: mission.description,
    briefing: mission.briefing,
    lockedTechs: mission.lockedTechs.slice(),
    objectives: mission.objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      optional: objective.optional === true,
      completed: false,
    })),
    trackedObjectiveEids: configuredCampaign?.trackedObjectiveEids ?? {},
    enemyAiMode: 'defensive',
    nextReinforcementTick:
      configuredCampaign?.nextReinforcementTick ?? world.tick + SIM.TICK_HZ * 70,
    scriptedWaveIndex: configuredCampaign?.scriptedWaveIndex,
    scriptedWaveCount: configuredCampaign?.scriptedWaveCount,
    zborovLinesTaken: configuredCampaign?.zborovLinesTaken,
    zborovForwardY: configuredCampaign?.zborovForwardY,
  };

  updateCampaignObjectives(world);
  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
  return world;
}

function configureBattleOfBilaHora(world: SimWorld): void {
  clearBattlefieldForTownlessMission(world);

  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  world.resources[LOCAL_PLAYER_ID].set([0, 0, 0, 0]);
  world.resources[AI_PLAYER_ID].set([0, 0, 0, 0]);
  world.population[LOCAL_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.population[AI_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;

  const p1 = world.map.spawns[LOCAL_PLAYER_ID];
  const p2 = world.map.spawns[AI_PLAYER_ID];
  const road = normalizeVector(p2.x - p1.x, p2.y - p1.y);
  const across = { x: -road.y, y: road.x };
  const bohemian = {
    x: Math.round(p1.x + (p2.x - p1.x) * 0.39),
    y: Math.round(p1.y + (p2.y - p1.y) * 0.39),
  };
  const imperial = clampBattlePoint(offsetBattlePoint(p2, road, across, 5, 0));

  clearBilaHoraDeploymentZone(world, bohemian, road, across, 17, 8);
  clearBilaHoraDeploymentZone(world, imperial, road, across, 21, 10);
  seedBilaHoraPassTrees(world, bohemian, imperial, road, across);
  world.map.spawns[LOCAL_PLAYER_ID] = bohemian;
  world.map.spawns[AI_PLAYER_ID] = imperial;

  const defenders = spawnBilaHoraBohemianLine(world, bohemian, road, across);
  const trackedObjectiveEids = spawnBilaHoraImperialArmy(world, imperial, road, across);
  setBilaHoraDefensiveStance(world, defenders);

  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_BILA_HORA,
    name: 'Battle of Bílá Hora',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids,
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + BILA_HORA_ENEMY_OPENING_WAIT_TICKS,
  };
  world.aiPlayers[AI_PLAYER_ID] = null;
  revealMapForPlayer(world, LOCAL_PLAYER_ID);
}

function configureBattleOfZborov(world: SimWorld): void {
  clearBattlefieldForTownlessMission(world);
  // Strip the skirmish map's generic resources; this mission gets explicit rear
  // economies so the fight stays inside the trench corridor.
  for (const eid of [...resourceQuery(world.ecs)]) removeEntity(world.ecs, eid);
  layZborovWire(world);

  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.TOTAL_WAR);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.TOTAL_WAR);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  world.resources[LOCAL_PLAYER_ID].set([260, 320, 420, 260]);
  world.resources[AI_PLAYER_ID].set([220, 280, 380, 240]);
  world.population[LOCAL_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.population[AI_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;

  const jumpOff = world.map.spawns[LOCAL_PLAYER_ID];

  placeZborovEconomy(world, AI_PLAYER_ID, ZBOROV_BUNKER_FRAC);
  placeZborovEconomy(world, LOCAL_PLAYER_ID, ZBOROV_PLAYER_BUNKER_FRAC);
  const bunkerEids = placeZborovCommandFoundry(world, AI_PLAYER_ID, ZBOROV_BUNKER_FRAC);
  const playerBaseEids = placeZborovCommandFoundry(world, LOCAL_PLAYER_ID, ZBOROV_PLAYER_BUNKER_FRAC);
  const garrison = spawnZborovGarrison(world);
  setBilaHoraDefensiveStance(world, garrison.all);
  const playerDefenders = spawnZborovPlayerDefenders(world);
  setBilaHoraDefensiveStance(world, playerDefenders);
  seedZborovAmbientDeadTrees(world);

  world.armyRallyPoints[LOCAL_PLAYER_ID] = { x: jumpOff.x, y: Math.round(MAP.HEIGHT * ZBOROV_PLAYER_LINE_FRAC) - 2 };
  world.armyRallyPoints[AI_PLAYER_ID] = { x: world.map.spawns[AI_PLAYER_ID].x, y: Math.round(MAP.HEIGHT * ZBOROV_REAR_LINE_FRAC) + 3 };
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_ZBOROV,
    name: 'Battle of Zborov',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids: {
      silence_mg_nests: garrison.nestEids,
      take_trench_1: garrison.line1,
      take_trench_2: garrison.line2,
      take_trench_3: garrison.line3,
      take_command_bunker: bunkerEids,
      hold_legion_command: playerBaseEids,
      zborov_garrison: garrison.all,
      zborov_player_defenders: playerDefenders,
      zborov_reinforcements: [],
      zborov_enemy_reinforcements: [],
    },
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + ZBOROV_ENEMY_FIRST_WAVE_TICKS,
    zborovLinesTaken: 0,
    zborovForwardY: jumpOff.y,
    scriptedWaveIndex: 0,
  };
  pushAiEvent(
    world,
    AI_PLAYER_ID,
    'Zborov is now an economy duel. Keep your foundry working, mass gunmen and cannon, and break the trench lines before their trained waves overrun your command post.'
  );
  revealMapForPlayer(world, LOCAL_PLAYER_ID);
}

function placeZborovCommandFoundry(
  world: SimWorld,
  playerId: number,
  yFrac: number
): number[] {
  const bunker = placePresetBuildingExact(
    world,
    BuildingDefId.FOUNDRY,
    Math.round(MAP.WIDTH * 0.5),
    Math.round(MAP.HEIGHT * yFrac),
    playerId
  );
  return bunker !== null ? [bunker] : [];
}

function placeZborovEconomy(
  world: SimWorld,
  playerId: number,
  baseYFrac: number
): number[] {
  const cx = Math.round(MAP.WIDTH * 0.5);
  const baseY = Math.round(MAP.HEIGHT * baseYFrac);
  const rearDir = playerId === LOCAL_PLAYER_ID ? 1 : -1;
  const base = { x: cx, y: baseY };
  clearZborovBaseGround(world, base, 14, 9);
  seedZborovBaseResources(world, base, rearDir);

  const built: number[] = [];
  const place = (defId: number, dx: number, dy: number) => {
    const eid = placePresetBuilding(world, defId, base.x + dx, base.y + dy, playerId);
    if (eid !== null) built.push(eid);
  };

  place(BuildingDefId.MILL, -8, rearDir * 3);
  place(BuildingDefId.FARM, -12, rearDir * 3);
  place(BuildingDefId.FARM, -9, rearDir * 6);
  place(BuildingDefId.FARM, -5, rearDir * 6);
  place(BuildingDefId.LUMBER_CAMP, 11, rearDir * 3);
  place(BuildingDefId.GOLD_MINE, 4, rearDir * 7);
  place(BuildingDefId.STONE_QUARRY, 10, rearDir * 7);
  return built;
}

function clearZborovBaseGround(
  world: SimWorld,
  center: GridPos,
  halfX: number,
  halfY: number
): void {
  const minX = Math.max(1, Math.round(center.x - halfX));
  const maxX = Math.min(MAP.WIDTH - 2, Math.round(center.x + halfX));
  const minY = Math.max(1, Math.round(center.y - halfY));
  const maxY = Math.min(MAP.HEIGHT - 2, Math.round(center.y + halfY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (x < center.x - ZBOROV_CORRIDOR_HALF || x > center.x + ZBOROV_CORRIDOR_HALF) continue;
      const idx = y * MAP.WIDTH + x;
      const baseLane = Math.abs(x - center.x) <= 1;
      const mudPatch = !baseLane && isZborovMudPatch(x, y);
      world.map.tiles[idx] = mudPatch ? TileType.MUD : TileType.DIRT;
      world.map.elevation[idx] = mudPatch ? 2 : 3;
      world.map.walkability[y][x] = 0;
      world.grid[y][x] = 0;
    }
  }

  for (const eid of [...resourceQuery(world.ecs)]) {
    if (
      Position.x[eid] >= minX - 1 &&
      Position.x[eid] <= maxX + 1 &&
      Position.y[eid] >= minY - 1 &&
      Position.y[eid] <= maxY + 1
    ) {
      removeEntity(world.ecs, eid);
    }
  }
}

function seedZborovBaseResources(
  world: SimWorld,
  base: GridPos,
  rearDir: number
): void {
  seedZborovBaseDeadTrees(world, base, rearDir);

  for (const [dx, dy] of [[3, 9], [4, 9], [5, 9], [4, 10]]) {
    spawnZborovResource(world, ResourceKindId.GOLD, base.x + dx, base.y + rearDir * dy, LOCAL_GOLD_DEPOSIT_AMOUNT);
  }
  for (const [dx, dy] of [[9, 9], [10, 9], [11, 9], [10, 10]]) {
    spawnZborovResource(world, ResourceKindId.STONE, base.x + dx, base.y + rearDir * dy, LOCAL_STONE_DEPOSIT_AMOUNT);
  }
}

function zborovHash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) ^ Math.imul(y - seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function zborovDeadTreeScore(x: number, y: number): number {
  const broad = zborovHash01(Math.floor(x / 4), Math.floor(y / 4), 41);
  const local = zborovHash01(x, y, 97);
  const scar = Math.sin(x * 0.29 + y * 0.17) * 0.08 + Math.cos(x * 0.13 - y * 0.31) * 0.08;
  return broad * 0.45 + local * 0.42 + scar + (isZborovMudPatch(x, y) ? 0.04 : 0);
}

function seedZborovBaseDeadTrees(
  world: SimWorld,
  base: GridPos,
  rearDir: number
): void {
  const candidates: Array<GridPos & { score: number }> = [];
  for (let dy = 3; dy <= 19; dy++) {
    for (let dx = -14; dx <= 15; dx++) {
      if (Math.abs(dx) <= 2 && dy <= 9) continue;
      if (isZborovBaseBuildingReserve(dx, dy)) continue;
      const x = base.x + dx;
      const y = base.y + rearDir * dy;
      if (!isZborovDeadTreeCandidate(world, x, y)) continue;
      const lumberCampBias = Math.max(0, 1 - Math.hypot(dx - 11, dy - 3) / 24) * 0.12;
      candidates.push({ x, y, score: zborovDeadTreeScore(x, y) + lumberCampBias });
    }
  }

  const selected: GridPos[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.some((spot) => Math.hypot(spot.x - candidate.x, spot.y - candidate.y) < 3.6)) continue;
    if (!trySpawnZborovDeadTree(world, candidate.x, candidate.y, TREE_RESOURCE_AMOUNT, 3.1)) continue;
    selected.push(candidate);
    if (selected.length >= ZBOROV_BASE_DEAD_TREE_COUNT) return;
  }
}

function isZborovBaseBuildingReserve(dx: number, dy: number): boolean {
  const reserved: GridPos[] = [
    { x: -12, y: 3 },
    { x: -8, y: 3 },
    { x: -9, y: 6 },
    { x: -5, y: 6 },
    { x: 11, y: 3 },
    { x: 4, y: 7 },
    { x: 10, y: 7 },
  ];
  return reserved.some((spot) => Math.abs(dx - spot.x) <= 1 && Math.abs(dy - spot.y) <= 1);
}

function seedZborovAmbientDeadTrees(world: SimWorld): void {
  const cx = Math.round(MAP.WIDTH * 0.5);
  const leftX = cx - ZBOROV_CORRIDOR_HALF + 2;
  const rightX = cx + ZBOROV_CORRIDOR_HALF - 2;
  const candidates: Array<GridPos & { score: number }> = [];

  for (let y = Math.round(MAP.HEIGHT * 0.24); y <= Math.round(MAP.HEIGHT * 0.74); y++) {
    for (let x = leftX; x <= rightX; x++) {
      if (Math.abs(x - cx) <= 2) continue;
      if (!isZborovDeadTreeCandidate(world, x, y)) continue;
      candidates.push({ x, y, score: zborovDeadTreeScore(x, y) });
    }
  }

  const selected: GridPos[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.some((spot) => Math.hypot(spot.x - candidate.x, spot.y - candidate.y) < 5.1)) continue;
    if (!trySpawnZborovDeadTree(
      world,
      candidate.x,
      candidate.y,
      ZBOROV_AMBIENT_DEAD_TREE_AMOUNT,
      4.4
    )) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= ZBOROV_AMBIENT_DEAD_TREE_COUNT) return;
  }
}

function isZborovDeadTreeCandidate(world: SimWorld, x: number, y: number): boolean {
  if (!isTileInMap(x, y)) return false;
  if (world.map.walkability[y][x] !== 0) return false;
  const tile = world.map.tiles[y * MAP.WIDTH + x];
  return tile === TileType.DIRT || tile === TileType.MUD;
}

function trySpawnZborovDeadTree(
  world: SimWorld,
  x: number,
  y: number,
  amount: number,
  resourceClearance: number
): boolean {
  if (!isZborovDeadTreeCandidate(world, x, y)) return false;
  if (findResourceAt(world, x, y, resourceClearance) !== null) return false;
  if (findBuildingAt(world, x, y, 1.8) !== null) return false;
  if (findEntityNear(world, x, y, 1.7) !== null) return false;
  spawnResource(world, ResourceKindId.WOOD, x, y, amount);
  return true;
}

function spawnZborovResource(
  world: SimWorld,
  kind: ResourceKind,
  preferredX: number,
  preferredY: number,
  amount: number
): boolean {
  const cx = Math.round(preferredX);
  const cy = Math.round(preferredY);
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!isTileInMap(x, y)) continue;
        if (world.map.walkability[y][x] !== 0) continue;
        if (findResourceAt(world, x, y, 0.6) !== null) continue;
        if (findBuildingAt(world, x, y, 0.9) !== null) continue;
        spawnResource(world, kind, x, y, amount);
        return true;
      }
    }
  }
  return false;
}

function zborovMgEmplacements(): GridPos[] {
  // Each MG nest sits two tiles NORTH of (behind) the forward wire belt — the
  // enemy side — in a wire bay, firing south through a slit in the wire at the
  // player (see layZborovWire). Well out of range of the player at spawn.
  const cx = Math.round(MAP.WIDTH * 0.5);
  const beltY = Math.round(MAP.HEIGHT * ZBOROV_FORWARD_WIRE_FRAC);
  return ZBOROV_MG_OFFSETS.map((dx) => ({ x: cx + dx, y: beltY - 2 }));
}

function layZborovWire(world: SimWorld): void {
  // Barbed-wire belts in front of each rifle line — the WW1 wall replacement.
  // Walkable but slows units to a crawl (ZBOROV_WIRE_SPEED_MULTIPLIER); left
  // open at GAP LANES so attackers can pour through, and INDENTED into wire
  // pockets around each machine-gun nest so the MGs read as dug-in emplacements.
  const cx = Math.round(MAP.WIDTH * 0.5);
  // Span the full playable corridor so the belts run wall-to-wall between the
  // impassable dirt/mud flanks — no open shoulder to walk around them.
  const leftX = cx - ZBOROV_CORRIDOR_HALF;
  const rightX = cx + ZBOROV_CORRIDOR_HALF;

  const wireAt = (x: number, y: number) => {
    if (!isTileInMap(x, y)) return;
    const idx = y * MAP.WIDTH + x;
    if (isWaterCampaignTile(world.map.tiles[idx])) return; // clip to the dry arena
    world.map.tiles[idx] = TileType.BARBED_WIRE;
    world.map.walkability[y][x] = 0; // crossed, not a wall
    world.grid[y][x] = 0;
  };
  const isGap = (x: number, gaps: number[]) => gaps.some((g) => Math.abs(x - g) <= 1);

  // Mid + rear belts: plain two-row entanglements with three sally gaps.
  const plainGaps = [cx - 9, cx, cx + 9];
  for (const frac of [ZBOROV_MID_WIRE_FRAC, ZBOROV_REAR_WIRE_FRAC]) {
    const beltY = Math.round(MAP.HEIGHT * frac);
    for (let x = leftX; x <= rightX; x++) {
      if (isGap(x, plainGaps)) continue;
      wireAt(x, beltY);
      wireAt(x, beltY + 1);
    }
  }

  // Forward belt: sally gaps + a machine-gun emplacement at each nest. The two-
  // row belt runs in FRONT of the MG (south, toward the player); at the nest it
  // opens a one-tile firing slit and throws short wire "wings" back north on
  // either side, forming a bay the MG (at beltY-2, behind the wire) fires from.
  const beltY = Math.round(MAP.HEIGHT * ZBOROV_FORWARD_WIRE_FRAC);
  const fwdGaps = [cx - 9, cx, cx + 9];
  const mgXs = zborovMgEmplacements().map((p) => p.x);
  for (let x = leftX; x <= rightX; x++) {
    if (isGap(x, fwdGaps)) continue;
    const nestX = mgXs.find((mx) => Math.abs(x - mx) <= 2);
    if (nestX === undefined) {
      wireAt(x, beltY);
      wireAt(x, beltY + 1);
    } else {
      const rel = x - nestX;
      if (rel !== 0) {
        // Belt in front of the bay (a 1-tile firing slit stays open at rel 0).
        wireAt(x, beltY);
        wireAt(x, beltY + 1);
      }
      if (Math.abs(rel) === 2) {
        // Side wings running back (north) to flank the MG nest.
        wireAt(x, beltY - 1);
        wireAt(x, beltY - 2);
      }
    }
  }
}

interface ZborovGarrison {
  line1: number[];
  line2: number[];
  line3: number[];
  nestEids: number[];
  all: number[];
}

function spawnZborovGarrison(world: SimWorld): ZborovGarrison {
  const midX = Math.round(MAP.WIDTH * 0.5);
  const south = { x: 0, y: 1 };
  const across = { x: 1, y: 0 };
  const y1 = Math.round(MAP.HEIGHT * ZBOROV_FORWARD_LINE_FRAC);
  const y2 = Math.round(MAP.HEIGHT * ZBOROV_MID_LINE_FRAC);
  const y3 = Math.round(MAP.HEIGHT * ZBOROV_REAR_LINE_FRAC);
  // Rifle lines spread across the corridor (wide spacing) so the defence covers
  // its full width — no thin centre to skirt around.
  const riflemen = (y: number) =>
    spawnFormationRow(world, UnitDefId.GUNMAN, { x: midX, y }, south, across, 0, 0, AI_PLAYER_ID, 12, 2.4);

  // Forward line = its riflemen + the machine-gun nests dug into the wire in
  // front of it; taking this trench means clearing both.
  const line1 = riflemen(y1);
  const nestEids: number[] = [];
  for (const nest of zborovMgEmplacements()) {
    const eid = spawnPresetUnitAt(world, UnitDefId.MACHINE_GUN, nest.x, nest.y, AI_PLAYER_ID);
    if (eid !== null) nestEids.push(eid);
  }
  line1.push(...nestEids);

  const line2 = riflemen(y2);

  // Rear line keeps two counter-battery mortars on the wings.
  const line3 = riflemen(y3);
  line3.push(...spawnFormationRow(world, UnitDefId.MORTAR, { x: midX, y: y3 }, south, across, 0, -9, AI_PLAYER_ID, 1, 1.6));
  line3.push(...spawnFormationRow(world, UnitDefId.MORTAR, { x: midX, y: y3 }, south, across, 0, 9, AI_PLAYER_ID, 1, 1.6));

  return { line1, line2, line3, nestEids, all: [...line1, ...line2, ...line3] };
}

function spawnZborovPlayerDefenders(world: SimWorld): number[] {
  const midX = Math.round(MAP.WIDTH * 0.5);
  const anchor = {
    x: midX,
    y: Math.round(MAP.HEIGHT * ZBOROV_PLAYER_LINE_FRAC),
  };
  const north = { x: 0, y: -1 };
  const across = { x: 1, y: 0 };
  const force: number[] = [];
  const push = (eids: number[]) => force.push(...eids);

  push(spawnFormationRow(world, UnitDefId.GUNMAN, anchor, north, across, 0, 0, LOCAL_PLAYER_ID, 10, 1.25));
  push(spawnFormationRow(world, UnitDefId.MACHINE_GUN, anchor, north, across, -2.2, 0, LOCAL_PLAYER_ID, 1, 1.0));

  return force;
}

function configureBattleOfKutnaHora(world: SimWorld): void {
  removePresetStarterMilitary(world);
  clearPlayerBuildingsForCampaign(world, LOCAL_PLAYER_ID);
  clearPlayerBuildingsForCampaign(world, AI_PLAYER_ID);

  world.population[LOCAL_PLAYER_ID] = { current: 0, cap: 0 };
  world.population[AI_PLAYER_ID] = { current: 0, cap: 0 };
  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  world.resources[LOCAL_PLAYER_ID].set([300, 300, 300, 300]);
  world.resources[AI_PLAYER_ID].set([0, 0, 0, 0]);

  const town = {
    x: Math.round(MAP.WIDTH * 0.50),
    y: Math.round(MAP.HEIGHT * 0.50),
  };
  const enemyEdge = kutnaHoraWaveSpawnAnchor(0);
  world.map.spawns[LOCAL_PLAYER_ID] = town;
  world.map.spawns[AI_PLAYER_ID] = enemyEdge;

  clearKutnaHoraGround(world, town, 15, 13);
  for (let i = 0; i < KUTNA_HORA_TOTAL_WAVES; i++) {
    clearKutnaHoraGround(world, kutnaHoraWaveSpawnAnchor(i), 6, 5);
  }

  const townCenter = spawnTownCenter(world, town.x, town.y, LOCAL_PLAYER_ID);
  buildKutnaHoraPlayerCity(world, town);
  seedKutnaHoraPerimeterWoods(world, town);
  const defenders = spawnKutnaHoraDefenders(world, town);
  setBilaHoraDefensiveStance(world, defenders);

  world.population[LOCAL_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.population[AI_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.armyRallyPoints[LOCAL_PLAYER_ID] = { x: town.x, y: town.y - 5 };
  world.armyRallyPoints[AI_PLAYER_ID] = null;
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_KUTNA_HORA,
    name: 'Battle of Kutná Hora',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids: {
      kutna_hora_attackers: [],
      kutna_hora_town_center: [townCenter],
    },
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + KUTNA_HORA_FIRST_WAVE_TICKS,
    scriptedWaveIndex: 0,
    scriptedWaveCount: KUTNA_HORA_TOTAL_WAVES,
  };
  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
}

function configureBattleOfSudomer(world: SimWorld): void {
  clearBattlefieldForTownlessMission(world);

  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  // [food, wood, gold, stone] — a modest stockpile: enough to queue a handful of
  // units immediately, but the prep window must be spent ramping the economy.
  world.resources[LOCAL_PLAYER_ID].set([400, 500, 150, 200]);
  world.resources[AI_PLAYER_ID].set([0, 0, 0, 0]);

  const town = sudomerTownCenter();
  const muster = { x: town.x + 3, y: town.y + 6 };
  const firstAttack = sudomerWaveSpawnAnchor(0);
  world.map.spawns[LOCAL_PLAYER_ID] = muster;
  world.map.spawns[AI_PLAYER_ID] = firstAttack;

  // Clear a generous dry bowl for the town + economy, and keep the two enemy
  // approach lanes (dry central choke, muddy right flank) walkable.
  clearSudomerGround(world, town, 18, 15, false, true);
  clearSudomerGround(world, { x: town.x + 14, y: town.y + 14 }, 14, 5, false);
  clearSudomerGround(world, { x: town.x + 27, y: town.y + 9 }, 6, 8, true);
  for (let i = 0; i < SUDOMER_TOTAL_WAVES; i++) {
    clearSudomerGround(world, sudomerWaveSpawnAnchor(i), 8, 6, i % 2 === 1);
  }

  const townCenter = buildSudomerPlayerTown(world, town);
  spawnSudomerStartingSquad(world, muster);
  spawnSudomerVillagers(world, town, 12);

  world.population[LOCAL_PLAYER_ID].cap = SUDOMER_POP_CAP;
  world.population[AI_PLAYER_ID].cap = SUDOMER_POP_CAP;
  world.armyRallyPoints[LOCAL_PLAYER_ID] = { x: town.x + 12, y: town.y + 12 };
  world.armyRallyPoints[AI_PLAYER_ID] = null;
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_SUDOMER,
    name: 'Battle of Sudoměř',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids: {
      sudomer_attackers: [],
      sudomer_town_center: townCenter !== null ? [townCenter] : [],
    },
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + SUDOMER_FIRST_WAVE_TICKS,
    scriptedWaveIndex: 0,
    scriptedWaveCount: SUDOMER_TOTAL_WAVES,
  };
  pushAiEvent(
    world,
    AI_PLAYER_ID,
    'A royalist crusader host masses across the field — first assault in 5 minutes. Marshal Sudoměř.'
  );
  revealMapForPlayer(world, LOCAL_PLAYER_ID);
}

function clearSudomerGround(
  world: SimWorld,
  center: GridPos,
  radiusX: number,
  radiusY: number,
  keepMud: boolean,
  preserveDirt = false
): void {
  const minX = Math.max(1, Math.round(center.x - radiusX));
  const maxX = Math.min(MAP.WIDTH - 2, Math.round(center.x + radiusX));
  const minY = Math.max(1, Math.round(center.y - radiusY));
  const maxY = Math.min(MAP.HEIGHT - 2, Math.round(center.y + radiusY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * MAP.WIDTH + x;
      if (keepMud && world.map.tiles[idx] === TileType.MUD) {
        world.map.elevation[idx] = Math.min(world.map.elevation[idx], 2);
      } else if (preserveDirt && world.map.tiles[idx] === TileType.DIRT) {
        world.map.elevation[idx] = 3;
      } else if (!isWaterCampaignTile(world.map.tiles[idx])) {
        world.map.tiles[idx] = Math.abs(x - center.x) <= 1 ? TileType.DIRT : TileType.GRASS;
        world.map.elevation[idx] = 3;
      }
      if (!isWaterCampaignTile(world.map.tiles[idx])) {
        world.map.walkability[y][x] = 0;
        world.grid[y][x] = 0;
      }
    }
  }

  for (const eid of [...resourceQuery(world.ecs)]) {
    if (
      Position.x[eid] >= minX - 1 &&
      Position.x[eid] <= maxX + 1 &&
      Position.y[eid] >= minY - 1 &&
      Position.y[eid] <= maxY + 1
    ) {
      removeEntity(world.ecs, eid);
    }
  }
}

function isWaterCampaignTile(tile: number): boolean {
  return tile === TileType.WATER || tile === TileType.WATER_SHALLOW;
}

function sudomerTownCenter(): GridPos {
  return {
    x: Math.round(MAP.WIDTH * 0.14),
    y: Math.round(MAP.HEIGHT * 0.14),
  };
}

function buildSudomerPlayerTown(world: SimWorld, town: GridPos): number | null {
  const townCenter = spawnTownCenter(world, town.x, town.y, LOCAL_PLAYER_ID);

  const place = (defId: number, dx: number, dy: number) =>
    placePresetBuilding(world, defId, town.x + dx, town.y + dy, LOCAL_PLAYER_ID);

  const houseOffsets: GridPos[] = [
    { x: -7, y: -5 }, { x: -4, y: -6 }, { x: -1, y: -6 },
    { x: -8, y: 0 }, { x: -8, y: 4 }, { x: -6, y: 7 },
    { x: 2, y: -6 }, { x: 5, y: -5 },
  ];
  for (const offset of houseOffsets) {
    place(BuildingDefId.HOUSE, offset.x, offset.y);
  }

  // Military production: pikemen from the barracks, hand-gunners from the foundry.
  place(BuildingDefId.BARRACKS, -5, 3);
  place(BuildingDefId.FOUNDRY, 5, 3);

  // Economy. Each worksite seeds its own resource nodes and auto-starts one
  // worker; the player must assign the idle villagers to ramp income — gold
  // especially, since gunmen cost 75 gold apiece.
  placeKutnaHoraWorksite(world, BuildingDefId.LUMBER_CAMP, town.x - 9, town.y - 3, ResourceKindId.WOOD);
  placeKutnaHoraWorksite(world, BuildingDefId.STONE_QUARRY, town.x + 9, town.y - 4, ResourceKindId.STONE);
  placeKutnaHoraWorksite(world, BuildingDefId.GOLD_MINE, town.x + 10, town.y + 2, ResourceKindId.GOLD);

  place(BuildingDefId.FARM, -6, 8);
  place(BuildingDefId.FARM, -3, 9);
  place(BuildingDefId.FARM, 0, 9);
  place(BuildingDefId.MILL, 3, 8);

  return townCenter;
}

function spawnSudomerStartingSquad(world: SimWorld, muster: GridPos): number[] {
  const squad: number[] = [];
  const block = (defId: number, originX: number, originY: number, cols: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const preferredX = originX + (i % cols);
      const preferredY = originY + Math.floor(i / cols);
      const spot = findPresetUnitSpot(world, preferredX, preferredY, 4, LOCAL_PLAYER_ID, 6);
      if (!spot) continue;
      const eid = spawnPresetUnitAt(world, defId, spot.x, spot.y, LOCAL_PLAYER_ID);
      if (eid === null) continue;
      setUnitHoldAnchor(world, eid, spot.x, spot.y);
      squad.push(eid);
    }
  };
  // A tidy square mustered in the base: 12 pikemen in front, 6 gunmen ranked up
  // behind. Default stance — the player repositions them before the assault.
  block(UnitDefId.SPEARMAN, muster.x - 2, muster.y, 4, 12);
  block(UnitDefId.GUNMAN, muster.x - 2, muster.y + 4, 3, 6);
  return squad;
}

function spawnSudomerVillagers(world: SimWorld, town: GridPos, count: number): void {
  for (let i = 0; i < count; i++) {
    const preferredX = town.x - 3 + (i % 4);
    const preferredY = town.y + 3 + Math.floor(i / 4);
    const spot = findPresetUnitSpot(world, preferredX, preferredY, 5, LOCAL_PLAYER_ID, 6);
    if (!spot) continue;
    spawnVillager(world, spot.x, spot.y, LOCAL_PLAYER_ID);
  }
}

function sudomerAttackTarget(route: SudomerWaveRoute): GridPos {
  const town = sudomerTownCenter();
  if (route === 'mud') {
    return { x: town.x + 27, y: town.y + 9 };
  }
  return { x: town.x + 12, y: town.y + 12 };
}

function clearPlayerBuildingsForCampaign(world: SimWorld, playerId: number): void {
  for (const eid of [...buildingQuery(world.ecs)]) {
    if (Owner.player[eid] !== playerId) continue;
    const def = getBuildingDef(Building.defId[eid]);
    if (def) {
      markFootprintBlocked(
        world,
        Position.x[eid],
        Position.y[eid],
        def.footprint.w,
        def.footprint.h,
        false
      );
    }
    world.productionQueues.delete(eid);
    removeEntity(world.ecs, eid);
  }
  recalculatePlayerPopCap(world, playerId);
}

function clearKutnaHoraGround(
  world: SimWorld,
  center: GridPos,
  radiusX: number,
  radiusY: number
): void {
  const minX = Math.max(1, Math.round(center.x - radiusX));
  const maxX = Math.min(MAP.WIDTH - 2, Math.round(center.x + radiusX));
  const minY = Math.max(1, Math.round(center.y - radiusY));
  const maxY = Math.min(MAP.HEIGHT - 2, Math.round(center.y + radiusY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * MAP.WIDTH + x;
      if (world.map.tiles[idx] !== TileType.DIRT) world.map.tiles[idx] = TileType.GRASS;
      world.map.elevation[idx] = 3;
      world.map.walkability[y][x] = 0;
      world.grid[y][x] = 0;
    }
  }

  for (const eid of [...resourceQuery(world.ecs)]) {
    if (
      Position.x[eid] >= minX - 1 &&
      Position.x[eid] <= maxX + 1 &&
      Position.y[eid] >= minY - 1 &&
      Position.y[eid] <= maxY + 1
    ) {
      removeEntity(world.ecs, eid);
    }
  }
}

function buildKutnaHoraPlayerCity(
  world: SimWorld,
  town: GridPos
): void {
  const place = (defId: number, x: number, y: number) =>
    placePresetBuilding(world, defId, town.x + x, town.y + y, LOCAL_PLAYER_ID);

  buildKutnaHoraWallRing(world, town, 13, 11, 1);
  buildKutnaHoraWallRing(world, town, 10, 8, 1);
  buildKutnaHoraTowerBelt(world, town);

  const houseOffsets: GridPos[] = [
    { x: -8, y: -6 }, { x: -6, y: -7 }, { x: -4, y: -7 }, { x: 4, y: -7 }, { x: 6, y: -7 }, { x: 8, y: -6 },
    { x: -8, y: 6 }, { x: -6, y: 7 }, { x: -4, y: 7 }, { x: 4, y: 7 }, { x: 6, y: 7 }, { x: 8, y: 6 },
  ];
  for (const offset of houseOffsets) {
    place(BuildingDefId.HOUSE, offset.x, offset.y);
  }

  place(BuildingDefId.BARRACKS, -5, -4);
  place(BuildingDefId.BARRACKS, 5, -4);
  place(BuildingDefId.BARRACKS, 0, -6);
  place(BuildingDefId.STABLE, -5, 4);
  place(BuildingDefId.STABLE, 5, 6);
  place(BuildingDefId.FOUNDRY, 5, 4);
  place(BuildingDefId.FOUNDRY, 0, 5);
  place(BuildingDefId.FARM, -8, 10);
  place(BuildingDefId.FARM, -4, 10);
  place(BuildingDefId.FARM, 4, 10);
  place(BuildingDefId.FARM, 8, 10);
  place(BuildingDefId.MILL, 0, 10);

  const lumberCamp = placeKutnaHoraWorksite(world, BuildingDefId.LUMBER_CAMP, town.x - 11, town.y - 9, ResourceKindId.WOOD);
  const goldMine = placeKutnaHoraWorksite(world, BuildingDefId.GOLD_MINE, town.x - 11, town.y + 2, ResourceKindId.GOLD);
  const stoneQuarry = placeKutnaHoraWorksite(world, BuildingDefId.STONE_QUARRY, town.x + 11, town.y + 2, ResourceKindId.STONE);
  if (lumberCamp !== null) seedKutnaHoraHarvestPatch(world, lumberCamp, ResourceKindId.WOOD);
  if (goldMine !== null) seedKutnaHoraHarvestPatch(world, goldMine, ResourceKindId.GOLD);
  if (stoneQuarry !== null) seedKutnaHoraHarvestPatch(world, stoneQuarry, ResourceKindId.STONE);
}

function buildKutnaHoraWallRing(
  world: SimWorld,
  center: GridPos,
  halfW: number,
  halfH: number,
  gateHalfWidth: number
): void {
  const left = center.x - halfW;
  const right = center.x + halfW;
  const top = center.y - halfH;
  const bottom = center.y + halfH;

  for (let x = left; x <= right; x++) {
    if (Math.abs(x - center.x) > gateHalfWidth) {
      placePresetBuildingExact(world, BuildingDefId.WALL, x, top, LOCAL_PLAYER_ID);
      placePresetBuildingExact(world, BuildingDefId.WALL, x, bottom, LOCAL_PLAYER_ID);
    }
  }
  for (let y = top + 1; y < bottom; y++) {
    if (Math.abs(y - center.y) > gateHalfWidth) {
      placePresetBuildingExact(world, BuildingDefId.WALL, left, y, LOCAL_PLAYER_ID);
      placePresetBuildingExact(world, BuildingDefId.WALL, right, y, LOCAL_PLAYER_ID);
    }
  }
}

function buildKutnaHoraTowerBelt(world: SimWorld, center: GridPos): void {
  const offsets: GridPos[] = [
    { x: -12, y: -9 }, { x: -7, y: -10 }, { x: 7, y: -10 }, { x: 12, y: -9 },
    { x: -12, y: -4 }, { x: -12, y: 4 }, { x: 12, y: -4 }, { x: 12, y: 4 },
    { x: -12, y: 9 }, { x: -7, y: 10 }, { x: 7, y: 10 }, { x: 12, y: 9 },
  ];
  for (const offset of offsets) {
    placePresetBuildingExact(
      world,
      BuildingDefId.DEFENSIVE_TOWER,
      center.x + offset.x,
      center.y + offset.y,
      LOCAL_PLAYER_ID
    );
  }
}

function seedKutnaHoraPerimeterWoods(world: SimWorld, center: GridPos): void {
  const clusters: GridPos[] = [
    { x: -18, y: -13 }, { x: -13, y: -16 }, { x: 13, y: -16 }, { x: 18, y: -13 },
    { x: -19, y: -7 }, { x: 19, y: -7 }, { x: -19, y: 7 }, { x: 19, y: 7 },
    { x: -18, y: 13 }, { x: -13, y: 16 }, { x: 13, y: 16 }, { x: 18, y: 13 },
  ];
  for (const offset of clusters) {
    spawnBilaHoraTreeCluster(world, center.x + offset.x, center.y + offset.y);
  }
}

function placeKutnaHoraWorksite(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  kind: ResourceKind
): number | null {
  seedKutnaHoraHarvestPatchAt(world, Math.round(x), Math.round(y), kind);
  return placePresetBuilding(world, defId, x, y, LOCAL_PLAYER_ID);
}

function seedKutnaHoraHarvestPatch(world: SimWorld, siteEid: number, kind: ResourceKind): void {
  seedKutnaHoraHarvestPatchAt(
    world,
    Math.round(Position.x[siteEid]),
    Math.round(Position.y[siteEid]),
    kind
  );
}

function seedKutnaHoraHarvestPatchAt(
  world: SimWorld,
  baseX: number,
  baseY: number,
  kind: ResourceKind
): void {
  const offsets = [
    [3, 0], [4, 1], [4, -1], [5, 0], [3, 2], [3, -2],
    [-3, 0], [-4, 1], [-4, -1], [-5, 0],
  ];
  for (const [dx, dy] of offsets) {
    const x = baseX + dx;
    const y = baseY + dy;
    if (kind === ResourceKindId.WOOD) {
      trySpawnBilaHoraTree(world, x, y);
    } else {
      trySpawnKutnaHoraResource(world, kind, x, y);
    }
  }
}

function trySpawnKutnaHoraResource(
  world: SimWorld,
  kind: ResourceKind,
  x: number,
  y: number
): void {
  if (x < 1 || y < 1 || x >= MAP.WIDTH - 1 || y >= MAP.HEIGHT - 1) return;
  if (world.map.walkability[y][x] !== 0) return;
  if (findResourceAt(world, x, y, 0.7) !== null) return;
  if (findBuildingAt(world, x, y, 2.2) !== null) return;
  if (findEntityNear(world, x, y, 0.75) !== null) return;
  const amount = kind === ResourceKindId.GOLD ? LOCAL_GOLD_DEPOSIT_AMOUNT : LOCAL_STONE_DEPOSIT_AMOUNT;
  spawnResource(world, kind, x, y, amount);
}

function spawnKutnaHoraDefenders(
  world: SimWorld,
  town: GridPos
): number[] {
  return [
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x, y: town.y - 5 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x + 5, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x, y: town.y + 5 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x - 5, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x, y: town.y - 3 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x + 3, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x, y: town.y + 3 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x - 3, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.ARCHER, { x: town.x, y: town.y + 6 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.12),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.CANNON, { x: town.x, y: town.y - 2 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 1, 3.0),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SCOUT_CAVALRY, { x: town.x - 8, y: town.y + 3 }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.18),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SCOUT_CAVALRY, { x: town.x + 8, y: town.y + 3 }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.18),
  ];
}

function spawnKutnaHoraLooseRow(
  world: SimWorld,
  defId: number,
  anchor: GridPos,
  across: GridPos,
  playerId: number,
  count: number,
  spacing: number
): number[] {
  const spawned: number[] = [];
  const start = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const x = Math.round(anchor.x + across.x * (start + i * spacing));
    const y = Math.round(anchor.y + across.y * (start + i * spacing));
    const spot = findKutnaHoraLooseUnitSpot(world, x, y);
    if (!spot) continue;
    const eid = spawnPresetUnitAt(world, defId, spot.x, spot.y, playerId);
    if (eid === null) continue;
    setUnitHoldAnchor(world, eid, spot.x, spot.y);
    spawned.push(eid);
  }
  return spawned;
}

function findKutnaHoraLooseUnitSpot(
  world: SimWorld,
  preferredX: number,
  preferredY: number
): GridPos | null {
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = preferredX + dx;
        const y = preferredY + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (world.map.walkability[y][x] !== 0) continue;
        if (findBuildingAt(world, x, y, 0.05) !== null) continue;
        if (findEntityNear(world, x, y, 0.35) !== null) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function clearBattlefieldForTownlessMission(world: SimWorld): void {
  for (const eid of [...unitQuery(world.ecs)]) {
    const playerId = Owner.player[eid];
    if (world.population[playerId]) {
      world.population[playerId].current = Math.max(
        0,
        world.population[playerId].current - PopulationCost.value[eid]
      );
    }
    world.paths.delete(eid);
    world.movementStuck.delete(eid);
    clearFormationSpeedCap(world, eid);
    removeEntity(world.ecs, eid);
  }

  for (const eid of [...buildingQuery(world.ecs)]) {
    const def = getBuildingDef(Building.defId[eid]);
    if (def) {
      markFootprintBlocked(
        world,
        Position.x[eid],
        Position.y[eid],
        def.footprint.w,
        def.footprint.h,
        false
      );
    }
    removeEntity(world.ecs, eid);
  }

  world.productionQueues.clear();
  world.armyRallyPoints[LOCAL_PLAYER_ID] = null;
  world.armyRallyPoints[AI_PLAYER_ID] = null;
  world.population[LOCAL_PLAYER_ID] = { current: 0, cap: 0 };
  world.population[AI_PLAYER_ID] = { current: 0, cap: 0 };
}

function normalizeVector(x: number, y: number): GridPos {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function clearBilaHoraDeploymentZone(
  world: SimWorld,
  center: GridPos,
  forward: GridPos,
  across: GridPos,
  halfAcross: number,
  halfDepth: number
): void {
  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      const relX = x - center.x;
      const relY = y - center.y;
      const lateral = relX * across.x + relY * across.y;
      const depth = relX * forward.x + relY * forward.y;
      if (Math.abs(lateral) > halfAcross || Math.abs(depth) > halfDepth) continue;
      const idx = y * MAP.WIDTH + x;
      if (world.map.tiles[idx] !== TileType.DIRT) {
        world.map.tiles[idx] = TileType.GRASS;
      }
      world.map.elevation[idx] = 3;
      world.map.walkability[y][x] = 0;
      world.grid[y][x] = 0;
    }
  }

  for (const eid of [...resourceQuery(world.ecs)]) {
    const relX = Position.x[eid] - center.x;
    const relY = Position.y[eid] - center.y;
    const lateral = relX * across.x + relY * across.y;
    const depth = relX * forward.x + relY * forward.y;
    if (Math.abs(lateral) <= halfAcross + 1 && Math.abs(depth) <= halfDepth + 1) {
      removeEntity(world.ecs, eid);
    }
  }
}

function seedBilaHoraPassTrees(
  world: SimWorld,
  bohemian: GridPos,
  imperial: GridPos,
  forward: GridPos,
  across: GridPos
): void {
  const mid = {
    x: (bohemian.x + imperial.x) / 2,
    y: (bohemian.y + imperial.y) / 2,
  };
  const clusters = [
    offsetBattlePoint(mid, forward, across, -2, -23),
    offsetBattlePoint(mid, forward, across, 2, 23),
    offsetBattlePoint(bohemian, forward, across, -7, -15),
    offsetBattlePoint(bohemian, forward, across, -6, 15),
    offsetBattlePoint(imperial, forward, across, 7, -16),
    offsetBattlePoint(imperial, forward, across, 7, 16),
  ];
  for (const cluster of clusters) {
    spawnBilaHoraTreeCluster(world, cluster.x, cluster.y);
  }
}

function offsetBattlePoint(
  origin: GridPos,
  forward: GridPos,
  across: GridPos,
  forwardOffset: number,
  lateralOffset: number
): GridPos {
  return {
    x: Math.round(origin.x + forward.x * forwardOffset + across.x * lateralOffset),
    y: Math.round(origin.y + forward.y * forwardOffset + across.y * lateralOffset),
  };
}

function clampBattlePoint(point: GridPos): GridPos {
  return {
    x: Math.max(2, Math.min(MAP.WIDTH - 3, Math.round(point.x))),
    y: Math.max(2, Math.min(MAP.HEIGHT - 3, Math.round(point.y))),
  };
}

function spawnBilaHoraTreeCluster(world: SimWorld, cx: number, cy: number): void {
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [2, 1],
    [-2, -1],
  ];
  for (const [dx, dy] of offsets) {
    trySpawnBilaHoraTree(world, cx + dx, cy + dy);
  }
}

function trySpawnBilaHoraTree(world: SimWorld, x: number, y: number): void {
  if (x < 1 || y < 1 || x >= MAP.WIDTH - 1 || y >= MAP.HEIGHT - 1) return;
  if (world.map.walkability[y][x] !== 0) return;
  const idx = y * MAP.WIDTH + x;
  const tile = world.map.tiles[idx];
  if (tile !== TileType.GRASS && tile !== TileType.FOREST) return;
  if (findResourceAt(world, x, y, 0.7) !== null) return;
  if (findEntityNear(world, x, y, 1.3) !== null) return;
  if (findBuildingAt(world, x, y, 2) !== null) return;
  world.map.tiles[idx] = TileType.FOREST;
  spawnResource(world, ResourceKindId.WOOD, x, y, TREE_RESOURCE_AMOUNT);
}

function spawnBilaHoraBohemianLine(
  world: SimWorld,
  anchor: GridPos,
  forward: GridPos,
  across: GridPos
): number[] {
  // Bohemian Estates: defensive infantry and firearms hold the White Mountain
  // rise, with guns behind the line and a smaller cavalry reserve on the wings.
  return [
    ...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, forward, across, 2.6, 0, LOCAL_PLAYER_ID, 16, 1.15),
    ...spawnFormationRow(world, UnitDefId.GUNMAN, anchor, forward, across, 0.2, 0, LOCAL_PLAYER_ID, 24, 1.05),
    ...spawnFormationRow(world, UnitDefId.CANNON, anchor, forward, across, -4.5, 0, LOCAL_PLAYER_ID, 2, 3.0),
    ...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -5.8, -9.5, LOCAL_PLAYER_ID, 4, 1.18),
    ...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -5.8, 9.5, LOCAL_PLAYER_ID, 4, 1.18),
  ];
}

function spawnBilaHoraImperialArmy(
  world: SimWorld,
  anchor: GridPos,
  forward: GridPos,
  across: GridPos
): Record<string, number[]> {
  const before = new Set(unitQuery(world.ecs));
  // Imperial and Catholic League troops: the pressure is cavalry-heavy, while
  // gunmen and field pieces give the attack its Gunpowder Age character.
  spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -4.0, -5.5, AI_PLAYER_ID, 12, 1.02);
  spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -4.0, 5.5, AI_PLAYER_ID, 12, 1.02);
  spawnFormationRow(world, UnitDefId.GUNMAN, anchor, forward, across, -1.4, -3.2, AI_PLAYER_ID, 13, 0.95);
  spawnFormationRow(world, UnitDefId.GUNMAN, anchor, forward, across, 0.5, 3.2, AI_PLAYER_ID, 13, 0.95);
  spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, forward, across, 2.6, 0, AI_PLAYER_ID, 8, 1.05);
  spawnFormationRow(world, UnitDefId.CANNON, anchor, forward, across, 5.6, 0, AI_PLAYER_ID, 2, 2.6);

  return {
    destroy_imperial_field_army: unitQuery(world.ecs)
      .filter((eid) => !before.has(eid) && Owner.player[eid] === AI_PLAYER_ID),
  };
}

function setBilaHoraDefensiveStance(world: SimWorld, eids: number[]): void {
  for (const eid of eids) {
    if (!hasComponent(world.ecs, UnitStance, eid)) continue;
    UnitStance.stance[eid] = UnitStanceId.HOLD_POSITION;
    setUnitHoldAnchor(world, eid);
  }
}

function issueBilaHoraEnemyAdvance(world: SimWorld, eids: number[], target: GridPos): void {
  const ordered: number[] = [];
  for (const { eid, dest } of formationDestinations(world, eids, target, FORMATION_MODE_LINE)) {
    if (!hasComponent(world.ecs, Combat, eid)) continue;
    if (!hasComponent(world.ecs, AttackTarget, eid)) continue;
    if (!pathTo(world, eid, dest.x, dest.y)) continue;
    AttackTarget.targetEid[eid] = -1;
    AttackTarget.retainGoal[eid] = 0;
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
      AttackMoveGoal.active[eid] = 1;
      AttackMoveGoal.x[eid] = dest.x;
      AttackMoveGoal.y[eid] = dest.y;
    }
    setUnitHoldAnchor(world, eid, dest.x, dest.y);
    ordered.push(eid);
  }
  applyFormationSpeedCap(world, ordered);
}

function spawnFormationRow(
  world: SimWorld,
  defId: number,
  anchor: GridPos,
  forward: GridPos,
  across: GridPos,
  forwardOffset: number,
  lateralOffset: number,
  playerId: number,
  count: number,
  spacing: number
): number[] {
  const spawned: number[] = [];
  const start = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const lateral = lateralOffset + start + i * spacing;
    const preferredX = anchor.x + forward.x * forwardOffset + across.x * lateral;
    const preferredY = anchor.y + forward.y * forwardOffset + across.y * lateral;
    const spot = findPresetUnitSpot(world, preferredX, preferredY, 3, playerId, 4);
    if (!spot) continue;
    const eid = spawnPresetUnitAt(world, defId, spot.x, spot.y, playerId);
    if (eid === null) continue;
    setUnitHoldAnchor(world, eid, spot.x, spot.y);
    spawned.push(eid);
  }
  return spawned;
}

function configureSiegeOfBrno(
  world: SimWorld,
  _objectives: CampaignObjectiveDef[]
): void {
  removePresetStarterMilitary(world);

  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.DARK);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.CASTLE);
  world.researchedTechs[LOCAL_PLAYER_ID] = createStartingTechSetForAge(AgeId.DARK);
  world.researchedTechs[AI_PLAYER_ID] = createStartingTechSetForAge(AgeId.CASTLE);
  world.researchedTechs[AI_PLAYER_ID].add(TechId.GOLD_MINES);
  world.researchedTechs[AI_PLAYER_ID].add(TechId.KNIGHTS);
  world.researchedTechs[AI_PLAYER_ID].add(TechId.FARMS);
  world.researchedTechs[AI_PLAYER_ID].add(TechId.FARMS_II);
  world.researchedTechs[AI_PLAYER_ID].add(TechId.MILLS);
  applyStartingResources(world.resources[LOCAL_PLAYER_ID], AgeId.DARK);
  world.resources[AI_PLAYER_ID].set([1600, 5200, 2400, 3200]);
  world.population[AI_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;

  const playerSpawn = world.map.spawns[LOCAL_PLAYER_ID];
  const scoutSpot = findPresetUnitSpot(
    world,
    playerSpawn.x + 3,
    playerSpawn.y + 2,
    8,
    LOCAL_PLAYER_ID
  );
  if (scoutSpot) {
    spawnScoutCavalry(world, scoutSpot.x, scoutSpot.y, LOCAL_PLAYER_ID);
  }

  const trackedObjectiveEids = buildBrnoEnemyCity(world);
  spawnBrnoDefenders(world, trackedObjectiveEids);
  world.campaign = {
    missionId: CampaignMissionId.SIEGE_OF_BRNO,
    name: 'Siege of Brno',
    description: '',
    briefing: '',
    lockedTechs: [TechId.GUNPOWDER_AGE],
    objectives: [],
    trackedObjectiveEids,
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + SIM.TICK_HZ * 70,
  };
  world.aiPlayers[AI_PLAYER_ID] = {
    ...createAiPlayerState(world.tick),
    plan: 'massing',
    nextAttackTick: Number.MAX_SAFE_INTEGER,
  };
}

function buildBrnoEnemyCity(world: SimWorld): Record<string, number[]> {
  const spawn = world.map.spawns[AI_PLAYER_ID];
  if (!spawn) return {};
  const trackedObjectiveEids: Record<string, number[]> = {};

  const primaryTc = findOwnedTownCenter(world, AI_PLAYER_ID);
  if (primaryTc !== null) trackedObjectiveEids.destroy_brno_tc = [primaryTc];

  const cityBuildings: Array<[number, number, number]> = [
    [BuildingDefId.HOUSE, -4, -4],
    [BuildingDefId.HOUSE, -2, -5],
    [BuildingDefId.HOUSE, 0, -5],
    [BuildingDefId.HOUSE, 2, -5],
    [BuildingDefId.HOUSE, 4, -4],
    [BuildingDefId.HOUSE, -5, -2],
    [BuildingDefId.HOUSE, 5, -2],
    [BuildingDefId.BARRACKS, -6, 2],
    [BuildingDefId.BARRACKS, -2, 5],
    [BuildingDefId.BARRACKS, 3, 5],
    [BuildingDefId.BARRACKS, 7, 2],
    [BuildingDefId.STABLE, 7, -3],
    [BuildingDefId.LUMBER_CAMP, -8, -6],
    [BuildingDefId.GOLD_MINE, -9, 0],
    [BuildingDefId.STONE_QUARRY, -6, 7],
    [BuildingDefId.FARM, 5, 7],
    [BuildingDefId.MILL, 8, 6],
  ];
  for (const [defId, dx, dy] of cityBuildings) {
    placePresetBuilding(world, defId, spawn.x + dx, spawn.y + dy, AI_PLAYER_ID);
  }
  buildBrnoCityWalls(world, spawn.x, spawn.y);

  const lumberCamp = placePresetBuilding(
    world,
    BuildingDefId.LUMBER_CAMP,
    Math.round(spawn.x - 24),
    Math.round(spawn.y - 14),
    AI_PLAYER_ID
  );
  if (lumberCamp !== null) trackedObjectiveEids.destroy_outer_lumber = [lumberCamp];

  const miningCamp = placePresetBuilding(
    world,
    BuildingDefId.GOLD_MINE,
    Math.round(spawn.x - 24),
    Math.round(spawn.y + 24),
    AI_PLAYER_ID
  );
  if (miningCamp !== null) trackedObjectiveEids.destroy_outer_mine = [miningCamp];

  return trackedObjectiveEids;
}

function buildBrnoCityWalls(world: SimWorld, centerX: number, centerY: number): number[] {
  const wallEids: number[] = [];
  const minX = Math.max(1, Math.round(centerX - 13));
  const maxX = Math.min(MAP.WIDTH - 2, Math.round(centerX + 10));
  const minY = Math.max(1, Math.round(centerY - 11));
  const maxY = Math.min(MAP.HEIGHT - 2, Math.round(centerY + 11));
  const midX = Math.round((minX + maxX) / 2);
  const midY = Math.round((minY + maxY) / 2);
  const towerNodes: GridPos[] = [
    { x: minX, y: minY },
    { x: midX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: midY },
    { x: maxX, y: maxY },
    { x: midX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: midY },
  ];
  const towerKeys = new Set(towerNodes.map((node) => `${node.x},${node.y}`));

  for (const node of towerNodes) {
    placePresetBuildingExact(world, BuildingDefId.DEFENSIVE_TOWER, node.x, node.y, AI_PLAYER_ID);
  }
  for (let i = 0; i < towerNodes.length; i++) {
    connectBrnoWallRun(world, towerNodes[i], towerNodes[(i + 1) % towerNodes.length], towerKeys, wallEids);
  }
  return wallEids;
}

function connectBrnoWallRun(
  world: SimWorld,
  from: GridPos,
  to: GridPos,
  towerKeys: Set<string>,
  wallEids: number[]
): void {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (!towerKeys.has(`${x},${y}`)) {
      const wall = placePresetBuildingExact(world, BuildingDefId.WALL, x, y, AI_PLAYER_ID);
      if (wall !== null) wallEids.push(wall);
    }
    x += dx;
    y += dy;
  }
}

function spawnBrnoDefenders(world: SimWorld, trackedObjectiveEids: Record<string, number[]>): void {
  const spawn = world.map.spawns[AI_PLAYER_ID];
  if (!spawn) return;
  spawnPresetUnits(world, UnitDefId.SPEARMAN, spawn.x - 4, spawn.y + 2, AI_PLAYER_ID, 12);
  spawnPresetUnits(world, UnitDefId.ARCHER, spawn.x + 1, spawn.y + 4, AI_PLAYER_ID, 12);
  spawnPresetUnits(world, UnitDefId.SCOUT_CAVALRY, spawn.x + 5, spawn.y - 2, AI_PLAYER_ID, 7);

  const outerLumber = trackedObjectiveEids.destroy_outer_lumber?.[0];
  if (outerLumber !== undefined) {
    spawnPresetUnits(world, UnitDefId.SPEARMAN, Position.x[outerLumber] - 2, Position.y[outerLumber] + 1, AI_PLAYER_ID, 4);
    spawnPresetUnits(world, UnitDefId.ARCHER, Position.x[outerLumber] + 1, Position.y[outerLumber] + 2, AI_PLAYER_ID, 3);
  }
  const outerMine = trackedObjectiveEids.destroy_outer_mine?.[0];
  if (outerMine !== undefined) {
    spawnPresetUnits(world, UnitDefId.SPEARMAN, Position.x[outerMine] - 2, Position.y[outerMine] + 1, AI_PLAYER_ID, 4);
    spawnPresetUnits(world, UnitDefId.ARCHER, Position.x[outerMine] + 1, Position.y[outerMine] + 2, AI_PLAYER_ID, 3);
    spawnPresetUnits(world, UnitDefId.SCOUT_CAVALRY, Position.x[outerMine] + 2, Position.y[outerMine] - 1, AI_PLAYER_ID, 2);
  }
}

function findOwnedTownCenter(world: SimWorld, playerId: number): number | null {
  for (const eid of townCenterQuery(world.ecs)) {
    if (Owner.player[eid] === playerId && Health.hp[eid] > 0) return eid;
  }
  return null;
}

export function createLateGameTestWorld(): SimWorld {
  const world = createSimWorld(4242);
  world.paused = false;
  world.tick = SIM.TICK_HZ * 60 * 28;
  world.outcome = { state: 'playing' };

  world.ages[1] = { current: AgeId.GUNPOWDER, progress: -1, totalTicks: 0 };
  world.ages[2] = { current: AgeId.GUNPOWDER, progress: -1, totalTicks: 0 };
  world.researchedTechs[1] = createAllTechSet();
  world.researchedTechs[2] = createAllTechSet();
  world.resources[1].set([2200, 2200, 1800, 1300]);
  world.resources[2].set([1600, 1800, 1300, 900]);

  removePresetStarterMilitary(world);
  buildLateGameBase(world, 1);
  buildLateGameBase(world, 2);
  spawnLateGameArmy(world, 1);
  spawnLateGameArmy(world, 2);
  world.aiPlayers[AI_PLAYER_ID] = {
    ...createAiPlayerState(world.tick),
    plan: 'massing',
    nextAttackTick: world.tick + SIM.TICK_HZ * 45,
  };
  updatePlayerVisibility(world, LOCAL_PLAYER_ID);

  return world;
}

function removePresetStarterMilitary(world: SimWorld): void {
  for (const eid of [...unitQuery(world.ecs)]) {
    if (hasComponent(world.ecs, VillagerTag, eid)) continue;
    const playerId = Owner.player[eid];
    if (world.population[playerId]) {
      world.population[playerId].current = Math.max(
        0,
        world.population[playerId].current - PopulationCost.value[eid]
      );
    }
    world.paths.delete(eid);
    removeEntity(world.ecs, eid);
  }
}

function buildLateGameBase(world: SimWorld, playerId: number): void {
  const spawn = world.map.spawns[playerId];
  if (!spawn) return;
  const side = playerId === 1 ? 1 : -1;
  const worksiteIds = [
    placePresetBuilding(world, BuildingDefId.LUMBER_CAMP, spawn.x + side * 6, spawn.y - side * 2, playerId),
    placePresetBuilding(world, BuildingDefId.FARM, spawn.x + side * 3, spawn.y + side * 4, playerId),
    placePresetBuilding(world, BuildingDefId.GOLD_MINE, spawn.x - side * 5, spawn.y - side * 2, playerId),
    placePresetBuilding(world, BuildingDefId.STONE_QUARRY, spawn.x - side * 6, spawn.y + side * 3, playerId),
  ];
  placePresetBuilding(world, BuildingDefId.MILL, spawn.x + side * 6, spawn.y + side * 5, playerId);

  for (const siteEid of worksiteIds) {
    if (siteEid === null || !hasComponent(world.ecs, ResourceWorksite, siteEid)) continue;
    const slots = getWorksiteWorkerSlots(world, siteEid);
    while (countWorksiteWorkers(world, siteEid) < slots) {
      if (spawnWorksiteWorker(world, siteEid) === null) break;
    }
    ResourceWorksite.assignedWorkers[siteEid] = countWorksiteWorkers(world, siteEid);
    ResourceWorksite.freeWorkersSpawned[siteEid] = 1;
  }

  const houseOffsets = [
    [3, 6], [4, 7], [5, 8], [6, 9], [7, 10], [8, 11],
  ];
  for (const [dx, dy] of houseOffsets) {
    placePresetBuilding(world, BuildingDefId.HOUSE, spawn.x + side * dx, spawn.y + side * dy, playerId);
  }

  placePresetBuilding(world, BuildingDefId.BARRACKS, spawn.x + side * 7, spawn.y + side * 5, playerId);
  placePresetBuilding(world, BuildingDefId.BARRACKS, spawn.x + side * 10, spawn.y + side * 5, playerId);
  placePresetBuilding(world, BuildingDefId.STABLE, spawn.x + side * 7, spawn.y + side * 8, playerId);
  placePresetBuilding(world, BuildingDefId.FOUNDRY, spawn.x + side * 10, spawn.y + side * 8, playerId);
  placePresetBuilding(world, BuildingDefId.DEFENSIVE_TOWER, spawn.x + side * 5, spawn.y - side * 5, playerId);
  placePresetBuilding(world, BuildingDefId.DEFENSIVE_TOWER, spawn.x + side * 10, spawn.y + side * 1, playerId);
}

function placePresetBuilding(
  world: SimWorld,
  defId: number,
  preferredX: number,
  preferredY: number,
  playerId: number
): number | null {
  const def = getBuildingDef(defId);
  if (!def) return null;
  const spot = findPresetBuildingSpot(world, def, preferredX, preferredY);
  if (!spot) return null;
  return spawnCompletedBuilding(world, defId, spot.x, spot.y, playerId);
}

function placePresetBuildingExact(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number | null {
  const def = getBuildingDef(defId);
  clearCampaignPlacementTile(world, x, y);
  if (!def || !canPlaceBuildingAt(world, def, x, y)) return null;
  return spawnCompletedBuilding(world, defId, x, y, playerId);
}

function clearCampaignPlacementTile(world: SimWorld, x: number, y: number): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) <= 0.6) {
      removeEntity(world.ecs, eid);
    }
  }
}

function findPresetBuildingSpot(
  world: SimWorld,
  def: BuildingDef,
  preferredX: number,
  preferredY: number
): GridPos | null {
  const cx = Math.round(preferredX);
  const cy = Math.round(preferredY);
  for (let r = 0; r <= 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (canPlaceBuildingAt(world, def, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function spawnLateGameArmy(world: SimWorld, playerId: number): void {
  const spawn = world.map.spawns[playerId];
  if (!spawn) return;
  const side = playerId === 1 ? 1 : -1;
  const anchor =
    findPresetArmyAnchor(world, spawn.x + side * 9, spawn.y - side * 8, playerId, spawn) ??
    findPresetArmyAnchor(world, spawn.x - side * 9, spawn.y - side * 8, playerId, spawn) ??
    findPresetArmyAnchor(world, spawn.x - side * 11, spawn.y + side * 2, playerId, spawn);
  if (!anchor) return;

  spawnPresetUnits(world, UnitDefId.ARCHER, anchor.x + side * 4, anchor.y, playerId, 8);
  spawnPresetUnits(world, UnitDefId.SPEARMAN, anchor.x, anchor.y + side * 3, playerId, 8);
  spawnPresetUnits(world, UnitDefId.SCOUT_CAVALRY, anchor.x + side * 4, anchor.y + side * 3, playerId, 5);
  spawnPresetUnits(world, UnitDefId.GUNMAN, anchor.x + side * 1, anchor.y + side * 6, playerId, 4);
  spawnPresetUnits(world, UnitDefId.CANNON, anchor.x + side * 5, anchor.y + side * 6, playerId, 2);
}

function findPresetArmyAnchor(
  world: SimWorld,
  preferredX: number,
  preferredY: number,
  playerId: number,
  home: GridPos
): GridPos | null {
  const cx = Math.round(preferredX);
  const cy = Math.round(preferredY);
  for (let r = 0; r <= 18; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (Math.hypot(x - home.x, y - home.y) > 18) continue;
        if (!canPresetUnitStandAt(world, x, y, 3, playerId, 22)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function spawnPresetUnits(
  world: SimWorld,
  defId: number,
  preferredX: number,
  preferredY: number,
  playerId: number,
  count: number,
  enemyClearance = 18
): void {
  for (let i = 0; i < count; i++) {
    const spot = findPresetUnitSpot(
      world,
      preferredX + (i % 3),
      preferredY + Math.floor(i / 3),
      8,
      playerId,
      enemyClearance
    );
    if (!spot) continue;
    spawnPresetUnitAt(world, defId, spot.x, spot.y, playerId);
  }
}

function spawnPresetUnitAt(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number | null {
  if (defId === UnitDefId.ARCHER) return spawnArcher(world, x, y, playerId);
  if (defId === UnitDefId.SPEARMAN) return spawnSpearman(world, x, y, playerId);
  if (defId === UnitDefId.SCOUT_CAVALRY) return spawnScoutCavalry(world, x, y, playerId);
  if (defId === UnitDefId.GUNMAN) return spawnGunman(world, x, y, playerId);
  if (defId === UnitDefId.CANNON) return spawnCannon(world, x, y, playerId);
  if (defId === UnitDefId.MACHINE_GUN) return spawnMachineGun(world, x, y, playerId);
  if (defId === UnitDefId.MORTAR) return spawnMortar(world, x, y, playerId);
  return null;
}

function findPresetUnitSpot(
  world: SimWorld,
  preferredX: number,
  preferredY: number,
  maxR: number,
  playerId: number,
  enemyClearance = 18
): GridPos | null {
  const cx = Math.round(preferredX);
  const cy = Math.round(preferredY);
  for (const waterClearance of [3, 2]) {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (canPresetUnitStandAt(world, x, y, waterClearance, playerId, enemyClearance)) return { x, y };
        }
      }
    }
  }
  return null;
}

function canPresetUnitStandAt(
  world: SimWorld,
  x: number,
  y: number,
  waterClearance: number,
  playerId: number,
  enemyClearance: number
): boolean {
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return false;
  if (world.map.walkability[y][x] !== 0) return false;
  const tile = world.map.tiles[y * MAP.WIDTH + x];
  if (
    tile !== TileType.GRASS
    && tile !== TileType.DIRT
    && tile !== TileType.MUD
    && tile !== TileType.SNOW
    && tile !== TileType.PACKED_SNOW
  ) return false;
  if (isNearWaterOrBridge(world, x, y, waterClearance)) return false;
  if (findResourceAt(world, x, y, 0.7) !== null) return false;
  if (findBuildingAt(world, x, y, 2.2) !== null) return false;
  if (findEntityNear(world, x, y, 0.75) !== null) return false;
  if (hasEnemyEntityNear(world, x, y, playerId, enemyClearance)) return false;
  return true;
}

function hasEnemyEntityNear(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number,
  radius: number
): boolean {
  for (const eid of positionQuery(world.ecs)) {
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] === playerId || Owner.player[eid] === 0) continue;
    if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
    const isRelevant =
      hasComponent(world.ecs, UnitKind, eid) ||
      hasComponent(world.ecs, Building, eid);
    if (!isRelevant) continue;
    if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) < radius) return true;
  }
  return false;
}

function isNearWaterOrBridge(
  world: SimWorld,
  x: number,
  y: number,
  radius: number
): boolean {
  for (let ny = y - radius; ny <= y + radius; ny++) {
    for (let nx = x - radius; nx <= x + radius; nx++) {
      if (nx < 0 || ny < 0 || nx >= MAP.WIDTH || ny >= MAP.HEIGHT) continue;
      const tile = world.map.tiles[ny * MAP.WIDTH + nx];
      if (
        tile === TileType.WATER ||
        tile === TileType.WATER_SHALLOW ||
        tile === TileType.BRIDGE
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Spawn a Villager at tile (x,y) owned by playerId. Returns the new eid. */
export function spawnVillager(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number,
  popCost = 1
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, VillagerTag, eid);
  addComponent(ecs, Gatherer, eid);
  addComponent(ecs, ResourceCarry, eid);

  addComponent(ecs, BuildOrder, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 2.5;
  UnitKind.kind[eid] = UnitKindId.VILLAGER;
  PopulationCost.value[eid] = popCost;
  Owner.player[eid] = playerId;
  Gatherer.targetEid[eid] = -1;
  Gatherer.state[eid] = GathererStateId.IDLE;
  Gatherer.cooldown[eid] = 0;
  ResourceCarry.kind[eid] = 0;
  ResourceCarry.amount[eid] = 0;
  BuildOrder.targetEid[eid] = -1;
  Health.hp[eid] = 25;
  Health.hpMax[eid] = 25;
  Health.armor[eid] = 0;
  // Villagers can defend themselves weakly.
  Combat.atk[eid] = 1;
  Combat.range[eid] = 1;
  Combat.attackSpeedTicks[eid] = 30;
  Combat.aggroRadius[eid] = 0; // villagers don't auto-aggro
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  Cooldown.ticksRemaining[eid] = 0;
  // Count toward population.
  world.population[playerId].current += popCost;
  return eid;
}

/** Spawn an Archer at tile (x,y) owned by playerId. */
export function spawnArcher(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, ArcherTag, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 2.25;
  UnitKind.kind[eid] = UnitKindId.ARCHER;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 35;
  Health.hpMax[eid] = 35;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 5;
  Combat.range[eid] = 5;
  Combat.attackSpeedTicks[eid] = 30;
  Combat.aggroRadius[eid] = 7;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Spearman at tile (x,y) owned by playerId. */
export function spawnSpearman(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, SpearmanTag, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 2.1;
  UnitKind.kind[eid] = UnitKindId.SPEARMAN;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 55;
  Health.hpMax[eid] = 55;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 5;
  Combat.range[eid] = 0.65;
  Combat.attackSpeedTicks[eid] = 25;
  Combat.aggroRadius[eid] = 6;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Scout Cavalry at tile (x,y) owned by playerId. */
export function spawnScoutCavalry(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, ScoutCavalryTag, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 3.45;
  UnitKind.kind[eid] = UnitKindId.SCOUT_CAVALRY;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 60;
  Health.hpMax[eid] = 60;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 6;
  Combat.range[eid] = 1;
  Combat.attackSpeedTicks[eid] = 22;
  Combat.aggroRadius[eid] = 7;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Gunpowder Age gunman at tile (x,y) owned by playerId. */
export function spawnGunman(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, GunmanTag, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 1.9;
  UnitKind.kind[eid] = UnitKindId.GUNMAN;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 45;
  Health.hpMax[eid] = 45;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 14;
  Combat.range[eid] = 5.5;
  Combat.attackSpeedTicks[eid] = 45;
  Combat.aggroRadius[eid] = 7;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Gunpowder Age field cannon at tile (x,y) owned by playerId. */
export function spawnCannon(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, CannonTag, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 1.05;
  UnitKind.kind[eid] = UnitKindId.CANNON;
  PopulationCost.value[eid] = 3;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 120;
  Health.hpMax[eid] = 120;
  Health.armor[eid] = 1;
  Combat.atk[eid] = 65;
  Combat.range[eid] = 8.5;
  Combat.attackSpeedTicks[eid] = 110;
  Combat.aggroRadius[eid] = 9;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 3;
  return eid;
}

/** Spawn a Total War Age machine gun team at tile (x,y) owned by playerId. */
export function spawnMachineGun(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, MachineGunTag, eid);
  addComponent(ecs, MachineGunDeployment, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 1.55;
  UnitKind.kind[eid] = UnitKindId.MACHINE_GUN;
  PopulationCost.value[eid] = 2;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 70;
  Health.hpMax[eid] = 70;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 9;
  Combat.range[eid] = 6.5;
  Combat.attackSpeedTicks[eid] = 3;
  Combat.aggroRadius[eid] = 8;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  MachineGunDeployment.deployed[eid] = 1;
  MachineGunDeployment.setupTicks[eid] = 0;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 2;
  return eid;
}

/** Spawn a Total War Age mortar team at tile (x,y) owned by playerId. */
export function spawnMortar(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, MortarTag, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 1.2;
  UnitKind.kind[eid] = UnitKindId.MORTAR;
  PopulationCost.value[eid] = 2;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 55;
  Health.hpMax[eid] = 55;
  Health.armor[eid] = 0;
  // Longest reach in the game (out-ranges MG 6.5 and Cannon 8.5) with arcing
  // splash; slow reload and the cavalry counter keep it honest.
  Combat.atk[eid] = 40;
  Combat.range[eid] = 10;
  Combat.attackSpeedTicks[eid] = 85;
  Combat.aggroRadius[eid] = 10;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 2;
  return eid;
}

/** Spawn a Resource node (tree, gold pile, stone pile, berry bush). */
export function spawnResource(
  world: SimWorld,
  kind: ResourceKind,
  x: number,
  y: number,
  amount: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Resource, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Resource.kind[eid] = kind;
  Resource.amount[eid] = amount;
  return eid;
}

function seedInitialForestTrees(world: SimWorld, mirrored = false): void {
  const canSeedForestTile = (x: number, y: number): boolean => {
    const tile = world.map.tiles[y * MAP.WIDTH + x];
    return tile === TileType.FOREST || tile === TileType.SNOW_FOREST;
  };

  if (mirrored) {
    const seen = new Set<number>();
    for (let y = 0; y < MAP.HEIGHT; y++) {
      for (let x = 0; x < MAP.WIDTH; x++) {
        const idx = y * MAP.WIDTH + x;
        if (seen.has(idx) || !canSeedForestTile(x, y)) continue;
        const mx = MAP.WIDTH - 1 - x;
        const my = MAP.HEIGHT - 1 - y;
        const mirrorIdx = my * MAP.WIDTH + mx;
        seen.add(idx);
        seen.add(mirrorIdx);
        if (!canSeedForestTile(mx, my)) continue;
        const edgeBonus = Math.max(edgeProximity01(x, y), edgeProximity01(mx, my))
          * FOREST_EDGE_INITIAL_TREE_BONUS;
        if (world.rng.next() > FOREST_TILE_INITIAL_TREE_CHANCE + edgeBonus) continue;
        trySpawnTreeAt(world, x, y, TREE_RESOURCE_AMOUNT, TREE_REGEN_BUILDING_CLEARANCE);
        if (mx !== x || my !== y) {
          trySpawnTreeAt(world, mx, my, TREE_RESOURCE_AMOUNT, TREE_REGEN_BUILDING_CLEARANCE);
        }
      }
    }
    return;
  }

  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      if (!canSeedForestTile(x, y)) continue;
      const edgeBonus = edgeProximity01(x, y) * FOREST_EDGE_INITIAL_TREE_BONUS;
      if (world.rng.next() > FOREST_TILE_INITIAL_TREE_CHANCE + edgeBonus) continue;
      trySpawnTreeAt(world, x, y, TREE_RESOURCE_AMOUNT, TREE_REGEN_BUILDING_CLEARANCE);
    }
  }
}

function randomEdgeTile(world: SimWorld): GridPos {
  const side = world.rng.int(4);
  const depth = world.rng.int(TREE_EDGE_BAND_TILES);
  if (side === 0) return { x: depth, y: world.rng.int(MAP.HEIGHT) };
  if (side === 1) return { x: MAP.WIDTH - 1 - depth, y: world.rng.int(MAP.HEIGHT) };
  if (side === 2) return { x: world.rng.int(MAP.WIDTH), y: depth };
  return { x: world.rng.int(MAP.WIDTH), y: MAP.HEIGHT - 1 - depth };
}

function edgeProximity01(x: number, y: number): number {
  const edgeDistance = Math.min(x, y, MAP.WIDTH - 1 - x, MAP.HEIGHT - 1 - y);
  if (edgeDistance >= TREE_EDGE_BAND_TILES) return 0;
  return (TREE_EDGE_BAND_TILES - edgeDistance) / TREE_EDGE_BAND_TILES;
}

function trySpawnTreeAt(
  world: SimWorld,
  x: number,
  y: number,
  amount: number,
  buildingClearance: number
): number | null {
  if (!canTreeGrowAt(world, x, y, buildingClearance)) return null;
  return spawnResource(world, ResourceKindId.WOOD, x, y, amount);
}

function canTreeGrowAt(
  world: SimWorld,
  x: number,
  y: number,
  buildingClearance: number
): boolean {
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return false;
  if (world.map.walkability[y][x] !== 0) return false;
  const tile = world.map.tiles[y * MAP.WIDTH + x];
  if (!isResourceTerrainTile(tile)) return false;
  if (
    tile !== TileType.GRASS
    && tile !== TileType.FOREST
    && tile !== TileType.SNOW
    && tile !== TileType.SNOW_FOREST
  ) return false;
  if (hasMapFeatureAt(world, x, y, 0.6)) return false;
  if (findResourceAt(world, x, y, 0.6) !== null) return false;
  return !isNearBuilding(world, x, y, buildingClearance);
}

function hasMapFeatureAt(world: SimWorld, x: number, y: number, radius: number): boolean {
  for (const feature of world.map.features) {
    if (Math.hypot(feature.x - x, feature.y - y) <= radius) return true;
  }
  return false;
}

function isNearBuilding(
  world: SimWorld,
  x: number,
  y: number,
  clearance: number
): boolean {
  for (const eid of buildingQuery(world.ecs)) {
    if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
    if (distToBuildingEdge(world, x, y, eid) < clearance) return true;
  }
  return false;
}

function countWoodNodes(world: SimWorld): number {
  let count = 0;
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] === ResourceKindId.WOOD && Resource.amount[eid] > 0) count++;
  }
  return count;
}

function countNearbyTrees(
  world: SimWorld,
  x: number,
  y: number,
  radius: number
): number {
  let count = 0;
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] !== ResourceKindId.WOOD) continue;
    if (Resource.amount[eid] <= 0) continue;
    if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) <= radius) count++;
  }
  return count;
}

/** Spawn a Town Center (always pre-built; acts as drop-off for all resources). */
export function spawnTownCenter(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, DropOff, eid);
  addComponent(ecs, TownCenterTag, eid);
  addComponent(ecs, Building, eid);
  addComponent(ecs, Producer, eid);
  addComponent(ecs, Health, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Owner.player[eid] = playerId;
  DropOff.acceptsMask[eid] = DropOffMask.ALL;
  Building.defId[eid] = BuildingDefId.TOWN_CENTER;
  Producer.currentProgress[eid] = 0;
  Health.hp[eid] = BUILDING_TABLE[BuildingDefId.TOWN_CENTER].hp;
  Health.hpMax[eid] = BUILDING_TABLE[BuildingDefId.TOWN_CENTER].hp;
  Health.armor[eid] = 0;
  // TC contributes pop cap.
  const tcDef = BUILDING_TABLE[BuildingDefId.TOWN_CENTER];
  world.population[playerId].cap += tcDef.popProvided;
  // Block the FULL TC footprint (3×3) — not just the centre — so units
  // can't walk underneath the visible building.
  markFootprintBlocked(world, x, y, tcDef.footprint.w, tcDef.footprint.h, true);
  return eid;
}

/**
 * Spawn a building foundation (under-construction). Buildings come into existence
 * through this path: villagers then add progress until totalTicks; finalisation
 * upgrades the entity from foundation → completed Building.
 */
export function spawnFoundation(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number {
  const def = getBuildingDef(defId);
  if (!def) throw new Error(`Unknown building defId ${defId}`);
  const { ecs } = world;
  const eid = addEntity(ecs);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, Building, eid);
  addComponent(ecs, ConstructionSite, eid);
  addComponent(ecs, FoundationTag, eid);
  addComponent(ecs, Health, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Owner.player[eid] = playerId;
  Building.defId[eid] = defId;
  ConstructionSite.defId[eid] = defId;
  ConstructionSite.progress[eid] = 0;
  ConstructionSite.totalTicks[eid] = def.buildTimeTicks;
  // Foundation starts at 1 hp and grows in finaliseBuilding.
  Health.hp[eid] = 1;
  Health.hpMax[eid] = def.hp;
  Health.armor[eid] = 0;
  // Block the full footprint from the moment the foundation drops.
  markFootprintBlocked(world, x, y, def.footprint.w, def.footprint.h, true);
  return eid;
}

/** Spawn a completed building without costs or construction delay.
 *  Used by deterministic test saves and debug tooling. */
export function spawnCompletedBuilding(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number {
  const eid = spawnFoundation(world, defId, x, y, playerId);
  ConstructionSite.progress[eid] = ConstructionSite.totalTicks[eid];
  finaliseBuilding(world, eid);
  return eid;
}

/** Distance from (fromX, fromY) to the EDGE of the building's occupied tile
 *  rectangle. Returns 0 inside the footprint. This mirrors markFootprintBlocked,
 *  including its even-footprint convention where a 2×2 building at (x,y)
 *  occupies tiles (x-1..x, y-1..y). */
function distToBuildingEdge(
  world: SimWorld,
  fromX: number,
  fromY: number,
  buildingEid: number
): number {
  if (!hasComponent(world.ecs, Building, buildingEid)) {
    return Math.hypot(
      fromX - Position.x[buildingEid],
      fromY - Position.y[buildingEid]
    );
  }
  const def = BUILDING_TABLE[Building.defId[buildingEid]];
  if (!def) {
    return Math.hypot(
      fromX - Position.x[buildingEid],
      fromY - Position.y[buildingEid]
    );
  }
  const x0 = Math.round(Position.x[buildingEid]) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(Position.y[buildingEid]) - Math.floor(def.footprint.h / 2);
  const minX = x0 - 0.5;
  const maxX = x0 + def.footprint.w - 0.5;
  const minY = y0 - 0.5;
  const maxY = y0 + def.footprint.h - 0.5;
  const dx = fromX < minX ? minX - fromX : fromX > maxX ? fromX - maxX : 0;
  const dy = fromY < minY ? minY - fromY : fromY > maxY ? fromY - maxY : 0;
  return Math.hypot(dx, dy);
}

/** Find a walkable tile near (cx, cy) for spawning units. Searches outward
 *  in concentric rings up to maxR. Returns the requested tile if walkable,
 *  the nearest walkable otherwise, or null if nothing within range. */
function findSpawnSpot(
  world: SimWorld,
  cx: number,
  cy: number,
  maxR = 5
): { x: number; y: number } | null {
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  if (
    ix >= 0 && iy >= 0 && ix < MAP.WIDTH && iy < MAP.HEIGHT &&
    world.map.walkability[iy][ix] === 0
  ) {
    return { x: ix, y: iy };
  }
  return world.pathfinder.nearestWalkable(
    Math.max(0, Math.min(MAP.WIDTH - 1, ix)),
    Math.max(0, Math.min(MAP.HEIGHT - 1, iy)),
    maxR
  );
}

/** Mark / unmark a tile as blocked in the walkability grid. Mutating the
 *  array also updates EasyStar (same array reference). */
function markTileBlocked(world: SimWorld, x: number, y: number, blocked: boolean): void {
  const ix = Math.round(x), iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= MAP.WIDTH || iy >= MAP.HEIGHT) return;
  world.map.walkability[iy][ix] = blocked ? 1 : 0;
}

/** Mark / unmark a building's full footprint in the walkability grid.
 *  Footprint is centred on (cx, cy). For even widths the extra tile is to
 *  the south/east. Buildings with a 3×3 footprint block 9 tiles total. */
function markFootprintBlocked(
  world: SimWorld,
  cx: number,
  cy: number,
  fw: number,
  fh: number,
  blocked: boolean
): void {
  const x0 = Math.round(cx) - Math.floor(fw / 2);
  const y0 = Math.round(cy) - Math.floor(fh / 2);
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      markTileBlocked(world, x0 + dx, y0 + dy, blocked);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────────────────────

export const positionQuery = defineQuery([Position]);
export const movableQuery = defineQuery([Position, Velocity, Speed]);
export const selectedQuery = defineQuery([Position, Selected]);
export const gathererQuery = defineQuery([Position, Gatherer, ResourceCarry]);
export const resourceQuery = defineQuery([Position, Resource]);
export const dropOffQuery = defineQuery([Position, DropOff, Owner]);
export const resourceWorksiteQuery = defineQuery([Position, ResourceWorksite, Owner, Building]);
export const worksiteWorkerQuery = defineQuery([Position, WorksiteWorker, Gatherer, Owner]);
export const townCenterQuery = defineQuery([Position, TownCenterTag, Owner]);
export const buildingQuery = defineQuery([Position, Building, Owner]);
export const foundationQuery = defineQuery([
  Position,
  Building,
  ConstructionSite,
  Owner,
]);
export const producerQuery = defineQuery([Producer, Owner]);
export const combatQuery = defineQuery([
  Position,
  Combat,
  AttackTarget,
  Cooldown,
  Owner,
  Health,
]);
export const damageableQuery = defineQuery([Position, Health, Owner]);
export const unitQuery = defineQuery([Position, UnitKind, Owner, Health]);
export const deadQuery = defineQuery([DeadTag]);

// ────────────────────────────────────────────────────────────────────────────
// Fog of war / player visibility
// ────────────────────────────────────────────────────────────────────────────

export function tileVisibilityIndex(x: number, y: number): number {
  return y * MAP.WIDTH + x;
}

export function getPlayerVisibility(
  world: SimWorld,
  playerId: number
): PlayerVisibility | null {
  return world.visibility[playerId] ?? null;
}

export function isTileVisibleTo(
  world: SimWorld,
  playerId: number,
  x: number,
  y: number
): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!isTileInMap(tx, ty)) return false;
  return (world.visibility[playerId]?.visible[tileVisibilityIndex(tx, ty)] ?? 0) === 1;
}

export function isTileExploredBy(
  world: SimWorld,
  playerId: number,
  x: number,
  y: number
): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!isTileInMap(tx, ty)) return false;
  return (world.visibility[playerId]?.explored[tileVisibilityIndex(tx, ty)] ?? 0) === 1;
}

export function isEntityVisibleTo(
  world: SimWorld,
  playerId: number,
  eid: number
): boolean {
  if (!hasComponent(world.ecs, Position, eid)) return false;
  if (hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId) return true;
  if (hasComponent(world.ecs, Building, eid)) {
    return isBuildingVisibleTo(world, playerId, eid);
  }
  return isTileVisibleTo(world, playerId, Position.x[eid], Position.y[eid]);
}

export function isBuildingVisibleTo(
  world: SimWorld,
  playerId: number,
  eid: number
): boolean {
  if (!hasComponent(world.ecs, Building, eid)) {
    return isTileVisibleTo(world, playerId, Position.x[eid], Position.y[eid]);
  }
  return isBuildingFootprintVisibleTo(
    world,
    playerId,
    Building.defId[eid],
    Position.x[eid],
    Position.y[eid]
  );
}

export function isBuildingFootprintVisibleTo(
  world: SimWorld,
  playerId: number,
  defId: number,
  x: number,
  y: number
): boolean {
  let visible = false;
  forEachBuildingFootprintTile(defId, x, y, (tx, ty) => {
    if (isTileVisibleTo(world, playerId, tx, ty)) visible = true;
  });
  return visible;
}

export function updatePlayerVisibility(
  world: SimWorld,
  playerId = LOCAL_PLAYER_ID
): void {
  const vis = world.visibility[playerId];
  if (!vis) return;
  if (world.revealedMapPlayers[playerId]) {
    vis.visible.fill(1);
    vis.explored.fill(1);
    updateLastSeenBuildings(world, playerId, vis);
    return;
  }
  vis.visible.fill(0);

  for (const eid of positionQuery(world.ecs)) {
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
    if (!hasComponent(world.ecs, UnitKind, eid) && !hasComponent(world.ecs, Building, eid)) {
      continue;
    }
    revealCircle(vis, Position.x[eid], Position.y[eid], lineOfSightRadius(world, eid));
  }

  smoothVisibilityFrontier(vis);
  updateLastSeenBuildings(world, playerId, vis);
  pruneHiddenLocalSelection(world, playerId);
}

export function revealMapForPlayer(world: SimWorld, playerId = LOCAL_PLAYER_ID): void {
  if (!world.visibility[playerId]) return;
  world.revealedMapPlayers[playerId] = true;
  updatePlayerVisibility(world, playerId);
}

function visibilitySystem(world: SimWorld): void {
  // Compute fog for every human player so each client can render its own
  // perspective. In single-player this is just LOCAL_PLAYER_ID.
  for (const playerId of world.humanPlayers) {
    updatePlayerVisibility(world, playerId);
  }
}

function isTileInMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP.WIDTH && y < MAP.HEIGHT;
}

function revealCircle(
  vis: PlayerVisibility,
  x: number,
  y: number,
  radius: number
): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const effectiveRadius = radius + VISION_EDGE_SOFTENING_TILES;
  const r = Math.ceil(effectiveRadius + VISION_TILE_FOOTPRINT_RADIUS);
  const r2 = effectiveRadius * effectiveRadius;
  for (let ty = cy - r; ty <= cy + r; ty++) {
    for (let tx = cx - r; tx <= cx + r; tx++) {
      if (!isTileInMap(tx, ty)) continue;
      // Reveal if the vision circle touches the tile footprint, not only when
      // it reaches the tile centre. This removes one-tile notches around the
      // visible frontier without turning vision into a square.
      const dx = Math.max(0, Math.abs(tx - x) - VISION_TILE_FOOTPRINT_RADIUS);
      const dy = Math.max(0, Math.abs(ty - y) - VISION_TILE_FOOTPRINT_RADIUS);
      if (dx * dx + dy * dy > r2) continue;
      const idx = tileVisibilityIndex(tx, ty);
      vis.visible[idx] = 1;
      vis.explored[idx] = 1;
    }
  }
}

function smoothVisibilityFrontier(vis: PlayerVisibility): void {
  const before = vis.visible.slice();
  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      const idx = tileVisibilityIndex(x, y);
      if (before[idx] === 1) continue;
      const neighbors = countVisibleNeighbors(before, x, y);
      const cardinals = countVisibleCardinalNeighbors(before, x, y);
      if (neighbors < 5 && cardinals < 3) continue;
      vis.visible[idx] = 1;
      vis.explored[idx] = 1;
    }
  }
}

function countVisibleNeighbors(visible: Uint8Array, x: number, y: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (!isTileInMap(tx, ty)) continue;
      count += visible[tileVisibilityIndex(tx, ty)];
    }
  }
  return count;
}

function countVisibleCardinalNeighbors(visible: Uint8Array, x: number, y: number): number {
  let count = 0;
  if (x > 0) count += visible[tileVisibilityIndex(x - 1, y)];
  if (x < MAP.WIDTH - 1) count += visible[tileVisibilityIndex(x + 1, y)];
  if (y > 0) count += visible[tileVisibilityIndex(x, y - 1)];
  if (y < MAP.HEIGHT - 1) count += visible[tileVisibilityIndex(x, y + 1)];
  return count;
}

function lineOfSightRadius(world: SimWorld, eid: number): number {
  if (hasComponent(world.ecs, Building, eid)) {
    const defId = Building.defId[eid];
    if (defId === BuildingDefId.TOWN_CENTER) return TOWN_CENTER_LINE_OF_SIGHT;
    if (defId === BuildingDefId.DEFENSIVE_TOWER) return TOWER_LINE_OF_SIGHT;
    return BUILDING_LINE_OF_SIGHT;
  }
  if (hasComponent(world.ecs, ScoutCavalryTag, eid)) return SCOUT_LINE_OF_SIGHT;
  if (hasComponent(world.ecs, MachineGunTag, eid)) return 8;
  // Indirect fire is useless without spotting — match LOS to the 10-tile range.
  if (hasComponent(world.ecs, MortarTag, eid)) return 10;
  return DEFAULT_UNIT_LINE_OF_SIGHT;
}

function updateLastSeenBuildings(
  world: SimWorld,
  playerId: number,
  vis: PlayerVisibility
): void {
  for (const eid of buildingQuery(world.ecs)) {
    if (!isVisibleEnemyBuilding(world, playerId, eid)) continue;
    vis.lastSeenBuildings.set(eid, snapshotBuilding(world, eid));
  }

  for (const [key, snap] of vis.lastSeenBuildings) {
    if (!isBuildingFootprintVisibleTo(world, playerId, snap.defId, snap.x, snap.y)) {
      continue;
    }
    const live = findBuildingAt(world, snap.x, snap.y, 0.01);
    if (
      live === null ||
      !hasComponent(world.ecs, Owner, live) ||
      Owner.player[live] !== snap.owner
    ) {
      vis.lastSeenBuildings.delete(key);
    }
  }
}

function isVisibleEnemyBuilding(world: SimWorld, playerId: number, eid: number): boolean {
  if (!hasComponent(world.ecs, Owner, eid)) return false;
  const owner = Owner.player[eid];
  if (owner === 0 || owner === playerId) return false;
  if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) return false;
  return isBuildingVisibleTo(world, playerId, eid);
}

function snapshotBuilding(world: SimWorld, eid: number): LastSeenBuilding {
  return {
    eid,
    owner: Owner.player[eid],
    defId: Building.defId[eid],
    age: world.ages[Owner.player[eid]]?.current ?? AgeId.DARK,
    x: Position.x[eid],
    y: Position.y[eid],
    hp: hasComponent(world.ecs, Health, eid) ? Health.hp[eid] : 0,
    hpMax: hasComponent(world.ecs, Health, eid) ? Health.hpMax[eid] : 0,
    isFoundation: hasComponent(world.ecs, ConstructionSite, eid),
  };
}

function pruneHiddenLocalSelection(world: SimWorld, playerId: number): void {
  for (const eid of selectedQuery(world.ecs)) {
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] === playerId) continue;
    if (!isEntityVisibleTo(world, playerId, eid)) {
      removeComponent(world.ecs, Selected, eid);
    }
  }
}

function forEachBuildingFootprintTile(
  defId: number,
  x: number,
  y: number,
  visit: (tx: number, ty: number) => void
): void {
  const def = BUILDING_TABLE[defId];
  if (!def) {
    visit(Math.round(x), Math.round(y));
    return;
  }
  const x0 = Math.round(x) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(y) - Math.floor(def.footprint.h / 2);
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (isTileInMap(tx, ty)) visit(tx, ty);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// step()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Advance the sim by one fixed tick. Inputs queued since the last tick are applied first,
 * then the gatherer state machine ticks, then movement applies any pending paths.
 *
 * Pure relative to the SimWorld it receives — same world + same inputs → same next state.
 */
export function step(world: SimWorld): void {
  if (world.paused) {
    // Inputs collected while paused are deferred until unpause.
    return;
  }
  if (world.outcome.state !== 'playing') {
    world.inputs.length = 0;
    return;
  }

  // 00 — refresh vision before commands; tests and debug tools can reposition
  // entities directly between ticks.
  visibilitySystem(world);

  // 01 — drain inputs.
  for (const input of world.inputs) {
    applyInput(world, input);
  }
  world.inputs.length = 0;

  // 10 — AI brain tick (player 2 only for now). Throttled inside.
  aiSystem(world);

  // 20 — age progression (one tick of any in-flight advances).
  ageProgressionSystem(world);

  // 21 — production tick (TC / Barracks queues).
  productionSystem(world);

  // 22 — construction tick (foundations gain progress from adjacent builders).
  constructionSystem(world);

  // 23 — assign workers and convert nearby resource nodes into income.
  resourceWorksiteSystem(world);

  // 40 — gatherer state machine.
  gatheringSystem(world);

  // 41 — credit player banks for any RETURNING villager that just reached drop-off.
  dropoffSystem(world);

  // 50 — auto-acquire targets via aggro radius.
  targetingSystem(world);

  // 51 — combat: in-range attackers fire, ticked-down cooldowns reset.
  combatSystem(world);

  // 52 — projectiles resolve damage only when their visual projectile lands.
  projectileImpactSystem(world);
  cannonImpactSystem(world);

  // 70 — death: hp<=0 entities flagged.
  deathSystem(world);

  // 71 — cleanup: remove flagged entities + decrement pop / cap.
  cleanupSystem(world);

  // 72 — campaign objectives and scripted defensive reinforcement.
  campaignSystem(world);

  // 72 — slow forest regrowth on empty grass near existing trees.
  forestRegrowthSystem(world);

  // 31 — movement.
  movementSystem(world);

  // 73 — rebuild local player vision after movement resolves.
  visibilitySystem(world);

  // 80 — win condition check.
  winConditionSystem(world);

  world.tick += 1;
}

function applyInput(world: SimWorld, input: SimInput): void {
  switch (input.type) {
    case 'moveSelected':
      applyMoveSelected(world, input.to);
      return;
    case 'gatherSelected':
      applyGatherSelected(world, input.targetEid);
      return;
    case 'stopSelected':
      applyStopSelected(world);
      return;
    case 'toggleSelectedUnitStance':
      applyToggleSelectedUnitStance(world);
      return;
    case 'setSelectedUnitStance':
      applySetSelectedUnitStance(world, input.stance);
      return;
    case 'setFormationMode':
      applySetFormationMode(world, input.mode);
      return;
    case 'adjustFormationMode':
      applyAdjustFormationMode(world, input.delta);
      return;
    case 'rotateSelectedFormation':
      applyRotateSelectedFormation(world, input.delta);
      return;
    case 'reformSelectedFormation':
      applyReformSelectedFormation(world);
      return;
    case 'attackSelected':
      applyAttackSelected(world, input.targetEid);
      return;
    case 'attackMoveSelected':
      applyAttackMoveSelected(world, input.to);
      return;
    case 'cmdMove':
      applyMoveCommand(world, input.playerId, input.eids, input.to);
      return;
    case 'cmdGather':
      applyGatherCommand(world, input.playerId, input.eids, input.targetEid);
      return;
    case 'cmdStop':
      applyStopCommand(world, input.playerId, input.eids);
      return;
    case 'cmdToggleStance':
      applyToggleStanceCommand(world, input.playerId, input.eids);
      return;
    case 'cmdAttack':
      applyAttackCommand(world, input.playerId, input.eids, input.targetEid);
      return;
    case 'cmdAttackMove':
      applyAttackMoveCommand(world, input.playerId, input.eids, input.to);
      return;
    case 'setArmyRallyPoint':
      applySetArmyRallyPoint(world, input.playerId, input.x, input.y);
      return;
    case 'placeBuilding':
      applyPlaceBuilding(world, input.defId, input.x, input.y, input.playerId);
      return;
    case 'removeSelectedBuildings':
      applyRemoveSelectedBuildings(world, input.playerId);
      return;
    case 'cmdRemoveBuildings':
      applyRemoveBuildingsCommand(world, input.playerId, input.eids);
      return;
    case 'cmdSetStance':
      applySetStanceCommand(world, input.playerId, input.eids, input.stance);
      return;
    case 'cmdSetFormationMode':
      applySetFormationModeCommand(world, input.playerId, input.eids, input.mode);
      return;
    case 'cmdAdjustFormationMode':
      applyAdjustFormationModeCommand(world, input.playerId, input.eids, input.delta);
      return;
    case 'cmdRotateFormation':
      applyRotateFormationCommand(world, input.playerId, input.eids, input.delta);
      return;
    case 'cmdReformFormation':
      applyReformFormationCommand(world, input.playerId, input.eids);
      return;
    case 'trainUnit':
      if (input.playerId !== undefined && !ownsCommandTarget(world, input.playerId, input.atEid)) return;
      applyTrainUnit(world, input.atEid, input.defId, input.count);
      return;
    case 'cancelProduction':
      if (input.playerId !== undefined && !ownsCommandTarget(world, input.playerId, input.atEid)) return;
      applyCancelProduction(world, input.atEid);
      return;
    case 'advanceAge':
      applyAdvanceAge(world, input.playerId);
      return;
    case 'researchTech':
      applyResearchTech(world, input.playerId, input.techId);
      return;
  }
}

function applyAdvanceAge(world: SimWorld, playerId: number): void {
  const age = world.ages[playerId];
  if (!age) return;
  if (age.progress >= 0) return; // already advancing
  if (age.current >= AGE_TABLE.length - 1) return; // at max
  const nextDef = getAgeDef(age.current + 1);
  if (!nextDef) return;
  if (nextDef.id === AgeId.GUNPOWDER && isCampaignTechLocked(world, TechId.GUNPOWDER_AGE)) return;
  // Total War is scaffolded for unit testing and cheats, but has no live tech path yet.
  if (nextDef.id === AgeId.TOTAL_WAR) return;
  if (nextDef.id === AgeId.CASTLE && !canStartCastleAge(world, playerId)) return;
  if (nextDef.id === AgeId.GUNPOWDER && !canStartGunpowderAge(world, playerId)) return;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, nextDef.advanceCost)) return;
  spend(bank, nextDef.advanceCost);
  age.progress = 0;
  age.totalTicks = nextDef.advanceTicks;
}

function applyResearchTech(world: SimWorld, playerId: number, techId: TechIdValue): void {
  const tech = techDef(techId);
  if (!tech) return;
  if (isCampaignTechLocked(world, techId)) return;
  if (hasTech(world, playerId, techId)) return;
  if (!techPrereqsMet(world, playerId, tech)) return;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, tech.cost)) return;

  if (techId === TechId.CASTLE_AGE || techId === TechId.GUNPOWDER_AGE) {
    const age = world.ages[playerId];
    const targetAge = techId === TechId.CASTLE_AGE ? AgeId.CASTLE : AgeId.GUNPOWDER;
    if (!age || age.progress >= 0 || age.current >= targetAge) return;
    spend(bank, tech.cost);
    age.progress = 0;
    age.totalTicks = AGE_TABLE[targetAge].advanceTicks;
    return;
  }

  const previousHousePop = getHousePopProvided(world, playerId);
  spend(bank, tech.cost);
  if (!world.researchedTechs[playerId]) {
    world.researchedTechs[playerId] = createStartingTechSet();
  }
  world.researchedTechs[playerId].add(techId);
  if (techId === TechId.HOUSING_I || techId === TechId.HOUSING_II) {
    applyHousingPopUpgrade(world, playerId, previousHousePop);
  }
}

function applyHousingPopUpgrade(
  world: SimWorld,
  playerId: number,
  previousHousePop: number
): void {
  const nextHousePop = getHousePopProvided(world, playerId);
  const delta = nextHousePop - previousHousePop;
  if (delta <= 0) return;
  let completedHouses = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Building.defId[eid] !== BuildingDefId.HOUSE) continue;
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    completedHouses++;
  }
  if (completedHouses <= 0) return;
  recalculatePlayerPopCap(world, playerId);
}

export function canStartCastleAge(world: SimWorld, playerId: number): boolean {
  const castleTech = techDef(TechId.CASTLE_AGE);
  return castleTech ? techPrereqsMet(world, playerId, castleTech) : false;
}

export function canStartGunpowderAge(world: SimWorld, playerId: number): boolean {
  if (isCampaignTechLocked(world, TechId.GUNPOWDER_AGE)) return false;
  const gunpowderTech = techDef(TechId.GUNPOWDER_AGE);
  return gunpowderTech ? techPrereqsMet(world, playerId, gunpowderTech) : false;
}

function isCampaignTechLocked(world: SimWorld, techId: TechIdValue): boolean {
  return world.campaign?.lockedTechs.includes(techId) ?? false;
}

/** Advance any in-flight age progressions by one tick. */
function ageProgressionSystem(world: SimWorld): void {
  for (let p = 0; p < world.ages.length; p++) {
    const age = world.ages[p];
    if (age.progress < 0) continue;
    age.progress += 1;
    if (age.progress >= age.totalTicks) {
      age.current += 1;
      age.progress = -1;
      age.totalTicks = 0;
      // Non-spatial fanfare; render plays it only for the local player.
      pushSoundCue(world, 'age_up', 0, 0, p);
    }
  }
}

/** Selected entities the local player owns. All command handlers route
 *  through this so the player can't command enemy or gaia units. */
function commandableSelection(world: SimWorld): number[] {
  const out: number[] = [];
  for (const eid of selectedQuery(world.ecs)) {
    if (hasComponent(world.ecs, WorksiteWorker, eid)) continue;
    if (Owner.player[eid] === LOCAL_PLAYER_ID) out.push(eid);
  }
  return out;
}

/** Validate a network/explicit eid list: keep only live entities the
 *  commanding player owns and that are commandable (not worksite workers, not
 *  dead). This is the trust boundary for commands arriving over the wire — a
 *  peer must not be able to move another player's units. Iteration order
 *  follows the supplied list, then is unused for ordering-sensitive mutations
 *  because callers that care re-sort (e.g. formationDestinations). */
function ownedCommandableEids(world: SimWorld, playerId: number, eids: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const eid of eids) {
    if (seen.has(eid)) continue;
    seen.add(eid);
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, WorksiteWorker, eid)) continue;
    if (hasComponent(world.ecs, DeadTag, eid)) continue;
    out.push(eid);
  }
  return out;
}

/** Does `playerId` own building/unit `eid`? Trust boundary for commands that
 *  target a single global eid (trainUnit, cancelProduction). */
function ownsCommandTarget(world: SimWorld, playerId: number, eid: number): boolean {
  return hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId;
}

/** Cancel the combat side of a unit's current orders. Used whenever a
 *  non-attack command is issued so units don't keep chasing whatever they
 *  were last fighting. */
function clearCombatOrders(world: SimWorld, eid: number): void {
  if (hasComponent(world.ecs, AttackTarget, eid)) {
    AttackTarget.targetEid[eid] = -1;
    AttackTarget.retainGoal[eid] = 0;
  }
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
    AttackMoveGoal.active[eid] = 0;
  }
  if (hasComponent(world.ecs, Cooldown, eid)) {
    // Don't zero the cooldown — that would let units fire instantly on a
    // new aggro acquire. Keep it as-is.
  }
  world.cannonWindups.delete(eid);
  clearFormationSpeedCap(world, eid);
}

/** Cancel the gathering / building side. Mirror of clearCombatOrders. */
function clearWorkOrders(world: SimWorld, eid: number): void {
  if (hasComponent(world.ecs, Gatherer, eid)) {
    Gatherer.state[eid] = GathererStateId.IDLE;
    Gatherer.targetEid[eid] = -1;
    Gatherer.cooldown[eid] = 0;
  }
  if (hasComponent(world.ecs, BuildOrder, eid)) {
    BuildOrder.targetEid[eid] = -1;
  }
}

function clearFormationSpeedCap(world: SimWorld, eid: number): void {
  world.formationSpeedCaps.delete(eid);
}

function setUnitHoldAnchor(world: SimWorld, eid: number, x = Position.x[eid], y = Position.y[eid]): void {
  if (!hasComponent(world.ecs, UnitStance, eid)) return;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
}

function applyFormationSpeedCap(world: SimWorld, eids: number[]): void {
  for (const eid of eids) clearFormationSpeedCap(world, eid);
  if (eids.length <= 1) return;
  let speedCap = Infinity;
  for (const eid of eids) {
    if (!hasComponent(world.ecs, Speed, eid)) continue;
    speedCap = Math.min(speedCap, Speed.value[eid]);
  }
  if (!Number.isFinite(speedCap)) return;
  for (const eid of eids) {
    if (Speed.value[eid] > speedCap) {
      world.formationSpeedCaps.set(eid, speedCap);
    }
  }
}

function applyAttackSelected(world: SimWorld, targetEid: number): void {
  applyAttackCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), targetEid);
}

function applyAttackCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  targetEid: number
): void {
  if (!hasComponent(world.ecs, Health, targetEid)) return;
  if (Health.hp[targetEid] <= 0) return;
  if (!isEntityVisibleTo(world, playerId, targetEid)) return;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    if (!hasComponent(world.ecs, Combat, eid)) continue;
    if (!hasComponent(world.ecs, AttackTarget, eid)) continue;
    if (Owner.player[eid] === Owner.player[targetEid]) continue; // no friendly fire
    const inRange = isTargetInAttackRange(world, eid, targetEid);
    const canReach =
      inRange ||
      (isMovableEntity(world, eid) &&
        pathTo(world, eid, Position.x[targetEid], Position.y[targetEid]));
    if (!canReach) continue;

    AttackTarget.targetEid[eid] = targetEid;
    // retainGoal = 1 means "the user explicitly told me to attack THIS unit",
    // which exempts the chase from the auto-aggro leash. The player gave a
    // direct order; honour it until the target dies, the player issues a new
    // order, or the target gets out of pathing range.
    AttackTarget.retainGoal[eid] = 1;
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
      AttackMoveGoal.active[eid] = 0;
    }
    world.cannonWindups.delete(eid);
    clearFormationSpeedCap(world, eid);
    clearWorkOrders(world, eid);
    if (inRange) world.paths.delete(eid);
  }
}

function applyAttackMoveSelected(world: SimWorld, to: GridPos): void {
  applyAttackMoveCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), to);
}

function applyAttackMoveCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  to: GridPos
): void {
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    isMovableEntity(world, eid)
  );
  const mode = playerFormationMode(world, playerId);
  const destinations = formationModeUsesSlots(mode)
    ? formationDestinations(world, units, to, mode)
    : units.map((eid) => ({ eid, dest: to }));
  const ordered: number[] = [];
  for (const { eid, dest } of destinations) {
    if (!hasComponent(world.ecs, Combat, eid)) continue;
    if (!formationModeUsesSlots(mode)) clearFormationSpeedCap(world, eid);
    if (!pathTo(world, eid, dest.x, dest.y)) continue;
    AttackTarget.targetEid[eid] = -1;
    AttackTarget.retainGoal[eid] = 0;
    world.cannonWindups.delete(eid);
    // Store the real attack-move destination so the unit can resume walking
    // toward it after killing whatever they engage along the way.
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
      AttackMoveGoal.active[eid] = 1;
      AttackMoveGoal.x[eid] = dest.x;
      AttackMoveGoal.y[eid] = dest.y;
    }
    setUnitHoldAnchor(world, eid, dest.x, dest.y);
    clearWorkOrders(world, eid);
    ordered.push(eid);
  }
  if (formationModeUsesSlots(mode)) {
    applyFormationSpeedCap(world, ordered);
  }
}

function applyMoveSelected(world: SimWorld, to: GridPos): void {
  applyMoveCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), to);
}

function applyMoveCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  to: GridPos
): void {
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    isMovableEntity(world, eid)
  );
  const mode = playerFormationMode(world, playerId);
  const destinations = formationModeUsesSlots(mode)
    ? formationDestinations(world, units, to, mode)
    : units.map((eid) => ({ eid, dest: to }));
  const ordered: number[] = [];
  for (const { eid, dest } of destinations) {
    if (!formationModeUsesSlots(mode)) clearFormationSpeedCap(world, eid);
    if (!pathTo(world, eid, dest.x, dest.y)) continue;
    // Move overrides any combat, gather, or build state.
    clearCombatOrders(world, eid);
    clearWorkOrders(world, eid);
    setUnitHoldAnchor(world, eid, dest.x, dest.y);
    ordered.push(eid);
  }
  if (formationModeUsesSlots(mode)) {
    applyFormationSpeedCap(world, ordered);
  }
}

/** SP convenience: reshape the local player's current selection. */
function applyReformSelectedFormation(world: SimWorld): void {
  applyReformFormationCommand(world, LOCAL_PLAYER_ID, commandableSelection(world));
}

/**
 * Re-pack a player's selected military into their current formation shape,
 * centered on the group. Network-safe: operates only on the supplied eids that
 * the player actually owns, and reads that player's own formation mode/facing.
 */
function applyReformFormationCommand(world: SimWorld, playerId: number, eids: number[]): void {
  const units = ownedCommandableEids(world, playerId, eids).filter(
    (eid) => hasComponent(world.ecs, UnitStance, eid) && isMovableEntity(world, eid)
  );
  if (units.length <= 1) return;
  const mode = playerFormationMode(world, playerId);
  if (!formationModeUsesSlots(mode)) {
    for (const eid of units) clearFormationSpeedCap(world, eid);
    return;
  }

  const center = formationCenter(units);
  const facing = formationFacingVector(playerFormationFacing(world, playerId));
  const ordered: number[] = [];
  for (const { eid, dest } of formationDestinations(world, units, center, mode, facing)) {
    if (!pathTo(world, eid, dest.x, dest.y)) continue;
    clearCombatOrders(world, eid);
    clearWorkOrders(world, eid);
    setUnitHoldAnchor(world, eid, dest.x, dest.y);
    ordered.push(eid);
  }
  applyFormationSpeedCap(world, ordered);
}

function applySetArmyRallyPoint(
  world: SimWorld,
  playerId: number,
  x: number,
  y: number
): void {
  if (playerId <= 0 || playerId >= world.armyRallyPoints.length) return;
  const spot = findSpawnSpot(world, x, y, 4);
  if (!spot) return;
  world.armyRallyPoints[playerId] = spot;
}

function isMovableEntity(world: SimWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, Position, eid) &&
    hasComponent(world.ecs, Velocity, eid) &&
    hasComponent(world.ecs, Speed, eid)
  );
}

function formationCenter(units: number[]): GridPos {
  const center = units.reduce(
    (acc, eid) => {
      acc.x += Position.x[eid];
      acc.y += Position.y[eid];
      return acc;
    },
    { x: 0, y: 0 }
  );
  return {
    x: Math.round(center.x / units.length),
    y: Math.round(center.y / units.length),
  };
}

function formationDestinations(
  world: SimWorld,
  units: number[],
  to: GridPos,
  formationMode = FORMATION_MODE_DEFAULT,
  facing?: { x: number; y: number }
): Array<{ eid: number; dest: GridPos }> {
  if (units.length <= 1) {
    return units.map((eid) => ({ eid, dest: to }));
  }

  const sorted = [...units].sort((a, b) => {
    const rank = formationRank(world, a) - formationRank(world, b);
    if (rank !== 0) return rank;
    return a - b;
  });

  const center = sorted.reduce(
    (acc, eid) => {
      acc.x += Position.x[eid];
      acc.y += Position.y[eid];
      return acc;
    },
    { x: 0, y: 0 }
  );
  center.x /= sorted.length;
  center.y /= sorted.length;

  let dirX = facing?.x ?? (to.x - center.x);
  let dirY = facing?.y ?? (to.y - center.y);
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 0.001) {
    const defaultFacing = formationFacingVector(FORMATION_FACING_DEFAULT);
    dirX = defaultFacing.x;
    dirY = defaultFacing.y;
  } else {
    dirX /= dirLen;
    dirY /= dirLen;
  }
  const sideX = -dirY;
  const sideY = dirX;
  const mode = clampFormationMode(formationMode);
  const spacing = formationSpacing(mode);
  const columns = formationColumnCount(sorted.length, mode);
  const rowCount = Math.ceil(sorted.length / columns);
  const reserved = new Set<string>();

  const out: Array<{ eid: number; dest: GridPos }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const eid = sorted[i];
    const row = Math.floor(i / columns);
    const col = i % columns;
    const rowStart = row * columns;
    const rowSize = Math.min(columns, sorted.length - rowStart);
    const sideOffset = (col - (rowSize - 1) / 2) * spacing;
    const forwardOffset = ((rowCount - 1) / 2 - row) * spacing;
    const desired = {
      x: Math.round(to.x + dirX * forwardOffset + sideX * sideOffset),
      y: Math.round(to.y + dirY * forwardOffset + sideY * sideOffset),
    };
    const dest = findFormationDestination(world, desired, reserved);
    if (dest) out.push({ eid, dest });
  }
  return out;
}

function clampFormationMode(mode: number): number {
  if (!Number.isFinite(mode)) return FORMATION_MODE_DEFAULT;
  return Math.max(
    FORMATION_MODE_MIN,
    Math.min(FORMATION_MODE_MAX, Math.trunc(mode))
  );
}

/** Current formation shape for a player (clamped, default-safe). */
export function playerFormationMode(world: SimWorld, playerId: number): number {
  return clampFormationMode(world.formationModes[playerId] ?? FORMATION_MODE_DEFAULT);
}

/** Current formation facing for a player (normalized, default-safe). */
export function playerFormationFacing(world: SimWorld, playerId: number): number {
  return normalizeFormationFacing(world.formationFacings[playerId] ?? FORMATION_FACING_DEFAULT);
}

function formationModeUsesSlots(mode: number): boolean {
  return clampFormationMode(mode) !== FORMATION_MODE_FREE;
}

function normalizeFormationFacing(facing: number): number {
  if (!Number.isFinite(facing)) return FORMATION_FACING_DEFAULT;
  return ((Math.trunc(facing) % FORMATION_FACING_STEPS) + FORMATION_FACING_STEPS) %
    FORMATION_FACING_STEPS;
}

function formationFacingVector(facing: number): { x: number; y: number } {
  const angle = Math.PI / 2 + normalizeFormationFacing(facing) * (Math.PI * 2 / FORMATION_FACING_STEPS);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function formationColumnCount(count: number, mode: number): number {
  const maxColumns = Math.min(FORMATION_MAX_COLUMNS, count);
  if (count <= 2) return count;
  const lineColumns = Math.max(
    2,
    Math.min(maxColumns, count <= 10 ? count : Math.ceil(count / 2))
  );
  const squareColumns = Math.max(
    2,
    Math.min(maxColumns, Math.ceil(Math.sqrt(count)))
  );
  if (mode === FORMATION_MODE_COMPACT) return squareColumns;
  return lineColumns;
}

function formationSpacing(mode: number): number {
  switch (mode) {
    case FORMATION_MODE_LINE: return 1.45;
    case FORMATION_MODE_COMPACT: return 1.04;
    default: return 1.2;
  }
}

function formationRank(world: SimWorld, eid: number): number {
  if (hasComponent(world.ecs, ScoutCavalryTag, eid)) return 0;
  if (hasComponent(world.ecs, SpearmanTag, eid)) return 1;
  if (hasComponent(world.ecs, VillagerTag, eid)) return 2;
  if (hasComponent(world.ecs, ArcherTag, eid)) return 3;
  if (hasComponent(world.ecs, MachineGunTag, eid)) return 4;
  return 4;
}

function findFormationDestination(
  world: SimWorld,
  desired: GridPos,
  reserved: Set<string>
): GridPos | null {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = desired.x + dx;
        const y = desired.y + dy;
        const key = `${x},${y}`;
        if (reserved.has(key)) continue;
        if (!canUnitOccupy(world, x, y)) continue;
        if (findResourceAt(world, x, y, 0.6) !== null) continue;
        reserved.add(key);
        return { x, y };
      }
    }
  }
  return null;
}

function applyGatherSelected(world: SimWorld, targetEid: number): void {
  applyGatherCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), targetEid);
}

function applyGatherCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  targetEid: number
): void {
  if (!hasComponent(world.ecs, Resource, targetEid)) return;
  if (Resource.amount[targetEid] <= 0) return;

  const kind = Resource.kind[targetEid] as ResourceKind;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    if (!hasComponent(world.ecs, Gatherer, eid)) continue;
    clearCombatOrders(world, eid);
    if (
      ResourceCarry.amount[eid] > 0 &&
      ResourceCarry.kind[eid] !== kind
    ) {
      // Force a drop-off run first; gathering system will route us to TC.
      Gatherer.targetEid[eid] = targetEid;
      Gatherer.state[eid] = GathererStateId.RETURNING;
      Gatherer.cooldown[eid] = 0;
      routeToNearestDropOff(world, eid);
      continue;
    }
    startGatheringResource(world, eid, targetEid);
  }
}

function applyStopSelected(world: SimWorld): void {
  applyStopCommand(world, LOCAL_PLAYER_ID, commandableSelection(world));
}

function applyStopCommand(world: SimWorld, playerId: number, eids: number[]): void {
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
    clearCombatOrders(world, eid);
    clearWorkOrders(world, eid);
    setUnitHoldAnchor(world, eid);
  }
}

function applyToggleSelectedUnitStance(world: SimWorld): void {
  applyToggleStanceCommand(world, LOCAL_PLAYER_ID, commandableSelection(world));
}

function applyToggleStanceCommand(world: SimWorld, playerId: number, eids: number[]): void {
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    hasComponent(world.ecs, UnitStance, eid)
  );
  if (units.length === 0) return;

  const allHolding = units.every((eid) =>
    UnitStance.stance[eid] === UnitStanceId.HOLD_POSITION
  );
  const nextStance = allHolding
    ? UnitStanceId.AUTO_DEFEND
    : UnitStanceId.HOLD_POSITION;

  for (const eid of units) {
    UnitStance.stance[eid] = nextStance;
    if (nextStance === UnitStanceId.HOLD_POSITION) {
      setUnitHoldAnchor(world, eid);
      clearNonExplicitCombatTarget(world, eid);
    }
  }
}

/** SP convenience: set the local player's selected units' stance. */
function applySetSelectedUnitStance(world: SimWorld, stance: UnitStanceValue): void {
  applySetStanceCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), stance);
}

/** Network-safe stance set: only the player's own stance-capable eids. */
function applySetStanceCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  stance: UnitStanceValue
): void {
  if (stance !== UnitStanceId.AUTO_DEFEND && stance !== UnitStanceId.HOLD_POSITION) return;
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    hasComponent(world.ecs, UnitStance, eid)
  );
  if (units.length === 0) return;

  for (const eid of units) {
    UnitStance.stance[eid] = stance;
    if (stance === UnitStanceId.HOLD_POSITION) {
      setUnitHoldAnchor(world, eid);
      clearNonExplicitCombatTarget(world, eid);
    }
  }
}

/** SP convenience: nudge the local player's formation mode by delta. */
function applyAdjustFormationMode(world: SimWorld, delta: number): void {
  applyAdjustFormationModeCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), delta);
}

function applyAdjustFormationModeCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  delta: number
): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  applySetFormationModeCommand(world, playerId, eids, playerFormationMode(world, playerId) + delta);
}

/** SP convenience: set the local player's formation mode. */
function applySetFormationMode(world: SimWorld, mode: number): void {
  applySetFormationModeCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), mode);
}

/** Network-safe: set a player's own formation mode, then re-pack their group. */
function applySetFormationModeCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  mode: number
): void {
  world.formationModes[playerId] = clampFormationMode(mode);
  applyReformFormationCommand(world, playerId, eids);
}

/** SP convenience: rotate the local player's formation facing by delta. */
function applyRotateSelectedFormation(world: SimWorld, delta: number): void {
  applyRotateFormationCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), delta);
}

/** Network-safe: rotate a player's own formation facing, then re-pack. */
function applyRotateFormationCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  delta: number
): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  world.formationFacings[playerId] = normalizeFormationFacing(
    playerFormationFacing(world, playerId) + delta
  );
  applyReformFormationCommand(world, playerId, eids);
}

function clearNonExplicitCombatTarget(world: SimWorld, eid: number): void {
  if (!hasComponent(world.ecs, AttackTarget, eid)) return;
  if (AttackTarget.targetEid[eid] < 0) return;
  if (AttackTarget.retainGoal[eid] === 1) return;

  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  world.paths.delete(eid);
  world.cannonWindups.delete(eid);
}

function applyRemoveSelectedBuildings(world: SimWorld, playerId: number): void {
  for (const eid of selectedQuery(world.ecs)) {
    if (!isRemovableBuilding(world, eid, playerId)) continue;
    markWorksiteWorkersDead(world, eid);
    addComponent(world.ecs, DeadTag, eid);
  }
}

/** Self-describing (network-safe) building removal: the sender resolves the
 *  exact building eids, and we validate ownership here so a peer can replay it
 *  identically. Ascending eid order keeps the mutation order deterministic. */
function applyRemoveBuildingsCommand(world: SimWorld, playerId: number, eids: number[]): void {
  for (const eid of [...eids].sort((a, b) => a - b)) {
    if (!isRemovableBuilding(world, eid, playerId)) continue;
    markWorksiteWorkersDead(world, eid);
    addComponent(world.ecs, DeadTag, eid);
  }
}

function isRemovableBuilding(world: SimWorld, eid: number, playerId: number): boolean {
  if (!hasComponent(world.ecs, Building, eid)) return false;
  if (!hasComponent(world.ecs, Owner, eid) || Owner.player[eid] !== playerId) return false;
  if (Health.hp[eid] <= 0) return false;
  return Building.defId[eid] !== BuildingDefId.TOWN_CENTER;
}

function applyPlaceBuilding(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): void {
  const def = getBuildingDef(defId);
  if (!def) return;
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return;

  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, def.cost)) return;
  if (!isBuildingUnlocked(world, playerId, defId)) return;

  if (!canPlaceBuildingAt(world, def, x, y)) return;

  spend(bank, def.cost);
  spawnFoundation(world, defId, x, y, playerId);
}

function canPlaceBuildingAt(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number
): boolean {
  if (
    worksiteUsesResourceNodes(def) &&
    findNearestResource(
      world,
      x,
      y,
      def.harvestKind as ResourceKind,
      def.harvestRadius ?? 6
    ) === null
  ) {
    return false;
  }

  const fw = def.footprint.w;
  const fh = def.footprint.h;
  const x0 = x - Math.floor(fw / 2);
  const y0 = y - Math.floor(fh / 2);
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
      if (world.map.walkability[ty][tx] !== 0) return false;
      if (findResourceAt(world, tx, ty, 0.6) !== null) return false;
      if (findBuildingAt(world, tx, ty, 0.01) !== null) return false;
    }
  }
  return true;
}

function applyTrainUnit(
  world: SimWorld,
  atEid: number,
  defId: number,
  count = 1
): void {
  const numericCount = Number.isFinite(count) ? count : 1;
  const requested = Math.max(1, Math.min(5, Math.trunc(numericCount)));
  for (let i = 0; i < requested; i++) {
    if (!applyTrainUnitOnce(world, atEid, defId)) return;
  }
}

function applyTrainUnitOnce(world: SimWorld, atEid: number, defId: number): boolean {
  if (!hasComponent(world.ecs, Producer, atEid)) return false;
  const unitDef = getUnitDef(defId);
  if (!unitDef) return false;
  if (!hasComponent(world.ecs, Building, atEid)) return false;
  const producerDef = getBuildingDef(Building.defId[atEid]);
  if (!producerDef) return false;
  const playerId = Owner.player[atEid];
  const bank = world.resources[playerId];
  if (!bank) return false;
  const queue = world.productionQueues.get(atEid) ?? [];
  const isWorksiteWorker =
    defId === UnitDefId.VILLAGER &&
    hasComponent(world.ecs, ResourceWorksite, atEid);

  if (isWorksiteWorker) {
    const slots = getWorksiteWorkerSlots(world, atEid);
    const occupied = countWorksiteWorkers(world, atEid) + countQueuedWorksiteWorkers(world, atEid);
    if (occupied >= slots) return false;
    if (queue.length >= 2) return false;
    if (!canAfford(bank, unitDef.cost)) return false;
    spend(bank, unitDef.cost);
    queue.push(defId);
    world.productionQueues.set(atEid, queue);
    return true;
  }

  if (unitDef.trainAt !== producerDef.id) return false;
  if (!producerDef.trains.includes(unitDef.id)) return false;
  if (!isUnitUnlocked(world, playerId, defId)) return false;
  if (!canAfford(bank, unitDef.cost)) return false;

  const pop = world.population[playerId];
  // Will the spawned unit exceed cap? (Front-of-queue spawns immediately when ready.)
  // We allow queueing past current cap only if pop.cap can grow (Houses). For
  // simplicity, block queueing if even the existing queue + pop.current >= cap.
  if (pop.current + countQueuedPopCost(world, playerId) + unitDef.popCost > pop.cap) return false;

  spend(bank, unitDef.cost);
  queue.push(defId);
  world.productionQueues.set(atEid, queue);
  return true;
}

function applyCancelProduction(world: SimWorld, atEid: number): void {
  const queue = world.productionQueues.get(atEid);
  if (!queue || queue.length === 0) return;
  // Pop the most recently-queued (back) and refund.
  const cancelled = queue.pop();
  if (cancelled === undefined) return;
  const def = getUnitDef(cancelled);
  if (!def) return;
  const playerId = Owner.player[atEid];
  const bank = world.resources[playerId];
  if (bank) refund(bank, def.cost);
  // If we cancelled the currently-training (front) slot, reset progress.
  if (queue.length === 0) {
    Producer.currentProgress[atEid] = 0;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Systems
// ────────────────────────────────────────────────────────────────────────────

/**
 * Gatherer state machine. Drives the canonical AoE2 villager loop:
 *   IDLE → (assigned) → WALKING_TO → (arrived) → GATHERING →
 *     (full or depleted) → RETURNING → (at drop-off) → DEPOSITING →
 *       (0.5s handoff) → WALKING_TO (if resource alive) or IDLE
 */
function gatheringSystem(world: SimWorld): void {
  const ents = gathererQuery(world.ecs);
  for (const eid of ents) {
    const state = Gatherer.state[eid];
    switch (state) {
      case GathererStateId.IDLE:
        // Nothing to do. Sit still.
        break;

      case GathererStateId.WALKING_TO:
        gatheringWalkingTo(world, eid);
        break;

      case GathererStateId.GATHERING:
        gatheringActive(world, eid);
        break;

      case GathererStateId.RETURNING:
        gatheringReturning(world, eid);
        break;

      case GathererStateId.DEPOSITING:
        // Handled by dropoffSystem, which transitions us forward.
        break;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 22 — Construction
// ────────────────────────────────────────────────────────────────────────────

function constructionSystem(world: SimWorld): void {
  const sites = foundationQuery(world.ecs);
  for (const siteEid of sites) {
    const total = Math.max(1, ConstructionSite.totalTicks[siteEid]);
    ConstructionSite.progress[siteEid] += 1;
    const frac = Math.min(1, ConstructionSite.progress[siteEid] / total);
    Health.hp[siteEid] = Math.max(1, Math.floor(Health.hpMax[siteEid] * frac));
    if (ConstructionSite.progress[siteEid] >= total) {
      finaliseBuilding(world, siteEid);
    }
  }
}

function finaliseBuilding(world: SimWorld, siteEid: number): void {
  const defId = ConstructionSite.defId[siteEid];
  const def = getBuildingDef(defId);
  if (!def) return;
  const playerId = Owner.player[siteEid];
  pushSoundCue(world, 'build_complete', Position.x[siteEid], Position.y[siteEid], playerId);

  removeComponent(world.ecs, ConstructionSite, siteEid);
  removeComponent(world.ecs, FoundationTag, siteEid);

  // Attach role-specific components based on the def.
  if (def.isDropOff) {
    addComponent(world.ecs, DropOff, siteEid);
    DropOff.acceptsMask[siteEid] = def.dropOffMask;
  }
  if (def.trains.length > 0 || def.harvestKind !== undefined) {
    addComponent(world.ecs, Producer, siteEid);
    Producer.currentProgress[siteEid] = 0;
  }
  if (def.harvestKind !== undefined) {
    addComponent(world.ecs, ResourceWorksite, siteEid);
    ResourceWorksite.kind[siteEid] = def.harvestKind;
    ResourceWorksite.assignedWorkers[siteEid] = 0;
    ResourceWorksite.freeWorkersSpawned[siteEid] = 0;
    ResourceWorksite.progress[siteEid] = 0;
    trySpawnInitialWorksiteWorker(world, siteEid);
  }
  if (defId === BuildingDefId.TOWN_CENTER) {
    addComponent(world.ecs, TownCenterTag, siteEid);
  }
  attachBuildingCombat(world, siteEid, def);
  // Heal foundation up to full HP on completion.
  Health.hp[siteEid] = def.hp;
  Health.hpMax[siteEid] = def.hp;
  // Apply pop cap bonus.
  const popProvided = getBuildingPopProvided(world, playerId, defId);
  if (popProvided > 0) recalculatePlayerPopCap(world, playerId);
}

function attachBuildingCombat(world: SimWorld, eid: number, def: BuildingDef): void {
  if (!def.combat) return;
  addComponent(world.ecs, Combat, eid);
  addComponent(world.ecs, AttackTarget, eid);
  addComponent(world.ecs, Cooldown, eid);
  Combat.atk[eid] = def.combat.atk;
  Combat.range[eid] = def.combat.range;
  Combat.attackSpeedTicks[eid] = def.combat.attackSpeedTicks;
  Combat.aggroRadius[eid] = def.combat.aggroRadius;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  Cooldown.ticksRemaining[eid] = 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 23 — Automatic resource buildings
// ────────────────────────────────────────────────────────────────────────────

function resourceWorksiteSystem(world: SimWorld): void {
  const sites = resourceWorksiteQuery(world.ecs);
  for (const siteEid of sites) {
    if (hasComponent(world.ecs, ConstructionSite, siteEid)) continue;
    if (Health.hp[siteEid] <= 0) continue;

    const def = getBuildingDef(Building.defId[siteEid]);
    if (!def || def.harvestKind === undefined) continue;

    trySpawnInitialWorksiteWorker(world, siteEid);
    ResourceWorksite.assignedWorkers[siteEid] = countWorksiteWorkers(world, siteEid);

    const kind = def.harvestKind as ResourceKind;
    const radius = def.harvestRadius ?? 6;
    if (Building.defId[siteEid] === BuildingDefId.FARM) {
      runFarmWorksite(world, siteEid, def);
      continue;
    }
    if (!worksiteUsesResourceNodes(def)) {
      runSelfProducingWorksite(world, siteEid, def, kind);
      continue;
    }

    const target = findNearestResource(
      world,
      Position.x[siteEid],
      Position.y[siteEid],
      kind,
      radius
    );
    if (target === null) {
      continue;
    }

    assignWorksiteHarvestOrders(world, siteEid, kind, radius);
  }
}

function worksiteUsesResourceNodes(def: BuildingDef): boolean {
  return def.harvestKind !== undefined && def.requiresNearbyResource !== false;
}

function runFarmWorksite(world: SimWorld, siteEid: number, def: BuildingDef): void {
  const workTicks = farmWorkCycleTicks(world, siteEid, def);
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    Gatherer.targetEid[worker] = siteEid;
    if (ResourceCarry.amount[worker] > 0) {
      ResourceCarry.kind[worker] = ResourceKindId.FOOD;
    }
    if (
      ResourceCarry.amount[worker] >= VILLAGER_CARRY_CAPACITY ||
      Gatherer.state[worker] === GathererStateId.RETURNING ||
      Gatherer.state[worker] === GathererStateId.DEPOSITING
    ) {
      if (Gatherer.state[worker] !== GathererStateId.DEPOSITING) {
        Gatherer.state[worker] = GathererStateId.RETURNING;
        routeToNearestDropOff(world, worker);
      }
      continue;
    }

    if (Gatherer.state[worker] === GathererStateId.BUILDING) {
      const dist = distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid);
      if (dist > FARM_WORK_EDGE_DISTANCE) {
        routeFarmWorkerToNextPatch(world, worker, siteEid);
        continue;
      }
      if (Gatherer.cooldown[worker] > 0) {
        Gatherer.cooldown[worker] -= 1;
        continue;
      }
      ResourceCarry.kind[worker] = ResourceKindId.FOOD;
      ResourceCarry.amount[worker] = Math.min(
        VILLAGER_CARRY_CAPACITY,
        ResourceCarry.amount[worker] + farmFoodPerWorkCycle(world, siteEid)
      );
      if (ResourceCarry.amount[worker] >= VILLAGER_CARRY_CAPACITY) {
        Gatherer.state[worker] = GathererStateId.RETURNING;
        routeToNearestDropOff(world, worker);
      } else {
        routeFarmWorkerToNextPatch(world, worker, siteEid);
      }
      continue;
    }

    const atFarmEdge =
      distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid) <=
      FARM_WORK_EDGE_DISTANCE;
    if (Gatherer.state[worker] === GathererStateId.WALKING_TO_BUILD && world.paths.has(worker)) {
      continue;
    }
    if (Gatherer.state[worker] === GathererStateId.WALKING_TO_BUILD && atFarmEdge) {
      world.paths.delete(worker);
      Gatherer.state[worker] = GathererStateId.BUILDING;
      Gatherer.cooldown[worker] = workTicks;
      continue;
    }
    if (Gatherer.state[worker] !== GathererStateId.WALKING_TO_BUILD || !world.paths.has(worker)) {
      if (!routeFarmWorkerToNextPatch(world, worker, siteEid) && atFarmEdge) {
        Gatherer.state[worker] = GathererStateId.BUILDING;
        Gatherer.cooldown[worker] = workTicks;
      }
    }
  }
}

function farmWorkCycleTicks(_world: SimWorld, _siteEid: number, def: BuildingDef): number {
  const base = Math.max(FARM_WORK_CYCLE_TICKS, def.harvestRateTicks ?? FARM_WORK_CYCLE_TICKS);
  return Math.max(FARM_MIN_WORK_CYCLE_TICKS, base);
}

function farmFoodPerWorkCycle(world: SimWorld, siteEid: number): number {
  const playerId = Owner.player[siteEid];
  if (hasTech(world, playerId, TechId.FARMS_II)) return FARM_YIELDS_II_FOOD_PER_WORK_CYCLE;
  if (hasTech(world, playerId, TechId.FARMS)) return FARM_YIELDS_I_FOOD_PER_WORK_CYCLE;
  return FARM_BASE_FOOD_PER_WORK_CYCLE;
}

function runSelfProducingWorksite(
  world: SimWorld,
  siteEid: number,
  def: BuildingDef,
  kind: ResourceKind
): void {
  const activeWorkers = assignSelfProducingWorksiteWorkers(world, siteEid);
  if (activeWorkers <= 0) return;
  const bank = world.resources[Owner.player[siteEid]];
  if (!bank) return;

  const rateTicks = worksiteProductionRateTicks(world, siteEid, def, kind);
  ResourceWorksite.progress[siteEid] += activeWorkers;
  while (ResourceWorksite.progress[siteEid] >= rateTicks) {
    ResourceWorksite.progress[siteEid] -= rateTicks;
    bank[kind] += 1;
  }
}

function assignSelfProducingWorksiteWorkers(world: SimWorld, siteEid: number): number {
  let activeWorkers = 0;
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    Gatherer.targetEid[worker] = siteEid;
    ResourceCarry.amount[worker] = 0;
    const dist = distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid);
    if (dist > DROP_OFF_EDGE_DISTANCE) {
      Gatherer.state[worker] = GathererStateId.WALKING_TO_BUILD;
      if (!world.paths.has(worker)) {
        pathToBuildingContact(world, worker, siteEid);
      }
      continue;
    }
    world.paths.delete(worker);
    Gatherer.state[worker] = GathererStateId.BUILDING;
    Gatherer.cooldown[worker] = 0;
    activeWorkers++;
  }
  return activeWorkers;
}

function worksiteProductionRateTicks(
  _world: SimWorld,
  _siteEid: number,
  def: BuildingDef,
  _kind: ResourceKind
): number {
  const base = Math.max(1, def.harvestRateTicks ?? SIM.TICK_HZ);
  return base;
}

function trySpawnInitialWorksiteWorker(world: SimWorld, siteEid: number): void {
  if (ResourceWorksite.freeWorkersSpawned[siteEid] > 0) {
    if (Owner.player[siteEid] !== AI_PLAYER_ID || countWorksiteWorkers(world, siteEid) > 0) return;
    const def = getBuildingDef(Building.defId[siteEid]);
    if (def && worksiteUsesResourceNodes(def) && !aiResourceWorksiteCanStillProduce(world, siteEid, def)) {
      return;
    }
    spawnWorksiteWorker(world, siteEid);
    return;
  }
  const slots = getWorksiteWorkerSlots(world, siteEid);
  if (slots <= 0 || countWorksiteWorkers(world, siteEid) >= slots) {
    ResourceWorksite.freeWorkersSpawned[siteEid] = 1;
    return;
  }
  if (spawnWorksiteWorker(world, siteEid) !== null) {
    ResourceWorksite.freeWorkersSpawned[siteEid] = 1;
  }
}

function spawnWorksiteWorker(world: SimWorld, siteEid: number): number | null {
  let current = countWorksiteWorkers(world, siteEid);
  const offsets = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let attempt = 0; attempt < offsets.length; attempt++) {
    const [dx, dy] = offsets[current % offsets.length];
    const spot = findSpawnSpot(
      world,
      Position.x[siteEid] + dx,
      Position.y[siteEid] + dy,
      4
    );
    current++;
    if (!spot) continue;
    const worker = spawnVillager(world, spot.x, spot.y, Owner.player[siteEid], 0);
    addComponent(world.ecs, WorksiteWorker, worker);
    WorksiteWorker.siteEid[worker] = siteEid;
    return worker;
  }
  return null;
}

function countWorksiteWorkers(world: SimWorld, siteEid: number): number {
  let count = 0;
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    count++;
  }
  return count;
}

function countQueuedWorksiteWorkers(world: SimWorld, siteEid: number): number {
  const queue = world.productionQueues.get(siteEid);
  if (!queue) return 0;
  return queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
}

export function getWorksiteWorkerSlots(world: SimWorld, siteEid: number): number {
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return 0;
  const def = getBuildingDef(Building.defId[siteEid]);
  const baseSlots = def?.workerSlots ?? 1;
  return Math.min(
    baseSlots,
    worksiteWorkerSlotsForKind(
      world,
      Owner.player[siteEid],
      ResourceWorksite.kind[siteEid]
    )
  );
}

function assignWorksiteHarvestOrders(
  world: SimWorld,
  siteEid: number,
  kind: ResourceKind,
  radius: number
): void {
  const claimedTargets = countClaimedWorksiteResourceTargets(world, siteEid, kind);
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    if (ResourceCarry.amount[worker] > 0) {
      const dropOff = findNearestDropOffEid(world, worker);
      if (dropOff !== null && Gatherer.state[worker] === GathererStateId.IDLE) {
        Gatherer.state[worker] = GathererStateId.RETURNING;
        routeToNearestDropOff(world, worker);
      }
      continue;
    }
    const targetValid =
      Gatherer.targetEid[worker] >= 0 &&
      hasComponent(world.ecs, Resource, Gatherer.targetEid[worker]) &&
      Resource.kind[Gatherer.targetEid[worker]] === kind &&
      Resource.amount[Gatherer.targetEid[worker]] > 0;
    if (targetValid && Gatherer.state[worker] !== GathererStateId.IDLE) {
      const target = Gatherer.targetEid[worker];
      const stalled =
        Gatherer.state[worker] === GathererStateId.WALKING_TO &&
        !world.paths.has(worker) &&
        Math.hypot(Position.x[worker] - Position.x[target], Position.y[worker] - Position.y[target]) >
          RESOURCE_GATHER_DISTANCE;
      const duplicateTarget = (claimedTargets.get(target) ?? 0) > 1;
      if (!stalled && !duplicateTarget) continue;
      if (duplicateTarget) {
        claimedTargets.set(target, (claimedTargets.get(target) ?? 1) - 1);
      }
    }

    const avoidedTargets = new Set<number>();
    for (const [target, count] of claimedTargets) {
      if (count > 0) avoidedTargets.add(target);
    }
    if (routeToNearestReachableResource(
      world,
      worker,
      kind,
      radius,
      Position.x[siteEid],
      Position.y[siteEid],
      avoidedTargets
    )) {
      const assignedTarget = Gatherer.targetEid[worker];
      if (assignedTarget >= 0) {
        claimedTargets.set(assignedTarget, (claimedTargets.get(assignedTarget) ?? 0) + 1);
      }
    }
  }
}

function countClaimedWorksiteResourceTargets(
  world: SimWorld,
  siteEid: number,
  kind: ResourceKind
): Map<number, number> {
  const claimed = new Map<number, number>();
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    if (Health.hp[worker] <= 0) continue;
    if (ResourceCarry.amount[worker] > 0) continue;
    if (Gatherer.state[worker] === GathererStateId.IDLE) continue;
    const target = Gatherer.targetEid[worker];
    if (
      target < 0 ||
      !hasComponent(world.ecs, Resource, target) ||
      Resource.kind[target] !== kind ||
      Resource.amount[target] <= 0
    ) {
      continue;
    }
    claimed.set(target, (claimed.get(target) ?? 0) + 1);
  }
  return claimed;
}

function forestRegrowthSystem(world: SimWorld): void {
  if (world.tick === 0 || world.tick % TREE_REGEN_INTERVAL_TICKS !== 0) return;
  if (countWoodNodes(world) >= TREE_REGEN_MAX_WOOD_NODES) return;

  for (let i = 0; i < TREE_REGEN_CANDIDATES_PER_PASS; i++) {
    if (countWoodNodes(world) >= TREE_REGEN_MAX_WOOD_NODES) return;

    const x = world.rng.int(MAP.WIDTH);
    const y = world.rng.int(MAP.HEIGHT);
    if (!canTreeGrowAt(world, x, y, TREE_REGEN_BUILDING_CLEARANCE)) continue;

    const nearbyTrees = countNearbyTrees(world, x, y, TREE_REGEN_RADIUS);
    const tile = world.map.tiles[y * MAP.WIDTH + x];
    const forestTileBonus = tile === TileType.FOREST || tile === TileType.SNOW_FOREST ? 1 : 0;
    const edgeBonus = edgeProximity01(x, y) * TREE_REGEN_EDGE_PRESSURE_BONUS;
    const growthPressure = nearbyTrees + forestTileBonus + edgeBonus;
    if (growthPressure <= 0) continue;

    const chance = Math.min(
      TREE_REGEN_MAX_CHANCE,
      TREE_REGEN_BASE_CHANCE + growthPressure * TREE_REGEN_CHANCE_PER_NEARBY_TREE
    );
    if (world.rng.next() < chance) {
      trySpawnTreeAt(
        world,
        x,
        y,
        REGENERATED_TREE_AMOUNT,
        TREE_REGEN_BUILDING_CLEARANCE
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 21 — Production
// ────────────────────────────────────────────────────────────────────────────

function productionSystem(world: SimWorld): void {
  const ents = producerQuery(world.ecs);
  for (const eid of ents) {
    const queue = world.productionQueues.get(eid);
    if (!queue || queue.length === 0) {
      Producer.currentProgress[eid] = 0;
      continue;
    }
    const trainingDefId = queue[0];
    const def = getUnitDef(trainingDefId);
    if (!def) {
      queue.shift();
      continue;
    }
    Producer.currentProgress[eid] += 1;
    if (Producer.currentProgress[eid] >= def.trainTimeTicks) {
      if (
        trainingDefId === UnitDefId.VILLAGER &&
        hasComponent(world.ecs, ResourceWorksite, eid)
      ) {
        const slots = getWorksiteWorkerSlots(world, eid);
        const bank = world.resources[Owner.player[eid]];
        if (countWorksiteWorkers(world, eid) >= slots) {
          if (bank) refund(bank, def.cost);
          queue.shift();
          Producer.currentProgress[eid] = 0;
          continue;
        }
        const worker = spawnWorksiteWorker(world, eid);
        if (worker !== null) {
          queue.shift();
          Producer.currentProgress[eid] = 0;
        } else {
          Producer.currentProgress[eid] = def.trainTimeTicks;
        }
        continue;
      }

      // Spawn unit at rally point (south of the building for now).
      const px = Position.x[eid];
      const py = Position.y[eid];
      // Find a free tile near building.
      const candidates: GridPos[] = [
        { x: px + 1, y: py + 1 },
        { x: px - 1, y: py + 1 },
        { x: px + 1, y: py - 1 },
        { x: px - 1, y: py - 1 },
        { x: px, y: py + 2 },
        { x: px + 2, y: py },
      ];
      // Find a walkable spawn location near the producer. Spawning inside a
      // blocked tile (e.g. the producer's own 3×3 footprint) traps the new
      // unit at a blocked start, so pathfinding from it fails silently.
      let spawnedEid: number | null = null;
      for (const c of candidates) {
        const spot = findSpawnSpot(world, c.x, c.y, 4);
        if (!spot) continue;
        if (trainingDefId === UnitDefId.VILLAGER) {
          spawnedEid = spawnVillager(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.ARCHER) {
          spawnedEid = spawnArcher(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.SPEARMAN) {
          spawnedEid = spawnSpearman(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.SCOUT_CAVALRY) {
          spawnedEid = spawnScoutCavalry(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.GUNMAN) {
          spawnedEid = spawnGunman(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.CANNON) {
          spawnedEid = spawnCannon(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.MACHINE_GUN) {
          spawnedEid = spawnMachineGun(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        if (trainingDefId === UnitDefId.MORTAR) {
          spawnedEid = spawnMortar(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
      }
      if (spawnedEid !== null) {
        pushSoundCue(world, 'unit_ready', Position.x[eid], Position.y[eid], Owner.player[eid]);
        issueProductionRallyOrder(world, eid, spawnedEid);
        queue.shift();
        Producer.currentProgress[eid] = 0;
      } else {
        // Pop blocked — try again next tick.
        Producer.currentProgress[eid] = def.trainTimeTicks; // pin at full
      }
    }
  }
}

function issueProductionRallyOrder(
  world: SimWorld,
  producerEid: number,
  unitEid: number
): void {
  if (!hasComponent(world.ecs, Building, producerEid)) return;
  if (!isArmyProducerDefId(Building.defId[producerEid])) return;
  const playerId = Owner.player[producerEid];
  const rally = world.armyRallyPoints[playerId];
  if (!rally) return;
  if (!isMovableEntity(world, unitEid)) return;
  pathTo(world, unitEid, rally.x, rally.y);
}

function isArmyProducerDefId(defId: number): boolean {
  return defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY;
}

// ────────────────────────────────────────────────────────────────────────────
// 50/51/70/71 — Combat
// ────────────────────────────────────────────────────────────────────────────

interface TargetScore {
  priority: number;
  distance: number;
  hpFrac: number;
  eid: number;
}

function findBestAutoTarget(
  world: SimWorld,
  attacker: number,
  aggro: number,
  targetAllowed: (target: number) => boolean = () => true
): number {
  const maxDistance = isMovableEntity(world, attacker)
    ? aggro + ATTACK_RANGE_TOLERANCE
    : Combat.range[attacker] + ATTACK_RANGE_TOLERANCE;
  let best: TargetScore | null = null;
  for (const target of damageableQuery(world.ecs)) {
    if (!isValidHostileTarget(world, attacker, target)) continue;
    if (!targetAllowed(target)) continue;
    const distance = distanceToAttackTarget(world, attacker, target);
    if (distance > maxDistance) continue;
    const score = targetScore(world, attacker, target, distance);
    if (!best || compareTargetScore(score, best) < 0) {
      best = score;
    }
  }
  return best?.eid ?? -1;
}

function isValidHostileTarget(world: SimWorld, attacker: number, target: number): boolean {
  if (attacker === target) return false;
  if (!hasComponent(world.ecs, Owner, attacker)) return false;
  if (!hasComponent(world.ecs, Owner, target)) return false;
  if (Owner.player[target] === Owner.player[attacker]) return false;
  if (Owner.player[target] === 0) return false;
  if (!hasComponent(world.ecs, Health, target) || Health.hp[target] <= 0) return false;
  if (Owner.player[attacker] === LOCAL_PLAYER_ID) {
    return isEntityVisibleTo(world, LOCAL_PLAYER_ID, target);
  }
  return true;
}

function targetScore(
  world: SimWorld,
  attacker: number,
  target: number,
  distance: number
): TargetScore {
  const isUnit = hasComponent(world.ecs, UnitKind, target);
  const isArmed = hasComponent(world.ecs, Combat, target) && Combat.atk[target] > 0;
  const isTargetingAttacker =
    hasComponent(world.ecs, AttackTarget, target) &&
    AttackTarget.targetEid[target] === attacker;
  const priority = isTargetingAttacker
    ? 0
    : isUnit && isArmed
      ? 1
      : isUnit
        ? 2
        : isArmed
          ? 3
          : 4;
  const hpMax = Math.max(1, Health.hpMax[target]);
  return {
    priority,
    distance,
    hpFrac: Health.hp[target] / hpMax,
    eid: target,
  };
}

function compareTargetScore(a: TargetScore, b: TargetScore): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (Math.abs(a.distance - b.distance) > 0.001) return a.distance - b.distance;
  if (Math.abs(a.hpFrac - b.hpFrac) > 0.001) return a.hpFrac - b.hpFrac;
  return a.eid - b.eid;
}

function distanceToAttackTarget(world: SimWorld, attacker: number, target: number): number {
  return hasComponent(world.ecs, Building, target)
    ? distToBuildingEdge(world, Position.x[attacker], Position.y[attacker], target)
    : Math.hypot(
        Position.x[attacker] - Position.x[target],
        Position.y[attacker] - Position.y[target]
      );
}

function isTargetInAttackRange(world: SimWorld, attacker: number, target: number): boolean {
  return distanceToAttackTarget(world, attacker, target) <=
    Combat.range[attacker] + ATTACK_RANGE_TOLERANCE;
}

function isHoldPositionStance(world: SimWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, UnitStance, eid) &&
    UnitStance.stance[eid] === UnitStanceId.HOLD_POSITION
  );
}

function isMeleeHoldPositionUnit(world: SimWorld, eid: number): boolean {
  return isMovableEntity(world, eid) && Combat.range[eid] <= 1.25;
}

function holdPositionAutoSearchRadius(world: SimWorld, eid: number): number {
  return isMeleeHoldPositionUnit(world, eid)
    ? HOLD_POSITION_MELEE_LEASH_TILES + Combat.range[eid]
    : Combat.range[eid];
}

function isHoldPositionTargetAllowed(world: SimWorld, eid: number, target: number): boolean {
  if (isTargetInAttackRange(world, eid, target)) return true;
  if (!isMeleeHoldPositionUnit(world, eid)) return false;

  const anchorX = UnitStance.anchorX[eid];
  const anchorY = UnitStance.anchorY[eid];
  const anchorToTarget = distToBuildingEdge(world, anchorX, anchorY, target);
  return anchorToTarget <=
    HOLD_POSITION_MELEE_LEASH_TILES + Combat.range[eid] + ATTACK_RANGE_TOLERANCE;
}

function canHoldPositionMoveToTarget(world: SimWorld, eid: number, target: number): boolean {
  if (!isMeleeHoldPositionUnit(world, eid)) return false;
  if (!isHoldPositionTargetAllowed(world, eid, target)) return false;
  const distanceFromAnchor = Math.hypot(
    Position.x[eid] - UnitStance.anchorX[eid],
    Position.y[eid] - UnitStance.anchorY[eid]
  );
  return distanceFromAnchor <=
    HOLD_POSITION_MELEE_LEASH_TILES + HOLD_POSITION_MELEE_LEASH_BUFFER;
}

function targetingSystem(world: SimWorld): void {
  const ents = combatQuery(world.ecs);
  for (const eid of ents) {
    if (Health.hp[eid] <= 0) continue;
    const cur = AttackTarget.targetEid[eid];
    const aggro = Combat.aggroRadius[eid];
    const holdPosition = isHoldPositionStance(world, eid);
    const attackMoving =
      hasComponent(world.ecs, AttackMoveGoal, eid) &&
      AttackMoveGoal.active[eid] === 1;
    const targetValid =
      cur >= 0 &&
      hasComponent(world.ecs, Health, cur) &&
      Health.hp[cur] > 0;

    if (targetValid) {
      // Apply a leash: aggro-acquired targets are dropped if they wander too
      // far. Explicit attack orders (AttackMoveGoal.active=0 + retainGoal=0)
      // also leash; only retainGoal=1 explicit-attack persists indefinitely.
      const explicitOrder = AttackTarget.retainGoal[eid] === 1;
      if (holdPosition && !explicitOrder && !attackMoving) {
        if (isHoldPositionTargetAllowed(world, eid, cur)) {
          if (isTargetInAttackRange(world, eid, cur)) world.paths.delete(eid);
          continue;
        }
        clearNonExplicitCombatTarget(world, eid);
      } else if (!explicitOrder && aggro > 0) {
        const dist = distanceToAttackTarget(world, eid, cur);
        // Leash = 2× aggro radius. Stops "infinite chase" from one slip of vision.
        if (dist > aggro * 2) {
          AttackTarget.targetEid[eid] = -1;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    AttackTarget.targetEid[eid] = -1;

    // Once we have no target, decide whether to auto-aggro or resume an
    // attack-move destination.
    if (aggro === 0) {
      // Non-aggressors (villagers) just stop chasing.
      continue;
    }

    // Suppress aggro re-acquisition while the unit is executing a manual
    // move order. Without this, the moment we clear AttackTarget in
    // `applyMoveSelected`, this system would auto-acquire the same enemy
    // again on the next tick and the player's move command would feel like
    // it did nothing. We detect manual-move as: has an active path AND
    // attack-move goal is NOT active.
    const onManualMove =
      world.paths.has(eid) &&
      !attackMoving;
    if (onManualMove) continue;

    const searchRadius = holdPosition && !attackMoving
      ? holdPositionAutoSearchRadius(world, eid)
      : aggro;
    const bestEid = findBestAutoTarget(
      world,
      eid,
      searchRadius,
      holdPosition && !attackMoving
        ? (target) => isHoldPositionTargetAllowed(world, eid, target)
        : undefined
    );
    if (bestEid >= 0) {
      const inRange = isTargetInAttackRange(world, eid, bestEid);
      const canMoveIntoRange =
        (holdPosition && !attackMoving
          ? canHoldPositionMoveToTarget(world, eid, bestEid)
          : isMovableEntity(world, eid)) &&
        pathTo(world, eid, Position.x[bestEid], Position.y[bestEid]);
      const canEngage = inRange || canMoveIntoRange;
      if (canEngage) {
        AttackTarget.targetEid[eid] = bestEid;
        clearFormationSpeedCap(world, eid);
      }
    } else if (
      hasComponent(world.ecs, AttackMoveGoal, eid) &&
      AttackMoveGoal.active[eid] === 1
    ) {
      // No enemy in aggro range — resume marching toward the attack-move
      // destination. Once we arrive (path empty), we clear active in
      // movement / above on next eval.
      const gx = AttackMoveGoal.x[eid];
      const gy = AttackMoveGoal.y[eid];
      const arrived =
        Math.hypot(Position.x[eid] - gx, Position.y[eid] - gy) < 0.6;
      if (arrived) {
        AttackMoveGoal.active[eid] = 0;
      } else if (!world.paths.has(eid)) {
        if (!pathTo(world, eid, gx, gy)) {
          AttackMoveGoal.active[eid] = 0;
        }
      }
    }
  }
}

function combatSystem(world: SimWorld): void {
  const ents = combatQuery(world.ecs);
  for (const eid of ents) {
    if (Cooldown.ticksRemaining[eid] > 0) {
      Cooldown.ticksRemaining[eid] -= 1;
    }
    if (Health.hp[eid] <= 0) continue;
    if (usesSiegeWindup(world, eid) && processCannonWindup(world, eid)) {
      continue;
    }
    if (hasComponent(world.ecs, MachineGunTag, eid) && !processMachineGunDeployment(world, eid)) {
      continue;
    }
    const target = AttackTarget.targetEid[eid];
    if (target < 0) continue;
    if (!hasComponent(world.ecs, Health, target) || Health.hp[target] <= 0) {
      AttackTarget.targetEid[eid] = -1;
      // Also free the path that was chasing this dead target so the unit
      // doesn't keep walking to where it died.
      world.paths.delete(eid);
      continue;
    }
    if (Owner.player[eid] === LOCAL_PLAYER_ID && !isEntityVisibleTo(world, LOCAL_PLAYER_ID, target)) {
      AttackTarget.targetEid[eid] = -1;
      world.paths.delete(eid);
      continue;
    }
    const range = Combat.range[eid];
    // Buildings have a non-trivial footprint — use edge distance so melee
    // units beside a 3×3 TC are correctly "in range" instead of permanently
    // out-of-range against the centre.
    const dist = distanceToAttackTarget(world, eid, target);
    if (dist > range + ATTACK_RANGE_TOLERANCE) {
      if (isMovableEntity(world, eid)) {
        const holdRestricted =
          isHoldPositionStance(world, eid) &&
          AttackTarget.retainGoal[eid] !== 1 &&
          (!hasComponent(world.ecs, AttackMoveGoal, eid) ||
            AttackMoveGoal.active[eid] === 0);
        if (holdRestricted && !canHoldPositionMoveToTarget(world, eid, target)) {
          clearNonExplicitCombatTarget(world, eid);
          continue;
        }
        const path = world.paths.get(eid);
        if (!path || path.length === 0 || dist > range + 2) {
          if (!pathTo(world, eid, Position.x[target], Position.y[target])) {
            AttackTarget.targetEid[eid] = -1;
            world.paths.delete(eid);
          }
        }
      }
      continue;
    }
    // In range — stop moving + attack on cooldown 0.
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
    if (Cooldown.ticksRemaining[eid] > 0) continue;
    if (usesSiegeWindup(world, eid)) {
      startCannonWindup(world, eid, target, range);
      continue;
    }
    if (usesProjectileAttack(world, eid)) {
      fireProjectileAttack(world, eid, target, range);
      continue;
    }
    applyAttackDamage(world, eid, target, computeAttackDamage(world, eid, target));
    Cooldown.ticksRemaining[eid] = Combat.attackSpeedTicks[eid];
    world.combatEvents.push({
      type: 'attack',
      tick: world.tick,
      attackerEid: eid,
      targetEid: target,
      attackerKind: hasComponent(world.ecs, UnitKind, eid) ? UnitKind.kind[eid] : -1,
      range,
      fromX: Position.x[eid],
      fromY: Position.y[eid],
      toX: Position.x[target],
      toY: Position.y[target],
    });
  }
}

function usesProjectileAttack(world: SimWorld, attacker: number): boolean {
  return Combat.range[attacker] > 1 &&
    (
      hasComponent(world.ecs, ArcherTag, attacker) ||
      hasComponent(world.ecs, GunmanTag, attacker) ||
      hasComponent(world.ecs, MachineGunTag, attacker) ||
      hasComponent(world.ecs, Building, attacker)
    );
}

function processMachineGunDeployment(world: SimWorld, eid: number): boolean {
  if (!hasComponent(world.ecs, MachineGunDeployment, eid)) {
    addComponent(world.ecs, MachineGunDeployment, eid);
    MachineGunDeployment.deployed[eid] = 1;
    MachineGunDeployment.setupTicks[eid] = 0;
  }

  const target = AttackTarget.targetEid[eid];
  if (
    target >= 0 &&
    hasComponent(world.ecs, Health, target) &&
    Health.hp[target] > 0 &&
    isTargetInAttackRange(world, eid, target)
  ) {
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
  }

  const path = world.paths.get(eid);
  const isMoving =
    (path !== undefined && path.length > 0) ||
    Math.hypot(Velocity.x[eid], Velocity.y[eid]) > 0.05;

  if (isMoving) {
    MachineGunDeployment.deployed[eid] = 0;
    MachineGunDeployment.setupTicks[eid] = MACHINE_GUN_DEPLOY_TICKS;
    return false;
  }

  if (MachineGunDeployment.setupTicks[eid] > 0) {
    MachineGunDeployment.setupTicks[eid] -= 1;
    MachineGunDeployment.deployed[eid] = 0;
    return false;
  }

  MachineGunDeployment.deployed[eid] = 1;
  return true;
}

function fireProjectileAttack(
  world: SimWorld,
  attacker: number,
  target: number,
  range: number
): void {
  const distance = Math.hypot(
    Position.x[attacker] - Position.x[target],
    Position.y[attacker] - Position.y[target]
  );
  const projectileTicks = projectileTravelTicksForAttack(world, attacker, distance);
  world.pendingProjectileImpacts.push({
    impactTick: world.tick + projectileTicks,
    attackerEid: attacker,
    attackerOwner: Owner.player[attacker],
    targetEid: target,
    damage: computeAttackDamage(world, attacker, target),
  });
  Cooldown.ticksRemaining[attacker] = Combat.attackSpeedTicks[attacker];
  world.combatEvents.push({
    type: 'attack',
    tick: world.tick,
    attackerEid: attacker,
    targetEid: target,
    attackerKind: hasComponent(world.ecs, UnitKind, attacker) ? UnitKind.kind[attacker] : -1,
    range,
    fromX: Position.x[attacker],
    fromY: Position.y[attacker],
    toX: Position.x[target],
    toY: Position.y[target],
    projectileTicks,
  });
}

function processCannonWindup(world: SimWorld, attacker: number): boolean {
  const windup = world.cannonWindups.get(attacker);
  if (!windup) return false;
  const target = windup.targetEid;
  if (!isCannonWindupTargetValid(world, attacker, target)) {
    world.cannonWindups.delete(attacker);
    return true;
  }

  world.paths.delete(attacker);
  clearFormationSpeedCap(world, attacker);
  windup.ticksRemaining -= 1;
  if (windup.ticksRemaining > 0) return true;

  world.cannonWindups.delete(attacker);
  fireCannonShot(world, attacker, target);
  return true;
}

function isCannonWindupTargetValid(world: SimWorld, attacker: number, target: number): boolean {
  if (target < 0) return false;
  if (!hasComponent(world.ecs, Health, target) || Health.hp[target] <= 0) return false;
  if (Owner.player[attacker] === LOCAL_PLAYER_ID && !isEntityVisibleTo(world, LOCAL_PLAYER_ID, target)) {
    return false;
  }
  return distanceToAttackTarget(world, attacker, target) <=
    Combat.range[attacker] + ATTACK_RANGE_TOLERANCE;
}

/** Cannons and mortars share the wind-up → splash-impact pipeline. */
function usesSiegeWindup(world: SimWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, CannonTag, eid) ||
    hasComponent(world.ecs, MortarTag, eid)
  );
}

function startCannonWindup(world: SimWorld, attacker: number, target: number, range: number): void {
  const isMortar = hasComponent(world.ecs, MortarTag, attacker);
  const windupTicks = isMortar ? MORTAR_WINDUP_TICKS : CANNON_WINDUP_TICKS;
  world.cannonWindups.set(attacker, {
    targetEid: target,
    ticksRemaining: windupTicks,
  });
  world.combatEvents.push({
    type: 'attack',
    tick: world.tick,
    attackerEid: attacker,
    targetEid: target,
    attackerKind: isMortar ? UnitDefId.MORTAR : UnitDefId.CANNON,
    range,
    fromX: Position.x[attacker],
    fromY: Position.y[attacker],
    toX: Position.x[target],
    toY: Position.y[target],
    phase: 'windup',
    windupTicks,
  });
}

function fireCannonShot(world: SimWorld, attacker: number, target: number): void {
  const isMortar = hasComponent(world.ecs, MortarTag, attacker);
  const dist = Math.hypot(Position.x[attacker] - Position.x[target], Position.y[attacker] - Position.y[target]);
  const projectileTicks = isMortar
    ? mortarProjectileTravelTicks(dist)
    : cannonProjectileTravelTicks(dist);
  world.pendingCannonImpacts.push({
    impactTick: world.tick + projectileTicks,
    attackerEid: attacker,
    attackerOwner: Owner.player[attacker],
    impactX: Position.x[target],
    impactY: Position.y[target],
    damage: Combat.atk[attacker],
  });
  Cooldown.ticksRemaining[attacker] = Combat.attackSpeedTicks[attacker];
  world.combatEvents.push({
    type: 'attack',
    tick: world.tick,
    attackerEid: attacker,
    targetEid: target,
    attackerKind: isMortar ? UnitDefId.MORTAR : UnitDefId.CANNON,
    range: Combat.range[attacker],
    fromX: Position.x[attacker],
    fromY: Position.y[attacker],
    toX: Position.x[target],
    toY: Position.y[target],
    phase: 'fire',
    projectileTicks,
  });
}

function projectileTravelTicksForAttack(
  world: SimWorld,
  attacker: number,
  distanceTiles: number
): number {
  if (hasComponent(world.ecs, GunmanTag, attacker)) {
    return projectileTravelTicks(distanceTiles, 70, 160, 24);
  }
  if (hasComponent(world.ecs, MachineGunTag, attacker)) {
    return projectileTravelTicks(distanceTiles, 45, 120, 18);
  }
  return projectileTravelTicks(distanceTiles, 180, 520, 70);
}

function cannonProjectileTravelTicks(distanceTiles: number): number {
  return projectileTravelTicks(distanceTiles, 320, 827, 96);
}

/** Mortar shells hang on a higher, slower arc than a flat cannon shot. */
function mortarProjectileTravelTicks(distanceTiles: number): number {
  return projectileTravelTicks(distanceTiles, 300, 760, 95);
}

function projectileTravelTicks(
  distanceTiles: number,
  minMs: number,
  maxMs: number,
  msPerTile: number
): number {
  const durationMs = Math.max(minMs, Math.min(maxMs, distanceTiles * msPerTile));
  return Math.max(1, Math.round(durationMs / SIM.TICK_MS));
}

function projectileImpactSystem(world: SimWorld): void {
  if (world.pendingProjectileImpacts.length === 0) return;
  const pending: PendingProjectileImpact[] = [];
  for (const impact of world.pendingProjectileImpacts) {
    if (impact.impactTick > world.tick) {
      pending.push(impact);
      continue;
    }
    applyProjectileImpactDamage(world, impact);
  }
  world.pendingProjectileImpacts = pending;
}

function applyProjectileImpactDamage(world: SimWorld, impact: PendingProjectileImpact): void {
  if (
    !hasComponent(world.ecs, Health, impact.targetEid) ||
    Health.hp[impact.targetEid] <= 0 ||
    !hasComponent(world.ecs, Owner, impact.targetEid) ||
    Owner.player[impact.targetEid] === impact.attackerOwner ||
    Owner.player[impact.targetEid] === 0
  ) {
    return;
  }
  Health.hp[impact.targetEid] -= impact.damage;
  retaliateWhenEngaged(world, impact.targetEid, impact.attackerEid);
}

function cannonImpactSystem(world: SimWorld): void {
  if (world.pendingCannonImpacts.length === 0) return;
  const pending: PendingCannonImpact[] = [];
  for (const impact of world.pendingCannonImpacts) {
    if (impact.impactTick > world.tick) {
      pending.push(impact);
      continue;
    }
    applyCannonImpactDamage(world, impact);
  }
  world.pendingCannonImpacts = pending;
}

function applyCannonImpactDamage(world: SimWorld, impact: PendingCannonImpact): void {
  pushSoundCue(world, 'cannon_impact', impact.impactX, impact.impactY, impact.attackerOwner);
  for (const building of buildingQuery(world.ecs)) {
    if (!isValidCannonBuildingVictim(world, impact.attackerOwner, building)) continue;
    if (distToBuildingEdge(world, impact.impactX, impact.impactY, building) > CANNON_BUILDING_DIRECT_HIT_RADIUS) {
      continue;
    }
    Health.hp[building] -= Math.max(
      1,
      Math.ceil(impact.damage * CANNON_BUILDING_DAMAGE_MULTIPLIER) - Health.armor[building]
    );
    retaliateWhenEngaged(world, building, impact.attackerEid);
  }

  for (const victim of unitQuery(world.ecs)) {
    if (!isValidCannonSplashVictim(world, impact.attackerOwner, victim)) continue;
    const distance = Math.hypot(Position.x[victim] - impact.impactX, Position.y[victim] - impact.impactY);
    if (distance > CANNON_SPLASH_MAX_RADIUS) continue;
    Health.hp[victim] -= computeCannonSplashDamage(impact.damage, victim, distance);
    retaliateWhenEngaged(world, victim, impact.attackerEid);
  }
}

function isValidCannonBuildingVictim(
  world: SimWorld,
  attackerOwner: number,
  building: number
): boolean {
  if (!hasComponent(world.ecs, Owner, building)) return false;
  if (Owner.player[building] === attackerOwner) return false;
  if (Owner.player[building] === 0) return false;
  return hasComponent(world.ecs, Health, building) && Health.hp[building] > 0;
}

function isValidCannonSplashVictim(world: SimWorld, attackerOwner: number, victim: number): boolean {
  if (!hasComponent(world.ecs, Owner, victim)) return false;
  if (Owner.player[victim] === attackerOwner) return false;
  if (Owner.player[victim] === 0) return false;
  return hasComponent(world.ecs, Health, victim) && Health.hp[victim] > 0;
}

function computeCannonSplashDamage(baseDamage: number, victim: number, distance: number): number {
  const span = Math.max(0.01, CANNON_SPLASH_MAX_RADIUS - CANNON_SPLASH_FULL_DAMAGE_RADIUS);
  const t = Math.min(1, Math.max(0, (distance - CANNON_SPLASH_FULL_DAMAGE_RADIUS) / span));
  const damageFraction =
    CANNON_SPLASH_MIN_DAMAGE_FRACTION +
    (1 - CANNON_SPLASH_MIN_DAMAGE_FRACTION) *
      Math.pow(1 - t, CANNON_SPLASH_FALLOFF_EXPONENT);
  return Math.max(1, Math.ceil(baseDamage * damageFraction) - Health.armor[victim]);
}

function retaliateWhenEngaged(world: SimWorld, defender: number, attacker: number): void {
  if (defender === attacker) return;
  if (!hasComponent(world.ecs, Position, defender)) return;
  if (!hasComponent(world.ecs, Position, attacker)) return;
  if (!hasComponent(world.ecs, Health, defender) || Health.hp[defender] <= 0) return;
  if (!hasComponent(world.ecs, Health, attacker) || Health.hp[attacker] <= 0) return;
  if (!hasComponent(world.ecs, Owner, defender) || !hasComponent(world.ecs, Owner, attacker)) return;
  if (Owner.player[defender] === Owner.player[attacker]) return;
  if (!hasComponent(world.ecs, Combat, defender)) return;
  if (!hasComponent(world.ecs, AttackTarget, defender)) return;
  if (isHoldPositionStance(world, defender)) return;

  const current = AttackTarget.targetEid[defender];
  if (current === attacker) return;
  const currentIsLivingUnit =
    current >= 0 &&
    hasComponent(world.ecs, UnitKind, current) &&
    hasComponent(world.ecs, Health, current) &&
    Health.hp[current] > 0;
  if (currentIsLivingUnit) return;

  AttackTarget.targetEid[defender] = attacker;
  AttackTarget.retainGoal[defender] = 0;
  if (hasComponent(world.ecs, AttackMoveGoal, defender)) {
    AttackMoveGoal.active[defender] = 0;
  }
  if (hasComponent(world.ecs, Gatherer, defender)) {
    clearWorkOrders(world, defender);
  }
  if (isMovableEntity(world, defender)) {
    if (isTargetInAttackRange(world, defender, attacker)) {
      world.paths.delete(defender);
      clearFormationSpeedCap(world, defender);
    } else {
      pathTo(world, defender, Position.x[attacker], Position.y[attacker]);
    }
  }
}

function applyAttackDamage(
  world: SimWorld,
  attacker: number,
  target: number,
  damage: number
): void {
  Health.hp[target] -= damage;
  retaliateWhenEngaged(world, target, attacker);
}

function computeAttackDamage(world: SimWorld, attacker: number, target: number): number {
  let bonus = 0;
  if (
    hasComponent(world.ecs, SpearmanTag, attacker) &&
    hasComponent(world.ecs, ScoutCavalryTag, target)
  ) {
    bonus += 13;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, ArcherTag, target)
  ) {
    bonus += 4;
  }
  if (
    hasComponent(world.ecs, ArcherTag, attacker) &&
    hasComponent(world.ecs, SpearmanTag, target)
  ) {
    bonus += 2;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, CannonTag, target)
  ) {
    bonus += 10;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, MachineGunTag, target)
  ) {
    bonus += 8;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, MortarTag, target)
  ) {
    bonus += 10;
  }
  return Math.max(1, Combat.atk[attacker] + bonus - Health.armor[target]);
}

function deathSystem(world: SimWorld): void {
  const ents = damageableQuery(world.ecs);
  for (const eid of ents) {
    if (Health.hp[eid] <= 0 && !hasComponent(world.ecs, DeadTag, eid)) {
      addComponent(world.ecs, DeadTag, eid);
      const isBuilding = hasComponent(world.ecs, Building, eid);
      pushSoundCue(
        world,
        isBuilding ? 'building_destroyed' : 'unit_death',
        Position.x[eid],
        Position.y[eid],
        Owner.player[eid]
      );
    }
  }
}

function cleanupSystem(world: SimWorld): void {
  const dead = deadQuery(world.ecs);
  for (const eid of dead) {
    let recalculatePopFor: number | null = null;
    // Update population counters.
    if (hasComponent(world.ecs, PopulationCost, eid)) {
      const p = Owner.player[eid];
      if (world.population[p]) {
        world.population[p].current = Math.max(
          0,
          world.population[p].current - PopulationCost.value[eid]
        );
      }
    }
    if (hasComponent(world.ecs, Building, eid)) {
      const defId = Building.defId[eid];
      const def = BUILDING_TABLE[defId];
      const p = Owner.player[eid];
      // CRITICAL: only decrement pop cap for COMPLETED buildings. Foundations
      // that haven't been finalised never granted cap, so destroying them
      // mid-build should not reduce cap.
      const wasFoundation = hasComponent(world.ecs, ConstructionSite, eid);
      if (!wasFoundation && def && getBuildingPopProvided(world, p, defId) > 0) {
        recalculatePopFor = p;
      }
      // Refund any queued production (resources were spent at queue time).
      const queue = world.productionQueues.get(eid);
      if (queue) {
        for (const qDef of queue) {
          const unitDef = getUnitDef(qDef);
          if (unitDef && world.resources[p]) {
            refund(world.resources[p], unitDef.cost);
          }
        }
      }
      world.productionQueues.delete(eid);
      if (def) {
        markFootprintBlocked(
          world,
          Position.x[eid],
          Position.y[eid],
          def.footprint.w,
          def.footprint.h,
          false
        );
      }
      markWorksiteWorkersDead(world, eid);
    }
    // Clear any attack targets pointing at us — AND drop the path that was
    // chasing us. Without this, attackers keep walking to the deceased's last
    // tile (the "targeting a previous position" bug).
    const attackers = combatQuery(world.ecs);
    for (const a of attackers) {
      if (AttackTarget.targetEid[a] === eid) {
        AttackTarget.targetEid[a] = -1;
        world.paths.delete(a);
        clearFormationSpeedCap(world, a);
      }
    }
    world.cannonWindups.delete(eid);
    // Clear gatherer targets pointing at us (resource depleted, etc.).
    const gatherers = gathererQuery(world.ecs);
    for (const g of gatherers) {
      if (Gatherer.targetEid[g] === eid) {
        Gatherer.state[g] = GathererStateId.IDLE;
        Gatherer.targetEid[g] = -1;
        world.paths.delete(g);
        clearFormationSpeedCap(world, g);
      }
    }
    // Clear builders' BuildOrder pointing at us.
    if (hasComponent(world.ecs, Building, eid)) {
      const allMovable = movableQuery(world.ecs);
      for (const m of allMovable) {
        if (
          hasComponent(world.ecs, BuildOrder, m) &&
          BuildOrder.targetEid[m] === eid
        ) {
          BuildOrder.targetEid[m] = -1;
          world.paths.delete(m);
          clearFormationSpeedCap(world, m);
        }
      }
    }
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
    removeEntity(world.ecs, eid);
    if (recalculatePopFor !== null) recalculatePlayerPopCap(world, recalculatePopFor);
  }
}

function markWorksiteWorkersDead(world: SimWorld, siteEid: number): void {
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return;
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
    addComponent(world.ecs, DeadTag, worker);
    Gatherer.targetEid[worker] = -1;
    Gatherer.state[worker] = GathererStateId.IDLE;
    world.paths.delete(worker);
    clearFormationSpeedCap(world, worker);
  }
  ResourceWorksite.assignedWorkers[siteEid] = 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 09 — Campaign mission state
// ────────────────────────────────────────────────────────────────────────────

function zborovAssaultSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  if (campaign.zborovForwardY === undefined) {
    campaign.zborovForwardY = world.map.spawns[LOCAL_PLAYER_ID].y;
  }

  // Bite-and-hold objective progress. The enemy garrison stays in its trench
  // anchors; pressure now comes from units actually trained at the rear foundry.
  const lineKeys = ['take_trench_1', 'take_trench_2', 'take_trench_3'];
  const lineFracs = [
    ZBOROV_FORWARD_LINE_FRAC,
    ZBOROV_MID_LINE_FRAC,
    ZBOROV_REAR_LINE_FRAC,
  ];
  let taken = campaign.zborovLinesTaken ?? 0;
  while (taken < lineKeys.length) {
    const lineEids = campaign.trackedObjectiveEids[lineKeys[taken]] ?? [];
    if (lineEids.length === 0 || countLiveTrackedEids(world, lineEids) > 0) break;
    completeCampaignObjective(campaign, lineKeys[taken]);
    campaign.zborovForwardY = Math.round(MAP.HEIGHT * lineFracs[taken]) + 4;
    pushAiEvent(world, AI_PLAYER_ID, `Trench line ${taken + 1} has fallen.`);
    taken += 1;
    campaign.zborovLinesTaken = taken;
  }

  zborovQueueEnemyProduction(world, campaign);
  zborovMaybeReleaseEnemyWave(world, campaign);
}

function zborovQueueEnemyProduction(world: SimWorld, campaign: CampaignState): void {
  const foundries = zborovLiveBuildings(world, AI_PLAYER_ID, BuildingDefId.FOUNDRY);
  for (const foundry of foundries) {
    const queue = world.productionQueues.get(foundry) ?? [];
    if (queue.length >= 2) continue;
    const waveIndex = campaign.scriptedWaveIndex ?? 0;
    const preferCannon = (waveIndex + queue.length) % 4 === 3;
    if (preferCannon && aiQueueUnit(world, foundry, UnitDefId.CANNON)) continue;
    aiQueueUnit(world, foundry, UnitDefId.GUNMAN);
  }
}

function zborovMaybeReleaseEnemyWave(world: SimWorld, campaign: CampaignState): void {
  if (world.tick < campaign.nextReinforcementTick) return;

  const candidates = zborovEnemyWaveCandidates(world, campaign);
  const waitedLongEnough =
    world.tick - campaign.nextReinforcementTick >= ZBOROV_ENEMY_WAVE_WAIT_CAP_TICKS;
  if (
    candidates.length < ZBOROV_ENEMY_WAVE_MIN_SIZE &&
    !(waitedLongEnough && candidates.length > 0)
  ) {
    return;
  }

  const wave = candidates
    .sort((a, b) => Position.y[b] - Position.y[a] || a - b)
    .slice(0, ZBOROV_ENEMY_WAVE_MAX_SIZE);
  const target = zborovCampaignTarget(
    world,
    campaign.trackedObjectiveEids.hold_legion_command ?? [],
    world.map.spawns[LOCAL_PLAYER_ID]
  );
  issueBilaHoraEnemyAdvance(world, wave, target);
  campaign.trackedObjectiveEids.zborov_enemy_reinforcements = mergeTrackedEids(
    campaign.trackedObjectiveEids.zborov_enemy_reinforcements ?? [],
    wave
  );
  campaign.scriptedWaveIndex = (campaign.scriptedWaveIndex ?? 0) + 1;
  campaign.nextReinforcementTick = world.tick + ZBOROV_ENEMY_WAVE_INTERVAL_TICKS;
  pushAiEvent(world, AI_PLAYER_ID, `Austro-Hungarian trained wave ${campaign.scriptedWaveIndex} is moving through no-man's-land.`);
}

function zborovEnemyWaveCandidates(world: SimWorld, campaign: CampaignState): number[] {
  const garrison = new Set(campaign.trackedObjectiveEids.zborov_garrison ?? []);
  const candidates: number[] = [];
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] !== AI_PLAYER_ID) continue;
    if (Health.hp[eid] <= 0) continue;
    if (garrison.has(eid)) continue;
    if (hasComponent(world.ecs, VillagerTag, eid)) continue;
    if (!hasComponent(world.ecs, GunmanTag, eid) && !hasComponent(world.ecs, CannonTag, eid)) continue;
    if (hasComponent(world.ecs, AttackMoveGoal, eid) && AttackMoveGoal.active[eid] === 1) continue;
    candidates.push(eid);
  }
  return candidates;
}

function zborovLiveBuildings(
  world: SimWorld,
  playerId: number,
  defId: number
): number[] {
  return buildingQuery(world.ecs).filter((eid) =>
    Owner.player[eid] === playerId &&
    Building.defId[eid] === defId &&
    Health.hp[eid] > 0 &&
    !hasComponent(world.ecs, ConstructionSite, eid)
  );
}

function zborovCampaignTarget(
  world: SimWorld,
  eids: number[],
  fallback: GridPos
): GridPos {
  for (const eid of eids) {
    if (!isLiveEntity(world, eid)) continue;
    return { x: Math.round(Position.x[eid]), y: Math.round(Position.y[eid]) };
  }
  return fallback;
}

function mergeTrackedEids(existing: number[], incoming: number[]): number[] {
  const seen = new Set(existing);
  const merged = existing.slice();
  for (const eid of incoming) {
    if (seen.has(eid)) continue;
    seen.add(eid);
    merged.push(eid);
  }
  return merged;
}

function campaignSystem(world: SimWorld): void {
  if (!world.campaign) return;
  updateCampaignObjectives(world);
  if (world.campaign.missionId === CampaignMissionId.SIEGE_OF_BRNO) {
    brnoReinforcementSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_BILA_HORA) {
    bilaHoraOpeningAdvanceSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_KUTNA_HORA) {
    kutnaHoraWaveSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_SUDOMER) {
    sudomerWaveSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) {
    zborovAssaultSystem(world);
  }
}

function updateCampaignObjectives(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  for (const objective of campaign.objectives) {
    if (objective.completed) continue;
    const tracked = campaign.trackedObjectiveEids[objective.id];
    if (!tracked || tracked.length === 0) continue;
    if (tracked.every((eid) => !isLiveEntity(world, eid))) {
      objective.completed = true;
      pushAiEvent(world, 0, `${objective.label} complete`);
    }
  }
}

function isLiveEntity(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, Position, eid) &&
    (!hasComponent(world.ecs, Health, eid) || Health.hp[eid] > 0);
}

function bilaHoraOpeningAdvanceSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  if (world.tick < campaign.nextReinforcementTick) return;
  const enemyUnits = campaign.trackedObjectiveEids.destroy_imperial_field_army ?? [];
  const liveEnemyUnits = enemyUnits.filter((eid) => isLiveEntity(world, eid));
  if (liveEnemyUnits.length > 0) {
    const playerAnchor = world.map.spawns[LOCAL_PLAYER_ID];
    const enemyAnchor = world.map.spawns[AI_PLAYER_ID];
    const road = normalizeVector(enemyAnchor.x - playerAnchor.x, enemyAnchor.y - playerAnchor.y);
    const across = { x: -road.y, y: road.x };
    issueBilaHoraEnemyAdvance(
      world,
      liveEnemyUnits,
      offsetBattlePoint(playerAnchor, road, across, -8, 0)
    );
  }
  campaign.nextReinforcementTick = Number.MAX_SAFE_INTEGER;
}

function brnoReinforcementSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  if (world.tick < campaign.nextReinforcementTick) return;
  const campsAlive = countIncompleteCampaignObjectives(campaign, [
    'destroy_outer_lumber',
    'destroy_outer_mine',
  ]);
  const targetArmy = campsAlive === 2 ? 42 : campsAlive === 1 ? 28 : 16;
  const interval = campsAlive === 2 ? 70 : campsAlive === 1 ? 95 : 130;
  const enemyArmy = countLiveMilitary(world, AI_PLAYER_ID);
  if (enemyArmy < targetArmy) {
    spawnBrnoReinforcementWave(world, campsAlive);
  }
  campaign.nextReinforcementTick = world.tick + SIM.TICK_HZ * interval;
}

function countIncompleteCampaignObjectives(campaign: CampaignState, ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    if (!campaign.objectives.find((objective) => objective.id === id)?.completed) count++;
  }
  return count;
}

function countLiveMilitary(world: SimWorld, playerId: number): number {
  let count = 0;
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Health.hp[eid] <= 0) continue;
    if (hasComponent(world.ecs, VillagerTag, eid)) continue;
    count++;
  }
  return count;
}

function spawnBrnoReinforcementWave(world: SimWorld, campsAlive: number): void {
  const spawn = world.map.spawns[AI_PLAYER_ID];
  if (!spawn) return;
  const baseX = spawn.x - 2;
  const baseY = spawn.y + 6;
  if (campsAlive >= 2) {
    spawnPresetUnits(world, UnitDefId.SPEARMAN, baseX, baseY, AI_PLAYER_ID, 2);
    spawnPresetUnits(world, UnitDefId.ARCHER, baseX + 2, baseY, AI_PLAYER_ID, 2);
    spawnPresetUnits(world, UnitDefId.SCOUT_CAVALRY, baseX + 4, baseY - 1, AI_PLAYER_ID, 1);
    return;
  }
  if (campsAlive === 1) {
    spawnPresetUnits(world, UnitDefId.SPEARMAN, baseX, baseY, AI_PLAYER_ID, 1);
    spawnPresetUnits(world, UnitDefId.ARCHER, baseX + 2, baseY, AI_PLAYER_ID, 1);
    return;
  }
  spawnPresetUnits(world, UnitDefId.SPEARMAN, baseX, baseY, AI_PLAYER_ID, 1);
}

function kutnaHoraWaveSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  campaign.scriptedWaveIndex ??= 0;
  campaign.scriptedWaveCount ??= KUTNA_HORA_TOTAL_WAVES;

  if (
    campaign.scriptedWaveIndex < campaign.scriptedWaveCount &&
    world.tick >= campaign.nextReinforcementTick
  ) {
    const waveIndex = campaign.scriptedWaveIndex;
    const spawned = spawnKutnaHoraAssaultWave(world, waveIndex);
    const attackers = campaign.trackedObjectiveEids.kutna_hora_attackers ?? [];
    campaign.trackedObjectiveEids.kutna_hora_attackers = attackers.concat(spawned);
    campaign.scriptedWaveIndex = waveIndex + 1;
    campaign.nextReinforcementTick =
      campaign.scriptedWaveIndex >= campaign.scriptedWaveCount
        ? Number.MAX_SAFE_INTEGER
        : world.tick + KUTNA_HORA_WAVE_INTERVAL_TICKS;
    pushAiEvent(world, AI_PLAYER_ID, `Crusader wave ${waveIndex + 1} is advancing on Kutná Hora`);
  }

  if (campaign.scriptedWaveIndex < campaign.scriptedWaveCount) return;
  const liveAttackers = countLiveTrackedEids(
    world,
    campaign.trackedObjectiveEids.kutna_hora_attackers ?? []
  );
  if (liveAttackers > 0) return;
  completeCampaignObjective(campaign, 'survive_kutna_hora');
  if (findOwnedTownCenter(world, LOCAL_PLAYER_ID) !== null) {
    completeCampaignObjective(campaign, 'hold_kutna_hora_tc');
  }
}

interface KutnaHoraWaveDef {
  spearmen: number;
  archers: number;
  cavalry: number;
  gunmen: number;
  cannons: number;
}

const KUTNA_HORA_WAVES: KutnaHoraWaveDef[] = [
  { spearmen: 8, archers: 4, cavalry: 6, gunmen: 0, cannons: 0 },
  { spearmen: 10, archers: 4, cavalry: 8, gunmen: 4, cannons: 0 },
  { spearmen: 12, archers: 6, cavalry: 10, gunmen: 6, cannons: 0 },
  { spearmen: 12, archers: 8, cavalry: 12, gunmen: 8, cannons: 1 },
  { spearmen: 14, archers: 8, cavalry: 14, gunmen: 10, cannons: 2 },
];

function spawnKutnaHoraAssaultWave(world: SimWorld, waveIndex: number): number[] {
  const town = world.map.spawns[LOCAL_PLAYER_ID];
  const enemyEdge = kutnaHoraWaveSpawnAnchor(waveIndex);
  world.map.spawns[AI_PLAYER_ID] = enemyEdge;
  const advance = normalizeVector(town.x - enemyEdge.x, town.y - enemyEdge.y);
  const across = { x: -advance.y, y: advance.x };
  const wave = KUTNA_HORA_WAVES[Math.min(waveIndex, KUTNA_HORA_WAVES.length - 1)];
  const anchor = offsetBattlePoint(enemyEdge, advance, across, waveIndex % 2 === 0 ? 0 : -2, (waveIndex - 2) * 1.5);
  clearKutnaHoraGround(world, anchor, 12, 8);

  const eids: number[] = [];
  eids.push(...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, advance, across, 1.2, 0, AI_PLAYER_ID, wave.spearmen, 1.1));
  eids.push(...spawnFormationRow(world, UnitDefId.ARCHER, anchor, advance, across, -0.7, 0, AI_PLAYER_ID, wave.archers, 1.15));
  if (wave.gunmen > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.GUNMAN, anchor, advance, across, -2.4, 0, AI_PLAYER_ID, wave.gunmen, 1.12));
  }
  if (wave.cavalry > 0) {
    const left = Math.ceil(wave.cavalry / 2);
    const right = wave.cavalry - left;
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 0.0, -7.0, AI_PLAYER_ID, left, 1.18));
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 0.0, 7.0, AI_PLAYER_ID, right, 1.18));
  }
  if (wave.cannons > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.CANNON, anchor, advance, across, -4.8, 0, AI_PLAYER_ID, wave.cannons, 3.0));
  }
  issueBilaHoraEnemyAdvance(world, eids, getKutnaHoraAttackTarget(world, enemyEdge));
  return eids;
}

function kutnaHoraWaveSpawnAnchor(waveIndex: number): GridPos {
  const anchors: GridPos[] = [
    { x: Math.round(MAP.WIDTH * 0.50), y: 2 },
    { x: MAP.WIDTH - 3, y: Math.round(MAP.HEIGHT * 0.50) },
    { x: Math.round(MAP.WIDTH * 0.50), y: MAP.HEIGHT - 3 },
    { x: 2, y: Math.round(MAP.HEIGHT * 0.50) },
    { x: MAP.WIDTH - 5, y: 5 },
  ];
  return anchors[waveIndex % anchors.length];
}

function getKutnaHoraAttackTarget(world: SimWorld, enemyEdge: GridPos): GridPos {
  const town = world.map.spawns[LOCAL_PLAYER_ID];
  const road = normalizeVector(enemyEdge.x - town.x, enemyEdge.y - town.y);
  const across = { x: -road.y, y: road.x };
  return offsetBattlePoint(town, road, across, -4, 0);
}

function sudomerWaveSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  campaign.scriptedWaveIndex ??= 0;
  campaign.scriptedWaveCount ??= SUDOMER_TOTAL_WAVES;

  if (campaign.scriptedWaveIndex < campaign.scriptedWaveCount) {
    // Telegraph the approaching wave so the player can shift between the two
    // fronts. Exact-tick checks fire each warning exactly once.
    const next = campaign.nextReinforcementTick;
    if (next < Number.MAX_SAFE_INTEGER) {
      const upcoming = SUDOMER_WAVES[Math.min(campaign.scriptedWaveIndex, SUDOMER_WAVES.length - 1)];
      if (world.tick === next - SIM.TICK_HZ * 40) {
        pushAiEvent(world, AI_PLAYER_ID, `The crusaders form up — ${sudomerWaveThreatLabel(upcoming)} incoming.`);
      } else if (world.tick === next - SIM.TICK_HZ * 12) {
        pushAiEvent(world, AI_PLAYER_ID, `Assault imminent — brace for ${sudomerWaveThreatLabel(upcoming)}!`);
      }
    }

    if (world.tick >= campaign.nextReinforcementTick) {
      const waveIndex = campaign.scriptedWaveIndex;
      const spawned = spawnSudomerAssaultWave(world, waveIndex);
      const attackers = campaign.trackedObjectiveEids.sudomer_attackers ?? [];
      campaign.trackedObjectiveEids.sudomer_attackers = attackers.concat(spawned);
      campaign.scriptedWaveIndex = waveIndex + 1;
      campaign.nextReinforcementTick =
        campaign.scriptedWaveIndex >= campaign.scriptedWaveCount
          ? Number.MAX_SAFE_INTEGER
          : world.tick + SUDOMER_WAVE_INTERVAL_TICKS;
      const wave = SUDOMER_WAVES[Math.min(waveIndex, SUDOMER_WAVES.length - 1)];
      pushAiEvent(
        world,
        AI_PLAYER_ID,
        `Crusader assault ${waveIndex + 1} of ${campaign.scriptedWaveCount} charges — ${sudomerWaveThreatLabel(wave)}!`
      );
    }
    return;
  }

  const liveAttackers = countLiveTrackedEids(
    world,
    campaign.trackedObjectiveEids.sudomer_attackers ?? []
  );
  if (liveAttackers > 0) return;
  completeCampaignObjective(campaign, 'survive_sudomer_assault');
  if (findOwnedTownCenter(world, LOCAL_PLAYER_ID) !== null) {
    completeCampaignObjective(campaign, 'hold_sudomer_town');
  }
}

type SudomerWaveRoute = 'middle' | 'mud';

interface SudomerWaveProng {
  route: SudomerWaveRoute;
  spearmen: number;
  archers: number;
  cavalry: number;
  gunmen?: number;
  cannons?: number;
}

interface SudomerWaveDef {
  prongs: SudomerWaveProng[];
}

// Five escalating waves alternating the dry central gap and the muddy flank,
// building to wave 4's simultaneous two-front squeeze and a combined finale.
// Counts are first-pass "balanced" values — tune against tests/playthrough.
const SUDOMER_WAVES: SudomerWaveDef[] = [
  { prongs: [{ route: 'middle', spearmen: 14, archers: 6, cavalry: 0 }] },
  { prongs: [{ route: 'mud', spearmen: 4, archers: 0, cavalry: 18 }] },
  { prongs: [{ route: 'middle', spearmen: 20, archers: 8, cavalry: 0, gunmen: 4 }] },
  {
    prongs: [
      { route: 'middle', spearmen: 16, archers: 6, cavalry: 0 },
      { route: 'mud', spearmen: 0, archers: 0, cavalry: 16 },
    ],
  },
  {
    prongs: [
      { route: 'middle', spearmen: 18, archers: 8, cavalry: 0, gunmen: 6, cannons: 1 },
      { route: 'mud', spearmen: 6, archers: 0, cavalry: 16 },
    ],
  },
];

function sudomerWaveThreatLabel(wave: SudomerWaveDef): string {
  const routes = new Set(wave.prongs.map((prong) => prong.route));
  if (routes.has('middle') && routes.has('mud')) return 'infantry at the gap and horse in the mud';
  if (routes.has('mud')) return 'cavalry through the mud';
  return 'infantry through the central gap';
}

function spawnSudomerAssaultWave(world: SimWorld, waveIndex: number): number[] {
  const wave = SUDOMER_WAVES[Math.min(waveIndex, SUDOMER_WAVES.length - 1)];
  const eids: number[] = [];
  wave.prongs.forEach((prong, i) => {
    eids.push(...spawnSudomerProng(world, prong, waveIndex + i));
  });
  return eids;
}

function spawnSudomerProng(world: SimWorld, prong: SudomerWaveProng, ordinal: number): number[] {
  const enemyEdge = sudomerRouteAnchor(prong.route);
  world.map.spawns[AI_PLAYER_ID] = enemyEdge;
  clearSudomerGround(world, enemyEdge, 8, 6, prong.route === 'mud');
  const target = sudomerAttackTarget(prong.route);
  const advance = normalizeVector(target.x - enemyEdge.x, target.y - enemyEdge.y);
  const across = { x: -advance.y, y: advance.x };
  const anchor = offsetBattlePoint(
    enemyEdge,
    advance,
    across,
    ordinal % 2 === 0 ? 0 : -2,
    (ordinal - 1.5) * 1.5
  );

  const eids: number[] = [];
  if (prong.cavalry > 0) {
    const left = Math.ceil(prong.cavalry / 2);
    const right = prong.cavalry - left;
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 1.0, -6.5, AI_PLAYER_ID, left, 1.1));
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 1.0, 6.5, AI_PLAYER_ID, right, 1.1));
  }
  if (prong.spearmen > 0) {
    const front = Math.ceil(prong.spearmen / 2);
    eids.push(...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, advance, across, 0.0, -4.0, AI_PLAYER_ID, front, 1.05));
    eids.push(...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, advance, across, 1.4, 4.0, AI_PLAYER_ID, prong.spearmen - front, 1.05));
  }
  if (prong.archers > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.ARCHER, anchor, advance, across, -1.6, 0, AI_PLAYER_ID, prong.archers, 1.1));
  }
  if (prong.gunmen && prong.gunmen > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.GUNMAN, anchor, advance, across, -3.0, 0, AI_PLAYER_ID, prong.gunmen, 1.12));
  }
  if (prong.cannons && prong.cannons > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.CANNON, anchor, advance, across, -4.6, 0, AI_PLAYER_ID, prong.cannons, 3.0));
  }
  issueBilaHoraEnemyAdvance(world, eids, target);
  return eids;
}

function sudomerRouteAnchor(route: SudomerWaveRoute): GridPos {
  if (route === 'mud') {
    return { x: MAP.WIDTH - 4, y: Math.round(MAP.HEIGHT * 0.25) };
  }
  return { x: Math.round(MAP.WIDTH * 0.49), y: MAP.HEIGHT - 4 };
}

function sudomerWaveSpawnAnchor(waveIndex: number): GridPos {
  const anchors: GridPos[] = [
    { x: Math.round(MAP.WIDTH * 0.49), y: MAP.HEIGHT - 4 },
    { x: MAP.WIDTH - 4, y: Math.round(MAP.HEIGHT * 0.25) },
  ];
  return anchors[waveIndex % anchors.length];
}

function countLiveTrackedEids(world: SimWorld, eids: number[]): number {
  let count = 0;
  for (const eid of eids) {
    if (isLiveEntity(world, eid)) count++;
  }
  return count;
}

function completeCampaignObjective(campaign: CampaignState, id: string): void {
  const objective = campaign.objectives.find((entry) => entry.id === id);
  if (objective) objective.completed = true;
}

// ────────────────────────────────────────────────────────────────────────────
// 10 — AI
// ────────────────────────────────────────────────────────────────────────────

function aiSystem(world: SimWorld): void {
  // In multiplayer the second player is human; their commands arrive over the
  // wire, so the AI controller must stay silent for them.
  if (world.humanPlayers.has(AI_PLAYER_ID)) return;
  const settings = aiSettings(world);
  if (world.tick % settings.thinkIntervalTicks !== 0) return;
  // Player 2 is the only AI for now.
  aiPlayerTick(world, AI_PLAYER_ID);
}

function aiSettings(world: SimWorld): AiDifficultySettings {
  return AI_DIFFICULTY_SETTINGS[normalizeAiDifficulty(world.aiDifficulty)];
}

function aiElapsedMinutes(world: SimWorld): number {
  return world.tick / SIM.TICK_HZ / 60;
}

interface AiSnapshot {
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

function collectAiSnapshot(world: SimWorld, playerId: number): AiSnapshot | null {
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
    else if (Owner.player[eid] === LOCAL_PLAYER_ID) enemyBuildings.push(eid);
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
    } else if (Owner.player[eid] === LOCAL_PLAYER_ID) {
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

function aiHasAnyBuilding(snapshot: AiSnapshot, defId: number): boolean {
  return snapshot.myBuildings.some((eid) => Building.defId[eid] === defId);
}

function countAiBuildings(snapshot: AiSnapshot, defId: number): number {
  return countBuildings(snapshot.myBuildings, defId);
}

function countAiEffectiveEconomyBuildings(
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

function aiResourceWorksiteCanStillProduce(
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

function countEnemyBuildings(snapshot: AiSnapshot, defId: number): number {
  return countBuildings(snapshot.enemyBuildings, defId);
}

function countBuildings(buildings: number[], defId: number): number {
  return buildings.filter((eid) => Building.defId[eid] === defId).length;
}

function aiIsCompletedBuilding(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, Building, eid) &&
    !hasComponent(world.ecs, ConstructionSite, eid);
}

interface AiProductionMacro {
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

const AI_PRODUCER_QUEUE_TARGET = 2;

function aiCompletedBuildingCount(world: SimWorld, snapshot: AiSnapshot, defId: number): number {
  return snapshot.myBuildings.filter((eid) =>
    Building.defId[eid] === defId && aiIsCompletedBuilding(world, eid)
  ).length;
}

function aiIsArmyProducerDef(defId: number): boolean {
  return defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY;
}

function aiTrainableUnitsForProducer(world: SimWorld, playerId: number, producerEid: number): number[] {
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

function aiAnalyzeProductionMacro(
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
  if (world.aiDifficulty === 'hard' && farms >= 14) return 3;
  if (farms >= 8 && world.aiDifficulty !== 'easy') return 2;
  return 1;
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

function aiBottleneckBuildingDef(kind: ResourceKind | null): number | null {
  if (kind === ResourceKindId.FOOD) return BuildingDefId.FARM;
  if (kind === ResourceKindId.WOOD) return BuildingDefId.LUMBER_CAMP;
  if (kind === ResourceKindId.STONE) return BuildingDefId.STONE_QUARRY;
  if (kind === ResourceKindId.GOLD) return BuildingDefId.GOLD_MINE;
  return null;
}

function aiMaintainEconomy(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  if (world.aiDifficulty !== 'easy') {
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

function aiMaintainMilitaryInfrastructure(
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
  const macro = world.aiDifficulty === 'hard'
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

function aiTrainArmy(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  if (world.aiDifficulty === 'hard') {
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
  const playerPressureTarget = world.aiDifficulty === 'hard'
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

function findAiDefenseTarget(world: SimWorld, playerId: number, snapshot: AiSnapshot): number | null {
  let best: { eid: number; dist: number } | null = null;
  for (const enemy of snapshot.enemyMilitary) {
    const nearest = aiDistanceToHomeBuildings(snapshot, enemy);
    const target = hasComponent(world.ecs, AttackTarget, enemy)
      ? AttackTarget.targetEid[enemy]
      : -1;
    const targetingHome =
      target >= 0 &&
      hasComponent(world.ecs, Owner, target) &&
      Owner.player[target] === playerId &&
      (
        hasComponent(world.ecs, Building, target) ||
        aiDistanceToHomeBuildings(snapshot, target) <= AI_DEFENSE_RADIUS
      );
    if (!targetingHome && nearest > AI_DEFENSE_RADIUS) continue;
    if (!best || nearest < best.dist) best = { eid: enemy, dist: nearest };
  }
  return best?.eid ?? null;
}

function aiDistanceToHomeBuildings(snapshot: AiSnapshot, eid: number): number {
  let nearest = Math.hypot(
    Position.x[eid] - Position.x[snapshot.tcEid],
    Position.y[eid] - Position.y[snapshot.tcEid]
  );
  for (const building of snapshot.myBuildings) {
    nearest = Math.min(
      nearest,
      Math.hypot(Position.x[eid] - Position.x[building], Position.y[eid] - Position.y[building])
    );
  }
  return nearest;
}

function aiHandleDefense(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot,
  target: number
): void {
  state.plan = 'defending';
  state.rallyPoint = null;
  state.waveUnitEids = [];
  state.stageStartedTick = -1;
  state.nextAttackTick = Math.max(state.nextAttackTick, world.tick + aiSettings(world).attackCooldownTicks / 2);

  for (const unit of snapshot.myMilitary) {
    const dist = Math.hypot(Position.x[unit] - Position.x[target], Position.y[unit] - Position.y[target]);
    const homeDist = Math.hypot(Position.x[unit] - Position.x[snapshot.tcEid], Position.y[unit] - Position.y[snapshot.tcEid]);
    if (dist > AI_DEFENSE_ORDER_RADIUS && homeDist > AI_DEFENSE_ORDER_RADIUS) continue;
    issueAiAttackOrder(world, unit, target);
  }

  if (world.tick - state.lastDefenseEventTick >= AI_EVENT_COOLDOWN_TICKS) {
    pushAiEvent(world, playerId, 'Frankia pulls its army home to defend');
    state.lastDefenseEventTick = world.tick;
  }
}

function aiManageAttackPlan(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot
): void {
  const settings = aiSettings(world);
  state.waveUnitEids = state.waveUnitEids.filter((eid) => isLiveOwnedMilitary(world, eid, playerId));
  if (state.plan === 'attacking') {
    if (
      state.waveUnitEids.length < 3 ||
      world.tick - state.lastAttackTick > settings.attackCooldownTicks
    ) {
      state.plan = 'recovering';
      state.nextAttackTick = world.tick + settings.attackCooldownTicks;
      state.waveUnitEids = [];
    }
    return;
  }

  const required = aiRequiredWaveSize(world, playerId);
  if (world.tick < state.nextAttackTick || snapshot.myMilitary.length < required) {
    if (state.plan !== 'opening') state.plan = 'massing';
    return;
  }

  const target = chooseAiAttackTarget(world, snapshot);
  if (target === null) return;
  if (state.plan !== 'staging' || !state.rallyPoint || state.waveUnitEids.length === 0) {
    const rally = findAiStagingPoint(world, snapshot.tcEid, target);
    if (!rally) return;
    state.plan = 'staging';
    state.rallyPoint = rally;
    state.stageStartedTick = world.tick;
    state.waveUnitEids = aiSelectWaveUnits(world, snapshot.myMilitary, rally);
    if (world.tick - state.lastAttackEventTick >= AI_EVENT_COOLDOWN_TICKS) {
      pushAiEvent(world, playerId, 'Frankish raiding party is gathering near the river');
      state.lastAttackEventTick = world.tick;
    }
  }

  const rally = state.rallyPoint;
  let nearRally = 0;
  for (const unit of state.waveUnitEids) {
    if (Math.hypot(Position.x[unit] - rally.x, Position.y[unit] - rally.y) <= AI_STAGE_RADIUS) {
      nearRally++;
    } else {
      issueAiMoveOrder(world, unit, rally);
    }
  }
  const enoughGathered = nearRally >= Math.max(3, Math.ceil(state.waveUnitEids.length * settings.gatherFraction));
  const stageTimedOut = world.tick - state.stageStartedTick >= settings.attackStageTimeoutTicks;
  if (!enoughGathered && !stageTimedOut) return;

  const destination = { x: Math.round(Position.x[target]), y: Math.round(Position.y[target]) };
  for (const unit of state.waveUnitEids) {
    issueAiAttackMoveOrder(world, unit, destination);
  }
  state.plan = 'attacking';
  state.lastAttackTick = world.tick;
  state.nextAttackTick = world.tick + settings.attackCooldownTicks;
  pushAiEvent(world, playerId, `Frankish attack is moving toward your ${aiTargetLabel(target)}`);
  state.lastAttackEventTick = world.tick;
}

function aiRequiredWaveSize(world: SimWorld, playerId: number): number {
  const settings = aiSettings(world);
  const base = (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.CASTLE
    ? settings.castleWaveSize
    : settings.darkWaveSize;
  const growth = Math.floor(Math.max(0, aiElapsedMinutes(world) - 3) * settings.waveGrowthPerMinute);
  return Math.min(settings.maxWaveUnits, base + growth);
}

function aiSelectWaveUnits(world: SimWorld, units: number[], rally: GridPos): number[] {
  return [...units]
    .sort((a, b) => {
      const da = Math.hypot(Position.x[a] - rally.x, Position.y[a] - rally.y);
      const db = Math.hypot(Position.x[b] - rally.x, Position.y[b] - rally.y);
      if (Math.abs(da - db) > 0.001) return da - db;
      return a - b;
    })
    .slice(0, aiSettings(world).maxWaveUnits);
}

function findAiStagingPoint(world: SimWorld, ownTc: number, target: number): GridPos | null {
  const sx = Position.x[ownTc] + (Position.x[target] - Position.x[ownTc]) * 0.45;
  const sy = Position.y[ownTc] + (Position.y[target] - Position.y[ownTc]) * 0.45;
  return findSpawnSpot(world, sx, sy, 8);
}

function chooseAiAttackTarget(world: SimWorld, snapshot: AiSnapshot): number | null {
  const nonTcTargets = snapshot.enemyBuildings.filter(
    (eid) => Building.defId[eid] !== BuildingDefId.TOWN_CENTER
  );
  const candidates = nonTcTargets.length > 0 ? nonTcTargets : snapshot.enemyBuildings;
  let best: { eid: number; score: number } | null = null;
  for (const eid of candidates) {
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    const score =
      aiAttackTargetPriority(world, eid) * 100 +
      Math.hypot(Position.x[eid] - Position.x[snapshot.tcEid], Position.y[eid] - Position.y[snapshot.tcEid]);
    if (!best || score < best.score) best = { eid, score };
  }
  return best?.eid ?? null;
}

function aiAttackTargetPriority(world: SimWorld, eid: number): number {
  const defId = Building.defId[eid];
  if (hasComponent(world.ecs, ResourceWorksite, eid)) return 0;
  if (
    defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY
  ) return 1;
  if (defId === BuildingDefId.DEFENSIVE_TOWER) return 2;
  if (defId === BuildingDefId.HOUSE) return 3;
  if (defId === BuildingDefId.TOWN_CENTER) return 5;
  return 4;
}

function aiTargetLabel(eid: number): string {
  const def = getBuildingDef(Building.defId[eid]);
  return def?.name.toLowerCase() ?? 'base';
}

function isLiveOwnedMilitary(world: SimWorld, eid: number, playerId: number): boolean {
  return hasComponent(world.ecs, UnitKind, eid) &&
    !hasComponent(world.ecs, VillagerTag, eid) &&
    hasComponent(world.ecs, Owner, eid) &&
    Owner.player[eid] === playerId &&
    hasComponent(world.ecs, Health, eid) &&
    Health.hp[eid] > 0;
}

function issueAiMoveOrder(world: SimWorld, eid: number, to: GridPos): void {
  if (!isMovableEntity(world, eid)) return;
  if (!pathTo(world, eid, to.x, to.y)) return;
  clearCombatOrders(world, eid);
  clearWorkOrders(world, eid);
}

function issueAiAttackMoveOrder(world: SimWorld, eid: number, to: GridPos): void {
  if (!isMovableEntity(world, eid)) return;
  if (!hasComponent(world.ecs, Combat, eid)) return;
  if (!pathTo(world, eid, to.x, to.y)) return;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
    AttackMoveGoal.active[eid] = 1;
    AttackMoveGoal.x[eid] = to.x;
    AttackMoveGoal.y[eid] = to.y;
  }
  clearWorkOrders(world, eid);
  clearFormationSpeedCap(world, eid);
}

function issueAiAttackOrder(world: SimWorld, eid: number, target: number): void {
  if (!hasComponent(world.ecs, Combat, eid)) return;
  if (!hasComponent(world.ecs, AttackTarget, eid)) return;
  if (!isValidHostileTarget(world, eid, target)) return;
  const inRange = isTargetInAttackRange(world, eid, target);
  const canReach =
    inRange ||
    (isMovableEntity(world, eid) && pathTo(world, eid, Position.x[target], Position.y[target]));
  if (!canReach) return;
  AttackTarget.targetEid[eid] = target;
  AttackTarget.retainGoal[eid] = 1;
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) AttackMoveGoal.active[eid] = 0;
  if (inRange) world.paths.delete(eid);
  clearWorkOrders(world, eid);
  clearFormationSpeedCap(world, eid);
}

function countQueuedPopCost(world: SimWorld, playerId: number): number {
  let total = 0;
  for (const [producerEid, queue] of world.productionQueues) {
    if (!hasComponent(world.ecs, Owner, producerEid)) continue;
    if (Owner.player[producerEid] !== playerId) continue;
    for (const defId of queue) {
      if (defId === UnitDefId.VILLAGER && hasComponent(world.ecs, ResourceWorksite, producerEid)) {
        continue;
      }
      const def = getUnitDef(defId);
      total += def?.popCost ?? 0;
    }
  }
  return total;
}

function countPendingPopCap(world: SimWorld, playerId: number): number {
  let total = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (!hasComponent(world.ecs, ConstructionSite, eid)) continue;
    total += getBuildingPopProvided(world, playerId, Building.defId[eid]);
  }
  return total;
}

function pushAiEvent(world: SimWorld, playerId: number, message: string): void {
  world.aiEvents.push({ tick: world.tick, playerId, message });
  if (world.aiEvents.length > 12) world.aiEvents.splice(0, world.aiEvents.length - 12);
}

function gatherCueForKind(kind: ResourceKind): SoundCueKind {
  switch (kind) {
    case ResourceKindId.WOOD:
      return 'gather_wood';
    case ResourceKindId.STONE:
      return 'gather_stone';
    case ResourceKindId.GOLD:
      return 'gather_gold';
    default:
      return 'gather_food';
  }
}

/** Maximum buffered sound cues. The render layer drains every frame; this cap
 *  only matters in headless runs (tests) where nothing drains — it bounds
 *  memory by dropping the oldest cues. Output-only, so determinism-safe. */
const MAX_SOUND_CUES = 256;

function pushSoundCue(
  world: SimWorld,
  kind: SoundCueKind,
  x: number,
  y: number,
  player: number
): void {
  world.soundCues.push({ kind, x, y, player });
  if (world.soundCues.length > MAX_SOUND_CUES) {
    world.soundCues.splice(0, world.soundCues.length - MAX_SOUND_CUES);
  }
}

function aiQueueUnit(world: SimWorld, atEid: number, defId: number): boolean {
  const unitDef = getUnitDef(defId);
  if (!unitDef) return false;
  if (!hasComponent(world.ecs, Building, atEid)) return false;
  const producerDef = getBuildingDef(Building.defId[atEid]);
  if (!producerDef) return false;
  const playerId = Owner.player[atEid];
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, unitDef.cost)) return false;
  const queue = world.productionQueues.get(atEid) ?? [];
  // Don't pile up queue.
  if (queue.length >= 2) return false;

  if (defId === UnitDefId.VILLAGER && hasComponent(world.ecs, ResourceWorksite, atEid)) {
    const slots = getWorksiteWorkerSlots(world, atEid);
    const occupied = countWorksiteWorkers(world, atEid) + countQueuedWorksiteWorkers(world, atEid);
    if (occupied >= slots) return false;
    spend(bank, unitDef.cost);
    queue.push(defId);
    world.productionQueues.set(atEid, queue);
    return true;
  }

  if (unitDef.trainAt !== producerDef.id) return false;
  if (!producerDef.trains.includes(unitDef.id)) return false;
  if (!isUnitUnlocked(world, playerId, defId)) return false;
  if (
    defId === UnitDefId.SCOUT_CAVALRY &&
    (world.ages[playerId]?.current ?? AgeId.DARK) < AgeId.CASTLE
  ) {
    return false;
  }
  const pop = world.population[playerId];
  if (!pop) return false;
  if (pop.current + countQueuedPopCost(world, playerId) + unitDef.popCost > pop.cap) return false;
  spend(bank, unitDef.cost);
  queue.push(defId);
  world.productionQueues.set(atEid, queue);
  return true;
}

function aiPlaceBuilding(
  world: SimWorld,
  defId: number,
  nearX: number,
  nearY: number,
  playerId: number
): boolean {
  const def = getBuildingDef(defId);
  if (!def) return false;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, def.cost)) return false;
  if (!isBuildingUnlocked(world, playerId, defId)) return false;
  if (
    defId === BuildingDefId.STABLE &&
    (world.ages[playerId]?.current ?? AgeId.DARK) < AgeId.CASTLE
  ) {
    return false;
  }
  const spot = aiFindBuildingSpot(world, def, nearX, nearY, playerId);
  if (!spot) return false;
  spend(bank, def.cost);
  spawnFoundation(world, defId, spot.x, spot.y, playerId);
  return true;
}

function aiFindBuildingSpot(
  world: SimWorld,
  def: BuildingDef,
  nearX: number,
  nearY: number,
  playerId: number
): GridPos | null {
  const cx = Math.round(nearX);
  const cy = Math.round(nearY);
  const maxR = aiBuildingPlacementSearchRadius(def);
  let bestSpot: GridPos | null = null;
  let bestScore = Infinity;
  for (let r = 2; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (!canPlaceBuildingAt(world, def, x, y)) continue;
        if (hasEnemyEntityNear(world, x, y, playerId, 8)) continue;
        const score = aiBuildingPlacementScore(world, def, x, y, nearX, nearY, playerId);
        if (score < bestScore) {
          bestScore = score;
          bestSpot = { x, y };
        }
      }
    }
  }
  return bestSpot;
}

function aiBuildingPlacementScore(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number,
  baseX: number,
  baseY: number,
  playerId: number
): number {
  const baseDist = Math.hypot(x - baseX, y - baseY);
  const spacingPenalty = aiOwnedBuildingSpacingPenalty(world, def, x, y, playerId);
  if (worksiteUsesResourceNodes(def)) {
    const resourceDist = aiNearestResourceDistance(
      world,
      x,
      y,
      def.harvestKind as ResourceKind,
      def.harvestRadius ?? 6
    );
    return resourceDist * 5 + baseDist * 0.08 + spacingPenalty;
  }
  if (def.id === 'FARM') {
    return aiPreferredBaseDistanceScore(baseDist, 7) +
      aiNearestOwnedBuildingTypeDistance(world, x, y, playerId, BuildingDefId.FARM) * 0.2 +
      spacingPenalty;
  }
  if (def.id === 'MILL') {
    return aiPreferredBaseDistanceScore(baseDist, 8) +
      aiNearestOwnedBuildingTypeDistance(world, x, y, playerId, BuildingDefId.FARM) * 1.8 +
      spacingPenalty;
  }
  if (def.id === 'DEFENSIVE_TOWER') {
    return aiPreferredBaseDistanceScore(baseDist, 11) + spacingPenalty;
  }
  if (def.trains.length > 0) {
    return aiPreferredBaseDistanceScore(baseDist, 9) + spacingPenalty;
  }
  if (def.id === 'HOUSE') {
    return aiPreferredBaseDistanceScore(baseDist, 8) + spacingPenalty;
  }
  return aiPreferredBaseDistanceScore(baseDist, 7) + spacingPenalty;
}

function aiPreferredBaseDistanceScore(distance: number, preferred: number): number {
  const tooClosePenalty = distance < 4 ? (4 - distance) * (4 - distance) * 5 : 0;
  return Math.abs(distance - preferred) * 0.75 + tooClosePenalty;
}

function aiOwnedBuildingSpacingPenalty(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number,
  playerId: number
): number {
  const desiredGap = aiDesiredBuildingGap(def);
  let penalty = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Health.hp[eid] <= 0) continue;
    const edgeDist = distToBuildingEdge(world, x, y, eid);
    if (edgeDist >= desiredGap) continue;
    const deficit = desiredGap - edgeDist;
    penalty += deficit * deficit * 8;
  }
  return penalty;
}

function aiDesiredBuildingGap(def: BuildingDef): number {
  if (worksiteUsesResourceNodes(def)) return 1.8;
  if (def.id === 'FARM') return 2.1;
  if (def.id === 'MILL') return 2.4;
  if (def.id === 'HOUSE') return 1.7;
  if (def.id === 'DEFENSIVE_TOWER') return 3.2;
  if (def.trains.length > 0) return 2.8;
  return 2.2;
}

function aiNearestOwnedBuildingTypeDistance(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number,
  defId: number
): number {
  let best = 20;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Building.defId[eid] !== defId) continue;
    if (Health.hp[eid] <= 0) continue;
    best = Math.min(best, distToBuildingEdge(world, x, y, eid));
  }
  return best;
}

function aiBuildingPlacementSearchRadius(def: BuildingDef): number {
  if (def.id === 'FARM') return 24;
  if (def.id === 'MILL') return 20;
  if (def.id === 'LUMBER_CAMP') return 52;
  if (worksiteUsesResourceNodes(def)) return 34;
  return 12;
}

function aiNearestResourceDistance(
  world: SimWorld,
  x: number,
  y: number,
  kind: ResourceKind,
  radius: number
): number {
  const target = findNearestResource(world, x, y, kind, radius);
  if (target === null) return radius;
  return Math.hypot(Position.x[target] - x, Position.y[target] - y);
}

function winConditionSystem(world: SimWorld): void {
  if (world.outcome.state !== 'playing') return;
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_BILA_HORA) {
    const playerArmy = countLiveMilitary(world, LOCAL_PLAYER_ID);
    const enemyArmy = countLiveMilitary(world, AI_PLAYER_ID);
    if (playerArmy <= 0 && enemyArmy > 0) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
    } else if (enemyArmy <= 0 && playerArmy > 0) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_KUTNA_HORA) {
    const townCenter = findOwnedTownCenter(world, LOCAL_PLAYER_ID);
    if (townCenter === null) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
      return;
    }
    const survived = world.campaign.objectives.find((objective) =>
      objective.id === 'survive_kutna_hora'
    )?.completed;
    if (survived) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_SUDOMER) {
    // Town defense: lose if the Town Hall falls, win by surviving every wave.
    if (findOwnedTownCenter(world, LOCAL_PLAYER_ID) === null) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
      return;
    }
    const survived = world.campaign.objectives.find((objective) =>
      objective.id === 'survive_sudomer_assault'
    )?.completed;
    if (survived) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) {
    // Economy trench duel: either command foundry falling decides the mission.
    const playerCommand = world.campaign.trackedObjectiveEids.hold_legion_command ?? [];
    const playerCommandDown = playerCommand.length > 0 && countLiveTrackedEids(world, playerCommand) === 0;
    if (playerCommandDown) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
      return;
    }
    const bunker = world.campaign.trackedObjectiveEids.take_command_bunker ?? [];
    const bunkerDown = bunker.length > 0 && countLiveTrackedEids(world, bunker) === 0;
    if (bunkerDown) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  // Conquest victory: only one player still has a Town Center.
  const tcs = townCenterQuery(world.ecs);
  let p1 = 0;
  let p2 = 0;
  for (const eid of tcs) {
    if (Health.hp[eid] <= 0) continue;
    const player = Owner.player[eid];
    if (player === 1) p1++;
    else if (player === 2) p2++;
  }
  if (p1 === 0 && p2 > 0) {
    world.outcome = { state: 'victory', winnerPlayerId: 2, mode: 'conquest' };
  } else if (p2 === 0 && p1 > 0) {
    world.outcome = { state: 'victory', winnerPlayerId: 1, mode: 'conquest' };
  }
}

function gatheringWalkingTo(world: SimWorld, eid: number): void {
  const target = Gatherer.targetEid[eid];
  if (target < 0 || !hasComponent(world.ecs, Resource, target)) {
    Gatherer.state[eid] = GathererStateId.IDLE;
    return;
  }
  if (Resource.amount[target] <= 0) {
    // Resource depleted en route — try to retarget to nearest of same kind.
    const kind = Resource.kind[target] as ResourceKind;
    // Auto-retarget after a node depletes: stay within ~15 tiles of the
    // villager rather than scouring the whole map. This is what stops the
    // AI's berry-gatherers from walking across the river to the human's
    // berries once their own deplete.
    if (
      !routeWorksiteWorkerToResource(world, eid, kind) &&
      !routeToNearestReachableResource(world, eid, kind, 15)
    ) {
      Gatherer.state[eid] = GathererStateId.IDLE;
      Gatherer.targetEid[eid] = -1;
    }
    return;
  }

  const dx = Position.x[eid] - Position.x[target];
  const dy = Position.y[eid] - Position.y[target];
  if (Math.hypot(dx, dy) <= RESOURCE_GATHER_DISTANCE) {
    // Arrived at the resource node. Keep this tight so harvesting animations
    // visually connect with the trunk / rock / bush rather than swinging at air.
    Gatherer.state[eid] = GathererStateId.GATHERING;
    Gatherer.cooldown[eid] = VILLAGER_GATHER_COOLDOWN;
    world.paths.delete(eid);
  }
  // Otherwise the path is in motion via movementSystem.
}

function gatheringActive(world: SimWorld, eid: number): void {
  const target = Gatherer.targetEid[eid];
  if (target < 0 || !hasComponent(world.ecs, Resource, target)) {
    // Resource removed under us — pick nearest of same kind if we have a hint.
    const carryKind = ResourceCarry.amount[eid] > 0
      ? (ResourceCarry.kind[eid] as ResourceKind)
      : null;
    if (carryKind !== null) {
      if (
        routeWorksiteWorkerToResource(world, eid, carryKind) ||
        routeToNearestReachableResource(world, eid, carryKind, 15)
      ) return;
    }
    Gatherer.state[eid] = GathererStateId.IDLE;
    Gatherer.targetEid[eid] = -1;
    return;
  }

  // Tick down the cooldown; emit a gather increment when it hits 0.
  if (Gatherer.cooldown[eid] > 0) {
    Gatherer.cooldown[eid] -= 1;
    return;
  }

  const kind = Resource.kind[target] as ResourceKind;
  // Refill or initialise carry slot.
  if (ResourceCarry.amount[eid] === 0) {
    ResourceCarry.kind[eid] = kind;
  }
  ResourceCarry.amount[eid] += 1;
  Resource.amount[target] -= 1;
  Gatherer.cooldown[eid] = VILLAGER_GATHER_COOLDOWN;
  pushSoundCue(world, gatherCueForKind(kind), Position.x[eid], Position.y[eid], Owner.player[eid]);

  // If resource is now empty, retarget on next tick via WALKING_TO branch.
  if (Resource.amount[target] <= 0) {
    removeEntity(world.ecs, target);
    Gatherer.targetEid[eid] = -1;
  }

  // If carry full, head home.
  if (ResourceCarry.amount[eid] >= VILLAGER_CARRY_CAPACITY) {
    Gatherer.state[eid] = GathererStateId.RETURNING;
    Gatherer.cooldown[eid] = 0;
    routeToNearestDropOff(world, eid);
  }
}

function gatheringReturning(world: SimWorld, eid: number): void {
  // Make sure we have an active path toward a drop-off.
  if (!world.paths.has(eid)) {
    routeToNearestDropOff(world, eid);
    if (!world.paths.has(eid) && tryFallbackWorksiteDeposit(world, eid)) return;
  }
  const dropOff = findNearestDropOffEid(world, eid);
  if (dropOff === null) {
    tryFallbackWorksiteDeposit(world, eid);
    return;
  }
  // Footprint-aware arrival: require the worker to reach a final contact point
  // close to the wall, not merely the center of an adjacent tile.
  const dist = distToBuildingEdge(world, Position.x[eid], Position.y[eid], dropOff);
  if (dist <= DROP_OFF_EDGE_DISTANCE) {
    Gatherer.state[eid] = GathererStateId.DEPOSITING;
    Gatherer.cooldown[eid] = DROP_OFF_DEPOSIT_TICKS;
    world.paths.delete(eid);
  }
}

function tryFallbackWorksiteDeposit(world: SimWorld, worker: number): boolean {
  if (!hasComponent(world.ecs, WorksiteWorker, worker)) return false;
  const siteEid = WorksiteWorker.siteEid[worker];
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (!hasComponent(world.ecs, DropOff, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  const carryAmt = ResourceCarry.amount[worker];
  if (carryAmt <= 0) return false;
  const carryKind = ResourceCarry.kind[worker] as ResourceKind;
  if ((DropOff.acceptsMask[siteEid] & (1 << carryKind)) === 0) return false;
  const dist = distToBuildingEdge(world, Position.x[worker], Position.y[worker], siteEid);
  if (dist > WORKSITE_FALLBACK_DROP_OFF_RADIUS) return false;
  Gatherer.state[worker] = GathererStateId.DEPOSITING;
  Gatherer.cooldown[worker] = DROP_OFF_DEPOSIT_TICKS;
  Gatherer.targetEid[worker] = siteEid;
  world.paths.delete(worker);
  return true;
}

/**
 * Drop-off system. For each gatherer in DEPOSITING state, credit the player bank
 * with their carry and bounce them back to the resource (if it still exists) or IDLE.
 */
function dropoffSystem(world: SimWorld): void {
  const ents = gathererQuery(world.ecs);
  for (const eid of ents) {
    if (Gatherer.state[eid] !== GathererStateId.DEPOSITING) continue;
    if (Gatherer.cooldown[eid] > 0) {
      Gatherer.cooldown[eid] -= 1;
      if (Gatherer.cooldown[eid] > 0) continue;
    }
    const carryAmt = ResourceCarry.amount[eid];
    const carryKind = ResourceCarry.kind[eid] as ResourceKind;
    const playerId = Owner.player[eid];
    if (carryAmt > 0 && world.resources[playerId]) {
      world.resources[playerId][carryKind] += carryAmt + millDropOffFoodBonus(world, eid, carryKind, carryAmt);
    }
    ResourceCarry.amount[eid] = 0;

    if (routeWorksiteWorkerAfterDropoff(world, eid, carryKind)) continue;

    // Decide next state: stick with the same resource kind, but only if a
    // node exists within a reasonable radius of the drop-off — not across
    // the map. Stops post-deposit villagers from wandering into enemy
    // territory.
    if (!routeToNearestReachableResource(world, eid, carryKind, 15)) {
      Gatherer.state[eid] = GathererStateId.IDLE;
      Gatherer.targetEid[eid] = -1;
    }
  }
}

function millDropOffFoodBonus(
  world: SimWorld,
  worker: number,
  carryKind: ResourceKind,
  carryAmt: number
): number {
  if (carryKind !== ResourceKindId.FOOD || carryAmt <= 0) return 0;
  const dropOff = findNearestDropOffEid(world, worker);
  if (dropOff === null) return 0;
  if (!hasComponent(world.ecs, Building, dropOff)) return 0;
  if (Building.defId[dropOff] !== BuildingDefId.MILL) return 0;
  return Math.max(1, Math.floor(carryAmt * MILL_FOOD_DEPOSIT_BONUS_MULTIPLIER));
}

function routeWorksiteWorkerAfterDropoff(
  world: SimWorld,
  worker: number,
  kind: ResourceKind
): boolean {
  if (!hasComponent(world.ecs, WorksiteWorker, worker)) return false;
  const siteEid = WorksiteWorker.siteEid[worker];
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  if (Building.defId[siteEid] === BuildingDefId.FARM) {
    return kind === ResourceKindId.FOOD && routeFarmWorkerToNextPatch(world, worker, siteEid);
  }
  return routeWorksiteWorkerToResource(world, worker, kind);
}

function routeWorksiteWorkerToResource(
  world: SimWorld,
  worker: number,
  kind: ResourceKind
): boolean {
  if (!hasComponent(world.ecs, WorksiteWorker, worker)) return false;
  const siteEid = WorksiteWorker.siteEid[worker];
  if (!hasComponent(world.ecs, ResourceWorksite, siteEid)) return false;
  if (Health.hp[siteEid] <= 0) return false;
  if (ResourceWorksite.kind[siteEid] !== kind) return false;
  const def = getBuildingDef(Building.defId[siteEid]);
  if (!def || !worksiteUsesResourceNodes(def)) return false;
  return routeToNearestReachableResource(
    world,
    worker,
    kind,
    def.harvestRadius ?? 6,
    Position.x[siteEid],
    Position.y[siteEid]
  );
}

/**
 * Move entities toward their current path waypoint at Speed.value tiles/sec.
 */
function movementSystem(world: SimWorld): void {
  const dt = 1 / SIM.TICK_HZ;
  const ents = movableQuery(world.ecs);
  for (const eid of ents) {
    // Snapshot pre-step position so the render layer can interpolate.
    if (hasComponent(world.ecs, PrevPosition, eid)) {
      PrevPosition.x[eid] = Position.x[eid];
      PrevPosition.y[eid] = Position.y[eid];
    }
    const path = world.paths.get(eid);
    if (!path || path.length === 0) {
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      world.movementStuck.delete(eid);
      clearFormationSpeedCap(world, eid);
      continue;
    }
    const waypoint = path[0];
    const px = Position.x[eid];
    const py = Position.y[eid];
    const dx = waypoint.x - px;
    const dy = waypoint.y - py;
    const dist = Math.hypot(dx, dy);
    const speedCap = world.formationSpeedCaps.get(eid);
    const baseSpeed = speedCap === undefined
      ? Speed.value[eid]
      : Math.min(Speed.value[eid], speedCap);
    const speed = baseSpeed * movementTerrainSpeedMultiplier(world, eid);
    const stepDist = speed * dt;
    const arrivalTolerance = pathArrivalTolerance(world, eid, path);

    if (dist <= stepDist || dist <= arrivalTolerance) {
      completeCurrentWaypoint(world, eid, path, waypoint, path.length > 1 || dist <= stepDist);
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      if (!tryMoveUnitStep(world, eid, nx, ny, stepDist, speed, waypoint)) {
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
      }
      updateMovementStuckState(world, eid, path);
    }
  }
  unitSeparationSystem(world);
}

function movementTerrainSpeedMultiplier(world: SimWorld, eid: number): number {
  const tx = Math.round(Position.x[eid]);
  const ty = Math.round(Position.y[eid]);
  if (!isTileInMap(tx, ty)) return 1;
  const tile = world.map.tiles[ty * MAP.WIDTH + tx];
  // Barbed wire bogs any unit to a crawl — the WW1 kill-zone in front of the
  // machine-gun nests.
  if (tile === TileType.BARBED_WIRE) return ZBOROV_WIRE_SPEED_MULTIPLIER;
  if (tile !== TileType.MUD) return 1;
  return hasComponent(world.ecs, ScoutCavalryTag, eid)
    ? SUDOMER_MUD_CAVALRY_SPEED_MULTIPLIER
    : SUDOMER_MUD_INFANTRY_SPEED_MULTIPLIER;
}

function pathArrivalTolerance(world: SimWorld, eid: number, path: GridPos[]): number {
  if (path.length > 1) return PATH_WAYPOINT_TOLERANCE;
  if (hasComponent(world.ecs, Gatherer, eid)) {
    const state = Gatherer.state[eid];
    if (
      state === GathererStateId.WALKING_TO ||
      state === GathererStateId.WALKING_TO_BUILD ||
      state === GathererStateId.RETURNING
    ) {
      return PATH_CONTACT_FINAL_TOLERANCE;
    }
  }
  if (hasComponent(world.ecs, BuildOrder, eid) && BuildOrder.targetEid[eid] >= 0) {
    return PATH_CONTACT_FINAL_TOLERANCE;
  }
  return PATH_FINAL_TOLERANCE;
}

function completeCurrentWaypoint(
  world: SimWorld,
  eid: number,
  path: GridPos[],
  waypoint: GridPos,
  snapToWaypoint: boolean
): void {
  if (snapToWaypoint && canUnitOccupyMovementTarget(world, eid, waypoint.x, waypoint.y)) {
    Position.x[eid] = waypoint.x;
    Position.y[eid] = waypoint.y;
  }
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  path.shift();
  if (path.length === 0) {
    world.paths.delete(eid);
    world.movementStuck.delete(eid);
    clearFormationSpeedCap(world, eid);
    return;
  }

  setPathHeadTarget(eid, path);
  updateMovementStuckState(world, eid, path);
}

function setPathHeadTarget(eid: number, path: GridPos[]): void {
  const head = path[0];
  if (!head) return;
  PathTarget.x[eid] = Math.round(head.x);
  PathTarget.y[eid] = Math.round(head.y);
}

function tryMoveUnitStep(
  world: SimWorld,
  eid: number,
  dirX: number,
  dirY: number,
  stepDist: number,
  speed: number,
  waypoint: GridPos
): boolean {
  const len = Math.hypot(dirX, dirY);
  if (len < 0.001 || stepDist <= 0) return false;
  const nx = dirX / len;
  const ny = dirY / len;
  const tx = Position.x[eid] + nx * stepDist;
  const ty = Position.y[eid] + ny * stepDist;
  if (
    !canUnitOccupyMovementTarget(world, eid, tx, ty) &&
    !canUnitSqueezeAlongDiagonalPath(world, tx, ty, nx, ny, waypoint)
  ) {
    return false;
  }
  Position.x[eid] = tx;
  Position.y[eid] = ty;
  Velocity.x[eid] = nx * speed;
  Velocity.y[eid] = ny * speed;
  return true;
}

function updateMovementStuckState(world: SimWorld, eid: number, path: GridPos[]): void {
  const waypoint = path[0];
  if (!waypoint) {
    world.movementStuck.delete(eid);
    return;
  }

  const dist = Math.hypot(Position.x[eid] - waypoint.x, Position.y[eid] - waypoint.y);
  let state = world.movementStuck.get(eid);
  const waypointChanged =
    !state ||
    Math.hypot(state.waypointX - waypoint.x, state.waypointY - waypoint.y) > 0.05;
  if (waypointChanged) {
    state = {
      lastDist: dist,
      waypointX: waypoint.x,
      waypointY: waypoint.y,
      noProgressTicks: 0,
      cooldownTicks: 0,
      attempts: 0,
    };
    world.movementStuck.set(eid, state);
    return;
  }
  if (!state) return;

  if (state.cooldownTicks > 0) state.cooldownTicks -= 1;
  if (dist < state.lastDist - STUCK_PROGRESS_EPSILON || dist <= 0.18) {
    state.noProgressTicks = 0;
    state.attempts = 0;
  } else {
    state.noProgressTicks += 1;
  }

  state.lastDist = dist;
  state.waypointX = waypoint.x;
  state.waypointY = waypoint.y;

  if (state.noProgressTicks < STUCK_PROGRESS_TICKS || state.cooldownTicks > 0) return;

  state.noProgressTicks = 0;
  state.cooldownTicks = STUCK_RECOVERY_COOLDOWN_TICKS;
  const recovered = recoverStuckMovement(world, eid, path, state);
  state.attempts += 1;
  if (!recovered) return;

  const nextWaypoint = world.paths.get(eid)?.[0];
  if (!nextWaypoint) {
    world.movementStuck.delete(eid);
    return;
  }
  state.lastDist = Math.hypot(Position.x[eid] - nextWaypoint.x, Position.y[eid] - nextWaypoint.y);
  state.waypointX = nextWaypoint.x;
  state.waypointY = nextWaypoint.y;
}

function recoverStuckMovement(
  world: SimWorld,
  eid: number,
  path: GridPos[],
  _state: MovementStuckState
): boolean {
  return repathAroundStuckDestination(world, eid, path);
}

function repathAroundStuckDestination(
  world: SimWorld,
  eid: number,
  path: GridPos[]
): boolean {
  const destination = path[path.length - 1];
  if (!destination) return false;

  const from = {
    x: Math.round(Position.x[eid]),
    y: Math.round(Position.y[eid]),
  };
  const destX = Math.round(destination.x);
  const destY = Math.round(destination.y);
  const candidates: Array<{ tile: GridPos; score: number }> = [];
  const seen = new Set<string>();

  for (let r = 0; r <= STUCK_REPATH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = destX + dx;
        const y = destY + dy;
        if (!isTileInMap(x, y) || world.map.walkability[y][x] !== 0) continue;
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          tile: { x, y },
          score:
            Math.hypot(Position.x[eid] - x, Position.y[eid] - y) +
            Math.hypot(destination.x - x, destination.y - y) * 0.5 +
            (isEconomicWorker(world, eid) ? workerContactCrowdPenalty(world, eid, x, y) : 0),
        });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  for (const candidate of candidates) {
    const nextPath = world.pathfinder.findPath(from, candidate.tile);
    if (nextPath === null) continue;
    if (nextPath.length === 0) {
      if (
        Math.hypot(Position.x[eid] - destination.x, Position.y[eid] - destination.y) >
        pathArrivalTolerance(world, eid, path)
      ) {
        continue;
      }
      world.paths.delete(eid);
      world.movementStuck.delete(eid);
      return true;
    }
    if (!pathHasUsableFirstStep(world, eid, nextPath)) continue;
    world.paths.set(eid, nextPath);
    setPathHeadTarget(eid, nextPath);
    return true;
  }
  return false;
}

function pathHasUsableFirstStep(world: SimWorld, eid: number, path: GridPos[]): boolean {
  const first = path[0];
  if (!first) return true;
  const dx = first.x - Position.x[eid];
  const dy = first.y - Position.y[eid];
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return true;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const stepDist = Math.min(Speed.value[eid] / SIM.TICK_HZ, dist);
  const nextX = Position.x[eid] + dirX * stepDist;
  const nextY = Position.y[eid] + dirY * stepDist;
  return (
    canUnitOccupyMovementTarget(world, eid, nextX, nextY) ||
    canUnitSqueezeAlongDiagonalPath(world, nextX, nextY, dirX, dirY, first)
  );
}

function unitSeparationSystem(world: SimWorld): void {
  const ents = Array.from(unitQuery(world.ecs)).filter((eid) => Health.hp[eid] > 0);
  for (let pass = 0; pass < UNIT_SEPARATION_PASSES; pass++) {
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j];
        if (areVillagersMutuallyNonBlocking(world, a, b)) continue;
        const radius = unitSeparationRadius(world, a, b);
        let dx = Position.x[b] - Position.x[a];
        let dy = Position.y[b] - Position.y[a];
        let dist = Math.hypot(dx, dy);
        if (dist >= radius) continue;

        const overlapDist = dist;
        if (dist < 0.001) {
          const angle = deterministicPairAngle(a, b);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        } else {
          dx /= dist;
          dy /= dist;
        }

        const push = Math.min(
          unitSeparationMaxNudge(world, a, b),
          (radius - overlapDist) * 0.5
        );
        if (push <= 0) continue;
        const weights = unitSeparationWeights(world, a, b);
        tryNudgeUnit(world, a, -dx * push * weights.a, -dy * push * weights.a);
        tryNudgeUnit(world, b, dx * push * weights.b, dy * push * weights.b);
      }
    }
  }
}

function areVillagersMutuallyNonBlocking(world: SimWorld, a: number, b: number): boolean {
  return hasComponent(world.ecs, VillagerTag, a) && hasComponent(world.ecs, VillagerTag, b);
}

function unitSeparationWeights(world: SimWorld, a: number, b: number): { a: number; b: number } {
  if (Owner.player[a] !== Owner.player[b]) return { a: 0.5, b: 0.5 };

  const aMoving = world.paths.has(a);
  const bMoving = world.paths.has(b);
  if (aMoving && bMoving) return { a: 0.15, b: 0.15 };
  if (aMoving) return { a: 0.15, b: 0.85 };
  if (bMoving) return { a: 0.85, b: 0.15 };
  return { a: 0.5, b: 0.5 };
}

function unitSeparationRadius(world: SimWorld, a: number, b: number): number {
  return isEconomicWorker(world, a) || isEconomicWorker(world, b)
    ? WORKER_SEPARATION_RADIUS
    : UNIT_SEPARATION_RADIUS;
}

function unitSeparationMaxNudge(world: SimWorld, a: number, b: number): number {
  return isEconomicWorker(world, a) || isEconomicWorker(world, b)
    ? WORKER_SEPARATION_MAX_NUDGE
    : UNIT_SEPARATION_MAX_NUDGE;
}

function isEconomicWorker(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, WorksiteWorker, eid) ||
    hasComponent(world.ecs, VillagerTag, eid);
}

function deterministicPairAngle(a: number, b: number): number {
  const hash = Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663);
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function tryNudgeUnit(world: SimWorld, eid: number, dx: number, dy: number): void {
  const nx = Position.x[eid] + dx;
  const ny = Position.y[eid] + dy;
  if (!canUnitOccupy(world, nx, ny)) return;
  Position.x[eid] = nx;
  Position.y[eid] = ny;
}

function canUnitOccupy(world: SimWorld, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
  return world.map.walkability[ty][tx] === 0;
}

function canUnitSqueezeAlongDiagonalPath(
  world: SimWorld,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  waypoint: GridPos
): boolean {
  if (Math.abs(dirX) < 0.2 || Math.abs(dirY) < 0.2) return false;
  if (!isTileInMap(Math.round(x), Math.round(y))) return false;
  return canUnitOccupy(world, waypoint.x, waypoint.y);
}

function canUnitOccupyMovementTarget(world: SimWorld, eid: number, x: number, y: number): boolean {
  if (canUnitOccupy(world, x, y)) return true;
  if (!hasComponent(world.ecs, WorksiteWorker, eid)) return false;
  const siteEid = WorksiteWorker.siteEid[eid];
  if (!hasComponent(world.ecs, Building, siteEid)) return false;
  if (Building.defId[siteEid] !== BuildingDefId.FARM) return false;
  if (Gatherer.targetEid[eid] !== siteEid) return false;
  return distToBuildingEdge(world, x, y, siteEid) <= FARM_WORK_EDGE_DISTANCE;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Plan a path for `eid` to (tx, ty) and stash it in world.paths.
 *  Returns `true` if a non-trivial path was produced (caller can safely commit
 *  state transitions). Returns `false` if the destination is unreachable —
 *  caller should leave the unit's previous state alone. */
function pathTo(world: SimWorld, eid: number, tx: number, ty: number): boolean {
  const from = {
    x: Math.round(Position.x[eid]),
    y: Math.round(Position.y[eid]),
  };
  const to = { x: Math.round(tx), y: Math.round(ty) };
  const path = world.pathfinder.findPath(from, to);
  if (path === null) return false;
  if (path.length === 0) {
    // Same tile — treat as success but no path needed.
    world.paths.delete(eid);
    return true;
  }
  world.paths.set(eid, path);
  PathTarget.x[eid] = path[0].x;
  PathTarget.y[eid] = path[0].y;
  return true;
}

function pathToResourceContact(world: SimWorld, eid: number, target: number): boolean {
  const from = {
    x: Math.round(Position.x[eid]),
    y: Math.round(Position.y[eid]),
  };
  for (const candidate of resourceApproachCandidates(world, eid, target)) {
    const path = world.pathfinder.findPath(from, candidate.tile);
    if (path === null) continue;

    const nextPath: GridPos[] = [...path];
    const final = nextPath[nextPath.length - 1];
    if (
      Math.hypot(Position.x[eid] - Position.x[target], Position.y[eid] - Position.y[target]) >
        RESOURCE_GATHER_DISTANCE &&
      (!final || Math.hypot(final.x - candidate.point.x, final.y - candidate.point.y) > 0.01)
    ) {
      nextPath.push(candidate.point);
    }

    if (nextPath.length === 0) {
      world.paths.delete(eid);
      return true;
    }
    world.paths.set(eid, nextPath);
    PathTarget.x[eid] = Math.round(nextPath[0].x);
    PathTarget.y[eid] = Math.round(nextPath[0].y);
    return true;
  }
  return false;
}

function resourceApproachCandidates(
  world: SimWorld,
  eid: number,
  target: number
): Array<{ tile: GridPos; point: GridPos; score: number }> {
  const cx = Math.round(Position.x[target]);
  const cy = Math.round(Position.y[target]);
  const out: Array<{ tile: GridPos; point: GridPos; score: number }> = [];
  const seen = new Set<string>();

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (!isTileInMap(tx, ty)) continue;
      if (world.map.walkability[ty][tx] !== 0) continue;
      const key = `${tx},${ty}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let vx = tx - Position.x[target];
      let vy = ty - Position.y[target];
      let len = Math.hypot(vx, vy);
      if (len < 0.001) {
        const angle = deterministicPairAngle(eid, target);
        vx = Math.cos(angle);
        vy = Math.sin(angle);
        len = 1;
      }
      vx /= len;
      vy /= len;
      const point = {
        x: Position.x[target] + vx * WORKER_RESOURCE_CONTACT_GAP,
        y: Position.y[target] + vy * WORKER_RESOURCE_CONTACT_GAP,
      };
      out.push({
        tile: { x: tx, y: ty },
        point,
        score:
          Math.hypot(Position.x[eid] - point.x, Position.y[eid] - point.y) +
          workerContactCrowdPenalty(world, eid, point.x, point.y) +
          workerResourceContactSlotPenalty(world, eid, target, point.x, point.y),
      });
    }
  }

  out.sort((a, b) => a.score - b.score);
  return out;
}

function workerResourceContactSlotPenalty(
  world: SimWorld,
  eid: number,
  target: number,
  x: number,
  y: number
): number {
  if (!hasComponent(world.ecs, VillagerTag, eid)) return 0;
  const owner = hasComponent(world.ecs, Owner, eid) ? Owner.player[eid] : -1;
  let penalty = 0;
  for (const other of unitQuery(world.ecs)) {
    if (other === eid) continue;
    if (Health.hp[other] <= 0) continue;
    if (!hasComponent(world.ecs, VillagerTag, other)) continue;
    if (owner >= 0 && Owner.player[other] !== owner) continue;
    if (!hasComponent(world.ecs, Gatherer, other)) continue;
    if (Gatherer.targetEid[other] !== target) continue;
    if (
      Gatherer.state[other] === GathererStateId.RETURNING ||
      Gatherer.state[other] === GathererStateId.DEPOSITING
    ) {
      continue;
    }

    const dist = Math.hypot(Position.x[other] - x, Position.y[other] - y);
    if (dist < WORKER_RESOURCE_CONTACT_SLOT_RADIUS) {
      penalty += WORKER_RESOURCE_CONTACT_SLOT_UNIT_PENALTY *
        (1 - dist / WORKER_RESOURCE_CONTACT_SLOT_RADIUS);
    }

    const path = world.paths.get(other);
    const final = path?.[path.length - 1];
    if (!final) continue;
    const pathDist = Math.hypot(final.x - x, final.y - y);
    if (pathDist < WORKER_RESOURCE_CONTACT_SLOT_RADIUS) {
      penalty += WORKER_RESOURCE_CONTACT_SLOT_PATH_PENALTY *
        (1 - pathDist / WORKER_RESOURCE_CONTACT_SLOT_RADIUS);
    }
  }
  return penalty;
}

function startGatheringResource(world: SimWorld, eid: number, target: number): boolean {
  if (!hasComponent(world.ecs, Resource, target) || Resource.amount[target] <= 0) {
    return false;
  }
  if (!pathToResourceContact(world, eid, target)) return false;
  Gatherer.targetEid[eid] = target;
  const isClose =
    Math.hypot(Position.x[eid] - Position.x[target], Position.y[eid] - Position.y[target]) <=
    RESOURCE_GATHER_DISTANCE;
  Gatherer.cooldown[eid] = isClose ? VILLAGER_GATHER_COOLDOWN : 0;
  Gatherer.state[eid] = isClose ? GathererStateId.GATHERING : GathererStateId.WALKING_TO;
  return true;
}

function routeToNearestReachableResource(
  world: SimWorld,
  eid: number,
  kind: ResourceKind,
  maxRange: number,
  originX = Position.x[eid],
  originY = Position.y[eid],
  avoidTargets: Set<number> = new Set()
): boolean {
  const candidates = resourceQuery(world.ecs)
    .filter((target) => Resource.kind[target] === kind && Resource.amount[target] > 0)
    .map((target) => ({
      target,
      dist: Math.hypot(Position.x[target] - originX, Position.y[target] - originY),
    }))
    .filter((candidate) => candidate.dist <= maxRange)
    .sort((a, b) => a.dist - b.dist);

  for (const { target } of candidates) {
    if (avoidTargets.has(target)) continue;
    if (startGatheringResource(world, eid, target)) return true;
  }
  for (const { target } of candidates) {
    if (startGatheringResource(world, eid, target)) return true;
  }
  world.paths.delete(eid);
  return false;
}

function routeFarmWorkerToNextPatch(world: SimWorld, worker: number, siteEid: number): boolean {
  if (!hasComponent(world.ecs, Building, siteEid)) return false;
  const candidates = farmWorkPatchCandidates(world, worker, siteEid);
  if (candidates.length === 0) return false;
  const start = ResourceWorksite.progress[siteEid] % candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const index = (start + i) % candidates.length;
    const candidate = candidates[index];
    const from = {
      x: Math.round(Position.x[worker]),
      y: Math.round(Position.y[worker]),
    };
    const path = world.pathfinder.findPath(from, candidate.tile);
    if (path === null) continue;

    const nextPath: GridPos[] = [...path];
    const final = nextPath[nextPath.length - 1];
    if (
      !final ||
      Math.hypot(final.x - candidate.point.x, final.y - candidate.point.y) > 0.01
    ) {
      nextPath.push(candidate.point);
    }

    if (nextPath.length === 0) {
      world.paths.delete(worker);
    } else {
      world.paths.set(worker, nextPath);
      PathTarget.x[worker] = Math.round(nextPath[0].x);
      PathTarget.y[worker] = Math.round(nextPath[0].y);
    }
    ResourceWorksite.progress[siteEid] = (index + 1) % candidates.length;
    Gatherer.targetEid[worker] = siteEid;
    Gatherer.state[worker] = GathererStateId.WALKING_TO_BUILD;
    Gatherer.cooldown[worker] = 0;
    return true;
  }
  return false;
}

function farmWorkPatchCandidates(
  world: SimWorld,
  worker: number,
  siteEid: number
): Array<{ tile: GridPos; point: GridPos; score: number }> {
  const def = BUILDING_TABLE[Building.defId[siteEid]];
  if (!def) return [];
  const rect = buildingFootprintRect(siteEid, def);
  const candidates: Array<{ tile: GridPos; point: GridPos; score: number }> = [];
  const seen = new Set<string>();

  for (const candidate of buildingApproachCandidates(world, worker, siteEid)) {
    const point = {
      x: clamp(candidate.point.x, rect.minX + FARM_WORK_PATCH_INSET, rect.maxX - FARM_WORK_PATCH_INSET),
      y: clamp(candidate.point.y, rect.minY + FARM_WORK_PATCH_INSET, rect.maxY - FARM_WORK_PATCH_INSET),
    };
    const key = `${candidate.tile.x},${candidate.tile.y}:${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      tile: candidate.tile,
      point,
      score:
        Math.hypot(Position.x[worker] - point.x, Position.y[worker] - point.y) +
        candidate.resourcePenalty,
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function pathToBuildingContact(world: SimWorld, eid: number, buildingEid: number): boolean {
  const candidates = buildingApproachCandidates(world, eid, buildingEid);
  for (const candidate of candidates) {
    const from = {
      x: Math.round(Position.x[eid]),
      y: Math.round(Position.y[eid]),
    };
    const path = world.pathfinder.findPath(from, candidate.tile);
    if (path === null) continue;

    const nextPath: GridPos[] = [...path];
    const final = nextPath[nextPath.length - 1];
    if (
      !final ||
      Math.hypot(final.x - candidate.point.x, final.y - candidate.point.y) > 0.01
    ) {
      nextPath.push(candidate.point);
    }

    if (nextPath.length === 0) {
      world.paths.delete(eid);
      return true;
    }
    world.paths.set(eid, nextPath);
    PathTarget.x[eid] = Math.round(nextPath[0].x);
    PathTarget.y[eid] = Math.round(nextPath[0].y);
    return true;
  }
  return false;
}

function buildingApproachCandidates(
  world: SimWorld,
  eid: number,
  buildingEid: number
): Array<{ tile: GridPos; point: GridPos; score: number; resourcePenalty: number }> {
  const def = BUILDING_TABLE[Building.defId[buildingEid]];
  if (!def) return [];
  const rect = buildingFootprintRect(buildingEid, def);
  const out: Array<{ tile: GridPos; point: GridPos; score: number; resourcePenalty: number }> = [];

  for (let ty = rect.tileY0 - 1; ty <= rect.tileY1 + 1; ty++) {
    for (let tx = rect.tileX0 - 1; tx <= rect.tileX1 + 1; tx++) {
      if (tx >= rect.tileX0 && tx <= rect.tileX1 && ty >= rect.tileY0 && ty <= rect.tileY1) {
        continue;
      }
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) continue;
      if (world.map.walkability[ty][tx] !== 0) continue;

      const edgeX = clamp(tx, rect.minX, rect.maxX);
      const edgeY = clamp(ty, rect.minY, rect.maxY);
      let vx = tx - edgeX;
      let vy = ty - edgeY;
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      const point = {
        x: edgeX + vx * BUILDING_CONTACT_EDGE_GAP,
        y: edgeY + vy * BUILDING_CONTACT_EDGE_GAP,
      };
      const resourcePenalty = findResourceAt(world, tx, ty, 0.35) === null ? 0 : 20;
      const crowdPenalty = workerContactCrowdPenalty(world, eid, point.x, point.y);
      out.push({
        tile: { x: tx, y: ty },
        point,
        resourcePenalty,
        score:
          Math.hypot(Position.x[eid] - point.x, Position.y[eid] - point.y) +
          resourcePenalty +
          crowdPenalty,
      });
    }
  }

  out.sort((a, b) => a.score - b.score);
  return out;
}

function workerContactCrowdPenalty(world: SimWorld, eid: number, x: number, y: number): number {
  let penalty = 0;
  const owner = hasComponent(world.ecs, Owner, eid) ? Owner.player[eid] : -1;
  const requesterIsVillager = hasComponent(world.ecs, VillagerTag, eid);
  for (const other of unitQuery(world.ecs)) {
    if (other === eid) continue;
    if (Health.hp[other] <= 0) continue;
    if (owner >= 0 && Owner.player[other] !== owner) continue;
    if (requesterIsVillager && hasComponent(world.ecs, VillagerTag, other)) continue;

    const dist = Math.hypot(Position.x[other] - x, Position.y[other] - y);
    if (dist < WORKER_CONTACT_CROWD_RADIUS) {
      penalty += WORKER_CONTACT_UNIT_PENALTY * (1 - dist / WORKER_CONTACT_CROWD_RADIUS);
    }

    const path = world.paths.get(other);
    const final = path?.[path.length - 1];
    if (!final) continue;
    const pathDist = Math.hypot(final.x - x, final.y - y);
    if (pathDist < WORKER_CONTACT_CROWD_RADIUS) {
      penalty += WORKER_CONTACT_PATH_PENALTY * (1 - pathDist / WORKER_CONTACT_CROWD_RADIUS);
    }
  }
  return penalty;
}

function buildingFootprintRect(
  buildingEid: number,
  def: BuildingDef
): {
  tileX0: number;
  tileY0: number;
  tileX1: number;
  tileY1: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const tileX0 = Math.round(Position.x[buildingEid]) - Math.floor(def.footprint.w / 2);
  const tileY0 = Math.round(Position.y[buildingEid]) - Math.floor(def.footprint.h / 2);
  const tileX1 = tileX0 + def.footprint.w - 1;
  const tileY1 = tileY0 + def.footprint.h - 1;
  return {
    tileX0,
    tileY0,
    tileX1,
    tileY1,
    minX: tileX0 - 0.5,
    maxX: tileX0 + def.footprint.w - 0.5,
    minY: tileY0 - 0.5,
    maxY: tileY0 + def.footprint.h - 0.5,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Find the building entity (any) at or near (x, y). Used for placement checks. */
export function findBuildingAt(
  world: SimWorld,
  x: number,
  y: number,
  radius = 0.7
): number | null {
  const ents = buildingQuery(world.ecs);
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const d = distToBuildingEdge(world, x, y, eid);
    if (d < bestDist) {
      bestDist = d;
      bestEid = eid;
    }
  }
  return bestEid;
}

/** Find the resource entity at exactly (or near) tile (x, y). */
export function findResourceAt(
  world: SimWorld,
  x: number,
  y: number,
  radius = 0.6
): number | null {
  const ents = resourceQuery(world.ecs);
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const d = Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
    if (d < bestDist) {
      bestDist = d;
      bestEid = eid;
    }
  }
  return bestEid;
}

/** Nearest resource of `kind` to (x, y) within `maxRange` tiles. */
export function findNearestResource(
  world: SimWorld,
  x: number,
  y: number,
  kind: ResourceKind,
  maxRange: number
): number | null {
  const ents = resourceQuery(world.ecs);
  let bestEid: number | null = null;
  let bestDist = maxRange;
  for (const eid of ents) {
    if (Resource.kind[eid] !== kind) continue;
    if (Resource.amount[eid] <= 0) continue;
    const d = Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
    if (d < bestDist) {
      bestDist = d;
      bestEid = eid;
    }
  }
  return bestEid;
}

function findNearestDropOffEid(world: SimWorld, eid: number): number | null {
  const player = Owner.player[eid];
  const carryKind = ResourceCarry.kind[eid] as ResourceKind;
  const mask = 1 << carryKind;
  const ents = dropOffQuery(world.ecs);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const cand of ents) {
    if (Owner.player[cand] !== player) continue;
    if ((DropOff.acceptsMask[cand] & mask) === 0) continue;
    const d = distToBuildingEdge(world, Position.x[eid], Position.y[eid], cand);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

function routeToNearestDropOff(world: SimWorld, eid: number): void {
  const target = findNearestDropOffEid(world, eid);
  if (target === null) {
    Gatherer.state[eid] = GathererStateId.IDLE;
    return;
  }
  if (!pathToBuildingContact(world, eid, target)) {
    pathTo(world, eid, Position.x[target], Position.y[target]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Selection helpers (used by render + window-api)
// ────────────────────────────────────────────────────────────────────────────

export function setSelected(
  world: SimWorld,
  eid: number,
  selected: boolean
): void {
  if (selected) {
    addComponent(world.ecs, Selected, eid);
  } else {
    removeComponent(world.ecs, Selected, eid);
  }
}

export function clearSelection(world: SimWorld): void {
  const sel = selectedQuery(world.ecs);
  for (const eid of sel) {
    removeComponent(world.ecs, Selected, eid);
  }
}

export function selectUnitsOfSameKindInRadius(
  world: SimWorld,
  sourceEid: number,
  radius: number,
  playerId = Owner.player[sourceEid]
): number {
  if (!hasComponent(world.ecs, UnitKind, sourceEid)) return 0;
  if (Owner.player[sourceEid] !== playerId) return 0;

  const sourceKind = UnitKind.kind[sourceEid];
  const sourceX = Position.x[sourceEid];
  const sourceY = Position.y[sourceEid];
  clearSelection(world);

  let selectedCount = 0;
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (UnitKind.kind[eid] !== sourceKind) continue;
    const dist = Math.hypot(Position.x[eid] - sourceX, Position.y[eid] - sourceY);
    if (dist > radius) continue;
    setSelected(world, eid, true);
    selectedCount++;
  }

  return selectedCount;
}

export function findEntityNear(
  world: SimWorld,
  x: number,
  y: number,
  radius: number
): number | null {
  const ents = positionQuery(world.ecs);
  let bestEid: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const isUnit = hasComponent(world.ecs, UnitKind, eid);
    const isBuilding = hasComponent(world.ecs, Building, eid);
    if (!isUnit && !isBuilding) continue;
    const d = isBuilding
      ? distToBuildingEdge(world, x, y, eid)
      : Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
    const effective = isUnit ? d : d + 0.02;
    if (effective < bestDist) {
      bestDist = effective;
      bestEid = eid;
    }
  }
  return bestEid;
}

/** Lookup helper for render — does this eid belong to an enemy of `myPlayer`? */
export function isEnemyOf(
  world: SimWorld,
  eid: number,
  myPlayer: number
): boolean {
  if (!hasComponent(world.ecs, Owner, eid)) return false;
  const p = Owner.player[eid];
  if (p === 0) return false; // gaia is neutral
  return p !== myPlayer;
}
