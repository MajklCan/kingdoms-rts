import { describe, expect, it } from 'vitest';
import { createSimWorld, spawnSpearman, spawnCompletedBuilding, step } from './world';
import { Health } from './components';
import { BuildingDefId } from './defs';

describe('sound cues', () => {
  it('starts with no buffered cues', () => {
    const world = createSimWorld(7);
    expect(world.soundCues).toHaveLength(0);
  });

  it('emits a unit_death cue when a unit reaches zero HP', () => {
    const world = createSimWorld(7);
    world.paused = false;
    const eid = spawnSpearman(world, 5, 5, 1);
    Health.hp[eid] = 0;
    step(world);
    const death = world.soundCues.find((c) => c.kind === 'unit_death');
    expect(death).toBeTruthy();
    expect(death?.player).toBe(1);
  });

  it('emits a building_destroyed cue when a building is razed', () => {
    const world = createSimWorld(7);
    world.paused = false;
    const b = spawnCompletedBuilding(world, BuildingDefId.BARRACKS, 8, 8, 1);
    Health.hp[b] = 0;
    step(world);
    expect(world.soundCues.some((c) => c.kind === 'building_destroyed')).toBe(true);
  });
});
