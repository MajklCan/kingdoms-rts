import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  Gatherer,
  GathererStateId,
  Position,
  Resource,
  ResourceCarry,
  ResourceKindId,
  type ResourceKind,
} from '../components';
import { checksumWorld } from '../checksum';
import {
  AI_PLAYER_ID,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  removeSimEntity,
  resourceQuery,
  spawnResource,
  spawnVillager,
  step,
  townCenterQuery,
  type GameEvent,
  type SimWorld,
} from '../world';
import { DEPLETED_NODE_RETARGET_RADIUS } from './resource-depletion';

const P1 = 1;

function quietWorld(seed = 4242): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([1, 2]);
  world.aiPlayers[AI_PLAYER_ID] = null;
  return world;
}

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function stepUntil(world: SimWorld, done: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !done(); i++) step(world);
}

function clearResources(world: SimWorld, kind: ResourceKind): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === kind) removeSimEntity(world, eid);
  }
}

function ownTc(world: SimWorld): number {
  for (const eid of townCenterQuery(world.ecs)) {
    if (Math.round(Position.x[eid]) === world.map.spawns[P1].x) return eid;
  }
  throw new Error('no TC');
}

/** Open, resource-free, building-free tiles around (cx, cy), nearest first. */
function openTiles(world: SimWorld, cx: number, cy: number, minR: number, maxR: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 1; y < MAP.HEIGHT - 1; y++) {
    for (let x = 1; x < MAP.WIDTH - 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < minR || d > maxR) continue;
      if (world.map.walkability[y][x] !== 0) continue;
      if (findResourceAt(world, x, y, 1.1) !== null) continue;
      if (findBuildingAt(world, x, y, 1.1) !== null) continue;
      out.push({ x, y, d });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
}

function depletedEvents(world: SimWorld): Array<Extract<GameEvent, { kind: 'resourceDepleted' }>> {
  return world.gameEvents.filter(
    (e): e is Extract<GameEvent, { kind: 'resourceDepleted' }> => e.kind === 'resourceDepleted'
  );
}

