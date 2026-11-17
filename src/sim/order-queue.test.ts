/**
 * Shift-queued orders: a unit carries out its queue in order, plain orders
 * and Stop clear it, dead targets are skipped, a gather order ends it, and
 * the queue is part of the checksum, of saves and of lockstep.
 */
import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../config';
import { polluteEidAllocator, resetBitecsGlobals } from '../net/testing/mp-match';
import { directAiActuator } from './ai/direct-actuator';
import { checksumWorld } from './checksum';
import {
  AttackMoveGoal,
  AttackTarget,
  Gatherer,
  GathererStateId,
  Health,
  Position,
  Resource,
  Speed,
} from './components';
import { FORMATION_MODE_LINE } from './core/constants';
import { BuildingDefId } from './defs';
import { orderQueueRefusal } from './input/order-queue';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import {
  AI_PLAYER_ID,
  ORDER_QUEUE_MAX,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  orderQueueRefusalForAll,
  removeSimEntity,
  resourceQuery,
  spawnArcher,
  spawnCompletedBuilding,
  spawnScoutCavalry,
  spawnSpearman,
  spawnVillager,
  step,
  type QueuedOrder,
  type SimInput,
  type SimWorld,
} from './world';

interface Tile {
  x: number;
  y: number;
}

const SEED = 4242;
const AREA_W = 20;
const AREA_H = 10;

/**
 * A match world with the computer player switched off and the whole map in
 * the player's sight (what a unit can see is not the subject here).
 */
function quietWorld(seed = SEED): SimWorld {
  const world = createSimWorld(seed);
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.revealedMapPlayers[1] = true;
  world.paused = false;
  return world;
}

/**
 * Top-left tile of an AREA_W x AREA_H field of walkable ground, well away
 * from both towns, with the bushes and rocks on it cleared. Tiles used by the
 * tests are offsets into it: x 0..19, y 0..9.
 */
function findOpenArea(world: SimWorld): Tile {
  for (let y = 4; y < MAP.HEIGHT - AREA_H - 4; y++) {
    for (let x = 4; x < MAP.WIDTH - AREA_W - 4; x++) {
      let open = true;
      for (let dy = 0; dy < AREA_H && open; dy++) {
        for (let dx = 0; dx < AREA_W && open; dx++) {
          open = world.map.walkability[y + dy][x + dx] === 0 && findBuildingAt(world, x + dx, y + dy, 10) === null;
        }
      }
      if (!open) continue;
      for (let dy = -1; dy <= AREA_H; dy++) {
        for (let dx = -1; dx <= AREA_W; dx++) {
          const resource = findResourceAt(world, x + dx, y + dy, 0.8);
          if (resource !== null) removeSimEntity(world, resource);
        }
      }
      return { x, y };
    }
  }
  throw new Error('No open area found');
}

function at(area: Tile, dx: number, dy: number): Tile {
  return { x: area.x + dx, y: area.y + dy };
}

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function near(eid: number, tile: Tile, radius = 0.7): boolean {
  return Math.hypot(Position.x[eid] - tile.x, Position.y[eid] - tile.y) <= radius;
}

/** Step until `done()` (at most `maxTicks`); returns the ticks it took, or -1. */
function stepUntil(world: SimWorld, done: () => boolean, maxTicks = 1200): number {
  for (let i = 0; i < maxTicks; i++) {
    if (done()) return i;
    step(world);
  }
  return done() ? maxTicks : -1;
}

function move(eids: number[], to: Tile, queue = false): SimInput {
  return queue
    ? { type: 'cmdMove', playerId: 1, eids, to, queue: true }
    : { type: 'cmdMove', playerId: 1, eids, to };
}

function queueOf(world: SimWorld, eid: number): QueuedOrder[] {
  return world.orderQueues.get(eid) ?? [];
}

/** A weak, passive enemy building the player's unit can see and attack. */
function spawnEnemyHouse(world: SimWorld, tile: Tile, hp = 30): number {
  const eid = spawnCompletedBuilding(world, BuildingDefId.HOUSE, tile.x, tile.y, AI_PLAYER_ID);
  Health.hp[eid] = hp;
  return eid;
}

