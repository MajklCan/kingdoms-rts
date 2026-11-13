/**
 * Public sim API. Re-exports the stable import surface (`@sim/world`) that
 * render, net, debug and tests build against. Implementation lives in:
 *   core/      world shape, constants, entity ids, queries, world creation
 *   factories/ spawn helpers and the late-game preset fixture
 *   input/     applyInput command handlers
 *   systems/   per-tick systems
 *   ai/        computer player
 * Keep this file a barrel: add new code to the module that owns it.
 */

export type {
  AgeState,
  AiDifficulty,
  AiEvent,
  AiPlan,
  AiPlayerState,
  CampaignObjectiveState,
  CampaignState,
  CombatEvent,
  CreateSimWorldOptions,
  LastSeenBuilding,
  MatchOutcome,
  PlayerVisibility,
  PopState,
  SimInput,
  SimWorld,
  SoundCue,
  SoundCueKind,
} from './core/types';
export { AI_PLAYER_ID, LOCAL_PLAYER_ID, MAX_PLAYERS, POP_CAP_HARD_LIMIT } from './core/constants';
export { addSimEntity, entityForNetId, netIdForEntity, removeSimEntity } from './core/entities';
export {
  buildingQuery,
  combatQuery,
  damageableQuery,
  deadQuery,
  dropOffQuery,
  foundationQuery,
  gathererQuery,
  movableQuery,
  positionQuery,
  producerQuery,
  resourceQuery,
  resourceWorksiteQuery,
  selectedQuery,
  townCenterQuery,
  unitQuery,
  worksiteWorkerQuery,
} from './core/queries';
export { getBuildingPopProvided } from './core/population';
export {
  findBuildingAt,
  findEntityNear,
  findNearestResource,
  findResourceAt,
  isEnemyOf,
} from './core/lookup';
export {
  clearSelection,
  pruneHiddenSelectionForPlayer,
  selectUnitsOfSameKindInRadius,
  setSelected,
} from './core/selection';
export { createSimWorld } from './core/create-world';
export {
  spawnArcher,
  spawnCannon,
  spawnGunman,
  spawnMachineGun,
  spawnMortar,
  spawnScoutCavalry,
  spawnSpearman,
  spawnVillager,
} from './factories/units';
export {
  spawnCompletedBuilding,
  spawnFoundation,
  spawnResource,
  spawnTownCenter,
} from './factories/buildings';
export { createLateGameTestWorld } from './factories/late-game';
export { playerFormationFacing, playerFormationMode } from './input/formation';
export {
  createVisibilityState,
  createVisibilityStates,
  getPlayerVisibility,
  isBuildingFootprintVisibleTo,
  isBuildingVisibleTo,
  isEntityVisibleTo,
  isTileExploredBy,
  isTileVisibleTo,
  revealMapForPlayer,
  tileVisibilityIndex,
  updatePlayerVisibility,
} from './systems/visibility';
export { canStartCastleAge, canStartGunpowderAge } from './systems/age-tech';
export { getWorksiteWorkerSlots } from './systems/worksites';
export { createAiPlayerState, normalizeAiDifficulty } from './ai/difficulty';

