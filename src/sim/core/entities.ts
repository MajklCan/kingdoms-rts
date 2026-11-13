/**
 * Entity lifecycle (NetId bookkeeping) and deterministic ordering helpers.
 */

import { addComponent, addEntity, hasComponent, removeEntity } from 'bitecs';
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
  removeEntity(world.ecs, eid);
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
