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

export function sortedEids(world: SimWorld, eids: readonly number[]): number[] {
  return [...eids].sort((a, b) => compareDeterministicEids(world, a, b));
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
