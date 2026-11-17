/**
 * Shift + order: append an order to the units' queues instead of replacing
 * what they are doing. systems/order-queue.ts starts the next queued order
 * when a unit's current one is finished.
 *
 * Rules:
 *  - At most ORDER_QUEUE_MAX orders wait per unit; more are refused.
 *  - Gathering never finishes on its own, so a gather order ends the queue:
 *    a unit that is gathering (or helping at a worksite), or whose last
 *    queued order is a gather, takes no further queued orders (a plain order
 *    still replaces everything).
 *  - A build (a Shift-placed row of buildings, or Shift + click on a
 *    foundation) waits like any other order: the villagers finish what they
 *    build now, then walk to the next foundation of the row.
 *  - A group move is resolved when it is queued, with the same formation
 *    logic as an immediate move: each unit gets its own slot tile, the
 *    formation facing the way the group will arrive from (the end of what it
 *    is already doing), and the group's pace in a slot formation.
 *  - A plain order that replaces what a unit is doing, Stop and re-forming
 *    clear its queue (unit-orders.ts, formation.ts); so do death and removal.
 */

import { hasComponent } from 'bitecs';
import {
  AttackMoveGoal,
  Combat,
  Gatherer,
  GathererStateId,
  Position,
  Speed,
  WorksiteHelper,
} from '../components';
import { ORDER_QUEUE_MAX } from '../core/constants';
import type { GridPos } from '../pathfinding';
import type { QueuedOrder, SimWorld } from '../core/types';
import { ownedCommandableEids } from './apply-input';
import {
  formationDestinations,
  formationModeUsesSlots,
  isMovableEntity,
  playerFormationMode,
} from './formation';
import { canBuild, isOpenFoundation } from '../systems/builders';
import { canTakeAttackOrder, isAttackOrderTarget, isGatherOrderTarget } from './unit-orders';

/** Why a unit takes no further queued order. */
export type OrderQueueRefusal = 'gathering' | 'full';

function isGathering(world: SimWorld, eid: number): boolean {
  if (hasComponent(world.ecs, WorksiteHelper, eid)) return true;
  return hasComponent(world.ecs, Gatherer, eid) && Gatherer.state[eid] !== GathererStateId.IDLE;
}

/** Why `eid` cannot take one more queued order right now, or null if it can. */
export function orderQueueRefusal(world: SimWorld, eid: number): OrderQueueRefusal | null {
  const queue = world.orderQueues.get(eid);
  const last = queue?.[queue.length - 1];
  if (last?.kind === 'gather' || isGathering(world, eid)) return 'gathering';
  if (queue && queue.length >= ORDER_QUEUE_MAX) return 'full';
  return null;
}

/**
 * The one reason none of `eids` would take a queued order, or null when at
 * least one of them would (or the list is empty). Read-only: the render layer
 * uses it to explain a refused Shift + order.
 */
export function orderQueueRefusalForAll(world: SimWorld, eids: readonly number[]): OrderQueueRefusal | null {
  let reason: OrderQueueRefusal | null = null;
  for (const eid of eids) {
    const refusal = orderQueueRefusal(world, eid);
    if (refusal === null) return null;
    if (reason !== 'gathering') reason = refusal;
  }
  return reason;
}

function appendOrder(world: SimWorld, eid: number, order: QueuedOrder): void {
  const queue = world.orderQueues.get(eid);
  if (queue) queue.push(order);
  else world.orderQueues.set(eid, [order]);
}

/**
 * Where `eid` will be when everything it has been told so far is done: the
 * last queued spot or target, else where its current order ends.
 */
