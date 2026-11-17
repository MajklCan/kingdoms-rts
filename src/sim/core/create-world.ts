/**
 * Skirmish world construction: map, banks, starting towns, units and resources.
 */

import { dhypot } from './dmath';
import { createWorld } from 'bitecs';
import { type ResourceKind, ResourceKindId } from '../components';
import { AgeId, type AgeIdValue } from '../defs';
import { MapId, TileType, generateMap, isNightMap } from '../map-gen';
import { type GridPos, Pathfinder } from '../pathfinding';
import { Rng } from '../rng';
import { type TechIdValue, createStartingTechSetForAge } from '../tech-tree';
import { createAiPlayers, normalizeAiDifficulty } from '../ai/difficulty';
import { spawnResource, spawnTownCenter } from '../factories/buildings';
import { placeGameHerds } from '../factories/game-animals';
import { spawnArcher, spawnScoutCavalry, spawnSpearman, spawnVillager } from '../factories/units';
import { createCampaignWorld } from '../missions/campaign-world';
import { edgeProximity01, trySpawnTreeAt } from '../systems/forest-regrowth';
import { createVisibilityStates, updatePlayerVisibility } from '../systems/visibility';
import {
  AI_PLAYER_ID,
  FORMATION_FACING_DEFAULT,
  FORMATION_MODE_DEFAULT,
  LOCAL_GOLD_DEPOSIT_AMOUNT,
  LOCAL_PLAYER_ID,
  MAX_PLAYERS,
  TREE_EDGE_BAND_TILES,
  TREE_REGEN_BUILDING_CLEARANCE,
  TREE_RESOURCE_AMOUNT,
} from './constants';
import {
  authoredDepositAmount,
  CENTER_GOLD_AMOUNT,
  CENTER_GOLD_HALF_OFFSETS,
  CENTER_STONE_AMOUNT,
  CENTER_STONE_HALF_OFFSETS,
  FLANK_GOLD_AMOUNT,
  FLANK_STONE_AMOUNT,
  HOME_STONE_AMOUNT,
  HOME_STONE_NODES,
  NATURAL_GOLD_AMOUNT,
  NATURAL_STONE_AMOUNT,
  SCATTERED_GOLD_AMOUNT,
  SCATTERED_STONE_AMOUNT,
  SITE_GOLD_OFFSETS,
  SITE_STONE_OFFSETS,
  mirrorThrough,
  planDeposits,
} from './deposit-sites';
import { findSpawnSpot } from './grid';
import { scaleByMapArea } from './map-size';
import { createMatchStats, resetMatchStats } from './match-stats';
import { normalizeMapSeed } from './map-seed';
import { findBuildingAt, findResourceAt, hasMapFeatureAt } from './lookup';
import type { AgeState, CreateSimWorldOptions, PopState, SimWorld } from './types';

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
/** Food in one berry bush. */
export const BERRY_BUSH_AMOUNT = 125;
/**
 * Starting berry patch, as offsets from player 1's town center; player 2 gets
 * the point mirror (negated offsets), like the other local patches. South-east
 * of the TC, clear of the trees (north-east), gold (north-west), stone
 * (south-west) and the starting army (just south).
 */
const LOCAL_BERRY_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [4, 3],
  [5, 3],
  [4, 4],
  [5, 4],
  [6, 4],
];
/** Lone bushes scattered over the rest of the map (mirrored pairs on Krkonose). */
const SCATTERED_BERRY_BUSH_COUNT = 6;
/** Scattered bushes stay at least this far from either town center. */
const SCATTERED_BERRY_MIN_SPAWN_DISTANCE = 10;

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
  return { current };
}

