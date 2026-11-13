/**
 * Automatic target acquisition and stance rules.
 */

import { hasComponent } from 'bitecs';
import {
  AttackMoveGoal,
  AttackTarget,
  Building,
  Combat,
  Health,
  Owner,
  Position,
  UnitKind,
  UnitStance,
  UnitStanceId,
} from '../components';
import { ATTACK_RANGE_TOLERANCE } from '../core/constants';
import { deterministicEidKey, sortedEids } from '../core/entities';
import { distToBuildingEdge } from '../core/grid';
import { pathTo } from '../core/navigation';
import { combatQuery, damageableQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { clearFormationSpeedCap, clearNonExplicitCombatTarget, isMovableEntity } from '../world';
import { isEntityVisibleTo } from './visibility';

const HOLD_POSITION_MELEE_LEASH_TILES = 1.6;
const HOLD_POSITION_MELEE_LEASH_BUFFER = 0.3;

interface TargetScore {
  priority: number;
  distance: number;
  hpFrac: number;
  order: number;
  eid: number;
}

function findBestAutoTarget(
  world: SimWorld,
  attacker: number,
  aggro: number,
  targetAllowed: (target: number) => boolean = () => true
): number {
  const maxDistance = isMovableEntity(world, attacker)
    ? aggro + ATTACK_RANGE_TOLERANCE
    : Combat.range[attacker] + ATTACK_RANGE_TOLERANCE;
  let best: TargetScore | null = null;
  for (const target of sortedEids(world, damageableQuery(world.ecs))) {
    if (!isValidHostileTarget(world, attacker, target)) continue;
    if (!targetAllowed(target)) continue;
    const distance = distanceToAttackTarget(world, attacker, target);
    if (distance > maxDistance) continue;
    const score = targetScore(world, attacker, target, distance);
    if (!best || compareTargetScore(score, best) < 0) {
      best = score;
    }
  }
  return best?.eid ?? -1;
}

export function isValidHostileTarget(world: SimWorld, attacker: number, target: number): boolean {
  if (attacker === target) return false;
  if (!hasComponent(world.ecs, Owner, attacker)) return false;
  if (!hasComponent(world.ecs, Owner, target)) return false;
  if (Owner.player[target] === Owner.player[attacker]) return false;
  if (Owner.player[target] === 0) return false;
  if (!hasComponent(world.ecs, Health, target) || Health.hp[target] <= 0) return false;
  return isTargetVisibleToAttackerOwner(world, attacker, target);
}

export function isTargetVisibleToAttackerOwner(world: SimWorld, attacker: number, target: number): boolean {
  const attackerOwner = Owner.player[attacker];
  if (!world.humanPlayers.has(attackerOwner)) return true;
  return isEntityVisibleTo(world, attackerOwner, target);
}

function targetScore(
  world: SimWorld,
  attacker: number,
  target: number,
  distance: number
): TargetScore {
  const isUnit = hasComponent(world.ecs, UnitKind, target);
  const isArmed = hasComponent(world.ecs, Combat, target) && Combat.atk[target] > 0;
  const isTargetingAttacker =
    hasComponent(world.ecs, AttackTarget, target) &&
    AttackTarget.targetEid[target] === attacker;
  const priority = isTargetingAttacker
    ? 0
    : isUnit && isArmed
      ? 1
      : isUnit
        ? 2
        : isArmed
          ? 3
          : 4;
  const hpMax = Math.max(1, Health.hpMax[target]);
  return {
    priority,
    distance,
    hpFrac: Health.hp[target] / hpMax,
    order: deterministicEidKey(world, target),
    eid: target,
  };
}

function compareTargetScore(a: TargetScore, b: TargetScore): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (Math.abs(a.distance - b.distance) > 0.001) return a.distance - b.distance;
  if (Math.abs(a.hpFrac - b.hpFrac) > 0.001) return a.hpFrac - b.hpFrac;
  if (a.order !== b.order) return a.order - b.order;
  return a.eid - b.eid;
}

export function distanceToAttackTarget(world: SimWorld, attacker: number, target: number): number {
  return hasComponent(world.ecs, Building, target)
    ? distToBuildingEdge(world, Position.x[attacker], Position.y[attacker], target)
    : Math.hypot(
        Position.x[attacker] - Position.x[target],
        Position.y[attacker] - Position.y[target]
      );
}

export function isTargetInAttackRange(world: SimWorld, attacker: number, target: number): boolean {
  return distanceToAttackTarget(world, attacker, target) <=
    Combat.range[attacker] + ATTACK_RANGE_TOLERANCE;
}

export function isHoldPositionStance(world: SimWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, UnitStance, eid) &&
    UnitStance.stance[eid] === UnitStanceId.HOLD_POSITION
  );
}

function isMeleeHoldPositionUnit(world: SimWorld, eid: number): boolean {
  return isMovableEntity(world, eid) && Combat.range[eid] <= 1.25;
}

function holdPositionAutoSearchRadius(world: SimWorld, eid: number): number {
  return isMeleeHoldPositionUnit(world, eid)
    ? HOLD_POSITION_MELEE_LEASH_TILES + Combat.range[eid]
    : Combat.range[eid];
}