function projectedPosition(world: SimWorld, eid: number): GridPos {
  const queue = world.orderQueues.get(eid);
  if (queue) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const order = queue[i];
      if (!('targetEid' in order)) return { x: order.x, y: order.y };
      if (hasComponent(world.ecs, Position, order.targetEid)) {
        return { x: Position.x[order.targetEid], y: Position.y[order.targetEid] };
      }
    }
  }
  if (hasComponent(world.ecs, AttackMoveGoal, eid) && AttackMoveGoal.active[eid] === 1) {
    return { x: AttackMoveGoal.x[eid], y: AttackMoveGoal.y[eid] };
  }
  const path = world.paths.get(eid);
  const end = path?.[path.length - 1];
  if (end) return { x: end.x, y: end.y };
  return { x: Position.x[eid], y: Position.y[eid] };
}

/** Queue a move or an attack-move to `to` behind the units' current orders. */
export function queueMoveOrders(
  world: SimWorld,
  playerId: number,
  eids: number[],
  to: GridPos,
  kind: 'move' | 'attackMove'
): void {
  const units = ownedCommandableEids(world, playerId, eids).filter(
    (eid) => isMovableEntity(world, eid) && orderQueueRefusal(world, eid) === null
  );
  if (units.length === 0) return;

  const mode = playerFormationMode(world, playerId);
  const slots = formationModeUsesSlots(mode);
  let destinations: Array<{ eid: number; dest: GridPos }>;
  if (slots) {
    // Face the formation the way the group will come from: its centre once
    // the orders it already has are done, not where it stands now.
    let cx = 0;
    let cy = 0;
    for (const eid of units) {
      const at = projectedPosition(world, eid);
      cx += at.x;
      cy += at.y;
    }
    const facing = { x: to.x - cx / units.length, y: to.y - cy / units.length };
    destinations = formationDestinations(world, units, to, mode, facing);
  } else {
    destinations = units.map((eid) => ({ eid, dest: to }));
  }
  // Unarmed units ignore an attack-move, as they do when it is not queued.
  const ordered = kind === 'attackMove'
    ? destinations.filter(({ eid }) => hasComponent(world.ecs, Combat, eid))
    : destinations;

  // A slot formation moves at the pace of its slowest member.
  let pace = Infinity;
  if (slots && ordered.length > 1) {
    for (const { eid } of ordered) pace = Math.min(pace, Speed.value[eid]);
  }
  for (const { eid, dest } of ordered) {
    const speedCap = Number.isFinite(pace) && Speed.value[eid] > pace ? pace : 0;
    appendOrder(world, eid, { kind, x: dest.x, y: dest.y, speedCap });
  }
}

/** Queue an attack on `targetEid` behind the units' current orders. */
export function queueAttackOrders(
  world: SimWorld,
  playerId: number,
  eids: number[],
  targetEid: number
): void {
  if (!isAttackOrderTarget(world, playerId, targetEid)) return;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    if (!canTakeAttackOrder(world, eid, targetEid)) continue;
    if (orderQueueRefusal(world, eid) !== null) continue;
    appendOrder(world, eid, { kind: 'attack', targetEid });
  }
}

/** Queue gathering `targetEid` behind the units' current orders; it ends their queue. */
export function queueGatherOrders(
  world: SimWorld,
  playerId: number,
  eids: number[],
  targetEid: number
): void {
  if (!isGatherOrderTarget(world, targetEid)) return;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    if (!hasComponent(world.ecs, Gatherer, eid)) continue;
    if (orderQueueRefusal(world, eid) !== null) continue;
    appendOrder(world, eid, { kind: 'gather', targetEid });
  }
}

/**
 * Queue building own foundation `siteEid` behind the villagers' current
 * orders (a Shift-placed row, or Shift + click on a foundation).
 */
export function queueBuildOrders(
  world: SimWorld,
  playerId: number,
  eids: number[],
  siteEid: number
): void {
  if (!isOpenFoundation(world, siteEid, playerId)) return;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    if (!canBuild(world, eid)) continue;
    if (orderQueueRefusal(world, eid) !== null) continue;
    appendOrder(world, eid, { kind: 'build', targetEid: siteEid });
  }
}