/**
 * Build a fresh sim world:
 * - 1 Town Center per player
 * - 1 scout rider per player
 * - starter villagers to raise the first buildings; specialist resource
 *   buildings still spawn their own work crews
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
  // Starting-age preset: Castle = ring I researched, Gunpowder = rings I and II.
  // Gaia researches nothing.
  const researchedTechs: Array<Set<TechIdValue>> = Array.from(
    { length: MAX_PLAYERS },
    (_, playerId) => (playerId === 0 ? new Set<TechIdValue>() : createStartingTechSetForAge(startingAge))
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
    villagerRallies: new Map(),
    orderQueues: new Map(),
    ages,
    researchedTechs,
    visibility: createVisibilityStates(mapData.width, mapData.height),
    revealedMapPlayers: Array.from({ length: MAX_PLAYERS }, () => false),
    night: options.night ?? isNightMap(selectedMapId),
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
    mapSeed: normalizeMapSeed(seed),
    matchStats: createMatchStats(),
    paused: true,
    map: mapData,
  };

  const canPlaceResourceAt = (x: number, y: number): boolean => {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= world.map.width || ty >= world.map.height) return false;
    if (mapData.walkability[ty][tx] !== 0) return false;
    if (!isResourceTerrainTile(mapData.tiles[ty * world.map.width + tx])) return false;
    if (hasMapFeatureAt(world, tx, ty, 0.6)) return false;
    if (findResourceAt(world, tx, ty, 0.6) !== null) return false;
    if (findBuildingAt(world, tx, ty, 0.9) !== null) return false;
    return true;
  };

  const nearestResourceTile = (x: number, y: number, maxR: number): GridPos | null => {
    const cx = Math.max(0, Math.min(world.map.width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(world.map.height - 1, Math.round(y)));
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

    const mirror = { x: world.map.width - 1 - spot.x, y: world.map.height - 1 - spot.y };
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
  // Each side starts with the town center and one scout rider, nothing more.
  safeSpawnCombatUnit('SCOUT_CAVALRY', p1x + 2, p1y + 2, 1);

  // Player 1's local resource patches - denser around the TC so each AI/human
  // has plenty to harvest without crossing the map.
  if (mirroredSnowSkirmish) {
    for (const [dx, dy] of LOCAL_BERRY_OFFSETS) {
      safeSpawnMirroredResource(ResourceKindId.FOOD, p1x + dx, p1y + dy, BERRY_BUSH_AMOUNT);
    }
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
    for (let i = 0; i < HOME_STONE_NODES; i++) {
      safeSpawnMirroredResource(
        ResourceKindId.STONE,
        p1x - 4 - i,
        p1y + 3 + (i % 2),
        HOME_STONE_AMOUNT
      );
    }
  } else {
    for (const [dx, dy] of LOCAL_BERRY_OFFSETS) {
      safeSpawnResource(ResourceKindId.FOOD, p1x + dx, p1y + dy, BERRY_BUSH_AMOUNT);
    }
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
    for (let i = 0; i < HOME_STONE_NODES; i++) {
      safeSpawnResource(
        ResourceKindId.STONE,
        p1x - 4 - i,
        p1y + 3 + (i % 2),
        HOME_STONE_AMOUNT
      );
    }
  }

  // ── Player 2 (Frankia, upper-right) ──────────────────────────────────────
  const p2 = mapData.spawns[2];
  const p2x = p2.x;
  const p2y = p2.y;
  spawnTownCenter(world, p2x, p2y, 2);
  // Each side starts with the town center and one scout rider, nothing more.
  safeSpawnCombatUnit('SCOUT_CAVALRY', p2x + 2, p2y + 2, 2);

  // Player 2's local patches mirror player 1.
  if (!mirroredSnowSkirmish) {
    for (const [dx, dy] of LOCAL_BERRY_OFFSETS) {
      safeSpawnResource(ResourceKindId.FOOD, p2x - dx, p2y - dy, BERRY_BUSH_AMOUNT);
    }
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
    for (let i = 0; i < HOME_STONE_NODES; i++) {
      safeSpawnResource(
        ResourceKindId.STONE,
        p2x + 4 + i,
        p2y - 3 - (i % 2),
        HOME_STONE_AMOUNT
      );
    }
  }

  // ── Shared deposits: natural expansions, the contested centre and wings ──
  // Every deposit below goes down together with its point mirror through the
  // middle between the towns, so both sides always get the same land.
  const depositPlan = planDeposits(
    world.map,
    p1,
    p2,
    canPlaceResourceAt,
    // The border forest has its own mine clearings out on the wings.
    selectedMapId === MapId.BOHEMIAN_BORDER_FOREST
      ? { x: Math.round(world.map.width * 0.22), y: Math.round(world.map.height * 0.22) }
      : undefined
  );
  const spawnDepositPair = (kind: ResourceKind, x: number, y: number, amt: number) => {
    const spot = resolveResourceSpawn(x, y);
    if (!spot) return;
    spawnResource(world, kind, spot.x, spot.y, amt);
    const mirror = mirrorThrough(depositPlan.mid, spot);
    if (mirror.x === spot.x && mirror.y === spot.y) return;
    const twin = resolveResourceSpawn(mirror.x, mirror.y);
    if (twin) spawnResource(world, kind, twin.x, twin.y, amt);
  };
  const spawnSitePair = (site: GridPos, stoneNodes: number, stoneAmt: number, goldNodes: number, goldAmt: number) => {
    for (const [dx, dy] of SITE_STONE_OFFSETS.slice(0, stoneNodes)) {
      spawnDepositPair(ResourceKindId.STONE, site.x + dx, site.y + dy, stoneAmt);
    }
    for (const [dx, dy] of SITE_GOLD_OFFSETS.slice(0, goldNodes)) {
      spawnDepositPair(ResourceKindId.GOLD, site.x + dx, site.y + dy, goldAmt);
    }
  };

  if (depositPlan.natural) {
    spawnSitePair(depositPlan.natural, 3, NATURAL_STONE_AMOUNT, 3, NATURAL_GOLD_AMOUNT);
  }
  // Large maps author their contested fields; they keep only the natural site.
  const authoredDeposits = mapData.deposits;
  if (!authoredDeposits) {
    for (const flank of depositPlan.flanks) {
      spawnSitePair(flank, 3, FLANK_STONE_AMOUNT, 2, FLANK_GOLD_AMOUNT);
    }
  }

  if (authoredDeposits) {
    for (const deposit of authoredDeposits) {
      const kind = deposit.kind === 'gold' ? ResourceKindId.GOLD : ResourceKindId.STONE;
      spawnDepositPair(kind, deposit.x, deposit.y, authoredDepositAmount(deposit));
    }
  } else if (mirroredSnowSkirmish) {
    // Krkonoše keeps its authored mines along the passes.
    const authored: Array<[ResourceKind, number, number, number]> = [
      [ResourceKindId.GOLD, Math.round(world.map.width * 0.42), Math.round(world.map.height * 0.46), CENTER_GOLD_AMOUNT],
      [ResourceKindId.GOLD, Math.round(world.map.width * 0.35), Math.round(world.map.height * 0.57), FLANK_GOLD_AMOUNT],
      [ResourceKindId.GOLD, Math.round(world.map.width * 0.20), Math.round(world.map.height * 0.37), FLANK_GOLD_AMOUNT],
      [ResourceKindId.STONE, Math.round(world.map.width * 0.45), Math.round(world.map.height * 0.59), CENTER_STONE_AMOUNT],
      [ResourceKindId.STONE, Math.round(world.map.width * 0.28), Math.round(world.map.height * 0.52), FLANK_STONE_AMOUNT],
      [ResourceKindId.STONE, Math.round(world.map.width * 0.16), Math.round(world.map.height * 0.57), FLANK_STONE_AMOUNT],
    ];
    for (const [kind, x, y, amount] of authored) {
      spawnDepositPair(kind, x, y, amount);
    }
  } else if (floodedBasinSkirmish) {
    // The basin's two forward fields, one on each side of the middle.
    const mx = Math.floor(world.map.width / 2);
    const my = Math.floor(world.map.height / 2);
    const forward: Array<[ResourceKind, number, number, number]> = [
      [ResourceKindId.GOLD, mx - 2, my - 5, CENTER_GOLD_AMOUNT],
      [ResourceKindId.GOLD, mx - 1, my - 6, CENTER_GOLD_AMOUNT],
      [ResourceKindId.STONE, mx + 1, my - 5, CENTER_STONE_AMOUNT],
      [ResourceKindId.STONE, mx + 2, my - 6, CENTER_STONE_AMOUNT],
      [ResourceKindId.GOLD, mx - 2, my + 5, CENTER_GOLD_AMOUNT],
      [ResourceKindId.GOLD, mx - 1, my + 6, CENTER_GOLD_AMOUNT],
      [ResourceKindId.STONE, mx + 1, my + 5, CENTER_STONE_AMOUNT],
      [ResourceKindId.STONE, mx + 2, my + 6, CENTER_STONE_AMOUNT],
    ];
    for (const [kind, x, y, amount] of forward) {
      safeSpawnResource(kind, x, y, amount);
    }
  } else if (depositPlan.center) {
    // The contested centre: a row of gold through the middle, stone on both sides.
    for (const [dx, dy] of CENTER_GOLD_HALF_OFFSETS) {
      spawnDepositPair(ResourceKindId.GOLD, depositPlan.center.x + dx, depositPlan.center.y + dy, CENTER_GOLD_AMOUNT);
    }
    for (const [dx, dy] of CENTER_STONE_HALF_OFFSETS) {
      spawnDepositPair(ResourceKindId.STONE, depositPlan.center.x + dx, depositPlan.center.y + dy, CENTER_STONE_AMOUNT);
    }
  }

  // Real tree resources on generated forest terrain, plus scattered singletons.
  // Counts grow with the map's area; a standard map gets exactly the base counts.
  const scatter = (count: number) => scaleByMapArea(world.map, count);
  seedInitialForestTrees(world, mirroredSnowSkirmish);
  if (!mirroredSnowSkirmish) {
    for (let i = 0; i < scatter(INITIAL_SCATTERED_TREE_COUNT); i++) {
      const x = Math.floor(rng.next() * world.map.width);
      const y = Math.floor(rng.next() * world.map.height);
      safeSpawnResource(ResourceKindId.WOOD, x, y, 80);
    }
    for (let i = 0; i < scatter(INITIAL_EDGE_TREE_COUNT); i++) {
      const spot = randomEdgeTile(world);
      safeSpawnResource(ResourceKindId.WOOD, spot.x, spot.y, 80);
    }
    // A few extra gold/stone outcrops, each with a twin on the other side.
    // The rng draws are the same as before this was mirrored (every second
    // draw is unused), so trees and berries keep their places.
    for (let i = 0; i < scatter(8); i++) {
      const x = Math.floor(rng.next() * world.map.width);
      const y = Math.floor(rng.next() * world.map.height);
      if (i % 2 === 0) spawnDepositPair(ResourceKindId.GOLD, x, y, SCATTERED_GOLD_AMOUNT);
    }
    for (let i = 0; i < scatter(6); i++) {
      const x = Math.floor(rng.next() * world.map.width);
      const y = Math.floor(rng.next() * world.map.height);
      if (i % 2 === 0) spawnDepositPair(ResourceKindId.STONE, x, y, SCATTERED_STONE_AMOUNT);
    }
  }

  // Lone berry bushes away from both bases. The only rng draws added for
  // berries, deliberately last in world creation, so map, forests and every
  // other resource spawn exactly where they did before.
  for (let i = 0; i < scatter(SCATTERED_BERRY_BUSH_COUNT); i++) {
    const x = Math.floor(rng.next() * world.map.width);
    const y = Math.floor(rng.next() * world.map.height);
    const spot = resolveResourceSpawn(x, y);
    if (!spot) continue;
    // Checked on the resolved tile (and its mirror), so no base gets a bonus bush.
    const awayFromBases = (tile: GridPos) =>
      [p1, p2].every(
        (spawn) => dhypot(spawn.x - tile.x, spawn.y - tile.y) >= SCATTERED_BERRY_MIN_SPAWN_DISTANCE
      );
    if (!awayFromBases(spot)) continue;
    if (mirroredSnowSkirmish) {
      if (!awayFromBases({ x: world.map.width - 1 - spot.x, y: world.map.height - 1 - spot.y })) continue;
      safeSpawnMirroredResource(ResourceKindId.FOOD, spot.x, spot.y, BERRY_BUSH_AMOUNT);
    } else {
      spawnResource(world, ResourceKindId.FOOD, spot.x, spot.y, BERRY_BUSH_AMOUNT);
    }
  }

  // Huntable herds, mirrored for both sides. Their rng draws come after the
  // berry bushes so every earlier spawn keeps its place.
  placeGameHerds(world, [p1, p2], canPlaceResourceAt);

  // Starter villagers: buildings need a villager to raise them. Spawned last
  // (no rng draws) so everything above keeps its creation order.
  for (const playerId of options.starterVillagers === false ? [] : [1, 2]) {
    const spawn = mapData.spawns[playerId];
    for (const [dx, dy] of STARTER_VILLAGER_OFFSETS) {
      const spot = findSpawnSpot(world, spawn.x + dx, spawn.y + dy, 6);
      if (spot) spawnVillager(world, spot.x, spot.y, playerId);
    }
  }

  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
  resetMatchStats(world);
  return world;
}

/** Where each player's starter villagers stand, relative to the town center. */
const STARTER_VILLAGER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-2, 2],
  [-2, 3],
];