describe('order queue', () => {
  it('carries out queued moves one after another, in order', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnScoutCavalry(world, area.x + 1, area.y + 1, 1);
    const a = at(area, 8, 1);
    const b = at(area, 8, 8);
    const c = at(area, 16, 8);

    world.inputs.push(move([unit], a), move([unit], b, true), move([unit], c, true));
    step(world);
    expect(queueOf(world, unit)).toEqual([
      { kind: 'move', x: b.x, y: b.y, speedCap: 0 },
      { kind: 'move', x: c.x, y: c.y, speedCap: 0 },
    ]);

    expect(stepUntil(world, () => near(unit, a))).toBeGreaterThan(0);
    expect(queueOf(world, unit)).toHaveLength(2);
    expect(stepUntil(world, () => near(unit, b))).toBeGreaterThan(0);
    // On its way to b the unit was never sent to c early.
    expect(queueOf(world, unit).length).toBeLessThanOrEqual(1);
    expect(stepUntil(world, () => near(unit, c))).toBeGreaterThan(0);
    expect(world.orderQueues.has(unit)).toBe(false);
    stepN(world, 10);
    expect(world.paths.has(unit)).toBe(false);
    expect(near(unit, c)).toBe(true);
  });

  it('starts a queued order at once when the unit has nothing to do', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 1, area.y + 1, 1);
    const control = quietWorld();
    findOpenArea(control);
    const controlUnit = spawnSpearman(control, area.x + 1, area.y + 1, 1);

    world.inputs.push(move([unit], at(area, 9, 4), true));
    control.inputs.push(move([controlUnit], at(area, 9, 4)));
    for (let tick = 0; tick < 200; tick++) {
      step(world);
      step(control);
      // Queued on an idle unit, the order is the plain order: same state every tick.
      expect(checksumWorld(world), `tick ${tick}`).toBe(checksumWorld(control));
    }
    expect(near(unit, at(area, 9, 4))).toBe(true);
  });

  it('a plain order replaces the current order and clears the queue', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 1, area.y + 1, 1);
    const other = spawnSpearman(world, area.x + 1, area.y + 3, 1);
    world.inputs.push(
      move([unit, other], at(area, 10, 1)),
      move([unit, other], at(area, 10, 9), true),
      move([unit, other], at(area, 18, 9), true)
    );
    stepN(world, 5);
    expect(queueOf(world, unit)).toHaveLength(2);

    const elsewhere = at(area, 4, 9);
    world.inputs.push(move([unit], elsewhere));
    step(world);
    expect(world.orderQueues.has(unit)).toBe(false);
    // The unit that was not re-ordered keeps its queue.
    expect(queueOf(world, other)).toHaveLength(2);
    expect(stepUntil(world, () => near(unit, elsewhere) && !world.paths.has(unit))).toBeGreaterThan(0);
    stepN(world, 40);
    expect(near(unit, elsewhere)).toBe(true);
  });

  it('Stop clears the queue and the unit stays put', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 1, area.y + 1, 1);
    world.inputs.push(move([unit], at(area, 10, 1)), move([unit], at(area, 10, 9), true));
    stepN(world, 10);
    expect(queueOf(world, unit)).toHaveLength(1);

    world.inputs.push({ type: 'cmdStop', playerId: 1, eids: [unit] });
    step(world);
    expect(world.orderQueues.has(unit)).toBe(false);
    const stoppedAt = { x: Position.x[unit], y: Position.y[unit] };
    stepN(world, 60);
    expect(near(unit, stoppedAt, 0.3)).toBe(true);
  });

  it('attacks queued targets in turn and skips one that died meanwhile', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    const first = spawnEnemyHouse(world, at(area, 6, 5));
    const second = spawnEnemyHouse(world, at(area, 10, 5));
    const third = spawnEnemyHouse(world, at(area, 14, 5));
    const rest = at(area, 18, 5);

    world.inputs.push(
      { type: 'cmdAttack', playerId: 1, eids: [unit], targetEid: first },
      { type: 'cmdAttack', playerId: 1, eids: [unit], targetEid: second, queue: true },
      { type: 'cmdAttack', playerId: 1, eids: [unit], targetEid: third, queue: true },
      move([unit], rest, true)
    );
    step(world);
    expect(AttackTarget.targetEid[unit]).toBe(first);
    expect(queueOf(world, unit).map((order) => order.kind)).toEqual(['attack', 'attack', 'move']);

    // The second target falls to something else before its turn comes.
    Health.hp[second] = 0;
    stepN(world, 2);
    expect(queueOf(world, unit)).toEqual([
      { kind: 'attack', targetEid: third },
      { kind: 'move', x: rest.x, y: rest.y, speedCap: 0 },
    ]);

    expect(stepUntil(world, () => !hasComponent(world.ecs, Health, first) || Health.hp[first] <= 0)).toBeGreaterThan(0);
    stepN(world, 3);
    expect(AttackTarget.targetEid[unit]).toBe(third);
    expect(stepUntil(world, () => near(unit, rest))).toBeGreaterThan(0);
    expect(hasComponent(world.ecs, Health, third) && Health.hp[third] > 0).toBe(false);
    expect(world.orderQueues.has(unit)).toBe(false);
  });

  it('drops a queued attack whose target is dead when its turn comes', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    const target = spawnEnemyHouse(world, at(area, 12, 5), 500);
    const rest = at(area, 6, 9);
    world.inputs.push(
      move([unit], at(area, 6, 5)),
      { type: 'cmdAttack', playerId: 1, eids: [unit], targetEid: target, queue: true },
      move([unit], rest, true)
    );
    step(world);
    expect(queueOf(world, unit)).toHaveLength(2);
    // First leg done; the target dies between ticks, so it is dead but still
    // in the world on the tick its order comes up: the queue has to skip it.
    expect(stepUntil(world, () => !world.paths.has(unit))).toBeGreaterThan(0);
    Health.hp[target] = 0;
    step(world);
    expect(AttackTarget.targetEid[unit]).toBe(-1);
    expect(world.orderQueues.has(unit)).toBe(false);
    expect(world.paths.has(unit)).toBe(true);
    expect(stepUntil(world, () => near(unit, rest))).toBeGreaterThan(0);
  });

  it('a gather order ends the queue: later queued orders are refused', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const villager = spawnVillager(world, area.x + 2, area.y + 2, 1);
    const tree = [...resourceQuery(world.ecs)]
      .filter((eid) => Resource.amount[eid] > 0)
      .sort((p, q) =>
        Math.hypot(Position.x[p] - area.x, Position.y[p] - area.y) -
        Math.hypot(Position.x[q] - area.x, Position.y[q] - area.y) || p - q
      )[0];
    const waypoint = at(area, 6, 2);

    world.inputs.push(
      move([villager], waypoint, true),
      { type: 'cmdGather', playerId: 1, eids: [villager], targetEid: tree, queue: true },
      move([villager], at(area, 12, 8), true)
    );
    step(world);
    // The first order started at once; the gather waits; the move after it was refused.
    expect(queueOf(world, villager)).toEqual([{ kind: 'gather', targetEid: tree }]);
    expect(orderQueueRefusal(world, villager)).toBe('gathering');
    expect(orderQueueRefusalForAll(world, [villager])).toBe('gathering');

    expect(stepUntil(world, () => Gatherer.state[villager] !== GathererStateId.IDLE)).toBeGreaterThan(0);
    expect(Gatherer.targetEid[villager]).toBe(tree);
    expect(world.orderQueues.has(villager)).toBe(false);

    // A villager that is gathering takes no queued order either...
    world.inputs.push(move([villager], at(area, 12, 8), true));
    step(world);
    expect(world.orderQueues.has(villager)).toBe(false);
    expect(Gatherer.state[villager]).not.toBe(GathererStateId.IDLE);
    expect(orderQueueRefusal(world, villager)).toBe('gathering');
    // ...but a plain order still takes it off the job.
    world.inputs.push(move([villager], at(area, 12, 8)));
    step(world);
    expect(Gatherer.state[villager]).toBe(GathererStateId.IDLE);
    expect(orderQueueRefusal(world, villager)).toBeNull();
  });

  it('holds at most ORDER_QUEUE_MAX orders per unit', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 1, area.y + 1, 1);
    const idle = spawnSpearman(world, area.x + 1, area.y + 4, 1);
    world.inputs.push(move([unit], at(area, 18, 9)));
    for (let i = 0; i < ORDER_QUEUE_MAX + 3; i++) world.inputs.push(move([unit], at(area, 2 + i, 6), true));
    step(world);
    expect(queueOf(world, unit)).toHaveLength(ORDER_QUEUE_MAX);
    expect(queueOf(world, unit)[ORDER_QUEUE_MAX - 1]).toEqual({ kind: 'move', x: area.x + 2 + ORDER_QUEUE_MAX - 1, y: area.y + 6, speedCap: 0 });
    expect(orderQueueRefusal(world, unit)).toBe('full');
    // The reason is only reported when no selected unit can take the order.
    expect(orderQueueRefusalForAll(world, [unit])).toBe('full');
    expect(orderQueueRefusalForAll(world, [unit, idle])).toBeNull();
  });

  it('a queued attack-move fights on the way, then goes on with the queue', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 1, area.y + 5, 1);
    const inTheWay = spawnEnemyHouse(world, at(area, 9, 5), 40);
    const goal = at(area, 16, 5);
    const after = at(area, 16, 9);
    world.inputs.push(
      move([unit], at(area, 3, 5)),
      { type: 'cmdAttackMove', playerId: 1, eids: [unit], to: goal, queue: true },
      move([unit], after, true)
    );
    step(world);
    expect(queueOf(world, unit).map((order) => order.kind)).toEqual(['attackMove', 'move']);
    expect(stepUntil(world, () => AttackMoveGoal.active[unit] === 1)).toBeGreaterThan(0);
    expect(queueOf(world, unit).map((order) => order.kind)).toEqual(['move']);
    // It stops for the enemy building, destroys it, then finishes both orders.
    expect(stepUntil(world, () => AttackTarget.targetEid[unit] === inTheWay)).toBeGreaterThanOrEqual(0);
    expect(queueOf(world, unit)).toHaveLength(1);
    expect(stepUntil(world, () => near(unit, after), 3000)).toBeGreaterThan(0);
    expect(hasComponent(world.ecs, Health, inTheWay) && Health.hp[inTheWay] > 0).toBe(false);
    expect(world.orderQueues.has(unit)).toBe(false);
  });

  it('a villager goes on with its queue after an attack-move (it never fights on the way)', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const villager = spawnVillager(world, area.x + 2, area.y + 2, 1);
    const goal = at(area, 8, 2);
    const after = at(area, 8, 8);
    world.inputs.push(
      { type: 'cmdAttackMove', playerId: 1, eids: [villager], to: goal },
      move([villager], after, true)
    );
    step(world);
    expect(queueOf(world, villager)).toHaveLength(1);
    expect(stepUntil(world, () => near(villager, goal))).toBeGreaterThan(0);
    expect(stepUntil(world, () => near(villager, after))).toBeGreaterThan(0);
    expect(world.orderQueues.has(villager)).toBe(false);
  });

  it('a queued group move takes the formation slots the same move would take on arrival', () => {
    const setUp = (): { world: SimWorld; area: Tile; units: number[] } => {
      const world = quietWorld();
      world.formationModes[1] = FORMATION_MODE_LINE;
      const area = findOpenArea(world);
      const units = [
        spawnSpearman(world, area.x + 1, area.y + 2, 1),
        spawnSpearman(world, area.x + 1, area.y + 4, 1),
        spawnArcher(world, area.x + 1, area.y + 6, 1),
        spawnScoutCavalry(world, area.x + 1, area.y + 8, 1),
      ];
      return { world, area, units };
    };
    const finalTiles = (units: number[]): Tile[] =>
      units.map((eid) => ({ x: Math.round(Position.x[eid]), y: Math.round(Position.y[eid]) }));
    const settle = (world: SimWorld, units: number[]): void => {
      expect(stepUntil(world, () => units.every((eid) => !world.paths.has(eid) && !world.orderQueues.has(eid)), 4000))
        .toBeGreaterThanOrEqual(0);
    };

    // Queued: first leg plain, second leg queued behind it.
    const queued = setUp();
    const first = at(queued.area, 10, 5);
    const second = at(queued.area, 16, 6);
    queued.world.inputs.push(move(queued.units, first), move(queued.units, second, true));
    step(queued.world);
    const slots = queued.units.map((eid) => queueOf(queued.world, eid)[0]);
    expect(slots.every((order) => order?.kind === 'move')).toBe(true);
    // Every unit has its own slot tile, and the fast rider keeps the group's pace.
    expect(new Set(slots.map((order) => (order && 'x' in order ? `${order.x},${order.y}` : ''))).size).toBe(4);
    const pace = Math.min(...queued.units.map((eid) => Speed.value[eid]));
    const rider = slots[3];
    expect(rider && 'speedCap' in rider ? rider.speedCap : -1).toBeCloseTo(pace, 5);
    settle(queued.world, queued.units);

    // Control: the same two moves, the second given only once the first is done.
    const control = setUp();
    control.world.inputs.push(move(control.units, first));
    step(control.world);
    settle(control.world, control.units);
    control.world.inputs.push(move(control.units, second));
    step(control.world);
    settle(control.world, control.units);

    const queuedTiles = finalTiles(queued.units);
    expect(queuedTiles).toEqual(finalTiles(control.units));
    expect(new Set(queuedTiles.map((tile) => `${tile.x},${tile.y}`)).size).toBe(4);
  });

  it('removing a unit drops its queue, removing a target drops the orders naming it', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    const gone = spawnSpearman(world, area.x + 2, area.y + 7, 1);
    const target = spawnEnemyHouse(world, at(area, 12, 5), 500);
    world.inputs.push(
      move([unit, gone], at(area, 6, 5)),
      { type: 'cmdAttack', playerId: 1, eids: [unit, gone], targetEid: target, queue: true },
      move([unit, gone], at(area, 6, 9), true)
    );
    step(world);
    expect(queueOf(world, unit)).toHaveLength(2);
    expect(queueOf(world, gone)).toHaveLength(2);

    removeSimEntity(world, gone);
    expect(world.orderQueues.has(gone)).toBe(false);
    removeSimEntity(world, target);
    expect(queueOf(world, unit)).toEqual([{ kind: 'move', x: area.x + 6, y: area.y + 9, speedCap: 0 }]);
  });

  it('a unit that dies loses its queue', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    world.inputs.push(move([unit], at(area, 12, 5)), move([unit], at(area, 12, 9), true));
    step(world);
    expect(world.orderQueues.has(unit)).toBe(true);
    Health.hp[unit] = 0;
    stepN(world, 2);
    expect(world.orderQueues.has(unit)).toBe(false);
    expect(world.orderQueues.size).toBe(0);
  });

  it('an order from the computer player clears the queue', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    world.inputs.push(move([unit], at(area, 12, 5)), move([unit], at(area, 12, 9), true));
    step(world);
    expect(world.orderQueues.has(unit)).toBe(true);
    directAiActuator.move(world, unit, at(area, 4, 9));
    expect(world.orderQueues.has(unit)).toBe(false);
  });

  it('another player cannot queue orders for units that are not theirs', () => {
    const world = quietWorld();
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    world.inputs.push({ type: 'cmdMove', playerId: 2, eids: [unit], to: at(area, 12, 5), queue: true });
    step(world);
    expect(world.orderQueues.size).toBe(0);
    expect(world.paths.has(unit)).toBe(false);
  });

  it('the queue is part of the checksum, and a world without queues hashes as before', () => {
    const a = quietWorld();
    const b = quietWorld();
    const area = findOpenArea(a);
    findOpenArea(b);
    const ua = spawnSpearman(a, area.x + 2, area.y + 5, 1);
    const ub = spawnSpearman(b, area.x + 2, area.y + 5, 1);
    expect(checksumWorld(a)).toBe(checksumWorld(b));

    a.orderQueues.set(ua, [{ kind: 'move', x: area.x + 8, y: area.y + 5, speedCap: 0 }]);
    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
    b.orderQueues.set(ub, [{ kind: 'move', x: area.x + 8, y: area.y + 5, speedCap: 0 }]);
    expect(checksumWorld(a)).toBe(checksumWorld(b));
    b.orderQueues.set(ub, [{ kind: 'attackMove', x: area.x + 8, y: area.y + 5, speedCap: 0 }]);
    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
    b.orderQueues.set(ub, [{ kind: 'move', x: area.x + 8, y: area.y + 6, speedCap: 0 }]);
    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
    a.orderQueues.clear();
    b.orderQueues.clear();
    expect(checksumWorld(a)).toBe(checksumWorld(b));
  });
});

