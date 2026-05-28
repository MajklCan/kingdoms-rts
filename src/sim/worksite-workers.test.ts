import { describe, expect, it } from 'vitest';
import { addComponent, hasComponent, removeEntity } from 'bitecs';
import { BUILDING_TABLE, BuildingDefId, UnitDefId } from './defs';
import {
  Gatherer,
  GathererStateId,
  Position,
  Building,
  Resource,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  WorksiteWorker,
  type ResourceKind,
} from './components';
import {
  createSimWorld,
  resourceQuery,
  setSelected,
  spawnCompletedBuilding,
  spawnFoundation,
  spawnResource,
  spawnVillager,
  step,
  worksiteWorkerQuery,
  type SimWorld,
} from './world';
import { MAP } from '../config';
import { TechId, type TechIdValue } from './tech-tree';

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function countWorkers(world: SimWorld, siteEid: number): number {
  let count = 0;
  for (const worker of worksiteWorkerQuery(world.ecs)) {
    if (WorksiteWorker.siteEid[worker] === siteEid) count++;
  }
  return count;
}

function removeResources(world: SimWorld, kind: ResourceKind): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === kind) {
      removeEntity(world.ecs, eid);
    }
  }
}

function findOpenTileAtRange(
  world: SimWorld,
  cx: number,
  cy: number,
  minRange: number,
  maxRange: number
): { x: number; y: number } {
  for (let y = 4; y < MAP.HEIGHT - 4; y++) {
    for (let x = 4; x < MAP.WIDTH - 4; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < minRange || dist > maxRange) continue;
      if (world.map.walkability[y][x] !== 0) continue;
      return { x, y };
    }
  }
  throw new Error('No open tile in range');
}

function findOpenResourceTiles(
  world: SimWorld,
  cx: number,
  cy: number,
  count: number
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 4; y < MAP.HEIGHT - 4; y++) {
    for (let x = 4; x < MAP.WIDTH - 4; x++) {
      if (Math.hypot(x - cx, y - cy) > 8) continue;
      if (world.map.walkability[y][x] !== 0) continue;
      if (out.some((tile) => Math.hypot(tile.x - x, tile.y - y) < 2)) continue;
      out.push({ x, y });
      if (out.length >= count) return out;
    }
  }
  throw new Error('No open resource tiles found');
}

function farmFoodDeliveredAfterTicks(
  techs: TechIdValue[],
  withMill = false
): number {
  const world = createSimWorld(47);
  world.paused = false;
  removeResources(world, ResourceKindId.FOOD);
  for (const tech of techs) world.researchedTechs[1].add(tech);

  const spawn = world.map.spawns[1];
  spawnCompletedBuilding(world, BuildingDefId.FARM, spawn.x + 6, spawn.y + 4, 1);
  if (withMill) {
    spawnCompletedBuilding(world, BuildingDefId.MILL, spawn.x + 9, spawn.y + 4, 1);
  }

  stepN(world, 900);
  return world.resources[1][ResourceKindId.FOOD];
}

function farmWorkerCarryAfterTicks(techs: TechIdValue[], ticks: number): number {
  const world = createSimWorld(48);
  world.paused = false;
  removeResources(world, ResourceKindId.FOOD);
  for (const tech of techs) world.researchedTechs[1].add(tech);

  const spawn = world.map.spawns[1];
  const farm = spawnCompletedBuilding(world, BuildingDefId.FARM, spawn.x + 6, spawn.y + 4, 1);
  stepN(world, ticks);

  const farmer = worksiteWorkerQuery(world.ecs).find((eid) => WorksiteWorker.siteEid[eid] === farm);
  if (farmer === undefined) return 0;
  return ResourceCarry.amount[farmer];
}

