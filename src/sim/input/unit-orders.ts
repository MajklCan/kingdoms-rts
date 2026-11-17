/**
 * Move, attack, gather, stop and stance orders for units.
 */

import { hasComponent } from 'bitecs';
import {
  AttackMoveGoal,
  AttackTarget,
  BuildOrder,
  Combat,
  Cooldown,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  Position,
  Resource,
  ResourceCarry,
  type ResourceKind,
  Speed,
  UnitStance,
  UnitStanceId,
  type UnitStanceValue,
} from '../components';
import type { GridPos } from '../pathfinding';
import { LOCAL_PLAYER_ID } from '../core/constants';
import { findSpawnSpot } from '../core/grid';
import { pathTo, pathToAttackTarget } from '../core/navigation';
import type { SimWorld } from '../core/types';
import { routeToNearestDropOff } from '../systems/dropoff';
import { startGatheringResource } from '../systems/gathering';
import { isTargetInAttackRange } from '../systems/targeting';
import { isEntityVisibleTo } from '../systems/visibility';
import { commandableSelection, ownedCommandableEids } from './apply-input';
import {
  formationDestinations,
  formationModeUsesSlots,
  isMovableEntity,
  playerFormationMode,
} from './formation';

/** Cancel the combat side of a unit's current orders. Used whenever a
 *  non-attack command is issued so units don't keep chasing whatever they
 *  were last fighting. */
export function clearCombatOrders(world: SimWorld, eid: number): void {
  if (hasComponent(world.ecs, AttackTarget, eid)) {
    AttackTarget.targetEid[eid] = -1;
    AttackTarget.retainGoal[eid] = 0;
  }
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
    AttackMoveGoal.active[eid] = 0;
  }
  if (hasComponent(world.ecs, Cooldown, eid)) {
    // Don't zero the cooldown - that would let units fire instantly on a
    // new aggro acquire. Keep it as-is.
  }
  world.cannonWindups.delete(eid);
  clearFormationSpeedCap(world, eid);
}

/** Cancel the gathering / building side. Mirror of clearCombatOrders. */
export function clearWorkOrders(world: SimWorld, eid: number): void {
  if (hasComponent(world.ecs, Gatherer, eid)) {
    Gatherer.state[eid] = GathererStateId.IDLE;
    Gatherer.targetEid[eid] = -1;
    Gatherer.cooldown[eid] = 0;
  }
  if (hasComponent(world.ecs, BuildOrder, eid)) {
    BuildOrder.targetEid[eid] = -1;
  }
}

/** Forget the orders a unit has waiting behind its current one (Shift queue). */
export function clearOrderQueue(world: SimWorld, eid: number): void {
  world.orderQueues.delete(eid);
}

export function clearFormationSpeedCap(world: SimWorld, eid: number): void {
  world.formationSpeedCaps.delete(eid);
}

export function setUnitHoldAnchor(world: SimWorld, eid: number, x = Position.x[eid], y = Position.y[eid]): void {
  if (!hasComponent(world.ecs, UnitStance, eid)) return;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
}

export function applyFormationSpeedCap(world: SimWorld, eids: number[]): void {
  for (const eid of eids) clearFormationSpeedCap(world, eid);
  if (eids.length <= 1) return;
  let speedCap = Infinity;
  for (const eid of eids) {
    if (!hasComponent(world.ecs, Speed, eid)) continue;
    speedCap = Math.min(speedCap, Speed.value[eid]);
  }
  if (!Number.isFinite(speedCap)) return;
  for (const eid of eids) {
    if (Speed.value[eid] > speedCap) {
      world.formationSpeedCaps.set(eid, speedCap);
    }
  }
}

export function applyAttackSelected(world: SimWorld, targetEid: number): void {
  applyAttackCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), targetEid);
}

/** May `playerId` order an attack on `targetEid` right now (alive, in sight)? */
export function isAttackOrderTarget(world: SimWorld, playerId: number, targetEid: number): boolean {
  if (!hasComponent(world.ecs, Health, targetEid)) return false;
  if (Health.hp[targetEid] <= 0) return false;
  return isEntityVisibleTo(world, playerId, targetEid);
}

/** Can `eid` be told to attack `targetEid` at all (armed, not its own side)? */
export function canTakeAttackOrder(world: SimWorld, eid: number, targetEid: number): boolean {
  if (!hasComponent(world.ecs, Combat, eid)) return false;
  if (!hasComponent(world.ecs, AttackTarget, eid)) return false;
  return Owner.player[eid] !== Owner.player[targetEid]; // no friendly fire
}

