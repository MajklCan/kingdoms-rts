/**
 * Shift-queued orders: a unit whose current order is finished starts the
 * next one in its queue (input/order-queue.ts appends them).
 *
 * Runs right after the tick's inputs, so a queued order starts exactly like
 * the same order arriving as an input on that tick, before targeting can
 * auto-acquire for a unit that just arrived.
 *
 * "Finished" is read off the unit, not stored:
 *   move          no path left (arrived, or the path gave up)
 *   attack-move   the attack-move goal was reached or dropped, nothing to fight
 *   attack        the target is dead, gone or out of sight (target cleared)
 *   gather        never: a gather order ends the queue (so does helping
 *                 at a worksite)
 *   build         the foundation is finished or gone
 * A unit that turned to fight on its own (hit while walking) finishes that
 * fight first, then goes on with the queue.
 *
 * An order that cannot start when its turn comes (target dead or hidden,
 * resource used up, no way there) is dropped and the next one is tried.
 */

import { hasComponent } from 'bitecs';
import {
  AttackMoveGoal,
  AttackTarget,
  BuildOrder,
  Combat,
  DeadTag,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  Position,
  Speed,
  WorksiteHelper,
  WorksiteWorker,
} from '../components';
import { dhypot } from '../core/dmath';
import { sortedEids } from '../core/entities';
import type { QueuedOrder, SimWorld } from '../core/types';
import {
  clearFormationSpeedCap,
  isAttackOrderTarget,
  isGatherOrderTarget,
  startAttackMoveOrder,
  startAttackOrder,
  startBuildOrder,
  startGatherOrder,
  startMoveOrder,
} from '../input/unit-orders';
import { isOpenFoundation } from './builders';
import { ATTACK_MOVE_ARRIVAL_RADIUS } from './targeting';

export function orderQueueSystem(world: SimWorld): void {
  if (world.orderQueues.size === 0) return;
  // NetId order: starting an order plans a path, and path planning reads
  // where other units stand and are headed.
  for (const eid of sortedEids(world, [...world.orderQueues.keys()])) {
    const queue = world.orderQueues.get(eid);
    if (!queue) continue;
    if (!canFollowOrders(world, eid)) {
      world.orderQueues.delete(eid);
      continue;
    }
    if (isBusy(world, eid)) continue;
    while (queue.length > 0) {
      const order = queue.shift()!;
      if (startQueuedOrder(world, eid, order)) break;
    }
    if (queue.length === 0) world.orderQueues.delete(eid);
  }
}

/** Alive, owned and still taking orders (a worksite crew member is not). */
function canFollowOrders(world: SimWorld, eid: number): boolean {
  if (!hasComponent(world.ecs, Owner, eid)) return false;
  if (hasComponent(world.ecs, DeadTag, eid)) return false;
  if (hasComponent(world.ecs, WorksiteWorker, eid)) return false;
  return !hasComponent(world.ecs, Health, eid) || Health.hp[eid] > 0;
}

/** Is the unit still carrying out an order (or a fight it picked itself)? */
function isBusy(world: SimWorld, eid: number): boolean {
  const path = world.paths.get(eid);
  if (path && path.length > 0) return true;
  if (isAttackMoving(world, eid)) return true;
  if (hasComponent(world.ecs, AttackTarget, eid)) {
    const target = AttackTarget.targetEid[eid];
    if (target >= 0 && hasComponent(world.ecs, Health, target) && Health.hp[target] > 0) return true;
  }
  // A builder is busy until his foundation is finished or gone (the builder
  // system would otherwise send him on to the nearest open one).
  if (hasComponent(world.ecs, BuildOrder, eid) && isOpenFoundation(world, BuildOrder.targetEid[eid], Owner.player[eid])) {
    return true;
  }
  if (hasComponent(world.ecs, WorksiteHelper, eid)) return true;
  return hasComponent(world.ecs, Gatherer, eid) && Gatherer.state[eid] !== GathererStateId.IDLE;
}

/**
 * On an attack-move that targeting will still end (goal reached or dropped);
 * the caller has already seen that no path is left. Two cases keep the flag
 * set for good, and for them the missing path is the end of the order:
 *  - a unit that never looks for enemies (a villager, aggro radius 0);
 *  - a unit pushed to a corner of its goal tile: further from the centre
 *    than targeting accepts as arrived, but with nowhere left to walk.
 */
function isAttackMoving(world: SimWorld, eid: number): boolean {
  if (!hasComponent(world.ecs, AttackMoveGoal, eid) || AttackMoveGoal.active[eid] !== 1) return false;
  if (!hasComponent(world.ecs, Combat, eid) || Combat.aggroRadius[eid] <= 0) return false;
  const gx = AttackMoveGoal.x[eid];
  const gy = AttackMoveGoal.y[eid];
  const onGoalTile =
    Math.round(Position.x[eid]) === Math.round(gx) && Math.round(Position.y[eid]) === Math.round(gy);
  const arrived = dhypot(Position.x[eid] - gx, Position.y[eid] - gy) < ATTACK_MOVE_ARRIVAL_RADIUS;
  return !onGoalTile || arrived;
}

/** Start `order` for `eid` as the same order given directly would. False: drop it. */
function startQueuedOrder(world: SimWorld, eid: number, order: QueuedOrder): boolean {
  switch (order.kind) {
    case 'move':
    case 'attackMove': {
      clearFormationSpeedCap(world, eid);
      const started = order.kind === 'move'
        ? startMoveOrder(world, eid, order)
        : startAttackMoveOrder(world, eid, order);
      if (started && order.speedCap > 0 && Speed.value[eid] > order.speedCap) {
        world.formationSpeedCaps.set(eid, order.speedCap);
      }
      return started;
    }
    case 'attack':
      return isAttackOrderTarget(world, Owner.player[eid], order.targetEid) &&
        startAttackOrder(world, eid, order.targetEid);
    case 'gather':
      return isGatherOrderTarget(world, order.targetEid) &&
        startGatherOrder(world, eid, order.targetEid);
    case 'build':
      return isOpenFoundation(world, order.targetEid, Owner.player[eid]) &&
        startBuildOrder(world, eid, order.targetEid);
  }
}
