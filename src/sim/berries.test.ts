import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../config';
import { Position, Resource, ResourceKindId } from './components';
import { BERRY_BUSH_AMOUNT } from './core/create-world';
import { MapId, type MapIdValue } from './map-gen';
import {
  AI_PLAYER_ID,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  resourceQuery,
  spawnVillager,
  step,
  type SimWorld,
} from './world';

function berries(world: SimWorld): number[] {
  return [...resourceQuery(world.ecs)].filter((eid) => Resource.kind[eid] === ResourceKindId.FOOD);
}

function berriesNear(world: SimWorld, x: number, y: number, radius: number): number {
  return berries(world).filter((eid) => Math.hypot(Position.x[eid] - x, Position.y[eid] - y) <= radius).length;
}

const SKIRMISH_MAPS = Object.values(MapId).filter((id) => id !== MapId.ZBOROV_LINES) as MapIdValue[];

describe('berry bushes', () => {
  it('every skirmish map gives both players the same starting berry patch', () => {
    for (const mapId of SKIRMISH_MAPS) {
      for (const seed of [3, 4242]) {
        const world = createSimWorld(seed, { mapId });
        const [p1, p2] = [world.map.spawns[1], world.map.spawns[2]];
        // Lone bushes keep 10+ tiles from both bases, so this counts the
        // starting patch only (terrain may nudge a bush a tile or two out).
        const near1 = berriesNear(world, p1.x, p1.y, 9.9);
        const near2 = berriesNear(world, p2.x, p2.y, 9.9);
        expect(near1, `${mapId} seed ${seed}`).toBeGreaterThanOrEqual(4);
        expect(near1, `${mapId} seed ${seed}`).toBe(near2);
        for (const eid of berries(world)) expect(Resource.amount[eid]).toBe(BERRY_BUSH_AMOUNT);
      }
    }
  });

  it('places the Krkonose berries as exact point mirrors', () => {
    const world = createSimWorld(11, { mapId: MapId.KRKONOSE_WINTER_CROWN });
    const tiles = new Set(berries(world).map((eid) => `${Position.x[eid]},${Position.y[eid]}`));
    for (const eid of berries(world)) {
      expect(tiles.has(`${MAP.WIDTH - 1 - Position.x[eid]},${MAP.HEIGHT - 1 - Position.y[eid]}`)).toBe(true);
    }
  });

  it('scatters a few lone bushes away from both bases', () => {
    let far = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = createSimWorld(seed);
      const [p1, p2] = [world.map.spawns[1], world.map.spawns[2]];
      far += berries(world).filter(
        (eid) =>
          Math.hypot(Position.x[eid] - p1.x, Position.y[eid] - p1.y) > 9 &&
          Math.hypot(Position.x[eid] - p2.x, Position.y[eid] - p2.y) > 9
      ).length;
    }
    expect(far).toBeGreaterThan(5);
    expect(far).toBeLessThanOrEqual(5 * 6);
  });

  it('is gathered to depletion and then disappears', () => {
    const world = createSimWorld(4242);
    world.paused = false;
    world.aiPlayers[AI_PLAYER_ID] = null;
    const p1 = world.map.spawns[1];
    const bush = berries(world)
      .sort((a, b) => Math.hypot(Position.x[a] - p1.x, Position.y[a] - p1.y) - Math.hypot(Position.x[b] - p1.x, Position.y[b] - p1.y))[0];
    Resource.amount[bush] = 12;
    let spot = { x: Position.x[bush] + 1, y: Position.y[bush] + 1 };
    for (let r = 1; r < 4; r++) {
      const c = { x: Position.x[bush] + r, y: Position.y[bush] };
      if (world.map.walkability[c.y][c.x] === 0 && !findResourceAt(world, c.x, c.y, 0.6) && !findBuildingAt(world, c.x, c.y, 0.5)) {
        spot = c;
        break;
      }
    }
    const villager = spawnVillager(world, spot.x, spot.y, 1);
    const foodBefore = world.resources[1][ResourceKindId.FOOD];
    world.inputs.push({ type: 'cmdGather', playerId: 1, eids: [villager], targetEid: bush });
    for (let i = 0; i < 2000 && world.resources[1][ResourceKindId.FOOD] < foodBefore + 12; i++) step(world);
    expect(hasComponent(world.ecs, Resource, bush)).toBe(false);
    // All 12 came home; the villager then moves on to the next bush of the patch.
    expect(world.resources[1][ResourceKindId.FOOD]).toBeGreaterThanOrEqual(foodBefore + 12);
    expect(world.gameEvents.some((e) => e.kind === 'resourceDepleted' && e.eid === bush)).toBe(true);
  });
});