/**
 * A scripted skirmish that uses every kind of queued order: two groups, a
 * route, queued attacks on two buildings, an attack-move, a gather at the end
 * of a villager's queue, a Stop and a plain order in the middle of a queue.
 * Built the same way in every world it is run in; commands reference that
 * world's own eids.
 */
interface Scenario {
  world: SimWorld;
  script: Array<{ atTick: number; input: SimInput }>;
  /** Did the queued orders do their work: both buildings razed, the villager gathering? */
  ranToTheEnd?: () => boolean;
}

function queueScenario(seed: number): Scenario {
  const world = quietWorld(seed);
  world.formationModes[1] = FORMATION_MODE_LINE;
  const area = findOpenArea(world);
  const army = [
    spawnSpearman(world, area.x + 1, area.y + 2, 1),
    spawnSpearman(world, area.x + 1, area.y + 4, 1),
    spawnArcher(world, area.x + 1, area.y + 6, 1),
    spawnScoutCavalry(world, area.x + 1, area.y + 8, 1),
  ];
  const loner = spawnSpearman(world, area.x + 3, area.y + 9, 1);
  const villager = spawnVillager(world, area.x + 3, area.y + 1, 1);
  const houseA = spawnEnemyHouse(world, at(area, 12, 3), 60);
  const houseB = spawnEnemyHouse(world, at(area, 15, 7), 60);
  const tree = [...resourceQuery(world.ecs)]
    .filter((eid) => Resource.amount[eid] > 0)
    .sort((p, q) =>
      Math.hypot(Position.x[p] - area.x, Position.y[p] - area.y) -
      Math.hypot(Position.x[q] - area.x, Position.y[q] - area.y) ||
      Position.y[p] - Position.y[q] || Position.x[p] - Position.x[q]
    )[0];

  const script: Scenario['script'] = [
    { atTick: 2, input: move(army, at(area, 6, 5)) },
    { atTick: 3, input: { type: 'cmdAttack', playerId: 1, eids: army, targetEid: houseA, queue: true } },
    { atTick: 3, input: { type: 'cmdAttack', playerId: 1, eids: army, targetEid: houseB, queue: true } },
    { atTick: 4, input: { type: 'cmdAttackMove', playerId: 1, eids: army, to: at(area, 18, 5), queue: true } },
    { atTick: 5, input: move(army, at(area, 4, 5), true) },
    { atTick: 6, input: move([loner], at(area, 10, 9)) },
    { atTick: 6, input: move([loner], at(area, 18, 9), true) },
    { atTick: 6, input: move([loner], at(area, 18, 1), true) },
    { atTick: 6, input: move([loner], at(area, 3, 1), true) },
    { atTick: 7, input: move([villager], at(area, 8, 1), true) },
    { atTick: 7, input: { type: 'cmdGather', playerId: 1, eids: [villager], targetEid: tree, queue: true } },
    { atTick: 60, input: { type: 'cmdStop', playerId: 1, eids: [army[3]] } },
    { atTick: 90, input: move([army[2]], at(area, 2, 9)) },
    { atTick: 91, input: move([army[2]], at(area, 18, 9), true) },
  ];
  const ranToTheEnd = (): boolean =>
    !hasComponent(world.ecs, Health, houseA) &&
    !hasComponent(world.ecs, Health, houseB) &&
    Gatherer.state[villager] !== GathererStateId.IDLE &&
    world.orderQueues.size === 0;
  return { world, script, ranToTheEnd };
}

