/**
 * Read-only query: which of a player's villagers have nothing to do. Used by
 * the HUD's idle villager button; never called from a tick system.
 */

import { hasComponent } from 'bitecs';
import {
  AttackTarget,
  BuildOrder,
  DeadTag,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  VillagerTag,
  WorksiteWorker,
} from '../components';
import { sortedEids } from './entities';
import { unitQuery } from './queries';
import type { SimWorld } from './types';

/** A living villager of `playerId` that is not walking, gathering, building
 *  or fighting. Worksite crews are excluded: their building drives them. */
export function isIdleVillager(world: SimWorld, eid: number, playerId: number): boolean {
  const ecs = world.ecs;
  if (!hasComponent(ecs, VillagerTag, eid)) return false;
  if (!hasComponent(ecs, Owner, eid) || Owner.player[eid] !== playerId) return false;
  if (hasComponent(ecs, WorksiteWorker, eid) || hasComponent(ecs, DeadTag, eid)) return false;
  if (hasComponent(ecs, Health, eid) && Health.hp[eid] <= 0) return false;
  if (hasComponent(ecs, Gatherer, eid) && Gatherer.state[eid] !== GathererStateId.IDLE) return false;
  if (hasComponent(ecs, BuildOrder, eid) && BuildOrder.targetEid[eid] >= 0) return false;
  if (hasComponent(ecs, AttackTarget, eid) && AttackTarget.targetEid[eid] >= 0) return false;
  const path = world.paths.get(eid);
  return !path || path.length === 0;
}

/** Idle villagers of `playerId` in stable (NetId) order, so cycling is predictable. */
export function findIdleVillagers(world: SimWorld, playerId: number): number[] {
  return sortedEids(world, unitQuery(world.ecs)).filter((eid) => isIdleVillager(world, eid, playerId));
}
