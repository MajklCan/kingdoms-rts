import { describe, expect, it } from 'vitest';
import { addComponent } from 'bitecs';
import { MAP } from '../config';
import { Position, ResourceKindId, Selected } from './components';
import {
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnResource,
  spawnSpearman,
  spawnVillager,
  step,
  type SimWorld,
} from './world';

function findOpenTile(world: SimWorld): { x: number; y: number } {
  for (let y = 4; y < MAP.HEIGHT - 4; y++) {
    for (let x = 4; x < MAP.WIDTH - 4; x++) {
      if (world.map.walkability[y][x] !== 0) continue;
      if (findBuildingAt(world, x, y, 1.2) !== null) continue;
      if (findResourceAt(world, x, y, 0.8) !== null) continue;
      return { x, y };
    }
  }
  throw new Error('No open tile found');
}

function findOpenStrip(world: SimWorld, length: number): { x: number; y: number } {
  for (let y = 4; y < MAP.HEIGHT - 4; y++) {
    for (let x = 4; x < MAP.WIDTH - length - 4; x++) {
      let clear = true;
      for (let ix = x; ix < x + length; ix++) {
        if (world.map.walkability[y][ix] !== 0) clear = false;
        if (findBuildingAt(world, ix, y, 1.2) !== null) clear = false;
        if (findResourceAt(world, ix, y, 0.8) !== null) clear = false;
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('No open strip found');
}

describe('unit separation', () => {
  it('nudges overlapping units apart without orders', () => {
    const world = createSimWorld(99);
    world.paused = false;
    const spot = findOpenTile(world);
    const a = spawnSpearman(world, spot.x, spot.y, 1);
    const b = spawnSpearman(world, spot.x, spot.y, 1);

    step(world);

    const dist = Math.hypot(Position.x[a] - Position.x[b], Position.y[a] - Position.y[b]);
    expect(dist).toBeGreaterThan(0.05);
  });

  it('does not push overlapping villagers apart', () => {
    const world = createSimWorld(100);
    world.paused = false;
    const spot = findOpenTile(world);
    const a = spawnVillager(world, spot.x, spot.y, 1, 0);
    const b = spawnVillager(world, spot.x, spot.y, 1, 0);

    step(world);

    expect(Position.x[a]).toBeCloseTo(spot.x);
    expect(Position.y[a]).toBeCloseTo(spot.y);
    expect(Position.x[b]).toBeCloseTo(spot.x);
    expect(Position.y[b]).toBeCloseTo(spot.y);
  });

  it('lets moving villagers pass through idle villagers without path drift', () => {
    const world = createSimWorld(103);
    world.paused = false;
    const spot = findOpenStrip(world, 6);
    const mover = spawnVillager(world, spot.x, spot.y, 1, 0);
    spawnVillager(world, spot.x + 0.65, spot.y + 0.15, 1, 0);

    world.paths.set(mover, [{ x: spot.x + 4, y: spot.y }]);
    const startX = Position.x[mover];
    const startY = Position.y[mover];

    for (let i = 0; i < 16; i++) step(world);

    expect(Position.x[mover]).toBeGreaterThan(startX + 0.8);
    expect(Position.y[mover]).toBeCloseTo(startY);
  });

  it('assigns different resource contact points for stacked villagers', () => {
    const world = createSimWorld(104);
    world.paused = false;
    const spot = findOpenStrip(world, 8);
    const resource = spawnResource(world, ResourceKindId.WOOD, spot.x + 4, spot.y, 100);
    world.map.walkability[spot.y][spot.x + 4] = 1;
    const a = spawnVillager(world, spot.x, spot.y, 1, 0);
    const b = spawnVillager(world, spot.x, spot.y, 1, 0);
    addComponent(world.ecs, Selected, a);
    addComponent(world.ecs, Selected, b);

    world.inputs.push({ type: 'gatherSelected', targetEid: resource });
    step(world);

    const aPath = world.paths.get(a);
    const bPath = world.paths.get(b);
    expect(aPath).toBeDefined();
    expect(bPath).toBeDefined();
    const aFinal = aPath?.[aPath.length - 1];
    const bFinal = bPath?.[bPath.length - 1];
    expect(aFinal).toBeDefined();
    expect(bFinal).toBeDefined();
    if (!aFinal || !bFinal) return;

    expect(Math.hypot(aFinal.x - bFinal.x, aFinal.y - bFinal.y)).toBeGreaterThan(0.35);
  });

  it('lets a moving unit keep its path through allied bodies', () => {
    const world = createSimWorld(101);
    world.paused = false;
    const spot = findOpenStrip(world, 6);
    const mover = spawnSpearman(world, spot.x, spot.y, 1);
    spawnSpearman(world, spot.x + 0.65, spot.y + 0.15, 1);

    world.paths.set(mover, [{ x: spot.x + 4, y: spot.y }]);
    const startX = Position.x[mover];
    const startY = Position.y[mover];

    for (let i = 0; i < 16; i++) step(world);

    expect(Position.x[mover]).toBeGreaterThan(startX + 0.8);
    expect(Math.abs(Position.y[mover] - startY)).toBeLessThan(0.2);
  });

  it('rarely repaths when a direct waypoint becomes blocked', () => {
    const world = createSimWorld(102);
    world.paused = false;
    const spot = findOpenStrip(world, 6);
    const unit = spawnSpearman(world, spot.x, spot.y, 1);
    world.map.walkability[spot.y][spot.x + 1] = 1;
    world.paths.set(unit, [{ x: spot.x + 3, y: spot.y }]);

    for (let i = 0; i < 85; i++) step(world);

    expect(Position.x[unit]).toBeGreaterThan(spot.x + 1.2);
  });
});