/**
 * One unit's part of an attack order on a valid target (see
 * {@link isAttackOrderTarget}). False when the unit cannot attack it or
 * cannot get to it; its previous orders are then left alone.
 */
export function startAttackOrder(world: SimWorld, eid: number, targetEid: number): boolean {
  if (!canTakeAttackOrder(world, eid, targetEid)) return false;
  const inRange = isTargetInAttackRange(world, eid, targetEid);
  const canReach =
    inRange ||
    (isMovableEntity(world, eid) &&
      pathToAttackTarget(world, eid, targetEid));
  if (!canReach) return false;

  AttackTarget.targetEid[eid] = targetEid;
  // retainGoal = 1 means "the user explicitly told me to attack THIS unit",
  // which exempts the chase from the auto-aggro leash. The player gave a
  // direct order; honour it until the target dies, the player issues a new
  // order, or the target gets out of pathing range.
  AttackTarget.retainGoal[eid] = 1;
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
    AttackMoveGoal.active[eid] = 0;
  }
  world.cannonWindups.delete(eid);
  clearFormationSpeedCap(world, eid);
  clearWorkOrders(world, eid);
  if (inRange) world.paths.delete(eid);
  return true;
}

export function applyAttackCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  targetEid: number
): void {
  if (!isAttackOrderTarget(world, playerId, targetEid)) return;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    // An order that replaces what the unit is doing also drops its queue.
    if (startAttackOrder(world, eid, targetEid)) clearOrderQueue(world, eid);
  }
}

export function applyAttackMoveSelected(world: SimWorld, to: GridPos): void {
  applyAttackMoveCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), to);
}

/**
 * One unit's part of an attack-move to `dest`. False when the unit is not
 * armed or the destination cannot be reached.
 */
export function startAttackMoveOrder(world: SimWorld, eid: number, dest: GridPos): boolean {
  if (!hasComponent(world.ecs, Combat, eid)) return false;
  if (!pathTo(world, eid, dest.x, dest.y)) return false;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  world.cannonWindups.delete(eid);
  // Store the real attack-move destination so the unit can resume walking
  // toward it after killing whatever they engage along the way.
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
    AttackMoveGoal.active[eid] = 1;
    AttackMoveGoal.x[eid] = dest.x;
    AttackMoveGoal.y[eid] = dest.y;
  }
  setUnitHoldAnchor(world, eid, dest.x, dest.y);
  clearWorkOrders(world, eid);
  return true;
}

export function applyAttackMoveCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  to: GridPos
): void {
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    isMovableEntity(world, eid)
  );
  const mode = playerFormationMode(world, playerId);
  const destinations = formationModeUsesSlots(mode)
    ? formationDestinations(world, units, to, mode)
    : units.map((eid) => ({ eid, dest: to }));
  const ordered: number[] = [];
  for (const { eid, dest } of destinations) {
    if (!hasComponent(world.ecs, Combat, eid)) continue;
    if (!formationModeUsesSlots(mode)) clearFormationSpeedCap(world, eid);
    if (!startAttackMoveOrder(world, eid, dest)) continue;
    clearOrderQueue(world, eid);
    ordered.push(eid);
  }
  if (formationModeUsesSlots(mode)) {
    applyFormationSpeedCap(world, ordered);
  }
}

export function applyMoveSelected(world: SimWorld, to: GridPos): void {
  applyMoveCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), to);
}

/** One unit's part of a move to `dest`. False when it cannot be reached. */
export function startMoveOrder(world: SimWorld, eid: number, dest: GridPos): boolean {
  if (!pathTo(world, eid, dest.x, dest.y)) return false;
  // Move overrides any combat, gather, or build state.
  clearCombatOrders(world, eid);
  clearWorkOrders(world, eid);
  setUnitHoldAnchor(world, eid, dest.x, dest.y);
  return true;
}

export function applyMoveCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  to: GridPos
): void {
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    isMovableEntity(world, eid)
  );
  const mode = playerFormationMode(world, playerId);
  const destinations = formationModeUsesSlots(mode)
    ? formationDestinations(world, units, to, mode)
    : units.map((eid) => ({ eid, dest: to }));
  const ordered: number[] = [];
  for (const { eid, dest } of destinations) {
    if (!formationModeUsesSlots(mode)) clearFormationSpeedCap(world, eid);
    if (!startMoveOrder(world, eid, dest)) continue;
    clearOrderQueue(world, eid);
    ordered.push(eid);
  }
  if (formationModeUsesSlots(mode)) {
    applyFormationSpeedCap(world, ordered);
  }
}

