/**
 * Versioned save format. Bump SAVE_VERSION when a field changes meaning and
 * add a step to migrateSavedGame() so older saves keep loading.
 *
 *   v1  original format
 *   v2  + matchStats (per-player match statistics)
 *   v3  + mapSeed (uint32 seed the map was generated from)
 */

import type { MapFeature } from '../map-gen';
import { legacyMapSeed, normalizeMapSeed } from '../core/map-seed';
import type {
  AiDifficulty,
  AiPlayerState,
  CampaignState,
  LastSeenBuilding,
  MatchOutcome,
  PlayerMatchStats,
} from '../world';
import type { GridPos } from '../pathfinding';
import type { TechIdValue } from '../tech-tree';

export const SAVE_VERSION = 3;
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

/** v1 layout. Only read by migrateSavedGame(); new saves are SavedGame (v3). */
export interface SavedGameV1 {
  version: 1;
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

export interface SavedGameV2 extends Omit<SavedGameV1, 'version'> {
  version: 2;
  /** Per-player statistics, indexed by playerId. */
  matchStats: PlayerMatchStats[];
}

export interface SavedGameV3 extends Omit<SavedGameV2, 'version'> {
  version: 3;
  /** uint32 seed the map was generated from (cosmetic, see core/map-seed.ts). */
  mapSeed: number;
}

/** The current save format. */
export type SavedGame = SavedGameV3;

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

function zeroStats(): PlayerMatchStats {
  return {
    unitsTrained: 0,
    unitsLost: 0,
    unitsKilled: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    buildingsRazed: 0,
    gathered: [0, 0, 0, 0],
    techsResearched: 0,
    peakPopulation: 0,
  };
}

const COUNTER_KEYS = [
  'unitsTrained',
  'unitsLost',
  'unitsKilled',
  'buildingsBuilt',
  'buildingsLost',
  'buildingsRazed',
  'techsResearched',
  'peakPopulation',
] as const;

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Coerce whatever a (possibly hand-edited) file holds into valid counters. */
export function sanitizeSavedMatchStats(raw: unknown, players: number): PlayerMatchStats[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: players }, (_, playerId) => {
    const entry: unknown = list[playerId];
    const stats = zeroStats();
    if (typeof entry !== 'object' || entry === null) return stats;
    const record = entry as Record<string, unknown>;
    for (const key of COUNTER_KEYS) stats[key] = count(record[key]);
    const gathered = Array.isArray(record.gathered) ? record.gathered : [];
    stats.gathered = [count(gathered[0]), count(gathered[1]), count(gathered[2]), count(gathered[3])];
    return stats;
  });
}

/**
 * Bring any supported save up to the current format. v1 predates match
 * statistics; nothing in it lets us reconstruct them, so they start at zero
 * (peak population at the population saved). v1 and v2 predate the stored map
 * seed; it is derived from the map bytes instead (stable for that save).
 * Returns null for unknown versions.
 */
export function migrateSavedGame(save: SavedGameV1 | SavedGameV2 | SavedGameV3): SavedGame | null {
  const players = Array.isArray(save.resources) ? save.resources.length : 0;
  if (save.version === 3) {
    return {
      ...save,
      matchStats: sanitizeSavedMatchStats(save.matchStats, players),
      mapSeed: typeof save.mapSeed === 'number' ? normalizeMapSeed(save.mapSeed) : seedFromMap(save),
    };
  }
  if (save.version === 2) {
    return {
      ...save,
      version: 3,
      matchStats: sanitizeSavedMatchStats(save.matchStats, players),
      mapSeed: seedFromMap(save),
    };
  }
  if (save.version === 1) {
    const matchStats = sanitizeSavedMatchStats([], players).map((stats, playerId) => ({
      ...stats,
      peakPopulation: count(save.population?.[playerId]?.current),
    }));
    return { ...save, version: 3, matchStats, mapSeed: seedFromMap(save) };
  }
  return null;
}

function seedFromMap(save: { map?: Partial<SavedMapV1> }): number {
  return legacyMapSeed(save.map?.tiles ?? [], save.map?.elevation ?? []);
}

export function parseSavedGame(text: string): SavedGame | null {
  try {
    const parsed = JSON.parse(text) as Partial<SavedGameV1 | SavedGameV2 | SavedGameV3>;
    if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== SAVE_VERSION) return null;
    if (!Array.isArray(parsed.entities) || !parsed.map) return null;
    return migrateSavedGame(parsed as SavedGameV1 | SavedGameV2 | SavedGameV3);
  } catch {
    return null;
  }
}
