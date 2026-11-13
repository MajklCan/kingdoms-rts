/**
 * AI defense response and attack wave planning (staging, targeting, orders).
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  AttackMoveGoal,
  AttackTarget,
  Building,
  Combat,
  ConstructionSite,
  Health,
  Owner,
  Position,
  ResourceWorksite,
  UnitKind,
  VillagerTag,
} from '../components';
import { AgeId, BuildingDefId, getBuildingDef } from '../defs';
import type { GridPos } from '../pathfinding';
import { pushAiEvent } from '../core/events';
import { findSpawnSpot } from '../core/grid';
import { pathTo } from '../core/navigation';
import type { AiPlayerState, SimWorld } from '../core/types';
import { isMovableEntity } from '../input/formation';
import { clearCombatOrders, clearFormationSpeedCap, clearWorkOrders } from '../input/unit-orders';
import { isTargetInAttackRange, isValidHostileTarget } from '../systems/targeting';
import { aiElapsedMinutes, aiSettings } from './difficulty';
import type { AiSnapshot } from './snapshot';

const AI_DEFENSE_RADIUS = 11;
const AI_DEFENSE_ORDER_RADIUS = 18;
const AI_STAGE_RADIUS = 3.5;
const AI_EVENT_COOLDOWN_TICKS = SIM.TICK_HZ * 20;

export function findAiDefenseTarget(world: SimWorld, playerId: number, snapshot: AiSnapshot): number | null {
  let best: { eid: number; dist: number } | null = null;
  for (const enemy of snapshot.enemyMilitary) {
    const nearest = aiDistanceToHomeBuildings(snapshot, enemy);
    const target = hasComponent(world.ecs, AttackTarget, enemy)
      ? AttackTarget.targetEid[enemy]
      : -1;
    const targetingHome =
      target >= 0 &&
      hasComponent(world.ecs, Owner, target) &&
      Owner.player[target] === playerId &&
      (
        hasComponent(world.ecs, Building, target) ||
        aiDistanceToHomeBuildings(snapshot, target) <= AI_DEFENSE_RADIUS
      );
    if (!targetingHome && nearest > AI_DEFENSE_RADIUS) continue;
    if (!best || nearest < best.dist) best = { eid: enemy, dist: nearest };
  }
  return best?.eid ?? null;
}

function aiDistanceToHomeBuildings(snapshot: AiSnapshot, eid: number): number {
  let nearest = Math.hypot(
    Position.x[eid] - Position.x[snapshot.tcEid],
    Position.y[eid] - Position.y[snapshot.tcEid]
  );
  for (const building of snapshot.myBuildings) {
    nearest = Math.min(
      nearest,
      Math.hypot(Position.x[eid] - Position.x[building], Position.y[eid] - Position.y[building])
    );
  }
  return nearest;
}

export function aiHandleDefense(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot,
  target: number
): void {
  state.plan = 'defending';
  state.rallyPoint = null;
  state.waveUnitEids = [];
  state.stageStartedTick = -1;
  state.nextAttackTick = Math.max(state.nextAttackTick, world.tick + aiSettings(world).attackCooldownTicks / 2);

  for (const unit of snapshot.myMilitary) {
    const dist = Math.hypot(Position.x[unit] - Position.x[target], Position.y[unit] - Position.y[target]);
    const homeDist = Math.hypot(Position.x[unit] - Position.x[snapshot.tcEid], Position.y[unit] - Position.y[snapshot.tcEid]);
    if (dist > AI_DEFENSE_ORDER_RADIUS && homeDist > AI_DEFENSE_ORDER_RADIUS) continue;
    issueAiAttackOrder(world, unit, target);
  }

  if (world.tick - state.lastDefenseEventTick >= AI_EVENT_COOLDOWN_TICKS) {
    pushAiEvent(world, playerId, 'Frankia pulls its army home to defend');
    state.lastDefenseEventTick = world.tick;
  }
}

export function aiManageAttackPlan(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot
): void {
  const settings = aiSettings(world);
  state.waveUnitEids = state.waveUnitEids.filter((eid) => isLiveOwnedMilitary(world, eid, playerId));
  if (state.plan === 'attacking') {
    if (
      state.waveUnitEids.length < 3 ||
      world.tick - state.lastAttackTick > settings.attackCooldownTicks
    ) {
      state.plan = 'recovering';
      state.nextAttackTick = world.tick + settings.attackCooldownTicks;
      state.waveUnitEids = [];
    }
    return;
  }

  const required = aiRequiredWaveSize(world, playerId);
  if (world.tick < state.nextAttackTick || snapshot.myMilitary.length < required) {
    if (state.plan !== 'opening') state.plan = 'massing';
    return;
  }

  const target = chooseAiAttackTarget(world, snapshot);
  if (target === null) return;
  if (state.plan !== 'staging' || !state.rallyPoint || state.waveUnitEids.length === 0) {
    const rally = findAiStagingPoint(world, snapshot.tcEid, target);
    if (!rally) return;
    state.plan = 'staging';
    state.rallyPoint = rally;
    state.stageStartedTick = world.tick;
    state.waveUnitEids = aiSelectWaveUnits(world, snapshot.myMilitary, rally);
    if (world.tick - state.lastAttackEventTick >= AI_EVENT_COOLDOWN_TICKS) {
      pushAiEvent(world, playerId, 'Frankish raiding party is gathering near the river');
      state.lastAttackEventTick = world.tick;
    }
  }

  const rally = state.rallyPoint;
  let nearRally = 0;
  for (const unit of state.waveUnitEids) {
    if (Math.hypot(Position.x[unit] - rally.x, Position.y[unit] - rally.y) <= AI_STAGE_RADIUS) {
      nearRally++;
    } else {
      issueAiMoveOrder(world, unit, rally);
    }
  }
  const enoughGathered = nearRally >= Math.max(3, Math.ceil(state.waveUnitEids.length * settings.gatherFraction));
  const stageTimedOut = world.tick - state.stageStartedTick >= settings.attackStageTimeoutTicks;
  if (!enoughGathered && !stageTimedOut) return;

  const destination = { x: Math.round(Position.x[target]), y: Math.round(Position.y[target]) };
  for (const unit of state.waveUnitEids) {
    issueAiAttackMoveOrder(world, unit, destination);
  }
  state.plan = 'attacking';
  state.lastAttackTick = world.tick;
  state.nextAttackTick = world.tick + settings.attackCooldownTicks;
  pushAiEvent(world, playerId, `Frankish attack is moving toward your ${aiTargetLabel(target)}`);
  state.lastAttackEventTick = world.tick;
}

export function aiRequiredWaveSize(world: SimWorld, playerId: number): number {
  const settings = aiSettings(world);
  const base = (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.CASTLE
    ? settings.castleWaveSize
    : settings.darkWaveSize;
  const growth = Math.floor(Math.max(0, aiElapsedMinutes(world) - 3) * settings.waveGrowthPerMinute);
  return Math.min(settings.maxWaveUnits, base + growth);
}

function aiSelectWaveUnits(world: SimWorld, units: number[], rally: GridPos): number[] {
  return [...units]
    .sort((a, b) => {
      const da = Math.hypot(Position.x[a] - rally.x, Position.y[a] - rally.y);
      const db = Math.hypot(Position.x[b] - rally.x, Position.y[b] - rally.y);
      if (Math.abs(da - db) > 0.001) return da - db;
      return a - b;
    })
    .slice(0, aiSettings(world).maxWaveUnits);
}

function findAiStagingPoint(world: SimWorld, ownTc: number, target: number): GridPos | null {
  const sx = Position.x[ownTc] + (Position.x[target] - Position.x[ownTc]) * 0.45;
  const sy = Position.y[ownTc] + (Position.y[target] - Position.y[ownTc]) * 0.45;
  return findSpawnSpot(world, sx, sy, 8);
}

function chooseAiAttackTarget(world: SimWorld, snapshot: AiSnapshot): number | null {
  const nonTcTargets = snapshot.enemyBuildings.filter(
    (eid) => Building.defId[eid] !== BuildingDefId.TOWN_CENTER
  );
  const candidates = nonTcTargets.length > 0 ? nonTcTargets : snapshot.enemyBuildings;
  let best: { eid: number; score: number } | null = null;
  for (const eid of candidates) {
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    const score =
      aiAttackTargetPriority(world, eid) * 100 +
      Math.hypot(Position.x[eid] - Position.x[snapshot.tcEid], Position.y[eid] - Position.y[snapshot.tcEid]);
    if (!best || score < best.score) best = { eid, score };
  }
  return best?.eid ?? null;
}

function aiAttackTargetPriority(world: SimWorld, eid: number): number {
  const defId = Building.defId[eid];
  if (hasComponent(world.ecs, ResourceWorksite, eid)) return 0;
  if (
    defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY
  ) return 1;
  if (defId === BuildingDefId.DEFENSIVE_TOWER) return 2;
  if (defId === BuildingDefId.HOUSE) return 3;
  if (defId === BuildingDefId.TOWN_CENTER) return 5;
  return 4;
}

function aiTargetLabel(eid: number): string {
  const def = getBuildingDef(Building.defId[eid]);
  return def?.name.toLowerCase() ?? 'base';
}

function isLiveOwnedMilitary(world: SimWorld, eid: number, playerId: number): boolean {
  return hasComponent(world.ecs, UnitKind, eid) &&
    !hasComponent(world.ecs, VillagerTag, eid) &&
    hasComponent(world.ecs, Owner, eid) &&
    Owner.player[eid] === playerId &&
    hasComponent(world.ecs, Health, eid) &&
    Health.hp[eid] > 0;
}

function issueAiMoveOrder(world: SimWorld, eid: number, to: GridPos): void {
  if (!isMovableEntity(world, eid)) return;
  if (!pathTo(world, eid, to.x, to.y)) return;
  clearCombatOrders(world, eid);
  clearWorkOrders(world, eid);
}

function issueAiAttackMoveOrder(world: SimWorld, eid: number, to: GridPos): void {
  if (!isMovableEntity(world, eid)) return;
  if (!hasComponent(world.ecs, Combat, eid)) return;
  if (!pathTo(world, eid, to.x, to.y)) return;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
    AttackMoveGoal.active[eid] = 1;
    AttackMoveGoal.x[eid] = to.x;
    AttackMoveGoal.y[eid] = to.y;
  }
  clearWorkOrders(world, eid);
  clearFormationSpeedCap(world, eid);
}

function issueAiAttackOrder(world: SimWorld, eid: number, target: number): void {
  if (!hasComponent(world.ecs, Combat, eid)) return;
  if (!hasComponent(world.ecs, AttackTarget, eid)) return;
  if (!isValidHostileTarget(world, eid, target)) return;
  const inRange = isTargetInAttackRange(world, eid, target);
  const canReach =
    inRange ||
    (isMovableEntity(world, eid) && pathTo(world, eid, Position.x[target], Position.y[target]));
  if (!canReach) return;
  AttackTarget.targetEid[eid] = target;
  AttackTarget.retainGoal[eid] = 1;
  if (hasComponent(world.ecs, AttackMoveGoal, eid)) AttackMoveGoal.active[eid] = 0;
  if (inRange) world.paths.delete(eid);
  clearWorkOrders(world, eid);
  clearFormationSpeedCap(world, eid);
}
