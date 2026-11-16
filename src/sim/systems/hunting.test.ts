import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  GameAnimal,
  GameAnimalStateId,
  GameSpeciesId,
  Gatherer,
  GathererStateId,
  Position,
  Resource,
  ResourceKindId,
} from '../components';
import { gameAnimalQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnGameAnimal, HERD_MIN_SPAWN_DISTANCE } from '../factories/game-animals';
import { MapId, type MapIdValue } from '../map-gen';
import { checksumWorld } from '../checksum';
import { createSimWorld } from '../world';
import { P1, quietWorld, stepN, tcOf, villagersNear } from '../testing/villager-jobs-fixture';
import { DEER_FOOD, WANDER_LEASH } from './hunting';

const SKIRMISH_MAPS = Object.values(MapId).filter((id) => id !== MapId.ZBOROV_LINES) as MapIdValue[];

function animals(world: SimWorld): number[] {
  return [...gameAnimalQuery(world.ecs)];
}

function positions(world: SimWorld): string {
  return animals(world)
    .map((eid) => `${Position.x[eid].toFixed(4)},${Position.y[eid].toFixed(4)}`)
    .join(';');
}

/** A deer herd on open land a few tiles from player 1's town center. */
function deerNearBase(world: SimWorld, count: number): number[] {
  const tc = tcOf(world, P1);
  for (let r = 6; r < 16; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]] as const) {
      const x = Math.round(Position.x[tc]) + dx;
      const y = Math.round(Position.y[tc]) + dy;
      const tiles = Array.from({ length: count }, (_, i) => ({ x: x + i, y }));
      if (tiles.every((t) => world.grid[t.y]?.[t.x] === 0)) {
        return tiles.map((t) => spawnGameAnimal(world, GameSpeciesId.DEER, t.x, t.y));
      }
    }
  }
  throw new Error('no open land for deer');
}

describe('huntable game', () => {
  it('every skirmish map gets mirrored herds away from both bases', () => {
    for (const mapId of SKIRMISH_MAPS) {
      const world = createSimWorld(11, { mapId });
      const herd = animals(world);
      expect(herd.length, mapId).toBeGreaterThanOrEqual(4);
      expect(herd.length % 2, mapId).toBe(0);
      const spawns = [world.map.spawns[1], world.map.spawns[2]];
      for (const eid of herd) {
        const x = Position.x[eid];
        const y = Position.y[eid];
        for (const s of spawns) expect(Math.hypot(s.x - x, s.y - y)).toBeGreaterThanOrEqual(HERD_MIN_SPAWN_DISTANCE - 2);
        const mirror = herd.find(
          (other) =>
            Position.x[other] === MAP.WIDTH - 1 - x &&
            Position.y[other] === MAP.HEIGHT - 1 - y &&
            GameAnimal.species[other] === GameAnimal.species[eid]
        );
        expect(mirror, `${mapId} ${x},${y}`).not.toBeUndefined();
        expect(Resource.kind[eid]).toBe(ResourceKindId.FOOD);
      }
    }
  });

  it('wanders deterministically and stays on its leash', () => {
    const a = createSimWorld(21);
    const b = createSimWorld(21);
    a.paused = false;
    b.paused = false;
    const start = positions(a);
    stepN(a, 600);
    stepN(b, 600);
    expect(positions(a)).toBe(positions(b));
    expect(positions(a)).not.toBe(start);
    expect(checksumWorld(a)).toBe(checksumWorld(b));
    for (const eid of animals(a)) {
      const d = Math.hypot(Position.x[eid] - GameAnimal.homeX[eid], Position.y[eid] - GameAnimal.homeY[eid]);
      expect(d).toBeLessThanOrEqual(WANDER_LEASH * Math.SQRT2 + 0.01);
    }
  });

  it('a hunter kills a deer, carries its food home and moves on to the herd', () => {
    const world = quietWorld();
    const [deer, second] = deerNearBase(world, 2);
    const [hunter] = villagersNear(world, tcOf(world, P1), 1);
    const foodBefore = world.resources[P1][ResourceKindId.FOOD];
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [hunter], targetEid: deer });

    let killedAt = -1;
    for (let i = 0; i < 2400 && hasComponent(world.ecs, Resource, deer); i++) {
      stepN(world, 1);
      if (killedAt < 0 && hasComponent(world.ecs, GameAnimal, deer) && GameAnimal.state[deer] === GameAnimalStateId.CARCASS) {
        killedAt = world.tick;
        const x = Position.x[deer];
        const y = Position.y[deer];
        stepN(world, 100);
        // A carcass lies still.
        expect(Position.x[deer]).toBe(x);
        expect(Position.y[deer]).toBe(y);
      }
    }
    expect(killedAt).toBeGreaterThan(0);
    // The first deer is eaten up and delivered (minus what is still carried).
    expect(hasComponent(world.ecs, GameAnimal, deer)).toBe(false);
    expect(world.resources[P1][ResourceKindId.FOOD]).toBeGreaterThanOrEqual(foodBefore + DEER_FOOD - 10);
    // ...and he goes for the next animal of the herd.
    stepN(world, 200);
    expect(Gatherer.targetEid[hunter]).toBe(second);
    expect(Gatherer.state[hunter]).not.toBe(GathererStateId.IDLE);
  });

  it('a hunt survives a save round trip with identical checksums', async () => {
    const { serializeSimWorld } = await import('../save/serialize');
    const { loadSimWorldSnapshot } = await import('../save/load');
    const world = quietWorld(9);
    const [deer] = deerNearBase(world, 2);
    const [hunter] = villagersNear(world, tcOf(world, P1), 1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [hunter], targetEid: deer });
    stepN(world, 200);
    const restored = quietWorld(1);
    loadSimWorldSnapshot(restored, JSON.parse(JSON.stringify(serializeSimWorld(world, 'hunt'))));
    expect(checksumWorld(restored)).toBe(checksumWorld(world));
    for (let i = 0; i < 400; i++) {
      stepN(world, 1);
      stepN(restored, 1);
    }
    expect(checksumWorld(restored)).toBe(checksumWorld(world));
  });
});
