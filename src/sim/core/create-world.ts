/**
 * Skirmish world construction: map, banks, starting towns, units and resources.
 */

import { createWorld } from 'bitecs';
import { MAP } from '../../config';
import { type ResourceKind, ResourceKindId } from '../components';
import { AgeId, type AgeIdValue } from '../defs';
import { MapId, TileType, generateMap } from '../map-gen';
import { type GridPos, Pathfinder } from '../pathfinding';
import { Rng } from '../rng';
import { type TechIdValue, createStartingTechSetForAge } from '../tech-tree';
import { createAiPlayers, normalizeAiDifficulty } from '../ai/difficulty';
import { spawnResource, spawnTownCenter } from '../factories/buildings';
import { spawnArcher, spawnScoutCavalry, spawnSpearman } from '../factories/units';
import { createCampaignWorld } from '../missions/campaign-world';
import { edgeProximity01, trySpawnTreeAt } from '../systems/forest-regrowth';
import { createVisibilityStates, updatePlayerVisibility } from '../systems/visibility';
import {
  AI_PLAYER_ID,
  FORMATION_FACING_DEFAULT,
  FORMATION_MODE_DEFAULT,
  LOCAL_GOLD_DEPOSIT_AMOUNT,
  LOCAL_PLAYER_ID,
  LOCAL_STONE_DEPOSIT_AMOUNT,
  MAX_PLAYERS,
  TREE_EDGE_BAND_TILES,
  TREE_REGEN_BUILDING_CLEARANCE,
  TREE_RESOURCE_AMOUNT,
} from './constants';
import { findSpawnSpot } from './grid';
import { createMatchStats, resetMatchStats } from './match-stats';
import { findBuildingAt, findResourceAt, hasMapFeatureAt } from './lookup';
import type { AgeState, CreateSimWorldOptions, PopState, SimWorld } from './types';

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
const FOREST_TILE_INITIAL_TREE_CHANCE = 0.48;
const FOREST_EDGE_INITIAL_TREE_BONUS = 0.2;
const LOCAL_STARTING_TREE_COUNT = 20;
const INITIAL_SCATTERED_TREE_COUNT = 72;
const INITIAL_EDGE_TREE_COUNT = 48;

export function applyStartingResources(bank: Int32Array, ageId: AgeIdValue): void {
  const resources = STARTING_RESOURCE_BANKS[ageId] ?? STARTING_RESOURCE_BANKS[AgeId.DARK];
  bank[ResourceKindId.FOOD] = resources[ResourceKindId.FOOD];
  bank[ResourceKindId.WOOD] = resources[ResourceKindId.WOOD];
  bank[ResourceKindId.GOLD] = resources[ResourceKindId.GOLD];
  bank[ResourceKindId.STONE] = resources[ResourceKindId.STONE];
}

export function isResourceTerrainTile(tile: number): boolean {
  return (
    tile !== TileType.WATER &&
    tile !== TileType.WATER_SHALLOW &&
    tile !== TileType.BRIDGE &&
    tile !== TileType.MUD &&
    tile !== TileType.ICE &&
    tile !== TileType.PACKED_SNOW
  );
}

function normalizeStartingAge(ageId: number | undefined): AgeIdValue {
  if (ageId === AgeId.CASTLE) return AgeId.CASTLE;
  if (ageId === AgeId.GUNPOWDER) return AgeId.GUNPOWDER;
  if (ageId === AgeId.TOTAL_WAR) return AgeId.TOTAL_WAR;
  return AgeId.DARK;
}

export function createAgeState(current: AgeIdValue): AgeState {
  return { current, progress: -1, totalTicks: 0 };
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
  // Generate the map first - its walkability grid drives the pathfinder.
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
    nextNetId: 1,
    netIdToEid: new Map(),
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
    gameEvents: [],
    killingBlows: new Map(),
    matchStats: createMatchStats(),
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

  // Player 1's local resource patches - denser around the TC so each AI/human
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
    // Map-wide resource scatter - gives the bigger 64×64 playfield enough
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
      // Contested centre gold/stone - worth crossing the river for.
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
  resetMatchStats(world);
  return world;
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
