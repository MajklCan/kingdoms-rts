/**
 * Battle of Zborov setup: trench lines, wire, garrisons and the player base.
 */

import { MAP, SIM } from '../../config';
import { Position, type ResourceKind, ResourceKindId } from '../components';
import { AgeId, BuildingDefId, UnitDefId } from '../defs';
import { CampaignMissionId } from '../campaign';
import { TileType, isZborovMudPatch } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { createAllTechSet } from '../tech-tree';
import {
  AI_PLAYER_ID,
  LOCAL_GOLD_DEPOSIT_AMOUNT,
  LOCAL_PLAYER_ID,
  LOCAL_STONE_DEPOSIT_AMOUNT,
  POP_CAP_HARD_LIMIT,
  TREE_RESOURCE_AMOUNT,
  ZBOROV_FORWARD_LINE_FRAC,
  ZBOROV_MID_LINE_FRAC,
  ZBOROV_REAR_LINE_FRAC,
} from '../core/constants';
import { createAgeState } from '../core/create-world';
import { removeSimEntity } from '../core/entities';
import { pushAiEvent } from '../core/events';
import { findBuildingAt, findEntityNear, findResourceAt } from '../core/lookup';
import { resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnResource } from '../factories/buildings';
import {
  placePresetBuilding,
  placePresetBuildingExact,
  spawnPresetUnitAt,
} from '../factories/late-game';
import { isTileInMap, revealMapForPlayer } from '../systems/visibility';
import { setBilaHoraDefensiveStance } from './bila-hora';
import {
  clearBattlefieldForTownlessMission,
  isWaterCampaignTile,
  spawnFormationRow,
} from './shared';

const ZBOROV_ENEMY_FIRST_WAVE_TICKS = SIM.TICK_HZ * 70;
const ZBOROV_BASE_DEAD_TREE_COUNT = 18;
const ZBOROV_AMBIENT_DEAD_TREE_COUNT = 28;
const ZBOROV_AMBIENT_DEAD_TREE_AMOUNT = 45;
// Half-width of the playable corridor (must match generateZborovMap); the rest
// of the dirt/mud map is blocked so the assault can't flank around the lines.
const ZBOROV_CORRIDOR_HALF = Math.round(MAP.WIDTH * 0.24);
const ZBOROV_FORWARD_WIRE_FRAC = 0.55;
const ZBOROV_MID_WIRE_FRAC = 0.42;
const ZBOROV_REAR_WIRE_FRAC = 0.31;
const ZBOROV_BUNKER_FRAC = 0.19;
const ZBOROV_PLAYER_BUNKER_FRAC = 0.81;
const ZBOROV_PLAYER_LINE_FRAC = 0.70;
const ZBOROV_MG_OFFSETS = [-13, -4, 4, 13];

export function configureBattleOfZborov(world: SimWorld): void {
  clearBattlefieldForTownlessMission(world);
  // Strip the skirmish map's generic resources; this mission gets explicit rear
  // economies so the fight stays inside the trench corridor.
  for (const eid of [...resourceQuery(world.ecs)]) removeSimEntity(world, eid);
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
      removeSimEntity(world, eid);
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
  // Each MG nest sits two tiles NORTH of (behind) the forward wire belt - the
  // enemy side - in a wire bay, firing south through a slit in the wire at the
  // player (see layZborovWire). Well out of range of the player at spawn.
  const cx = Math.round(MAP.WIDTH * 0.5);
  const beltY = Math.round(MAP.HEIGHT * ZBOROV_FORWARD_WIRE_FRAC);
  return ZBOROV_MG_OFFSETS.map((dx) => ({ x: cx + dx, y: beltY - 2 }));
}

function layZborovWire(world: SimWorld): void {
  // Barbed-wire belts in front of each rifle line - the WW1 wall replacement.
  // Walkable but slows units to a crawl (ZBOROV_WIRE_SPEED_MULTIPLIER); left
  // open at GAP LANES so attackers can pour through, and INDENTED into wire
  // pockets around each machine-gun nest so the MGs read as dug-in emplacements.
  const cx = Math.round(MAP.WIDTH * 0.5);
  // Span the full playable corridor so the belts run wall-to-wall between the
  // impassable dirt/mud flanks - no open shoulder to walk around them.
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
  // its full width - no thin centre to skirt around.
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
