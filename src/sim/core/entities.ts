/**
 * Entity lifecycle (NetId bookkeeping) and deterministic ordering helpers.
 */

import { addComponent, addEntity, getEntityComponents, hasComponent, removeComponent, removeEntity } from 'bitecs';
import { Health, NetId, Position } from '../components';
import type { GridPos } from '../pathfinding';
import type { SimWorld } from './types';

export function deterministicEidKey(world: SimWorld, eid: number): number {
  return hasComponent(world.ecs, NetId, eid) ? NetId.value[eid] : eid;
}

export function compareDeterministicEids(world: SimWorld, a: number, b: number): number {
  const ak = deterministicEidKey(world, a);
  const bk = deterministicEidKey(world, b);
  return ak - bk || a - b;
}

/** Packing (key, eid) into one double keeps the order exact while both fit. */
const EID_SPAN = 0x100000;
const MAX_PACKED_KEY = 0xffffffff;
let packScratch = new Float64Array(256);

/**
 * `eids` in deterministic order (NetId, then raw eid), as a new array.
 * Hot: some systems call this per candidate tile, so instead of a comparator
 * that looks up NetId on every comparison it reads each key once, packs
 * (key, eid) into a double and runs the native numeric sort. Same order as
 * {@link compareDeterministicEids}; falls back to it if a value cannot pack.
 */
export function sortedEids(world: SimWorld, eids: readonly number[]): number[] {
  const n = eids.length;
  if (n < 2) return n === 0 ? [] : [eids[0]];
  if (packScratch.length < n) packScratch = new Float64Array(Math.max(n, packScratch.length * 2));
  const packed = packScratch.subarray(0, n);
  for (let i = 0; i < n; i++) {
    const eid = eids[i];
    const key = deterministicEidKey(world, eid);
    if (eid < 0 || eid >= EID_SPAN || key < 0 || key > MAX_PACKED_KEY) {
      return [...eids].sort((a, b) => compareDeterministicEids(world, a, b));
    }
    packed[i] = key * EID_SPAN + eid;
  }
  packed.sort();
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = packed[i] % EID_SPAN;
  return out;
}

export function compareGridPos(a: GridPos, b: GridPos): number {
  return a.y - b.y || a.x - b.x;
}

export function addSimEntity(world: SimWorld): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, NetId, eid);
  const netId = world.nextNetId++;
  NetId.value[eid] = netId;
  world.netIdToEid.set(netId, eid);
  return eid;
}

export function removeSimEntity(world: SimWorld, eid: number): void {
  if (hasComponent(world.ecs, NetId, eid)) {
    world.netIdToEid.delete(NetId.value[eid]);
  }
  forgetEntity(world, eid);
  // bitECS 0.3 keeps component data in global arrays and does not clear them
  // on removeEntity; a recycled eid would inherit this entity's values for
  // every field its next spawn does not write. Clear them now.
  for (const component of getEntityComponents(world.ecs, eid)) {
    removeComponent(world.ecs, component, eid, true);
  }
  removeEntity(world.ecs, eid);
}

/**
 * Drop every world-level reference to a removed entity. bitECS recycles raw
 * eids, and clients recycle differently (one may have played a match before),
 * so a stale entry keyed by this eid would later attach to an unrelated
 * entity on one client only: a desync.
 */
function forgetEntity(world: SimWorld, eid: number): void {
  world.paths.delete(eid);
  world.movementStuck.delete(eid);
  world.formationSpeedCaps.delete(eid);
  world.cannonWindups.delete(eid);
  world.productionQueues.delete(eid);
  world.killingBlows.delete(eid);
  for (const [attacker, windup] of world.cannonWindups) {
    if (windup.targetEid === eid) world.cannonWindups.delete(attacker);
  }
  if (world.pendingProjectileImpacts.some((i) => i.targetEid === eid || i.attackerEid === eid)) {
    // An arrow at a removed target hits nothing; one from a removed archer
    // still lands, it just cannot provoke retaliation against its shooter.
    world.pendingProjectileImpacts = world.pendingProjectileImpacts
      .filter((i) => i.targetEid !== eid)
      .map((i) => (i.attackerEid === eid ? { ...i, attackerEid: -1 } : i));
  }
  if (world.pendingCannonImpacts.some((i) => i.attackerEid === eid)) {
    world.pendingCannonImpacts = world.pendingCannonImpacts.map((i) =>
      i.attackerEid === eid ? { ...i, attackerEid: -1 } : i
    );
  }
  for (const ai of world.aiPlayers) {
    if (ai && ai.waveUnitEids.includes(eid)) ai.waveUnitEids = ai.waveUnitEids.filter((e) => e !== eid);
  }
}

export function netIdForEntity(world: SimWorld, eid: number): number | null {
  if (!hasComponent(world.ecs, NetId, eid)) return null;
  return NetId.value[eid];
}

export function entityForNetId(world: SimWorld, netId: number): number | null {
  return world.netIdToEid.get(netId) ?? null;
}

export function isLiveEntity(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, Position, eid) &&
    (!hasComponent(world.ecs, Health, eid) || Health.hp[eid] > 0);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