export function applySetArmyRallyPoint(
  world: SimWorld,
  playerId: number,
  x: number,
  y: number
): void {
  if (playerId <= 0 || playerId >= world.armyRallyPoints.length) return;
  const spot = findSpawnSpot(world, x, y, 4);
  if (!spot) return;
  world.armyRallyPoints[playerId] = spot;
}

export function applyGatherSelected(world: SimWorld, targetEid: number): void {
  applyGatherCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), targetEid);
}

/** A resource node that still has something to gather. */
export function isGatherOrderTarget(world: SimWorld, targetEid: number): boolean {
  return hasComponent(world.ecs, Resource, targetEid) && Resource.amount[targetEid] > 0;
}

/**
 * One villager's part of a gather order on a valid node (see
 * {@link isGatherOrderTarget}). False for a unit that cannot gather.
 */
export function startGatherOrder(world: SimWorld, eid: number, targetEid: number): boolean {
  if (!hasComponent(world.ecs, Gatherer, eid)) return false;
  const kind = Resource.kind[targetEid] as ResourceKind;
  clearCombatOrders(world, eid);
  if (
    ResourceCarry.amount[eid] > 0 &&
    ResourceCarry.kind[eid] !== kind
  ) {
    // Force a drop-off run first; gathering system will route us to TC.
    Gatherer.targetEid[eid] = targetEid;
    Gatherer.state[eid] = GathererStateId.RETURNING;
    Gatherer.cooldown[eid] = 0;
    routeToNearestDropOff(world, eid);
    return true;
  }
  startGatheringResource(world, eid, targetEid);
  return true;
}

export function applyGatherCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  targetEid: number
): void {
  if (!isGatherOrderTarget(world, targetEid)) return;
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    if (startGatherOrder(world, eid, targetEid)) clearOrderQueue(world, eid);
  }
}

export function applyStopSelected(world: SimWorld): void {
  applyStopCommand(world, LOCAL_PLAYER_ID, commandableSelection(world));
}

export function applyStopCommand(world: SimWorld, playerId: number, eids: number[]): void {
  for (const eid of ownedCommandableEids(world, playerId, eids)) {
    world.paths.delete(eid);
    clearOrderQueue(world, eid);
    clearFormationSpeedCap(world, eid);
    clearCombatOrders(world, eid);
    clearWorkOrders(world, eid);
    setUnitHoldAnchor(world, eid);
  }
}

export function applyToggleSelectedUnitStance(world: SimWorld): void {
  applyToggleStanceCommand(world, LOCAL_PLAYER_ID, commandableSelection(world));
}

export function applyToggleStanceCommand(world: SimWorld, playerId: number, eids: number[]): void {
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    hasComponent(world.ecs, UnitStance, eid)
  );
  if (units.length === 0) return;

  const allHolding = units.every((eid) =>
    UnitStance.stance[eid] === UnitStanceId.HOLD_POSITION
  );
  const nextStance = allHolding
    ? UnitStanceId.AUTO_DEFEND
    : UnitStanceId.HOLD_POSITION;

  for (const eid of units) {
    UnitStance.stance[eid] = nextStance;
    if (nextStance === UnitStanceId.HOLD_POSITION) {
      setUnitHoldAnchor(world, eid);
      clearNonExplicitCombatTarget(world, eid);
    }
  }
}

/** SP convenience: set the local player's selected units' stance. */
export function applySetSelectedUnitStance(world: SimWorld, stance: UnitStanceValue): void {
  applySetStanceCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), stance);
}

/** Network-safe stance set: only the player's own stance-capable eids. */
export function applySetStanceCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  stance: UnitStanceValue
): void {
  if (stance !== UnitStanceId.AUTO_DEFEND && stance !== UnitStanceId.HOLD_POSITION) return;
  const units = ownedCommandableEids(world, playerId, eids).filter((eid) =>
    hasComponent(world.ecs, UnitStance, eid)
  );
  if (units.length === 0) return;

  for (const eid of units) {
    UnitStance.stance[eid] = stance;
    if (stance === UnitStanceId.HOLD_POSITION) {
      setUnitHoldAnchor(world, eid);
      clearNonExplicitCombatTarget(world, eid);
    }
  }
}

export function clearNonExplicitCombatTarget(world: SimWorld, eid: number): void {
  if (!hasComponent(world.ecs, AttackTarget, eid)) return;
  if (AttackTarget.targetEid[eid] < 0) return;
  if (AttackTarget.retainGoal[eid] === 1) return;

  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  world.paths.delete(eid);
  world.cannonWindups.delete(eid);
}
