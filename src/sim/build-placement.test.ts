import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { Owner, Position } from './components';
import { BUILDING_TABLE, BuildingDefId, type BuildingDef } from './defs';
import {
  BUILD_PLACEMENT_UNIT_RADIUS,
  buildingQuery,
  canPlaceBuildingAt,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnVillager,
  step,
  type SimWorld,
  unitQuery,
} from './world';

function countOwnedBuildings(world: SimWorld, playerId: number): number {
  return buildingQuery(world.ecs).filter((eid) => Owner.player[eid] === playerId).length;
}

function findFarmTile(
  world: SimWorld,
  matches: (x: number, y: number) => boolean
): { x: number; y: number } {
  const def = BUILDING_TABLE[BuildingDefId.FARM];
  for (let y = 4; y < MAP.HEIGHT - 4; y++) {
    for (let x = 4; x < MAP.WIDTH - 4; x++) {
      if (!canPlaceBuildingAt(world, def, x, y)) continue;
      if (!matches(x, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No matching farm tile found');
}

function findUnitTileNear(
  world: SimWorld,
  cx: number,
  cy: number
): { x: number; y: number } {
  for (let r = 2; r <= Math.floor(BUILD_PLACEMENT_UNIT_RADIUS); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (Math.hypot(dx, dy) > BUILD_PLACEMENT_UNIT_RADIUS) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (world.map.walkability[y][x] !== 0) continue;
        if (findBuildingAt(world, x, y, 0.8) !== null) continue;
        if (findResourceAt(world, x, y, 0.8) !== null) continue;
        return { x, y };
      }
    }
  }
  throw new Error('No unit tile near build tile found');
}

function commandPlaceFarm(world: SimWorld, x: number, y: number): void {
  world.inputs.push({
    type: 'placeBuilding',
    defId: BuildingDefId.FARM,
    x,
    y,
    playerId: 1,
  });
  step(world);
}

describe('building placement influence', () => {
  const farmDef: BuildingDef = BUILDING_TABLE[BuildingDefId.FARM];

  it('rejects player building commands outside owned building and unit influence', () => {
    const world = createSimWorld(701);
    world.paused = false;
    world.resources[1].set([0, 1000, 0, 0]);
    const tile = findFarmTile(world, (x, y) => !canPlaceBuildingAt(world, farmDef, x, y, 1));
    const before = countOwnedBuildings(world, 1);

    commandPlaceFarm(world, tile.x, tile.y);

    expect(countOwnedBuildings(world, 1)).toBe(before);
  });

  it('allows player building commands near owned completed buildings', () => {
    const world = createSimWorld(702);
    world.paused = false;
    world.resources[1].set([0, 1000, 0, 0]);
    const tile = findFarmTile(world, (x, y) => canPlaceBuildingAt(world, farmDef, x, y, 1));
    const before = countOwnedBuildings(world, 1);

    commandPlaceFarm(world, tile.x, tile.y);

    expect(countOwnedBuildings(world, 1)).toBe(before + 1);
  });

  it('allows player building commands inside a small radius of owned units', () => {
    const world = createSimWorld(703);
    world.paused = false;
    world.resources[1].set([0, 1000, 0, 0]);
    const tile = findFarmTile(world, (x, y) => !canPlaceBuildingAt(world, farmDef, x, y, 1));
    const unitTile = findUnitTileNear(world, tile.x, tile.y);
    const before = countOwnedBuildings(world, 1);

    spawnVillager(world, unitTile.x, unitTile.y, 1, 0);
    expect(unitQuery(world.ecs).some((eid) =>
      Owner.player[eid] === 1 &&
      Math.hypot(Position.x[eid] - tile.x, Position.y[eid] - tile.y) <= BUILD_PLACEMENT_UNIT_RADIUS
    )).toBe(true);
    expect(canPlaceBuildingAt(world, farmDef, tile.x, tile.y, 1)).toBe(true);

    commandPlaceFarm(world, tile.x, tile.y);

    expect(countOwnedBuildings(world, 1)).toBe(before + 1);
  });
});
