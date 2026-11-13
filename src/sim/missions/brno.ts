/**
 * Siege of Brno: enemy city, walls, defenders and reinforcement waves.
 */

import { MAP, SIM } from '../../config';
import { Position } from '../components';
import { AgeId, BuildingDefId, UnitDefId } from '../defs';
import { CampaignMissionId, type CampaignObjectiveDef } from '../campaign';
import type { GridPos } from '../pathfinding';
import { TechId, createStartingTechSetForAge } from '../tech-tree';
import { createAiPlayerState } from '../ai/difficulty';
import { AI_PLAYER_ID, LOCAL_PLAYER_ID, POP_CAP_HARD_LIMIT } from '../core/constants';
import { applyStartingResources, createAgeState } from '../core/create-world';
import { findOwnedTownCenter } from '../core/lookup';
import type { SimWorld } from '../core/types';
import {
  findPresetUnitSpot,
  placePresetBuilding,
  placePresetBuildingExact,
  removePresetStarterMilitary,
  spawnPresetUnits,
} from '../factories/late-game';
import { spawnScoutCavalry } from '../factories/units';
import { countIncompleteCampaignObjectives, countLiveMilitary } from './campaign-world';

export function configureSiegeOfBrno(
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

export function brnoReinforcementSystem(world: SimWorld): void {
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
