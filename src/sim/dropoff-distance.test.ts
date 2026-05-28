import { removeEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import {
  Gatherer,
  GathererStateId,
  Position,
  Resource,
  ResourceCarry,
  ResourceKindId,
} from './components';
import {
  createSimWorld,
  resourceQuery,
  spawnResource,
  spawnVillager,
  step,
  type SimWorld,
} from './world';

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function townCenterEdgeDistance(world: SimWorld, eid: number): number {
  const spawn = world.map.spawns[1];
  const dx = Math.max(0, Math.abs(Position.x[eid] - spawn.x) - 1.5);
  const dy = Math.max(0, Math.abs(Position.y[eid] - spawn.y) - 1.5);
  return Math.hypot(dx, dy);
}

function makeCarrierNearTownCenter(world: SimWorld, edgeDistance: number): number {
  const spawn = world.map.spawns[1];
  const eid = spawnVillager(world, spawn.x + 1.5 + edgeDistance, spawn.y, 1, 0);
  Gatherer.state[eid] = GathererStateId.RETURNING;
  Gatherer.targetEid[eid] = -1;
  ResourceCarry.kind[eid] = ResourceKindId.STONE;
  ResourceCarry.amount[eid] = 10;
  return eid;
}

function removeResourcesOfKind(world: SimWorld, kind: number): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === kind) removeEntity(world.ecs, eid);
  }
}

describe('drop-off distance', () => {
  it('requires resource carriers to reach the building edge before depositing', () => {
    const world = createSimWorld(99);
    world.paused = false;

    const tooFar = makeCarrierNearTownCenter(world, 0.9);
    const stoneBefore = world.resources[1][ResourceKindId.STONE];

    step(world);

    expect(ResourceCarry.amount[tooFar]).toBe(10);
    expect(world.resources[1][ResourceKindId.STONE]).toBe(stoneBefore);

    const adjacentTileCenter = makeCarrierNearTownCenter(world, 0.5);

    step(world);

    expect(Gatherer.state[adjacentTileCenter]).toBe(GathererStateId.RETURNING);
    expect(ResourceCarry.amount[adjacentTileCenter]).toBe(10);
    expect(world.resources[1][ResourceKindId.STONE]).toBe(stoneBefore);

    const contact = makeCarrierNearTownCenter(world, 0.18);

    step(world);

    expect(Gatherer.state[contact]).toBe(GathererStateId.DEPOSITING);
    expect(ResourceCarry.amount[contact]).toBe(10);
    expect(world.resources[1][ResourceKindId.STONE]).toBe(stoneBefore);

    stepN(world, 9);

    expect(ResourceCarry.amount[contact]).toBe(0);
    expect(world.resources[1][ResourceKindId.STONE]).toBe(stoneBefore + 10);
  });

  it('routes carriers to a close building-edge contact point before depositing', () => {
    const world = createSimWorld(101);
    world.paused = false;
    const spawn = world.map.spawns[1];
    const carrier = spawnVillager(world, spawn.x + 6, spawn.y, 1, 0);
    Gatherer.state[carrier] = GathererStateId.RETURNING;
    Gatherer.targetEid[carrier] = -1;
    ResourceCarry.kind[carrier] = ResourceKindId.WOOD;
    ResourceCarry.amount[carrier] = 10;

    for (let i = 0; i < 240 && Gatherer.state[carrier] !== GathererStateId.DEPOSITING; i++) {
      step(world);
    }

    expect(Gatherer.state[carrier]).toBe(GathererStateId.DEPOSITING);
    expect(townCenterEdgeDistance(world, carrier)).toBeLessThan(0.25);
  });

  it('skips unreachable resource targets after a deposit instead of getting stuck', () => {
    const world = createSimWorld(102);
    world.paused = false;
    removeResourcesOfKind(world, ResourceKindId.WOOD);

    const spawn = world.map.spawns[1];
    const wallX = Math.min(MAP.WIDTH - 3, spawn.x + 4);
    for (let y = 0; y < MAP.HEIGHT; y++) world.map.walkability[y][wallX] = 1;

    const unreachable = spawnResource(world, ResourceKindId.WOOD, wallX + 2, spawn.y, 100);
    const reachable = spawnResource(
      world,
      ResourceKindId.WOOD,
      Math.max(1, spawn.x - 6),
      spawn.y,
      100
    );
    const carrier = spawnVillager(world, spawn.x + 1.66, spawn.y, 1, 0);
    Gatherer.state[carrier] = GathererStateId.DEPOSITING;
    Gatherer.cooldown[carrier] = 0;
    ResourceCarry.kind[carrier] = ResourceKindId.WOOD;
    ResourceCarry.amount[carrier] = 10;

    step(world);

    expect(Gatherer.targetEid[carrier]).toBe(reachable);
    expect(Gatherer.targetEid[carrier]).not.toBe(unreachable);
    expect(Gatherer.state[carrier]).toBe(GathererStateId.WALKING_TO);
    expect(world.paths.has(carrier)).toBe(true);
  });

  it('requires gatherers to stand close to resource nodes before harvesting', () => {
    const world = createSimWorld(100);
    world.paused = false;

    const spawn = world.map.spawns[1];
    const tree = spawnResource(world, ResourceKindId.WOOD, spawn.x + 8, spawn.y + 1, 100);
    const worker = spawnVillager(world, Position.x[tree] + 0.8, Position.y[tree], 1, 0);
    Gatherer.targetEid[worker] = tree;
    Gatherer.state[worker] = GathererStateId.WALKING_TO;

    step(world);

    expect(Gatherer.state[worker]).toBe(GathererStateId.WALKING_TO);

    Position.x[worker] = Position.x[tree] + 0.45;
    Position.y[worker] = Position.y[tree];

    step(world);

    expect(Gatherer.state[worker]).toBe(GathererStateId.GATHERING);
  });
});
