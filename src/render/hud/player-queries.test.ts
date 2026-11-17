import { describe, expect, it } from 'vitest';
import { Gatherer, Owner, Resource, ResourceKindId } from '@sim/components';
import { UnitDefId } from '@sim/defs';
import { createSimWorld, step, townCenterQuery, unitQuery, type SimWorld } from '@sim/world';
import { getWorkerCounts } from './player-queries';

const P1 = 1;

function trainVillager(world: SimWorld): number {
  const tc = townCenterQuery(world.ecs).find((eid) => Owner.player[eid] === P1)!;
  world.resources[P1].set([1000, 1000, 0, 0]);
  const before = new Set(unitQuery(world.ecs));
  world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.VILLAGER, playerId: P1 });
  for (let i = 0; i < 2000; i++) {
    step(world);
    const fresh = unitQuery(world.ecs).find((eid) => !before.has(eid) && Owner.player[eid] === P1);
    if (fresh !== undefined) return fresh;
  }
  throw new Error('villager never trained');
}

describe('getWorkerCounts', () => {
  it('counts nobody before any villager works', () => {
    const world = createSimWorld(801);
    world.paused = false;
    expect(getWorkerCounts(world, P1)).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
  });

  it('counts each working villager once, under the resource it gathers', () => {
    const world = createSimWorld(802);
    world.paused = false;
    const a = trainVillager(world);
    const b = trainVillager(world);
    for (let i = 0; i < 40; i++) step(world);
    const counts = getWorkerCounts(world, P1);
    expect(counts.food + counts.wood + counts.gold + counts.stone).toBe(2);
    for (const v of [a, b]) {
      const kind = Resource.kind[Gatherer.targetEid[v]];
      const key = kind === ResourceKindId.FOOD ? 'food' : kind === ResourceKindId.WOOD ? 'wood' : kind === ResourceKindId.GOLD ? 'gold' : 'stone';
      expect(counts[key]).toBeGreaterThan(0);
    }
    expect(getWorkerCounts(world, 0)).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
  });
});