function runScript(scenario: Scenario, fromTick: number, toTick: number, onTick?: (tick: number) => void): void {
  for (let tick = fromTick; tick < toTick; tick++) {
    for (const { atTick, input } of scenario.script) {
      if (atTick === tick) scenario.world.inputs.push(input);
    }
    step(scenario.world);
    onTick?.(tick);
  }
}

describe('order queue determinism', () => {
  it('two worlds fed the same queued orders stay in checksum lockstep', () => {
    // The second world gets recycled, descending raw eids, the way a client
    // that already played a match does: order must follow NetIds.
    resetBitecsGlobals();
    const a = queueScenario(91);
    polluteEidAllocator();
    const b = queueScenario(91);
    expect(checksumWorld(a.world)).toBe(checksumWorld(b.world));

    let sawQueues = false;
    for (let tick = 0; tick < 700; tick++) {
      runScript(a, tick, tick + 1);
      runScript(b, tick, tick + 1);
      if (a.world.orderQueues.size > 0) sawQueues = true;
      expect(checksumWorld(b.world), `tick ${tick}`).toBe(checksumWorld(a.world));
    }
    expect(sawQueues).toBe(true);
    expect(a.ranToTheEnd?.()).toBe(true);
    expect(b.ranToTheEnd?.()).toBe(true);
  });

  it('save, load and play on gives the same checksums as the uninterrupted match', () => {
    resetBitecsGlobals();
    const original = queueScenario(92);
    runScript(original, 0, 120);
    // Mid-queue: moves, an attack on a building and a gather are still waiting.
    const kinds = new Set([...original.world.orderQueues.values()].flat().map((order) => order.kind));
    expect(kinds.has('move')).toBe(true);
    expect(kinds.has('attack')).toBe(true);
    expect(original.world.orderQueues.size).toBeGreaterThanOrEqual(3);

    const saved = JSON.parse(JSON.stringify(serializeSimWorld(original.world)));
    polluteEidAllocator();
    const loaded = createSimWorld(92);
    loadSimWorldSnapshot(loaded, saved);
    expect(loaded.orderQueues.size).toBe(original.world.orderQueues.size);
    expect(checksumWorld(loaded)).toBe(checksumWorld(original.world));

    // The rest of the script only names units by eid for inputs after the
    // save; remap them through NetIds into the loaded world.
    const toLoaded = new Map<number, number>();
    for (const [netId, eid] of original.world.netIdToEid) {
      const mapped = loaded.netIdToEid.get(netId);
      if (mapped !== undefined) toLoaded.set(eid, mapped);
    }
    const remap = (input: SimInput): SimInput => {
      const out = { ...input } as Record<string, unknown>;
      if ('eids' in input && input.eids) out.eids = input.eids.map((eid) => toLoaded.get(eid) ?? -1);
      if ('targetEid' in input && input.targetEid !== undefined) out.targetEid = toLoaded.get(input.targetEid) ?? -1;
      return out as unknown as SimInput;
    };
    const replay: Scenario = {
      world: loaded,
      script: original.script.map(({ atTick, input }) => ({ atTick, input: remap(input) })),
    };
    for (let tick = 120; tick < 800; tick++) {
      runScript(original, tick, tick + 1);
      runScript(replay, tick, tick + 1);
      if (tick % 10 === 9) expect(checksumWorld(loaded), `tick ${tick}`).toBe(checksumWorld(original.world));
    }
    expect(checksumWorld(loaded)).toBe(checksumWorld(original.world));
    expect(original.ranToTheEnd?.()).toBe(true);
    expect(loaded.orderQueues.size).toBe(0);
  });

  it('a save from before order queues loads with empty queues', () => {
    const world = quietWorld(93);
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    world.inputs.push(move([unit], at(area, 12, 5)), move([unit], at(area, 12, 9), true));
    stepN(world, 3);
    const saved = JSON.parse(JSON.stringify(serializeSimWorld(world)));
    expect(saved.orderQueues).toHaveLength(1);
    delete saved.orderQueues;

    const loaded = createSimWorld(93);
    loadSimWorldSnapshot(loaded, saved);
    expect(loaded.orderQueues.size).toBe(0);
    loaded.paused = false;
    stepN(loaded, 5);
    expect(loaded.orderQueues.size).toBe(0);
  });

  it('a hand-edited save cannot smuggle in a broken or oversized queue', () => {
    const world = quietWorld(94);
    const area = findOpenArea(world);
    const unit = spawnSpearman(world, area.x + 2, area.y + 5, 1);
    world.inputs.push(move([unit], at(area, 12, 5)), move([unit], at(area, 12, 9), true));
    stepN(world, 3);
    const saved = JSON.parse(JSON.stringify(serializeSimWorld(world)));
    const good = { kind: 'move', x: area.x + 3, y: area.y + 3, speedCap: 0 };
    saved.orderQueues[0].orders = [
      { kind: 'dance' },
      { kind: 'move', x: 'far', y: 3 },
      { kind: 'attack', targetEid: 987654 },
      null,
      ...Array.from({ length: ORDER_QUEUE_MAX + 4 }, () => ({ ...good })),
    ];
    const loaded = createSimWorld(94);
    loadSimWorldSnapshot(loaded, saved);
    const queue = [...loaded.orderQueues.values()][0];
    expect(queue).toHaveLength(ORDER_QUEUE_MAX);
    expect(queue.every((order) => order.kind === 'move')).toBe(true);
  });
});