function seedInitialForestTrees(world: SimWorld, mirrored = false): void {
  const canSeedForestTile = (x: number, y: number): boolean => {
    const tile = world.map.tiles[y * world.map.width + x];
    return tile === TileType.FOREST || tile === TileType.SNOW_FOREST;
  };

  if (mirrored) {
    const seen = new Set<number>();
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const idx = y * world.map.width + x;
        if (seen.has(idx) || !canSeedForestTile(x, y)) continue;
        const mx = world.map.width - 1 - x;
        const my = world.map.height - 1 - y;
        const mirrorIdx = my * world.map.width + mx;
        seen.add(idx);
        seen.add(mirrorIdx);
        if (!canSeedForestTile(mx, my)) continue;
        const edgeBonus = Math.max(edgeProximity01(world, x, y), edgeProximity01(world, mx, my))
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

  for (let y = 0; y < world.map.height; y++) {
    for (let x = 0; x < world.map.width; x++) {
      if (!canSeedForestTile(x, y)) continue;
      const edgeBonus = edgeProximity01(world, x, y) * FOREST_EDGE_INITIAL_TREE_BONUS;
      if (world.rng.next() > FOREST_TILE_INITIAL_TREE_CHANCE + edgeBonus) continue;
      trySpawnTreeAt(world, x, y, TREE_RESOURCE_AMOUNT, TREE_REGEN_BUILDING_CLEARANCE);
    }
  }
}

function randomEdgeTile(world: SimWorld): GridPos {
  const side = world.rng.int(4);
  const depth = world.rng.int(TREE_EDGE_BAND_TILES);
  if (side === 0) return { x: depth, y: world.rng.int(world.map.height) };
  if (side === 1) return { x: world.map.width - 1 - depth, y: world.rng.int(world.map.height) };
  if (side === 2) return { x: world.rng.int(world.map.width), y: depth };
  return { x: world.rng.int(world.map.width), y: world.map.height - 1 - depth };
}
