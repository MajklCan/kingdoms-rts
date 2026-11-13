/**
 * Deterministic late-game stress fixture and preset placement helpers.
 */

import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../../config';
import {
  Building,
  Health,
  Owner,
  PopulationCost,
  Position,
  ResourceWorksite,
  UnitKind,
  VillagerTag,
} from '../components';
import { AgeId, type BuildingDef, BuildingDefId, UnitDefId, getBuildingDef } from '../defs';
import { TileType } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { createAllTechSet } from '../tech-tree';
import { AI_PLAYER_ID, LOCAL_PLAYER_ID } from '../core/constants';
import { createSimWorld } from '../core/create-world';
import { removeSimEntity } from '../core/entities';
import { findBuildingAt, findEntityNear, findResourceAt } from '../core/lookup';
import { positionQuery, resourceQuery, unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { updatePlayerVisibility } from '../systems/visibility';
import {
  canPlaceBuildingAt,
  countWorksiteWorkers,
  createAiPlayerState,
  getWorksiteWorkerSlots,
  spawnWorksiteWorker,
} from '../world';
import { spawnCompletedBuilding } from './buildings';
import {
  spawnArcher,
  spawnCannon,
  spawnGunman,
  spawnMachineGun,
  spawnMortar,
  spawnScoutCavalry,
  spawnSpearman,
} from './units';

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

export function removePresetStarterMilitary(world: SimWorld): void {
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
    removeSimEntity(world, eid);
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

export function placePresetBuilding(
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

export function placePresetBuildingExact(
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
      removeSimEntity(world, eid);
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

export function spawnPresetUnits(
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

export function spawnPresetUnitAt(
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

export function findPresetUnitSpot(
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

export function hasEnemyEntityNear(
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
