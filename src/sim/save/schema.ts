/**
 * Versioned save format. Bump SAVE_VERSION when a field changes meaning.
 */

import type { MapFeature } from '../map-gen';
import type {
  AiDifficulty,
  AiPlayerState,
  CampaignState,
  LastSeenBuilding,
  MatchOutcome,
} from '../world';
import type { GridPos } from '../pathfinding';
import type { TechIdValue } from '../tech-tree';

export const SAVE_VERSION = 1;
export const LATE_GAME_TEST_SAVE_ID = 'late-game-test';

export interface SavedMapV1 {
  width: number;
  height: number;
  tiles: number[];
  elevation: number[];
  bridgePositions: Array<{ x: number; y: number }>;
  walkability: number[][];
  spawns: Array<{ x: number; y: number }>;
  features?: MapFeature[];
}

export interface SavedEntityV1 {
  id: number;
  netId?: number;
  position: { x: number; y: number };
  prevPosition?: { x: number; y: number };
  velocity?: { x: number; y: number };
  speed?: number;
  unitKind?: number;
  populationCost?: number;
  owner?: number;
  selected?: true;
  villager?: true;
  militia?: true;
  archer?: true;
  spearman?: true;
  scoutCavalry?: true;
  gunman?: true;
  cannon?: true;
  machineGun?: true;
  machineGunDeployment?: { deployed: number; setupTicks: number };
  mortar?: true;
  resource?: { kind: number; amount: number };
  resourceCarry?: { kind: number; amount: number };
  gatherer?: { targetEid: number; state: number; cooldown: number };
  dropOff?: { acceptsMask: number };
  townCenter?: true;
  building?: { defId: number };
  foundation?: true;
  constructionSite?: { defId: number; progress: number; totalTicks: number };
  buildOrder?: { targetEid: number };
  producer?: { currentProgress: number };
  resourceWorksite?: {
    kind: number;
    assignedWorkers: number;
    freeWorkersSpawned: number;
    progress: number;
  };
  worksiteWorker?: { siteEid: number };
  health?: { hp: number; hpMax: number; armor: number };
  combat?: { atk: number; range: number; attackSpeedTicks: number; aggroRadius: number };
  attackTarget?: { targetEid: number; retainGoal: number };
  attackMoveGoal?: { active: number; x: number; y: number };
  stance?: number;
  stanceAnchor?: { x: number; y: number };
  cooldown?: { ticksRemaining: number };
  pathTarget?: { x: number; y: number };
  dead?: true;
}

export interface SavedGameV1 {
  version: typeof SAVE_VERSION;
  label: string;
  savedAt: string;
  tick: number;
  /** Mulberry32 RNG state at save time. Required so a loaded/joined world
   *  reproduces the SAME future RNG draws (forest regrowth, AI tie-breaks,
   *  map gen). Lockstep join-snapshots and replays diverge without it.
   *  Optional for back-compat with v1 saves written before this field existed. */
  rngState?: number;
  nextNetId?: number;
  paused: boolean;
  aiDifficulty?: AiDifficulty;
  map: SavedMapV1;
  resources: number[][];
  population: Array<{ current: number; cap: number }>;
  ages: Array<{ current: number; progress: number; totalTicks: number }>;
  researchedTechs?: TechIdValue[][];
  revealedMapPlayers?: boolean[];
  humanPlayers?: number[];
  formationModes?: number[];
  formationFacings?: number[];
  outcome: MatchOutcome;
  entities: SavedEntityV1[];
  productionQueues: Array<{ eid: number; queue: number[] }>;
  armyRallyPoints?: Array<GridPos | null>;
  paths: Array<{ eid: number; waypoints: GridPos[] }>;
  movementStuck?: Array<{ eid: number; lastDist: number; waypointX: number; waypointY: number; noProgressTicks: number; cooldownTicks: number; attempts: number }>;
  formationSpeedCaps?: Array<{ eid: number; speedCap: number }>;
  cannonWindups?: Array<{ attackerEid: number; targetEid: number; ticksRemaining: number }>;
  pendingProjectileImpacts?: Array<{ impactTick: number; attackerEid: number; attackerOwner: number; targetEid: number; damage: number }>;
  pendingCannonImpacts?: Array<{ impactTick: number; attackerEid: number; attackerOwner: number; impactX: number; impactY: number; damage: number }>;
  aiPlayers?: Array<SavedAiPlayerStateV1 | null>;
  visibility?: Array<SavedVisibilityV1 | null>;
  campaign?: SavedCampaignV1 | null;
}

export interface SavedAiPlayerStateV1 {
  plan: AiPlayerState['plan'];
  nextAttackTick: number;
  lastAttackTick: number;
  stageStartedTick: number;
  rallyPoint: GridPos | null;
  waveUnitEids?: number[];
  lastAttackEventTick: number;
  lastDefenseEventTick: number;
}

export interface SavedVisibilityV1 {
  visible?: number[];
  explored: number[];
  lastSeenBuildings: LastSeenBuilding[];
}

export interface SavedCampaignV1 {
  missionId: CampaignState['missionId'];
  name: string;
  description: string;
  briefing: string;
  lockedTechs: TechIdValue[];
  objectives: CampaignState['objectives'];
  trackedObjectiveEids: Record<string, number[]>;
  enemyAiMode: CampaignState['enemyAiMode'];
  nextReinforcementTick: number;
  scriptedWaveIndex?: number;
  scriptedWaveCount?: number;
  zborovLinesTaken?: number;
  zborovForwardY?: number;
}

export function parseSavedGame(text: string): SavedGameV1 | null {
  try {
    const parsed = JSON.parse(text) as Partial<SavedGameV1>;
    if (parsed.version !== SAVE_VERSION) return null;
    if (!Array.isArray(parsed.entities) || !parsed.map) return null;
    return parsed as SavedGameV1;
  } catch {
    return null;
  }
}
