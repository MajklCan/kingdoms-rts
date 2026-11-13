/**
 * SimWorld shape and the plain data types stored on it.
 */

import type { IWorld } from 'bitecs';
import type { UnitStanceValue } from '../components';
import type { AgeIdValue } from '../defs';
import type { CampaignMissionIdValue } from '../campaign';
import type { MapData, MapIdValue } from '../map-gen';
import type { GridPos, Pathfinder } from '../pathfinding';
import type { Rng } from '../rng';
import type { TechIdValue } from '../tech-tree';

export type SimInput =
  // ── Selection-relative commands (local single-player UX). These read the
  //    local Selected component + LOCAL_PLAYER_ID, so they are NOT safe to send
  //    over the wire - a peer has no idea what the sender had selected. The
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
  // ── Self-describing commands. Inside the sim these eids are local raw bitECS
  //    ids. MultiplayerSession converts them to deterministic NetIds before
  //    putting commands on the wire, then decodes them back before applyInput().
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
  /** Cancel queue entry `slot` (0 = the one training now). Without a slot the
   *  most recently queued entry is cancelled. The cost is refunded either way. */
  | { type: 'cancelProduction'; atEid: number; playerId?: number; slot?: number }
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

/** Outcome of the match - set by winConditionSystem when one player loses or wins. */
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
 *  - same contract as combatEvents. Combat fire SFX come from combatEvents;
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
  /** Owning player - render uses this for fog/local-player filtering. */
  player: number;
}

/** Exact per-player match statistics (see core/match-stats.ts). */
export interface PlayerMatchStats {
  /** Units that left a production queue (villagers, soldiers, worksite crews). */
  unitsTrained: number;
  /** Own units whose health reached zero. */
  unitsLost: number;
  /** Enemy units this player dealt the killing blow to. */
  unitsKilled: number;
  /** Foundations this player finished building. */
  buildingsBuilt: number;
  /** Own buildings (and foundations) whose health reached zero. Demolitions are not losses. */
  buildingsLost: number;
  /** Enemy buildings (and foundations) this player dealt the killing blow to. */
  buildingsRazed: number;
  /** Income per ResourceKindId (food, wood, gold, stone). Refunds and grants excluded. */
  gathered: [number, number, number, number];
  /** Technologies researched (age advances are not counted here). */
  techsResearched: number;
  /** Highest population reached. */
  peakPopulation: number;
}

/**
 * Player-facing game events. Output-only like soundCues: the sim appends,
 * render drains, the sim never reads them back, so they cannot affect
 * determinism and are not part of the checksum or save files.
 */
export type GameEvent =
  | { kind: 'unitTrained'; tick: number; playerId: number; unitDefId: number; eid: number; x: number; y: number }
  | { kind: 'buildingCompleted'; tick: number; playerId: number; buildingDefId: number; eid: number; x: number; y: number }
  | { kind: 'researchCompleted'; tick: number; playerId: number; techId: TechIdValue }
  | { kind: 'ageAdvanced'; tick: number; playerId: number; ageId: number }
  /** A resource node ran dry and was removed (trees leave a stump in render). */
  | { kind: 'resourceDepleted'; tick: number; eid: number; resourceKind: number; x: number; y: number }
  | {
      kind: 'entityDestroyed';
      tick: number;
      ownerId: number;
      isBuilding: boolean;
      /** Unit def id for units, building def id for buildings. */
      defId: number;
      x: number;
      y: number;
    };

interface CannonWindup {
  targetEid: number;
  ticksRemaining: number;
}

export interface PendingCannonImpact {
  impactTick: number;
  attackerEid: number;
  attackerOwner: number;
  impactX: number;
  impactY: number;
  damage: number;
}

export interface PendingProjectileImpact {
  impactTick: number;
  attackerEid: number;
  attackerOwner: number;
  targetEid: number;
  damage: number;
}

export type AiPlan = 'opening' | 'massing' | 'staging' | 'attacking' | 'defending' | 'recovering';
export type AiDifficulty = 'easy' | 'medium' | 'hard';

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

export interface MovementStuckState {
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
  /** Deterministic command-id mapping for multiplayer wire payloads. */
  nextNetId: number;
  netIdToEid: Map<number, number>;
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
  /** Match outcome - set by winConditionSystem. */
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
   *  is suppressed for them - they're driven by relayed commands instead. */
  humanPlayers: Set<number>;
  /** Per-player AI controller state. Null for human/gaia players. */
  aiPlayers: Array<AiPlayerState | null>;
  /** Controls AI build cadence, economy scale, and attack wave discipline. */
  aiDifficulty: AiDifficulty;
  /** Render-consumed AI event messages. */
  aiEvents: AiEvent[];
  /** Render-consumed non-combat sound cues. Sim appends; render drains. */
  soundCues: SoundCue[];
  /** Render-consumed player-facing events (trained, built, researched, destroyed). */
  gameEvents: GameEvent[];
  /** Per-player match statistics, indexed by playerId. Write-only for the sim. */
  matchStats: PlayerMatchStats[];
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
