/**
 * Attack resolution: cooldowns, melee hits, projectile and siege fire.
 */

import { addComponent, hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  ArcherTag,
  AttackMoveGoal,
  AttackTarget,
  Building,
  CannonTag,
  Combat,
  Cooldown,
  Gatherer,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MortarTag,
  Owner,
  Position,
  ScoutCavalryTag,
  SpearmanTag,
  UnitKind,
  Velocity,
} from '../components';
import { UnitDefId } from '../defs';
import { ATTACK_RANGE_TOLERANCE } from '../core/constants';
import { sortedEids } from '../core/entities';
import { pathTo } from '../core/navigation';
import { combatQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { isMovableEntity } from '../input/formation';
import {
  clearFormationSpeedCap,
  clearNonExplicitCombatTarget,
  clearWorkOrders,
} from '../input/unit-orders';
import {
  cannonProjectileTravelTicks,
  mortarProjectileTravelTicks,
  projectileTravelTicksForAttack,
} from './projectiles';
import {
  canHoldPositionMoveToTarget,
  distanceToAttackTarget,
  isHoldPositionStance,
  isTargetInAttackRange,
  isTargetVisibleToAttackerOwner,
} from './targeting';

const CANNON_WINDUP_TICKS = Math.round(SIM.TICK_HZ * 0.9);
const MACHINE_GUN_DEPLOY_TICKS = Math.round(SIM.TICK_HZ * 1.35);
// Mortars reuse the cannon's windup + splash + impact machinery, but lob on a
// higher, slower arc - a longer aim/elevation delay before each shell.
const MORTAR_WINDUP_TICKS = Math.round(SIM.TICK_HZ * 1.2);

export function combatSystem(world: SimWorld): void {
  const ents = sortedEids(world, combatQuery(world.ecs));
  for (const eid of ents) {
    if (Cooldown.ticksRemaining[eid] > 0) {
      Cooldown.ticksRemaining[eid] -= 1;
    }
    if (Health.hp[eid] <= 0) continue;
    if (usesSiegeWindup(world, eid) && processCannonWindup(world, eid)) {
      continue;
    }
    if (hasComponent(world.ecs, MachineGunTag, eid) && !processMachineGunDeployment(world, eid)) {
      continue;
    }
    const target = AttackTarget.targetEid[eid];
    if (target < 0) continue;
    if (!hasComponent(world.ecs, Health, target) || Health.hp[target] <= 0) {
      AttackTarget.targetEid[eid] = -1;
      // Also free the path that was chasing this dead target so the unit
      // doesn't keep walking to where it died.
      world.paths.delete(eid);
      continue;
    }
    if (!isTargetVisibleToAttackerOwner(world, eid, target)) {
      AttackTarget.targetEid[eid] = -1;
      world.paths.delete(eid);
      continue;
    }
    const range = Combat.range[eid];
    // Buildings have a non-trivial footprint - use edge distance so melee
    // units beside a 3×3 TC are correctly "in range" instead of permanently
    // out-of-range against the centre.
    const dist = distanceToAttackTarget(world, eid, target);
    if (dist > range + ATTACK_RANGE_TOLERANCE) {
      if (isMovableEntity(world, eid)) {
        const holdRestricted =
          isHoldPositionStance(world, eid) &&
          AttackTarget.retainGoal[eid] !== 1 &&
          (!hasComponent(world.ecs, AttackMoveGoal, eid) ||
            AttackMoveGoal.active[eid] === 0);
        if (holdRestricted && !canHoldPositionMoveToTarget(world, eid, target)) {
          clearNonExplicitCombatTarget(world, eid);
          continue;
        }
        const path = world.paths.get(eid);
        if (!path || path.length === 0 || dist > range + 2) {
          if (!pathTo(world, eid, Position.x[target], Position.y[target])) {
            AttackTarget.targetEid[eid] = -1;
            world.paths.delete(eid);
          }
        }
      }
      continue;
    }
    // In range - stop moving + attack on cooldown 0.
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
    if (Cooldown.ticksRemaining[eid] > 0) continue;
    if (usesSiegeWindup(world, eid)) {
      startCannonWindup(world, eid, target, range);
      continue;
    }
    if (usesProjectileAttack(world, eid)) {
      fireProjectileAttack(world, eid, target, range);
      continue;
    }
    applyAttackDamage(world, eid, target, computeAttackDamage(world, eid, target));
    Cooldown.ticksRemaining[eid] = Combat.attackSpeedTicks[eid];
    world.combatEvents.push({
      type: 'attack',
      tick: world.tick,
      attackerEid: eid,
      targetEid: target,
      attackerKind: hasComponent(world.ecs, UnitKind, eid) ? UnitKind.kind[eid] : -1,
      range,
      fromX: Position.x[eid],
      fromY: Position.y[eid],
      toX: Position.x[target],
      toY: Position.y[target],
    });
  }
}

function usesProjectileAttack(world: SimWorld, attacker: number): boolean {
  return Combat.range[attacker] > 1 &&
    (
      hasComponent(world.ecs, ArcherTag, attacker) ||
      hasComponent(world.ecs, GunmanTag, attacker) ||
      hasComponent(world.ecs, MachineGunTag, attacker) ||
      hasComponent(world.ecs, Building, attacker)
    );
}

function processMachineGunDeployment(world: SimWorld, eid: number): boolean {
  if (!hasComponent(world.ecs, MachineGunDeployment, eid)) {
    addComponent(world.ecs, MachineGunDeployment, eid);
    MachineGunDeployment.deployed[eid] = 1;
    MachineGunDeployment.setupTicks[eid] = 0;
  }

  const target = AttackTarget.targetEid[eid];
  if (
    target >= 0 &&
    hasComponent(world.ecs, Health, target) &&
    Health.hp[target] > 0 &&
    isTargetInAttackRange(world, eid, target)
  ) {
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
  }

  const path = world.paths.get(eid);
  const isMoving =
    (path !== undefined && path.length > 0) ||
    Math.hypot(Velocity.x[eid], Velocity.y[eid]) > 0.05;

  if (isMoving) {
    MachineGunDeployment.deployed[eid] = 0;
    MachineGunDeployment.setupTicks[eid] = MACHINE_GUN_DEPLOY_TICKS;
    return false;
  }

  if (MachineGunDeployment.setupTicks[eid] > 0) {
    MachineGunDeployment.setupTicks[eid] -= 1;
    MachineGunDeployment.deployed[eid] = 0;
    return false;
  }

  MachineGunDeployment.deployed[eid] = 1;
  return true;
}

function fireProjectileAttack(
  world: SimWorld,
  attacker: number,
  target: number,
  range: number
): void {
  const distance = Math.hypot(
    Position.x[attacker] - Position.x[target],
    Position.y[attacker] - Position.y[target]
  );
  const projectileTicks = projectileTravelTicksForAttack(world, attacker, distance);
  world.pendingProjectileImpacts.push({
    impactTick: world.tick + projectileTicks,
    attackerEid: attacker,
    attackerOwner: Owner.player[attacker],
    targetEid: target,
    damage: computeAttackDamage(world, attacker, target),
  });
  Cooldown.ticksRemaining[attacker] = Combat.attackSpeedTicks[attacker];
  world.combatEvents.push({
    type: 'attack',
    tick: world.tick,
    attackerEid: attacker,
    targetEid: target,
    attackerKind: hasComponent(world.ecs, UnitKind, attacker) ? UnitKind.kind[attacker] : -1,
    range,
    fromX: Position.x[attacker],
    fromY: Position.y[attacker],
    toX: Position.x[target],
    toY: Position.y[target],
    projectileTicks,
  });
}

function processCannonWindup(world: SimWorld, attacker: number): boolean {
  const windup = world.cannonWindups.get(attacker);
  if (!windup) return false;
  const target = windup.targetEid;
  if (!isCannonWindupTargetValid(world, attacker, target)) {
    world.cannonWindups.delete(attacker);
    return true;
  }

  world.paths.delete(attacker);
  clearFormationSpeedCap(world, attacker);
  windup.ticksRemaining -= 1;
  if (windup.ticksRemaining > 0) return true;

  world.cannonWindups.delete(attacker);
  fireCannonShot(world, attacker, target);
  return true;
}

function isCannonWindupTargetValid(world: SimWorld, attacker: number, target: number): boolean {
  if (target < 0) return false;
  if (!hasComponent(world.ecs, Health, target) || Health.hp[target] <= 0) return false;
  if (!isTargetVisibleToAttackerOwner(world, attacker, target)) return false;
  return distanceToAttackTarget(world, attacker, target) <=
    Combat.range[attacker] + ATTACK_RANGE_TOLERANCE;
}

/** Cannons and mortars share the wind-up → splash-impact pipeline. */
function usesSiegeWindup(world: SimWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, CannonTag, eid) ||
    hasComponent(world.ecs, MortarTag, eid)
  );
}