describe('resource worksite workers', () => {
  it('starts with one free worker and requires the crew upgrade for extra workers', () => {
    const world = createSimWorld(42);
    world.paused = false;
    world.resources[1].set([0, 2000, 0, 1000]);

    const spawn = world.map.spawns[1];
    const siteEid = spawnFoundation(
      world,
      BuildingDefId.LUMBER_CAMP,
      spawn.x + 5,
      spawn.y - 1,
      1
    );

    stepN(world, BUILDING_TABLE[BuildingDefId.LUMBER_CAMP].buildTimeTicks);

    expect(ResourceWorksite.assignedWorkers[siteEid]).toBe(1);
    expect(countWorkers(world, siteEid)).toBe(1);

    world.inputs.push({ type: 'trainUnit', atEid: siteEid, defId: UnitDefId.VILLAGER });
    step(world);
    expect(world.productionQueues.get(siteEid)?.length ?? 0).toBe(0);

    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.LUMBER_CREWS });
    step(world);

    const woodBefore = world.resources[1][1];
    world.inputs.push(
      { type: 'trainUnit', atEid: siteEid, defId: UnitDefId.VILLAGER },
      { type: 'trainUnit', atEid: siteEid, defId: UnitDefId.VILLAGER },
      { type: 'trainUnit', atEid: siteEid, defId: UnitDefId.VILLAGER }
    );
    step(world);

    expect(world.productionQueues.get(siteEid)?.length).toBe(2);
    expect(world.resources[1][1]).toBe(woodBefore - 100);

    stepN(world, 1010);

    expect(ResourceWorksite.assignedWorkers[siteEid]).toBe(3);
    expect(countWorkers(world, siteEid)).toBe(3);
  });

  it('farms produce food without nearby berry nodes', () => {
    const world = createSimWorld(43);
    world.paused = false;
    removeResources(world, ResourceKindId.FOOD);

    const spawn = world.map.spawns[1];
    const farm = spawnCompletedBuilding(
      world,
      BuildingDefId.FARM,
      spawn.x + 6,
      spawn.y + 4,
      1
    );

    const foodBefore = world.resources[1][ResourceKindId.FOOD];
    stepN(world, 140);
    const farmer = worksiteWorkerQuery(world.ecs).find((eid) => WorksiteWorker.siteEid[eid] === farm);
    expect(farmer).not.toBeUndefined();
    if (farmer === undefined) return;

    expect(resourceQuery(world.ecs).some((eid) => Resource.kind[eid] === ResourceKindId.FOOD)).toBe(false);
    expect(ResourceWorksite.assignedWorkers[farm]).toBe(1);
    expect(countWorkers(world, farm)).toBe(1);
    expect(ResourceCarry.amount[farmer]).toBeGreaterThan(0);
    expect(Math.hypot(Position.x[farmer] - Position.x[farm], Position.y[farmer] - Position.y[farm])).toBeLessThanOrEqual(1.25);
    expect(world.resources[1][ResourceKindId.FOOD]).toBe(foodBefore);

    stepN(world, 700);

    expect(world.resources[1][ResourceKindId.FOOD]).toBeGreaterThan(foodBefore);
  });

  it('farm upgrades increase food produced per farm work cycle', () => {
    const baseFood = farmWorkerCarryAfterTicks([], 140);
    const firstUpgradeFood = farmWorkerCarryAfterTicks([TechId.FARMS], 140);
    const secondUpgradeFood = farmWorkerCarryAfterTicks([TechId.FARMS, TechId.FARMS_II], 140);

    expect(firstUpgradeFood).toBeGreaterThan(baseFood);
    expect(secondUpgradeFood).toBeGreaterThan(firstUpgradeFood);
  });

  it('mills act as nearby food drop-offs with a delivery bonus', () => {
    const townCenterFood = farmFoodDeliveredAfterTicks([TechId.FARMS, TechId.FARMS_II]);
    const millFood = farmFoodDeliveredAfterTicks([TechId.FARMS, TechId.FARMS_II, TechId.MILLS], true);

    expect(millFood).toBeGreaterThan(townCenterFood);
  });

  it('lumber crews keep working when trees are outside the old local radius', () => {
    const world = createSimWorld(44);
    world.paused = false;
    removeResources(world, ResourceKindId.WOOD);

    const spawn = world.map.spawns[1];
    const siteEid = spawnCompletedBuilding(
      world,
      BuildingDefId.LUMBER_CAMP,
      spawn.x + 5,
      spawn.y - 1,
      1
    );
    const farWoodTile = findOpenTileAtRange(
      world,
      Position.x[siteEid],
      Position.y[siteEid],
      12,
      20
    );
    const farWood = spawnResource(world, ResourceKindId.WOOD, farWoodTile.x, farWoodTile.y, 80);

    stepN(world, 5);

    const worker = worksiteWorkerQuery(world.ecs).find((eid) => WorksiteWorker.siteEid[eid] === siteEid);
    expect(worker).not.toBeUndefined();
    if (worker === undefined) return;
    expect(Gatherer.targetEid[worker]).toBe(farWood);
    expect(Gatherer.state[worker]).not.toBe(GathererStateId.IDLE);
  });

  it('spreads worksite workers across available nearby resource nodes', () => {
    const world = createSimWorld(49);
    world.paused = false;
    world.researchedTechs[1].add(TechId.LUMBER_CREWS);
    removeResources(world, ResourceKindId.WOOD);

    const spawn = world.map.spawns[1];
    const siteEid = spawnCompletedBuilding(
      world,
      BuildingDefId.LUMBER_CAMP,
      spawn.x + 5,
      spawn.y - 1,
      1
    );
    ResourceWorksite.freeWorkersSpawned[siteEid] = 1;

    for (const tile of findOpenResourceTiles(world, Position.x[siteEid], Position.y[siteEid], 3)) {
      spawnResource(world, ResourceKindId.WOOD, tile.x, tile.y, 80);
    }

    for (let i = 0; i < 3; i++) {
      const worker = spawnVillager(world, Position.x[siteEid] + i * 0.05, Position.y[siteEid], 1, 0);
      addComponent(world.ecs, WorksiteWorker, worker);
      WorksiteWorker.siteEid[worker] = siteEid;
    }

    stepN(world, 5);

    const assignedTargets = new Set<number>();
    for (const worker of worksiteWorkerQuery(world.ecs)) {
      if (WorksiteWorker.siteEid[worker] !== siteEid) continue;
      if (Gatherer.targetEid[worker] >= 0) assignedTargets.add(Gatherer.targetEid[worker]);
    }
    expect(assignedTargets.size).toBeGreaterThan(1);
  });

  it('deposits carried resources when a worksite worker cannot path to a crowded drop-off', () => {
    const world = createSimWorld(50);
    world.paused = false;
    const spawn = world.map.spawns[1];
    const siteEid = spawnCompletedBuilding(
      world,
      BuildingDefId.LUMBER_CAMP,
      spawn.x + 5,
      spawn.y - 1,
      1
    );
    for (let y = Math.round(Position.y[siteEid]) - 1; y <= Math.round(Position.y[siteEid]) + 1; y++) {
      for (let x = Math.round(Position.x[siteEid]) - 1; x <= Math.round(Position.x[siteEid]) + 1; x++) {
        if (x === Math.round(Position.x[siteEid]) && y === Math.round(Position.y[siteEid])) continue;
        spawnCompletedBuilding(world, BuildingDefId.HOUSE, x, y, 1);
      }
    }
    step(world);
    const worker = worksiteWorkerQuery(world.ecs).find((eid) => WorksiteWorker.siteEid[eid] === siteEid);
    expect(worker).not.toBeUndefined();
    if (worker === undefined) return;

    Position.x[worker] = Position.x[siteEid] - 3;
    Position.y[worker] = Position.y[siteEid] + 2;
    ResourceCarry.kind[worker] = ResourceKindId.WOOD;
    ResourceCarry.amount[worker] = 10;
    Gatherer.targetEid[worker] = siteEid;
    Gatherer.state[worker] = GathererStateId.RETURNING;
    world.paths.delete(worker);
    const woodBefore = world.resources[1][ResourceKindId.WOOD];

    stepN(world, 16);

    expect(ResourceCarry.amount[worker]).toBe(0);
    expect(world.resources[1][ResourceKindId.WOOD]).toBeGreaterThanOrEqual(woodBefore + 10);
  });

  it('removing a worksite removes its assigned workers', () => {
    const world = createSimWorld(45);
    world.paused = false;

    const spawn = world.map.spawns[1];
    const farm = spawnCompletedBuilding(
      world,
      BuildingDefId.FARM,
      spawn.x + 6,
      spawn.y + 4,
      1
    );
    step(world);
    expect(countWorkers(world, farm)).toBe(1);

    setSelected(world, farm, true);
    world.inputs.push({ type: 'removeSelectedBuildings', playerId: 1 });
    step(world);

    expect(countWorkers(world, farm)).toBe(0);
    expect(hasComponent(world.ecs, Building, farm)).toBe(false);
  });

  it('removing a completed house frees its provided population cap', () => {
    const world = createSimWorld(46);
    world.paused = false;

    const spawn = world.map.spawns[1];
    const capBefore = world.population[1].cap;
    const house = spawnCompletedBuilding(
      world,
      BuildingDefId.HOUSE,
      spawn.x + 6,
      spawn.y + 4,
      1
    );
    expect(world.population[1].cap).toBe(capBefore + BUILDING_TABLE[BuildingDefId.HOUSE].popProvided);

    setSelected(world, house, true);
    world.inputs.push({ type: 'removeSelectedBuildings', playerId: 1 });
    step(world);

    expect(world.population[1].cap).toBe(capBefore);
    expect(hasComponent(world.ecs, Building, house)).toBe(false);
  });
});
