import { removeEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { Resource, ResourceKindId } from './components';
import { TileType } from './map-gen';
import {
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  resourceQuery,
  spawnResource,
  step,
  type SimWorld,
} from './world';

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function countWood(world: SimWorld): number {
  let count = 0;
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] === ResourceKindId.WOOD && Resource.amount[eid] > 0) count++;
  }
  return count;
}

function clearWood(world: SimWorld): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === ResourceKindId.WOOD) removeEntity(world.ecs, eid);
  }
}

function findRegrowthPair(world: SimWorld): { seedX: number; seedY: number; growX: number; growY: number } {
  for (let y = 6; y < MAP.HEIGHT - 6; y++) {
    for (let x = 6; x < MAP.WIDTH - 7; x++) {
      const seedTile = world.map.tiles[y * MAP.WIDTH + x];
      const growTile = world.map.tiles[y * MAP.WIDTH + x + 1];
      const seedOk = seedTile === TileType.GRASS || seedTile === TileType.FOREST;
      const growOk = growTile === TileType.GRASS || growTile === TileType.FOREST;
      if (!seedOk || !growOk) continue;
      if (world.map.walkability[y][x] !== 0 || world.map.walkability[y][x + 1] !== 0) continue;
      if (findResourceAt(world, x, y, 0.6) !== null) continue;
      if (findResourceAt(world, x + 1, y, 0.6) !== null) continue;
      if (findBuildingAt(world, x, y, 7) !== null) continue;
      if (findBuildingAt(world, x + 1, y, 7) !== null) continue;
      return { seedX: x, seedY: y, growX: x + 1, growY: y };
    }
  }
  throw new Error('No valid forest regrowth pair found');
}

function findEdgeRegrowthSpot(world: SimWorld): { x: number; y: number } {
  for (let y = 4; y < MAP.HEIGHT - 4; y++) {
    for (const x of [2, 3, 4, MAP.WIDTH - 5, MAP.WIDTH - 4, MAP.WIDTH - 3]) {
      const tile = world.map.tiles[y * MAP.WIDTH + x];
      const tileOk = tile === TileType.GRASS || tile === TileType.FOREST;
      if (!tileOk) continue;
      if (world.map.walkability[y][x] !== 0) continue;
      if (findResourceAt(world, x, y, 0.6) !== null) continue;
      if (findBuildingAt(world, x, y, 7) !== null) continue;
      return { x, y };
    }
  }
  throw new Error('No valid edge regrowth spot found');
}

describe('forest regrowth', () => {
  it('can replenish an empty grass tile near an existing tree', () => {
    const world = createSimWorld(77);
    world.paused = false;
    // Suppress the player-2 AI: it also draws world.rng.int during the run, which
    // would shift the parity of the deterministic int() stub below and make
    // regrowth target the wrong tile. With both players "human" the regrowth
    // system is the only rng.int consumer, so the stub stays aligned.
    world.humanPlayers = new Set([1, 2]);
    clearWood(world);

    const spot = findRegrowthPair(world);
    spawnResource(world, ResourceKindId.WOOD, spot.seedX, spot.seedY, 100);

    let intCalls = 0;
    world.rng.int = () => (intCalls++ % 2 === 0 ? spot.growX : spot.growY);
    world.rng.next = () => 0;

    stepN(world, 121);

    const regrown = findResourceAt(world, spot.growX, spot.growY, 0.6);
    expect(regrown).not.toBeNull();
    expect(regrown === null ? null : Resource.kind[regrown]).toBe(ResourceKindId.WOOD);
    expect(countWood(world)).toBeGreaterThanOrEqual(2);
  });

  it('favors empty edge grass for map-border replenishment', () => {
    const world = createSimWorld(88);
    world.paused = false;
    // See note above: keep the AI from consuming rng.int and desyncing the stub.
    world.humanPlayers = new Set([1, 2]);
    clearWood(world);

    const spot = findEdgeRegrowthSpot(world);
    let intCalls = 0;
    world.rng.int = () => (intCalls++ % 2 === 0 ? spot.x : spot.y);
    world.rng.next = () => 0;

    stepN(world, 81);

    const regrown = findResourceAt(world, spot.x, spot.y, 0.6);
    expect(regrown).not.toBeNull();
    expect(regrown === null ? null : Resource.kind[regrown]).toBe(ResourceKindId.WOOD);
  });
});