function startCannonWindup(world: SimWorld, attacker: number, target: number, range: number): void {
  const isMortar = hasComponent(world.ecs, MortarTag, attacker);
  const windupTicks = isMortar ? MORTAR_WINDUP_TICKS : CANNON_WINDUP_TICKS;
  world.cannonWindups.set(attacker, {
    targetEid: target,
    ticksRemaining: windupTicks,
  });
  world.combatEvents.push({
    type: 'attack',
    tick: world.tick,
    attackerEid: attacker,
    targetEid: target,
    attackerKind: isMortar ? UnitDefId.MORTAR : UnitDefId.CANNON,
    range,
    fromX: Position.x[attacker],
    fromY: Position.y[attacker],
    toX: Position.x[target],
    toY: Position.y[target],
    phase: 'windup',
    windupTicks,
  });
}

function fireCannonShot(world: SimWorld, attacker: number, target: number): void {
  const isMortar = hasComponent(world.ecs, MortarTag, attacker);
  const dist = Math.hypot(Position.x[attacker] - Position.x[target], Position.y[attacker] - Position.y[target]);
  const projectileTicks = isMortar
    ? mortarProjectileTravelTicks(dist)
    : cannonProjectileTravelTicks(dist);
  world.pendingCannonImpacts.push({
    impactTick: world.tick + projectileTicks,
    attackerEid: attacker,
    attackerOwner: Owner.player[attacker],
    impactX: Position.x[target],
    impactY: Position.y[target],
    damage: Combat.atk[attacker],
  });
  Cooldown.ticksRemaining[attacker] = Combat.attackSpeedTicks[attacker];
  world.combatEvents.push({
    type: 'attack',
    tick: world.tick,
    attackerEid: attacker,
    targetEid: target,
    attackerKind: isMortar ? UnitDefId.MORTAR : UnitDefId.CANNON,
    range: Combat.range[attacker],
    fromX: Position.x[attacker],
    fromY: Position.y[attacker],
    toX: Position.x[target],
    toY: Position.y[target],
    phase: 'fire',
    projectileTicks,
  });
}

