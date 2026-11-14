import { describe, expect, it } from 'vitest';
import { addEntity, removeComponent } from 'bitecs';
import { NetId, Position } from '../components';
import { createSimWorld, resourceQuery } from '../world';
import { addSimEntity, compareDeterministicEids, sortedEids } from './entities';
import { findNearestResource, findResourceAt } from './lookup';
import { ResourceKindId } from '../components';

describe('sortedEids', () => {
  it('matches the comparator order, NetId first and raw eid for entities without one', () => {
    const world = createSimWorld(7);
    const eids: number[] = [];
    for (let i = 0; i < 40; i++) eids.push(addSimEntity(world));
    // Scramble NetIds so key order differs from eid order, and strip a few.
    for (let i = 0; i < eids.length; i++) NetId.value[eids[i]] = (i * 7919) % 101;
    removeComponent(world.ecs, NetId, eids[3]);
    removeComponent(world.ecs, NetId, eids[17]);
    eids.push(addEntity(world.ecs));
    const shuffled = [...eids].reverse();
    const expected = [...shuffled].sort((a, b) => compareDeterministicEids(world, a, b));
    expect(sortedEids(world, shuffled)).toEqual(expected);
    expect(sortedEids(world, [])).toEqual([]);
    expect(sortedEids(world, [eids[5]])).toEqual([eids[5]]);
  });

  it('returns a fresh array each call', () => {
    const world = createSimWorld(7);
    const eids = [addSimEntity(world), addSimEntity(world)];
    const a = sortedEids(world, eids);
    const b = sortedEids(world, eids);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('nearest lookups', () => {
  it('break exact distance ties toward the lower deterministic key', () => {
    const world = createSimWorld(7);
    const wood = [...resourceQuery(world.ecs)].filter((eid) => Position.x[eid] > 0).slice(0, 2);
    expect(wood.length).toBe(2);
    const [a, b] = wood;
    // Two nodes the same distance from (100, 100), far from everything else.
    Position.x[a] = 99;
    Position.y[a] = 100;
    Position.x[b] = 101;
    Position.y[b] = 100;
    NetId.value[a] = 900_001;
    NetId.value[b] = 900_000;
    expect(findResourceAt(world, 100, 100, 1.5)).toBe(b);
    NetId.value[a] = 899_999;
    expect(findResourceAt(world, 100, 100, 1.5)).toBe(a);
    // Strictly nearer always wins regardless of key.
    Position.x[b] = 100.5;
    expect(findResourceAt(world, 100, 100, 1.5)).toBe(b);
    // Outside the radius nothing is found.
    expect(findResourceAt(world, 100, 100, 0.4)).toBe(null);
    expect(findNearestResource(world, 200, 200, ResourceKindId.WOOD, 1)).toBe(null);
  });
});
