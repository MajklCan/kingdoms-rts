/**
 * Projectile flight time and impact damage (arrows, shots, cannon and mortar splash).
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { GunmanTag, Health, MachineGunTag, Owner, Position } from '../components';
import { sortedEids } from '../core/entities';
import { pushSoundCue } from '../core/events';
import { distToBuildingEdge } from '../core/grid';
import { applyDamage } from '../core/match-stats';
import { buildingQuery, unitQuery } from '../core/queries';
import type { PendingCannonImpact, PendingProjectileImpact, SimWorld } from '../core/types';
import { retaliateWhenEngaged } from './combat';

const CANNON_SPLASH_FULL_DAMAGE_RADIUS = 0.48;
const CANNON_SPLASH_MAX_RADIUS = 1.8;
const CANNON_SPLASH_MIN_DAMAGE_FRACTION = 0.08;
const CANNON_SPLASH_FALLOFF_EXPONENT = 2.3;
const CANNON_BUILDING_DIRECT_HIT_RADIUS = 0.35;
const CANNON_BUILDING_DAMAGE_MULTIPLIER = 2;

export function projectileTravelTicksForAttack(
  world: SimWorld,
  attacker: number,
  distanceTiles: number
): number {
  if (hasComponent(world.ecs, GunmanTag, attacker)) {
    return projectileTravelTicks(distanceTiles, 70, 160, 24);
  }
  if (hasComponent(world.ecs, MachineGunTag, attacker)) {
    return projectileTravelTicks(distanceTiles, 45, 120, 18);
  }
  return projectileTravelTicks(distanceTiles, 180, 520, 70);
}

export function cannonProjectileTravelTicks(distanceTiles: number): number {
  return projectileTravelTicks(distanceTiles, 320, 827, 96);
}

/** Mortar shells hang on a higher, slower arc than a flat cannon shot. */
export function mortarProjectileTravelTicks(distanceTiles: number): number {
  return projectileTravelTicks(distanceTiles, 300, 760, 95);
}

function projectileTravelTicks(
  distanceTiles: number,
  minMs: number,
  maxMs: number,
  msPerTile: number
): number {
  const durationMs = Math.max(minMs, Math.min(maxMs, distanceTiles * msPerTile));
  return Math.max(1, Math.round(durationMs / SIM.TICK_MS));
}

export function projectileImpactSystem(world: SimWorld): void {
  if (world.pendingProjectileImpacts.length === 0) return;
  const pending: PendingProjectileImpact[] = [];
  for (const impact of world.pendingProjectileImpacts) {
    if (impact.impactTick > world.tick) {
      pending.push(impact);
      continue;
    }
    applyProjectileImpactDamage(world, impact);
  }
  world.pendingProjectileImpacts = pending;
}

function applyProjectileImpactDamage(world: SimWorld, impact: PendingProjectileImpact): void {
  if (
    !hasComponent(world.ecs, Health, impact.targetEid) ||
    Health.hp[impact.targetEid] <= 0 ||
    !hasComponent(world.ecs, Owner, impact.targetEid) ||
    Owner.player[impact.targetEid] === impact.attackerOwner ||
    Owner.player[impact.targetEid] === 0
  ) {
    return;
  }
  applyDamage(world, impact.targetEid, impact.damage, impact.attackerOwner);
  retaliateWhenEngaged(world, impact.targetEid, impact.attackerEid);
}

export function cannonImpactSystem(world: SimWorld): void {
  if (world.pendingCannonImpacts.length === 0) return;
  const pending: PendingCannonImpact[] = [];
  for (const impact of world.pendingCannonImpacts) {
    if (impact.impactTick > world.tick) {
      pending.push(impact);
      continue;
    }
    applyCannonImpactDamage(world, impact);
  }
  world.pendingCannonImpacts = pending;
}

function applyCannonImpactDamage(world: SimWorld, impact: PendingCannonImpact): void {
  pushSoundCue(world, 'cannon_impact', impact.impactX, impact.impactY, impact.attackerOwner);
  for (const building of sortedEids(world, buildingQuery(world.ecs))) {
    if (!isValidCannonBuildingVictim(world, impact.attackerOwner, building)) continue;
    if (distToBuildingEdge(world, impact.impactX, impact.impactY, building) > CANNON_BUILDING_DIRECT_HIT_RADIUS) {
      continue;
    }
    applyDamage(
      world,
      building,
      Math.max(1, Math.ceil(impact.damage * CANNON_BUILDING_DAMAGE_MULTIPLIER) - Health.armor[building]),
      impact.attackerOwner
    );
    retaliateWhenEngaged(world, building, impact.attackerEid);
  }

  for (const victim of sortedEids(world, unitQuery(world.ecs))) {
    if (!isValidCannonSplashVictim(world, impact.attackerOwner, victim)) continue;
    const distance = Math.hypot(Position.x[victim] - impact.impactX, Position.y[victim] - impact.impactY);
    if (distance > CANNON_SPLASH_MAX_RADIUS) continue;
    applyDamage(world, victim, computeCannonSplashDamage(impact.damage, victim, distance), impact.attackerOwner);
    retaliateWhenEngaged(world, victim, impact.attackerEid);
  }
}

function isValidCannonBuildingVictim(
  world: SimWorld,
  attackerOwner: number,
  building: number
): boolean {
  if (!hasComponent(world.ecs, Owner, building)) return false;
  if (Owner.player[building] === attackerOwner) return false;
  if (Owner.player[building] === 0) return false;
  return hasComponent(world.ecs, Health, building) && Health.hp[building] > 0;
}

function isValidCannonSplashVictim(world: SimWorld, attackerOwner: number, victim: number): boolean {
  if (!hasComponent(world.ecs, Owner, victim)) return false;
  if (Owner.player[victim] === attackerOwner) return false;
  if (Owner.player[victim] === 0) return false;
  return hasComponent(world.ecs, Health, victim) && Health.hp[victim] > 0;
}

function computeCannonSplashDamage(baseDamage: number, victim: number, distance: number): number {
  const span = Math.max(0.01, CANNON_SPLASH_MAX_RADIUS - CANNON_SPLASH_FULL_DAMAGE_RADIUS);
  const t = Math.min(1, Math.max(0, (distance - CANNON_SPLASH_FULL_DAMAGE_RADIUS) / span));
  const damageFraction =
    CANNON_SPLASH_MIN_DAMAGE_FRACTION +
    (1 - CANNON_SPLASH_MIN_DAMAGE_FRACTION) *
      Math.pow(1 - t, CANNON_SPLASH_FALLOFF_EXPONENT);
  return Math.max(1, Math.ceil(baseDamage * damageFraction) - Health.armor[victim]);
}