export function retaliateWhenEngaged(world: SimWorld, defender: number, attacker: number): void {
  if (defender === attacker) return;
  if (!hasComponent(world.ecs, Position, defender)) return;
  if (!hasComponent(world.ecs, Position, attacker)) return;
  if (!hasComponent(world.ecs, Health, defender) || Health.hp[defender] <= 0) return;
  if (!hasComponent(world.ecs, Health, attacker) || Health.hp[attacker] <= 0) return;
  if (!hasComponent(world.ecs, Owner, defender) || !hasComponent(world.ecs, Owner, attacker)) return;
  if (Owner.player[defender] === Owner.player[attacker]) return;
  if (!hasComponent(world.ecs, Combat, defender)) return;
  if (!hasComponent(world.ecs, AttackTarget, defender)) return;
  if (isHoldPositionStance(world, defender)) return;

  const current = AttackTarget.targetEid[defender];
  if (current === attacker) return;
  const currentIsLivingUnit =
    current >= 0 &&
    hasComponent(world.ecs, UnitKind, current) &&
    hasComponent(world.ecs, Health, current) &&
    Health.hp[current] > 0;
  if (currentIsLivingUnit) return;

  AttackTarget.targetEid[defender] = attacker;
  AttackTarget.retainGoal[defender] = 0;
  if (hasComponent(world.ecs, AttackMoveGoal, defender)) {
    AttackMoveGoal.active[defender] = 0;
  }
  if (hasComponent(world.ecs, Gatherer, defender)) {
    clearWorkOrders(world, defender);
  }
  if (isMovableEntity(world, defender)) {
    if (isTargetInAttackRange(world, defender, attacker)) {
      world.paths.delete(defender);
      clearFormationSpeedCap(world, defender);
    } else {
      pathTo(world, defender, Position.x[attacker], Position.y[attacker]);
    }
  }
}

function applyAttackDamage(
  world: SimWorld,
  attacker: number,
  target: number,
  damage: number
): void {
  Health.hp[target] -= damage;
  retaliateWhenEngaged(world, target, attacker);
}

function computeAttackDamage(world: SimWorld, attacker: number, target: number): number {
  let bonus = 0;
  if (
    hasComponent(world.ecs, SpearmanTag, attacker) &&
    hasComponent(world.ecs, ScoutCavalryTag, target)
  ) {
    bonus += 13;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, ArcherTag, target)
  ) {
    bonus += 4;
  }
  if (
    hasComponent(world.ecs, ArcherTag, attacker) &&
    hasComponent(world.ecs, SpearmanTag, target)
  ) {
    bonus += 2;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, CannonTag, target)
  ) {
    bonus += 10;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, MachineGunTag, target)
  ) {
    bonus += 8;
  }
  if (
    hasComponent(world.ecs, ScoutCavalryTag, attacker) &&
    hasComponent(world.ecs, MortarTag, target)
  ) {
    bonus += 10;
  }
  return Math.max(1, Combat.atk[attacker] + bonus - Health.armor[target]);
}
