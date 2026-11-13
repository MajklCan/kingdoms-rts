/**
 * Regressions for the desyncs found by the lockstep soak (src/net/testing).
 * Each test pins one root cause with a pure sim scenario, no network.
 */
import { describe, expect, it } from 'vitest';
import { entityExists, getEntityComponents } from 'bitecs';
import { polluteEidAllocator, resetBitecsGlobals } from '../net/testing/mp-match';
import { checksumWorld } from './checksum';
import { AgeId } from './defs';
import { MapId } from './map-gen';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import {
  createAiPlayerState,
  createSimWorld,
  removeSimEntity,
  spawnSpearman,
  step,
  type SimWorld,
} from './world';

function aiVsAiWorld(seed: number): SimWorld {
  const world = createSimWorld(seed, { mapId: MapId.RIVERLANDS, startingAge: AgeId.CASTLE, aiDifficulty: 'hard' });
  world.humanPlayers = new Set();
  world.aiPlayers[1] = { ...createAiPlayerState(0, 'medium'), difficulty: 'medium' };
  world.paused = false;
  return world;
}

function loadedCopy(world: SimWorld, seed: number): SimWorld {
  const saved = JSON.parse(JSON.stringify(serializeSimWorld(world)));
  const fresh = createSimWorld(seed, { mapId: MapId.RIVERLANDS, startingAge: AgeId.CASTLE, aiDifficulty: 'hard' });
  loadSimWorldSnapshot(fresh, saved);
  return fresh;
}

describe('lockstep regressions', () => {
  it('the same match hashes the same when the raw eids are numbered differently', () => {
    // A client that already played a match gets recycled, descending eids.
    // Order and checksum must follow NetIds, never raw eids.
    resetBitecsGlobals();
    const fresh = aiVsAiWorld(41);
    polluteEidAllocator();
    const recycled = aiVsAiWorld(41);
    expect(fresh.nextNetId).toBe(recycled.nextNetId);
    for (let tick = 0; tick < 900; tick++) {
      step(fresh);
      step(recycled);
      if (tick % 30 === 29) expect(checksumWorld(recycled), `tick ${tick}`).toBe(checksumWorld(fresh));
    }
  });

  it('removing an entity drops its components and every side table entry', () => {
    const world = createSimWorld(5);
    const eid = spawnSpearman(world, 10, 10, 1);
    world.movementStuck.set(eid, { lastDist: 2, waypointX: 11, waypointY: 11, noProgressTicks: 3, cooldownTicks: 0, attempts: 1 });
    world.formationSpeedCaps.set(eid, 1);
    world.paths.set(eid, [{ x: 11, y: 11 }]);
    expect(getEntityComponents(world.ecs, eid).length).toBeGreaterThan(0);

    removeSimEntity(world, eid);

    expect(entityExists(world.ecs, eid)).toBe(false);
    expect(world.movementStuck.has(eid)).toBe(false);
    expect(world.formationSpeedCaps.has(eid)).toBe(false);
    expect(world.paths.has(eid)).toBe(false);
  });

  it('a mid-match save, loaded into a fresh world, plays on exactly like the original', () => {
    resetBitecsGlobals();
    const original = aiVsAiWorld(77);
    for (let i = 0; i < 450; i++) step(original);
    polluteEidAllocator();
    const loaded = loadedCopy(original, 77);
    expect(checksumWorld(loaded)).toBe(checksumWorld(original));
    // New entities keep getting fresh NetIds after the load.
    expect(loaded.nextNetId).toBe(original.nextNetId);
    for (let tick = 0; tick < 600; tick++) {
      step(original);
      step(loaded);
      if (tick % 30 === 29) expect(checksumWorld(loaded), `tick ${450 + tick}`).toBe(checksumWorld(original));
    }
  });
});
