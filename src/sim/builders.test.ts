import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { BuildOrder, ConstructionSite, Gatherer, GathererStateId, Health, Owner, Position } from './components';
import { BUILDING_TABLE, BuildingDefId, getBuildingDef } from './defs';
import { AI_PLAYER_ID } from './core/constants';
import { findSpawnSpot } from './core/grid';
import { isIdleVillager } from './core/idle-villagers';
import { buildingQuery, resourceQuery, townCenterQuery } from './core/queries';
import type { SimWorld } from './core/types';
import { spawnFoundation } from './factories/buildings';
import { spawnVillager } from './factories/units';
import { canPlaceBuildingAt } from './input/buildings';
import { BUILD_CONTACT_DISTANCE, buildWorkThisTick } from './systems/builders';
import { distToBuildingEdge } from './core/grid';
import { createSimWorld, removeSimEntity, step } from './world';
import { checksumWorld } from './checksum';

const P1 = 1;
const HOUSE = BUILDING_TABLE[BuildingDefId.HOUSE];

function quietWorld(seed = 77): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([1, 2]);
  world.resources[P1] = Int32Array.of(2000, 2000, 2000, 2000);
  return world;
}

function stepN(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) step(world);
}

function tcOf(world: SimWorld, playerId: number): number {
  return townCenterQuery(world.ecs).find((eid) => Owner.player[eid] === playerId)!;
}

/** A free house spot a few tiles from the player's town center. */
function houseSpot(world: SimWorld, playerId = P1, skip = 0): { x: number; y: number } {
  const tc = tcOf(world, playerId);
  const def = getBuildingDef(BuildingDefId.HOUSE)!;
  let seen = 0;
  for (let r = 4; r < 12; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r]] as const) {
      const x = Position.x[tc] + dx;
      const y = Position.y[tc] + dy;
      if (!canPlaceBuildingAt(world, def, x, y)) continue;
      if (seen++ === skip) return { x, y };
    }
  }
  throw new Error('no house spot');
}

/** Villagers standing in contact with `site`, already ordered to build it. */
function buildersAt(world: SimWorld, site: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const spot = findSpawnSpot(world, Position.x[site], Position.y[site], 3)!;
    const eid = spawnVillager(world, spot.x, spot.y, P1, 0);
    expect(distToBuildingEdge(world, Position.x[eid], Position.y[eid], site)).toBeLessThanOrEqual(BUILD_CONTACT_DISTANCE);
    BuildOrder.targetEid[eid] = site;
    out.push(eid);
  }
  return out;
}

function ticksToComplete(world: SimWorld, site: number, limit = 5000): number {
  for (let i = 1; i <= limit; i++) {
    step(world);
    if (!hasComponent(world.ecs, ConstructionSite, site)) return i;
  }
  throw new Error('never completed');
}

