/**
 * Per-player unit caps. The Commander is the only capped unit today: one
 * alive or in a production queue at a time, so he is a veteran and never a
 * troop type. A count, not an iteration that mutates, so eid order is moot.
 */

import { hasComponent } from 'bitecs';
import { DeadTag, Owner } from '../components';
import { UnitDefId } from '../defs';
import { commanderQuery } from './queries';
import type { SimWorld } from './types';

/** Most commanders a player may have alive plus queued. */
export const COMMANDER_LIMIT = 1;

/** Living commanders owned by `playerId` (units already marked dead excluded). */
export function countAliveCommanders(world: SimWorld, playerId: number): number {
  let total = 0;
  for (const eid of commanderQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, DeadTag, eid)) continue;
    total++;
  }
  return total;
}

/** Commanders waiting in any of the player's production queues. */
export function countQueuedCommanders(world: SimWorld, playerId: number): number {
  let total = 0;
  for (const [producerEid, queue] of world.productionQueues) {
    if (!hasComponent(world.ecs, Owner, producerEid)) continue;
    if (Owner.player[producerEid] !== playerId) continue;
    for (const defId of queue) if (defId === UnitDefId.COMMANDER) total++;
  }
  return total;
}

/** True when `defId` is capped and the player has already used the allowance. */
export function unitLimitReached(world: SimWorld, playerId: number, defId: number): boolean {
  if (defId !== UnitDefId.COMMANDER) return false;
  return (
    countAliveCommanders(world, playerId) + countQueuedCommanders(world, playerId) >=
    COMMANDER_LIMIT
  );
}

/** Player-facing reason for a refused capped unit, or null when it is allowed. */
export function unitLimitReason(world: SimWorld, playerId: number, defId: number): string | null {
  if (!unitLimitReached(world, playerId, defId)) return null;
  return countAliveCommanders(world, playerId) > 0
    ? 'Your Commander is already in the field'
    : 'A Commander is already in training';
}
