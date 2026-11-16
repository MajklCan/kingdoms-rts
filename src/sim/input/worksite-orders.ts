/**
 * Assign free villagers to help at an own completed worksite (see
 * src/sim/systems/worksite-helpers.ts for the rules).
 */

import { hasComponent } from 'bitecs';
import { Gatherer, WorksiteHelper } from '../components';
import { sortedEids } from '../core/entities';
import type { SimWorld } from '../core/types';
import { canBuild } from '../systems/builders';
import { helpRefusal, joinWorksite, leaveWorksite } from '../systems/worksite-helpers';
import { ownedCommandableEids } from './apply-input';
import { clearCombatOrders, clearFormationSpeedCap } from './unit-orders';

/**
 * Send `eids` (the player's free villagers among them, in NetId order) to
 * help at `siteEid` while it has room. Villagers already helping there keep
 * working; the rest of a too-large group is left with its current orders.
 */
export function applyAssignWorksiteCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  siteEid: number
): void {
  const refusal = helpRefusal(world, siteEid, playerId);
  if (refusal !== null && refusal !== 'full') return;
  for (const eid of sortedEids(world, ownedCommandableEids(world, playerId, eids))) {
    if (!canBuild(world, eid) || !hasComponent(world.ecs, Gatherer, eid)) continue;
    if (hasComponent(world.ecs, WorksiteHelper, eid) && WorksiteHelper.siteEid[eid] === siteEid) continue;
    if (helpRefusal(world, siteEid, playerId) !== null) return;
    leaveWorksite(world, eid);
    clearCombatOrders(world, eid);
    clearFormationSpeedCap(world, eid);
    joinWorksite(world, eid, siteEid);
  }
}