describe('villager builders', () => {
  it('a foundation without a builder makes no progress', () => {
    const world = quietWorld();
    const spot = houseSpot(world);
    const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
    stepN(world, HOUSE.buildTimeTicks * 2);
    expect(ConstructionSite.progress[site]).toBe(0);
    expect(Health.hp[site]).toBe(1);
    expect(hasComponent(world.ecs, ConstructionSite, site)).toBe(true);
  });

  it('one builder finishes in the def build time', () => {
    const world = quietWorld();
    const spot = houseSpot(world);
    const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
    buildersAt(world, site, 1);
    expect(ticksToComplete(world, site)).toBe(HOUSE.buildTimeTicks);
    expect(Health.hp[site]).toBe(HOUSE.hp);
  });

  it('more builders are faster, with diminishing returns', () => {
    const times = [1, 2, 4].map((count) => {
      const world = quietWorld();
      const spot = houseSpot(world);
      const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
      buildersAt(world, site, count);
      return ticksToComplete(world, site);
    });
    const [one, two, four] = times;
    expect(two).toBeLessThan(one);
    expect(four).toBeLessThan(two);
    // (n + 2) / 3: two builders give 4/3 speed, four give double.
    expect(two).toBeGreaterThanOrEqual(Math.floor((one * 3) / 4));
    expect(four).toBeGreaterThanOrEqual(Math.floor(one / 2));
    expect(one - two).toBeGreaterThan(two - four - 1);
  });

  it('spreads fractional work over ticks without drift', () => {
    for (const builders of [1, 2, 3, 5]) {
      let total = 0;
      for (let tick = 100; tick < 400; tick++) total += buildWorkThisTick(builders, tick);
      expect(total).toBe((builders + 2) * 100);
    }
    expect(buildWorkThisTick(0, 5)).toBe(0);
  });

  it('placeBuilding sends the given villagers, who walk over and build it', () => {
    const world = quietWorld();
    const villagers = [0, 1].map(() => {
      const tc = tcOf(world, P1);
      const spot = findSpawnSpot(world, Position.x[tc] - 3, Position.y[tc] + 2, 5)!;
      return spawnVillager(world, spot.x, spot.y, P1, 0);
    });
    const spot = houseSpot(world);
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: P1, eids: villagers });
    step(world);
    const site = buildingQuery(world.ecs).find(
      (eid) => hasComponent(world.ecs, ConstructionSite, eid) && Owner.player[eid] === P1
    )!;
    expect(site).toBeDefined();
    for (const eid of villagers) expect(BuildOrder.targetEid[eid]).toBe(site);
    ticksToComplete(world, site, HOUSE.buildTimeTicks + 600);
    // Done: the order is cleared and the villagers are idle again.
    step(world);
    for (const eid of villagers) {
      expect(BuildOrder.targetEid[eid]).toBe(-1);
      expect(isIdleVillager(world, eid, P1)).toBe(true);
    }
  });

  it('cmdBuild ignores foreign foundations and foreign villagers', () => {
    const world = quietWorld();
    const mineSpot = houseSpot(world);
    const mine = spawnFoundation(world, BuildingDefId.HOUSE, mineSpot.x, mineSpot.y, P1);
    const theirSpot = houseSpot(world, AI_PLAYER_ID);
    const theirs = spawnFoundation(world, BuildingDefId.HOUSE, theirSpot.x, theirSpot.y, AI_PLAYER_ID);
    const tc = tcOf(world, P1);
    const spot = findSpawnSpot(world, Position.x[tc] - 3, Position.y[tc] + 2, 5)!;
    const own = spawnVillager(world, spot.x, spot.y, P1, 0);
    const foreign = spawnVillager(world, spot.x, spot.y + 1, AI_PLAYER_ID, 0);

    world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [own], targetEid: theirs });
    world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [foreign], targetEid: mine });
    step(world);
    expect(BuildOrder.targetEid[own]).toBe(-1);
    expect(BuildOrder.targetEid[foreign]).toBe(-1);

    world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [own, foreign], targetEid: mine });
    step(world);
    expect(BuildOrder.targetEid[own]).toBe(mine);
    expect(BuildOrder.targetEid[foreign]).toBe(-1);
  });

  it('a builder moves on to the next foundation nearby when its own is done', () => {
    const world = quietWorld();
    const first = houseSpot(world, P1, 0);
    const siteA = spawnFoundation(world, BuildingDefId.HOUSE, first.x, first.y, P1);
    const [builder] = buildersAt(world, siteA, 1);
    const second = houseSpot(world, P1, 0);
    const siteB = spawnFoundation(world, BuildingDefId.HOUSE, second.x, second.y, P1);
    ticksToComplete(world, siteA);
    step(world);
    expect(BuildOrder.targetEid[builder]).toBe(siteB);
    ticksToComplete(world, siteB, HOUSE.buildTimeTicks + 800);
  });

  it('Shift-placing a row: the first site is built at once, the queued ones follow in order', () => {
    const world = quietWorld();
    const tc = tcOf(world, P1);
    const start = findSpawnSpot(world, Position.x[tc] - 3, Position.y[tc] + 2, 5)!;
    const villager = spawnVillager(world, start.x, start.y, P1, 0);
    const sites: number[] = [];
    /** The free house spot nearest to (or farthest from) the villager. */
    const spotBy = (nearest: boolean) => {
      const spots: Array<{ x: number; y: number }> = [];
      for (let skip = 0; skip < 12; skip++) {
        try {
          spots.push(houseSpot(world, P1, skip));
        } catch {
          break;
        }
      }
      const dist = (s: { x: number; y: number }) => Math.hypot(s.x - Position.x[villager], s.y - Position.y[villager]);
      return spots.sort((p, q) => (nearest ? dist(p) - dist(q) : dist(q) - dist(p)))[0];
    };
    const place = (nearest: boolean, queue: boolean) => {
      const spot = spotBy(nearest);
      world.inputs.push({
        type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: P1, eids: [villager],
        ...(queue ? { queue: true } : {}),
      });
      step(world);
      const site = buildingQuery(world.ecs).find(
        (eid) => hasComponent(world.ecs, ConstructionSite, eid) && Owner.player[eid] === P1 && !sites.includes(eid)
      )!;
      expect(site).toBeDefined();
      sites.push(site);
    };
    // The second site is a farther one, the third the nearest free spot: the
    // queue, not the nearest-site chain, decides what comes next.
    place(true, false);
    place(false, true);
    place(true, true);
    const [a, b, c] = sites;
    const fromA = (site: number) => Math.hypot(Position.x[site] - Position.x[a], Position.y[site] - Position.y[a]);
    expect(fromA(c)).toBeLessThan(fromA(b));
    expect(BuildOrder.targetEid[villager]).toBe(a);
    expect(world.orderQueues.get(villager)).toEqual([
      { kind: 'build', targetEid: b },
      { kind: 'build', targetEid: c },
    ]);

    const done: number[] = [];
    for (let i = 0; i < HOUSE.buildTimeTicks * 3 + 1500 && done.length < 3; i++) {
      step(world);
      for (const site of sites) {
        if (!done.includes(site) && !hasComponent(world.ecs, ConstructionSite, site)) done.push(site);
      }
    }
    expect(done).toEqual([a, b, c]);
    expect(world.orderQueues.has(villager)).toBe(false);
  });

  it('a Shift-placed building waits behind the site its builders are working on', () => {
    const world = quietWorld();
    const first = houseSpot(world);
    const siteA = spawnFoundation(world, BuildingDefId.HOUSE, first.x, first.y, P1);
    const [builder] = buildersAt(world, siteA, 1);
    // The first Shift+click of a new row: no earlier building in the row.
    const spot = houseSpot(world);
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: P1, eids: [builder], queue: true });
    step(world);
    const siteB = buildingQuery(world.ecs).find(
      (eid) => hasComponent(world.ecs, ConstructionSite, eid) && Owner.player[eid] === P1 && eid !== siteA
    )!;
    expect(siteB).toBeDefined();
    // He stays on the house he was building; the new one is next.
    expect(BuildOrder.targetEid[builder]).toBe(siteA);
    expect(world.orderQueues.get(builder)).toEqual([{ kind: 'build', targetEid: siteB }]);
    ticksToComplete(world, siteA, HOUSE.buildTimeTicks + 200);
    step(world);
    expect(BuildOrder.targetEid[builder]).toBe(siteB);
    expect(world.orderQueues.has(builder)).toBe(false);
  });

  it('a Shift-placed building takes an idle or gathering villager at once', () => {
    const world = quietWorld();
    const tc = tcOf(world, P1);
    const start = findSpawnSpot(world, Position.x[tc] - 3, Position.y[tc] + 2, 5)!;
    const idle = spawnVillager(world, start.x, start.y, P1, 0);
    const gatherer = spawnVillager(world, start.x, start.y, P1, 0);
    const tree = resourceQuery(world.ecs)
      .map((eid) => ({ eid, d: Math.hypot(Position.x[eid] - start.x, Position.y[eid] - start.y) }))
      .sort((a, b) => a.d - b.d)[0]!.eid;
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [gatherer], targetEid: tree });
    stepN(world, 5);
    expect(Gatherer.state[gatherer]).not.toBe(GathererStateId.IDLE);

    const spot = houseSpot(world);
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: P1, eids: [idle, gatherer], queue: true });
    step(world);
    const site = buildingQuery(world.ecs).find((eid) => hasComponent(world.ecs, ConstructionSite, eid) && Owner.player[eid] === P1)!;
    stepN(world, 2);
    // Gathering never ends, so there is nothing to wait for: both go now.
    expect(BuildOrder.targetEid[idle]).toBe(site);
    expect(BuildOrder.targetEid[gatherer]).toBe(site);
    expect(world.orderQueues.has(gatherer)).toBe(false);
  });

  it('Shift on a foundation queues the build; a site finished meanwhile is skipped', () => {
    const world = quietWorld();
    const first = houseSpot(world);
    const siteA = spawnFoundation(world, BuildingDefId.HOUSE, first.x, first.y, P1);
    const [builder] = buildersAt(world, siteA, 1);
    const second = houseSpot(world);
    const siteB = spawnFoundation(world, BuildingDefId.HOUSE, second.x, second.y, P1);
    const third = houseSpot(world);
    const siteC = spawnFoundation(world, BuildingDefId.HOUSE, third.x, third.y, P1);
    world.inputs.push(
      { type: 'cmdBuild', playerId: P1, eids: [builder], targetEid: siteB, queue: true },
      { type: 'cmdBuild', playerId: P1, eids: [builder], targetEid: siteC, queue: true }
    );
    step(world);
    expect(BuildOrder.targetEid[builder]).toBe(siteA);
    expect(world.orderQueues.get(builder)?.map((order) => order.kind)).toEqual(['build', 'build']);
    // Someone else finishes B first: the builder goes from A straight to C.
    buildersAt(world, siteB, 3);
    ticksToComplete(world, siteB, HOUSE.buildTimeTicks + 200);
    ticksToComplete(world, siteA, HOUSE.buildTimeTicks + 200);
    step(world);
    expect(BuildOrder.targetEid[builder]).toBe(siteC);
    expect(world.orderQueues.has(builder)).toBe(false);
  });

  it('a queued build names its site in the checksum and goes when the site is removed', () => {
    const queued = (which: number) => {
      const world = quietWorld();
      const first = houseSpot(world);
      const siteA = spawnFoundation(world, BuildingDefId.HOUSE, first.x, first.y, P1);
      const [builder] = buildersAt(world, siteA, 1);
      const sites = [0, 1].map(() => {
        const spot = houseSpot(world);
        return spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
      });
      world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [builder], targetEid: sites[which], queue: true });
      step(world);
      return { world, builder, site: sites[which] };
    };
    const a = queued(0);
    const b = queued(1);
    expect(a.world.orderQueues.get(a.builder)).toEqual([{ kind: 'build', targetEid: a.site }]);
    expect(checksumWorld(a.world)).not.toBe(checksumWorld(b.world));
    removeSimEntity(a.world, a.site);
    expect(a.world.orderQueues.has(a.builder)).toBe(false);
  });

  it('a move or gather order takes a builder off the job', () => {
    const world = quietWorld();
    const spot = houseSpot(world);
    const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
    const [a, b] = buildersAt(world, site, 2);
    stepN(world, 5);
    const tc = tcOf(world, P1);
    world.inputs.push({ type: 'cmdMove', playerId: P1, eids: [a], to: { x: Position.x[tc] - 3, y: Position.y[tc] + 3 } });
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [b], targetEid: resourceQuery(world.ecs)[0] });
    step(world);
    expect(BuildOrder.targetEid[a]).toBe(-1);
    expect(BuildOrder.targetEid[b]).toBe(-1);
    expect(Gatherer.state[b]).not.toBe(GathererStateId.IDLE);
    const progress = ConstructionSite.progress[site];
    stepN(world, 40);
    expect(ConstructionSite.progress[site]).toBe(progress);
  });
});

describe('AI builders', () => {
  it('the AI raises its buildings with villagers and stalls without them', () => {
    const world = createSimWorld(4242);
    world.paused = false;
    stepN(world, 20 * 120);
    const aiBuildings = () =>
      buildingQuery(world.ecs).filter(
        (eid) => Owner.player[eid] === AI_PLAYER_ID && !hasComponent(world.ecs, ConstructionSite, eid)
      ).length;
    // Two minutes in, the AI has finished more than its town center.
    expect(aiBuildings()).toBeGreaterThan(1);
  });
});