describe('resource depletion', () => {
  it('removes a node the tick it runs dry and moves its gatherer to the nearest same-kind node', () => {
    const world = quietWorld();
    clearResources(world, ResourceKindId.GOLD);
    const tc = ownTc(world);
    const [villagerTile, firstTile, ...rest] = openTiles(world, Position.x[tc], Position.y[tc], 3, 6);
    const secondTile = rest.find((t) => Math.hypot(t.x - firstTile.x, t.y - firstTile.y) >= 3)!;
    const first = spawnResource(world, ResourceKindId.GOLD, firstTile.x, firstTile.y, 3);
    const second = spawnResource(world, ResourceKindId.GOLD, secondTile.x, secondTile.y, 200);
    const villager = spawnVillager(world, villagerTile.x, villagerTile.y, P1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [villager], targetEid: first });

    stepUntil(world, () => !hasComponent(world.ecs, Resource, first), 600);
    expect(hasComponent(world.ecs, Resource, first)).toBe(false);
    expect(Gatherer.targetEid[villager]).toBe(second);
    expect([GathererStateId.WALKING_TO, GathererStateId.GATHERING]).toContain(Gatherer.state[villager]);
    expect(ResourceCarry.amount[villager]).toBe(3);

    const events = depletedEvents(world);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eid: first, resourceKind: ResourceKindId.GOLD, x: firstTile.x, y: firstTile.y });

    // Keeps working the second node: no stale target, no negative amounts.
    stepN(world, 200);
    expect(Resource.amount[second]).toBeLessThan(200);
    expect(Resource.amount[second]).toBeGreaterThan(0);
  });

  it('releases every gatherer bound to the node and never drives an amount below zero', () => {
    const world = quietWorld(77);
    clearResources(world, ResourceKindId.STONE);
    const tc = ownTc(world);
    const tiles = openTiles(world, Position.x[tc], Position.y[tc], 3, 7);
    const node = spawnResource(world, ResourceKindId.STONE, tiles[0].x, tiles[0].y, 5);
    const villagers = [tiles[1], tiles[2], tiles[3]].map((t) => spawnVillager(world, t.x, t.y, P1));
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: villagers, targetEid: node });

    for (let i = 0; i < 600 && hasComponent(world.ecs, Resource, node); i++) {
      step(world);
      if (hasComponent(world.ecs, Resource, node)) expect(Resource.amount[node]).toBeGreaterThan(0);
    }
    expect(hasComponent(world.ecs, Resource, node)).toBe(false);
    let carried = 0;
    for (const v of villagers) {
      expect(Gatherer.targetEid[v]).toBe(-1);
      carried += ResourceCarry.amount[v];
    }
    // Every unit of stone came from the node: nothing was gathered from an empty one.
    expect(carried + world.resources[P1][ResourceKindId.STONE]).toBe(5);
  });

  it('sends a gatherer home with a partial load when no node of that kind is in reach', () => {
    const world = quietWorld(9);
    clearResources(world, ResourceKindId.GOLD);
    const tc = ownTc(world);
    const tiles = openTiles(world, Position.x[tc], Position.y[tc], 3, 6);
    const node = spawnResource(world, ResourceKindId.GOLD, tiles[0].x, tiles[0].y, 4);
    const villager = spawnVillager(world, tiles[1].x, tiles[1].y, P1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [villager], targetEid: node });

    stepUntil(world, () => !hasComponent(world.ecs, Resource, node), 600);
    expect(Gatherer.state[villager]).toBe(GathererStateId.RETURNING);
    stepUntil(world, () => Gatherer.state[villager] === GathererStateId.IDLE, 600);
    expect(world.resources[P1][ResourceKindId.GOLD]).toBe(4);
    expect(ResourceCarry.amount[villager]).toBe(0);
    expect(Gatherer.targetEid[villager]).toBe(-1);
  });

  it('ignores same-kind nodes beyond the retarget radius', () => {
    const world = quietWorld(31);
    clearResources(world, ResourceKindId.GOLD);
    const tc = ownTc(world);
    const tiles = openTiles(world, Position.x[tc], Position.y[tc], 3, 6);
    const far = openTiles(world, tiles[1].x, tiles[1].y, DEPLETED_NODE_RETARGET_RADIUS + 3, DEPLETED_NODE_RETARGET_RADIUS + 8)[0];
    const farNode = spawnResource(world, ResourceKindId.GOLD, far.x, far.y, 100);
    const node = spawnResource(world, ResourceKindId.GOLD, tiles[0].x, tiles[0].y, 2);
    const villager = spawnVillager(world, tiles[1].x, tiles[1].y, P1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [villager], targetEid: node });

    stepUntil(world, () => !hasComponent(world.ecs, Resource, node), 600);
    expect(Gatherer.targetEid[villager]).not.toBe(farNode);
    expect(Resource.amount[farNode]).toBe(100);
  });

  it('removes nodes that arrive empty (old saves, scripted spawns) on the next tick', () => {
    const world = quietWorld(5);
    const tc = ownTc(world);
    const tile = openTiles(world, Position.x[tc], Position.y[tc], 4, 8)[0];
    const empty = spawnResource(world, ResourceKindId.FOOD, tile.x, tile.y, 0);
    step(world);
    expect(hasComponent(world.ecs, Resource, empty)).toBe(false);
    expect(depletedEvents(world).map((e) => e.eid)).toContain(empty);
  });

  it('stays deterministic: two identical worlds deplete identically', () => {
    const run = () => {
      const world = quietWorld(1234);
      clearResources(world, ResourceKindId.GOLD);
      const tc = ownTc(world);
      const tiles = openTiles(world, Position.x[tc], Position.y[tc], 3, 7);
      const a = spawnResource(world, ResourceKindId.GOLD, tiles[0].x, tiles[0].y, 6);
      spawnResource(world, ResourceKindId.GOLD, tiles[4].x, tiles[4].y, 30);
      const vs = [tiles[1], tiles[2]].map((t) => spawnVillager(world, t.x, t.y, P1));
      world.inputs.push({ type: 'cmdGather', playerId: P1, eids: vs, targetEid: a });
      stepN(world, 400);
      return checksumWorld(world);
    };
    expect(run()).toBe(run());
  });
});
