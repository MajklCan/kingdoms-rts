import { describe, expect, it } from 'vitest';
import {
  Resource,
  ResourceCarry,
  ResourceKindId,
  type ResourceKind,
  STONE_GATHER_COOLDOWN,
  VILLAGER_CARRY_CAPACITY,
  VILLAGER_GATHER_COOLDOWN,
  gatherCooldownForKind,
} from './components';
import {
  AI_PLAYER_ID,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnResource,
  spawnVillager,
  step,
  type SimWorld,
} from './world';

/** A free tile near player 1's base with a free tile right of it. */
function clearSpot(world: SimWorld, skip: number): { x: number; y: number } {
  const base = world.map.spawns[1];
  let seen = 0;
  for (let r = 4; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = base.x + dx;
        const y = base.y + dy;
        const free = (tx: number, ty: number): boolean =>
          world.map.walkability[ty]?.[tx] === 0 &&
          !findResourceAt(world, tx, ty, 1.6) &&
          !findBuildingAt(world, tx, ty, 2.5);
        if (!free(x, y) || !free(x + 1, y)) continue;
        if (seen++ === skip) return { x, y };
      }
    }
  }
  throw new Error('no clear spot near the base');
}

/** Ticks at which the node lost a unit, for the first `units` units. */
function gatherTicks(kind: ResourceKind, units: number): number[] {
  const world = createSimWorld(4242);
  world.paused = false;
  world.aiPlayers[AI_PLAYER_ID] = null;
  const spot = clearSpot(world, 0);
  const node = spawnResource(world, kind, spot.x, spot.y, 500);
  const villager = spawnVillager(world, spot.x + 1, spot.y, 1);
  world.inputs.push({ type: 'cmdGather', playerId: 1, eids: [villager], targetEid: node });
  const ticks: number[] = [];
  let last = Resource.amount[node];
  for (let i = 0; i < 400 && ticks.length < units; i++) {
    step(world);
    if (Resource.amount[node] < last) {
      ticks.push(world.tick);
      last = Resource.amount[node];
    }
  }
  expect(ResourceCarry.kind[villager]).toBe(kind);
  return ticks;
}

function intervals(ticks: number[]): number[] {
  return ticks.slice(1).map((t, i) => t - ticks[i]);
}

describe('gather rates', () => {
  it('stone is the only slow resource', () => {
    expect(gatherCooldownForKind(ResourceKindId.STONE)).toBe(STONE_GATHER_COOLDOWN);
    for (const kind of [ResourceKindId.FOOD, ResourceKindId.WOOD, ResourceKindId.GOLD]) {
      expect(gatherCooldownForKind(kind)).toBe(VILLAGER_GATHER_COOLDOWN);
    }
  });

  it('a villager cuts one stone every 10 ticks, one wood every 5', () => {
    const units = VILLAGER_CARRY_CAPACITY - 1;
    const wood = gatherTicks(ResourceKindId.WOOD, units);
    const stone = gatherTicks(ResourceKindId.STONE, units);
    expect(wood).toHaveLength(units);
    expect(stone).toHaveLength(units);
    expect(new Set(intervals(wood))).toEqual(new Set([5]));
    expect(new Set(intervals(stone))).toEqual(new Set([10]));
    // Same walk to the node, twice the time at the rock face.
    const span = (ticks: number[]): number => ticks[ticks.length - 1] - ticks[0];
    expect(span(stone)).toBe(2 * span(wood));
  });

  it('gold and food keep the wood pace', () => {
    for (const kind of [ResourceKindId.GOLD, ResourceKindId.FOOD]) {
      expect(new Set(intervals(gatherTicks(kind, 5)))).toEqual(new Set([5]));
    }
  });
});