function isHoldPositionTargetAllowed(world: SimWorld, eid: number, target: number): boolean {
  if (isTargetInAttackRange(world, eid, target)) return true;
  if (!isMeleeHoldPositionUnit(world, eid)) return false;

  const anchorX = UnitStance.anchorX[eid];
  const anchorY = UnitStance.anchorY[eid];
  const anchorToTarget = distToBuildingEdge(world, anchorX, anchorY, target);
  return anchorToTarget <=
    HOLD_POSITION_MELEE_LEASH_TILES + Combat.range[eid] + ATTACK_RANGE_TOLERANCE;
}

export function canHoldPositionMoveToTarget(world: SimWorld, eid: number, target: number): boolean {
  if (!isMeleeHoldPositionUnit(world, eid)) return false;
  if (!isHoldPositionTargetAllowed(world, eid, target)) return false;
  const distanceFromAnchor = Math.hypot(
    Position.x[eid] - UnitStance.anchorX[eid],
    Position.y[eid] - UnitStance.anchorY[eid]
  );
  return distanceFromAnchor <=
    HOLD_POSITION_MELEE_LEASH_TILES + HOLD_POSITION_MELEE_LEASH_BUFFER;
}

export function targetingSystem(world: SimWorld): void {
  const ents = sortedEids(world, combatQuery(world.ecs));
  for (const eid of ents) {
    if (Health.hp[eid] <= 0) continue;
    const cur = AttackTarget.targetEid[eid];
    const aggro = Combat.aggroRadius[eid];
    const holdPosition = isHoldPositionStance(world, eid);
    const attackMoving =
      hasComponent(world.ecs, AttackMoveGoal, eid) &&
      AttackMoveGoal.active[eid] === 1;
    const targetValid =
      cur >= 0 &&
      hasComponent(world.ecs, Health, cur) &&
      Health.hp[cur] > 0;

    if (targetValid) {
      // Apply a leash: aggro-acquired targets are dropped if they wander too
      // far. Explicit attack orders (AttackMoveGoal.active=0 + retainGoal=0)
      // also leash; only retainGoal=1 explicit-attack persists indefinitely.
      const explicitOrder = AttackTarget.retainGoal[eid] === 1;
      if (holdPosition && !explicitOrder && !attackMoving) {
        if (isHoldPositionTargetAllowed(world, eid, cur)) {
          if (isTargetInAttackRange(world, eid, cur)) world.paths.delete(eid);
          continue;
        }
        clearNonExplicitCombatTarget(world, eid);
      } else if (!explicitOrder && aggro > 0) {
        const dist = distanceToAttackTarget(world, eid, cur);
        // Leash = 2× aggro radius. Stops "infinite chase" from one slip of vision.
        if (dist > aggro * 2) {
          AttackTarget.targetEid[eid] = -1;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    AttackTarget.targetEid[eid] = -1;

    // Once we have no target, decide whether to auto-aggro or resume an
    // attack-move destination.
    if (aggro === 0) {
      // Non-aggressors (villagers) just stop chasing.
      continue;
    }

    // Suppress aggro re-acquisition while the unit is executing a manual
    // move order. Without this, the moment we clear AttackTarget in
    // `applyMoveSelected`, this system would auto-acquire the same enemy
    // again on the next tick and the player's move command would feel like
    // it did nothing. We detect manual-move as: has an active path AND
    // attack-move goal is NOT active.
    const onManualMove =
      world.paths.has(eid) &&
      !attackMoving;
    if (onManualMove) continue;

    const searchRadius = holdPosition && !attackMoving
      ? holdPositionAutoSearchRadius(world, eid)
      : aggro;
    const bestEid = findBestAutoTarget(
      world,
      eid,
      searchRadius,
      holdPosition && !attackMoving
        ? (target) => isHoldPositionTargetAllowed(world, eid, target)
        : undefined
    );
    if (bestEid >= 0) {
      const inRange = isTargetInAttackRange(world, eid, bestEid);
      const canMoveIntoRange =
        (holdPosition && !attackMoving
          ? canHoldPositionMoveToTarget(world, eid, bestEid)
          : isMovableEntity(world, eid)) &&
        pathTo(world, eid, Position.x[bestEid], Position.y[bestEid]);
      const canEngage = inRange || canMoveIntoRange;
      if (canEngage) {
        AttackTarget.targetEid[eid] = bestEid;
        clearFormationSpeedCap(world, eid);
      }
    } else if (
      hasComponent(world.ecs, AttackMoveGoal, eid) &&
      AttackMoveGoal.active[eid] === 1
    ) {
      // No enemy in aggro range — resume marching toward the attack-move
      // destination. Once we arrive (path empty), we clear active in
      // movement / above on next eval.
      const gx = AttackMoveGoal.x[eid];
      const gy = AttackMoveGoal.y[eid];
      const arrived =
        Math.hypot(Position.x[eid] - gx, Position.y[eid] - gy) < 0.6;
      if (arrived) {
        AttackMoveGoal.active[eid] = 0;
      } else if (!world.paths.has(eid)) {
        if (!pathTo(world, eid, gx, gy)) {
          AttackMoveGoal.active[eid] = 0;
        }
      }
    }
  }
}