import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../config';
import {
  AttackMoveGoal,
  AttackTarget,
  Building,
  CannonTag,
  Combat,
  ConstructionSite,
  GunmanTag,
  Health,
  Owner,
  PopulationCost,
  Position,
  type ResourceKind,
  ResourceKindId,
  UnitStance,
  UnitStanceId,
  VillagerTag,
} from './components';
import { AgeId, BuildingDefId, UnitDefId, getBuildingDef } from './defs';
import {
  CampaignMissionId,
  type CampaignMissionIdValue,
  type CampaignObjectiveDef,
  getCampaignMissionDef,
} from './campaign';
import { TileType, isZborovMudPatch } from './map-gen';
import type { GridPos } from './pathfinding';
import { TechId, createAllTechSet, createStartingTechSetForAge } from './tech-tree';
import { aiSystem } from './ai/brain';
import { createAiPlayerState } from './ai/difficulty';
import { aiQueueUnit } from './ai/placement';
import { AI_PLAYER_ID, LOCAL_PLAYER_ID, POP_CAP_HARD_LIMIT } from './core/constants';
import { applyStartingResources, createAgeState, createSimWorld } from './core/create-world';
import { isLiveEntity, removeSimEntity } from './core/entities';
import { pushAiEvent } from './core/events';
import { markFootprintBlocked } from './core/grid';
import { findBuildingAt, findEntityNear, findOwnedTownCenter, findResourceAt } from './core/lookup';
import { pathTo } from './core/navigation';
import { recalculatePlayerPopCap } from './core/population';
import { buildingQuery, resourceQuery, unitQuery } from './core/queries';
import type { CampaignState, SimWorld } from './core/types';
import { spawnResource, spawnTownCenter } from './factories/buildings';
import {
  findPresetUnitSpot,
  placePresetBuilding,
  placePresetBuildingExact,
  removePresetStarterMilitary,
  spawnPresetUnitAt,
  spawnPresetUnits,
} from './factories/late-game';
import { spawnScoutCavalry, spawnVillager } from './factories/units';
import { applyInput } from './input/apply-input';
import { formationDestinations } from './input/formation';
import {
  applyFormationSpeedCap,
  clearFormationSpeedCap,
  setUnitHoldAnchor,
} from './input/unit-orders';
import { ageProgressionSystem } from './systems/age-tech';
import { combatSystem } from './systems/combat';
import { constructionSystem } from './systems/construction';
import { cleanupSystem, deathSystem } from './systems/death';
import { dropoffSystem } from './systems/dropoff';
import { forestRegrowthSystem } from './systems/forest-regrowth';
import { gatheringSystem } from './systems/gathering';
import { movementSystem } from './systems/movement';
import { productionSystem } from './systems/production';
import { cannonImpactSystem, projectileImpactSystem } from './systems/projectiles';
import { targetingSystem } from './systems/targeting';
import {
  isTileInMap,
  revealMapForPlayer,
  updatePlayerVisibility,
  visibilitySystem,
} from './systems/visibility';
import { winConditionSystem } from './systems/win-condition';
import { resourceWorksiteSystem } from './systems/worksites';

export const TREE_RESOURCE_AMOUNT = 100;
export const LOCAL_GOLD_DEPOSIT_AMOUNT = 650;
export const LOCAL_STONE_DEPOSIT_AMOUNT = 600;
const BILA_HORA_ENEMY_OPENING_WAIT_TICKS = SIM.TICK_HZ * 15;
const KUTNA_HORA_FIRST_WAVE_TICKS = SIM.TICK_HZ * 30;
const KUTNA_HORA_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 65;
const KUTNA_HORA_TOTAL_WAVES = 5;
const SUDOMER_FIRST_WAVE_TICKS = SIM.TICK_HZ * 300;
const SUDOMER_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 55;
const SUDOMER_TOTAL_WAVES = 5;
const SUDOMER_POP_CAP = 120;
const ZBOROV_ENEMY_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 55;
const ZBOROV_ENEMY_FIRST_WAVE_TICKS = SIM.TICK_HZ * 70;
const ZBOROV_ENEMY_WAVE_MIN_SIZE = 3;
const ZBOROV_ENEMY_WAVE_MAX_SIZE = 8;
const ZBOROV_ENEMY_WAVE_WAIT_CAP_TICKS = SIM.TICK_HZ * 35;
const ZBOROV_BASE_DEAD_TREE_COUNT = 18;
const ZBOROV_AMBIENT_DEAD_TREE_COUNT = 28;
const ZBOROV_AMBIENT_DEAD_TREE_AMOUNT = 45;
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
export const FORMATION_MODE_LINE = 1;

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
      removeSimEntity(world, eid);
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
    removeSimEntity(world, eid);
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
      removeSimEntity(world, eid);
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
    removeSimEntity(world, eid);
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
    removeSimEntity(world, eid);
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
      removeSimEntity(world, eid);
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

export function countLiveMilitary(world: SimWorld, playerId: number): number {
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

export function countLiveTrackedEids(world: SimWorld, eids: number[]): number {
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
