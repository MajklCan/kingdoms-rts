/**
 * Removes resource nodes whose amount reached zero.
 *
 * Gathering only decrements Resource.amount; this system is the single place
 * that deletes emptied nodes, once per tick, in deterministic (NetId) order.
 * Every gatherer still bound to a removed node is released first so no stale
 * eid survives the removal (bitECS recycles eids): it moves on to the nearest
 * node of the same kind nearby, heads home with what it carries, or goes idle.
 *
 * Resource nodes never block the walkability grid (units path through
 * trees), so there is no tile to free. Forest regrowth sees the empty tile on
 * its next pass, exactly as before. The render layer draws stumps for felled
 * trees; the `resourceDepleted` game event tells it where one fell.
 */

import {
  Gatherer,
  GathererStateId,
  Position,
  Resource,
  ResourceCarry,
  type ResourceKind,
  VILLAGER_CARRY_CAPACITY,
} from '../components';
import { removeSimEntity, sortedEids } from '../core/entities';
import { pushGameEvent } from '../core/events';
import { gathererQuery, resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { routeToNearestDropOff, routeWorksiteWorkerToResource } from './dropoff';
import { routeToNearestReachableResource } from './gathering';

/** How far a gatherer looks for another node of the same kind (tiles). */
export const DEPLETED_NODE_RETARGET_RADIUS = 15;

export function resourceDepletionSystem(world: SimWorld): void {
  const depleted: number[] = [];
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.amount[eid] <= 0) depleted.push(eid);
  }
  if (depleted.length === 0) return;

  for (const node of sortedEids(world, depleted)) {
    const kind = Resource.kind[node] as ResourceKind;
    const x = Position.x[node];
    const y = Position.y[node];
    for (const gatherer of sortedEids(world, gathererQuery(world.ecs))) {
      if (Gatherer.targetEid[gatherer] !== node) continue;
      releaseGatherer(world, gatherer, kind);
    }
    pushGameEvent(world, { kind: 'resourceDepleted', eid: node, resourceKind: kind, x, y });
    removeSimEntity(world, node);
  }
}

function releaseGatherer(world: SimWorld, gatherer: number, kind: ResourceKind): void {
  Gatherer.targetEid[gatherer] = -1;
  const state = Gatherer.state[gatherer];
  // Carriers on their way home pick their next node after the drop-off.
  if (state !== GathererStateId.WALKING_TO && state !== GathererStateId.GATHERING) return;

  if (ResourceCarry.amount[gatherer] >= VILLAGER_CARRY_CAPACITY) {
    sendHome(world, gatherer);
    return;
  }
  if (routeWorksiteWorkerToResource(world, gatherer, kind)) return;
  if (routeToNearestReachableResource(world, gatherer, kind, DEPLETED_NODE_RETARGET_RADIUS)) return;

  // Nothing of that kind nearby: deliver a partial load rather than idle on
  // it (worksite crews then get reassigned by their worksite).
  if (ResourceCarry.amount[gatherer] > 0) {
    sendHome(world, gatherer);
    return;
  }
  Gatherer.state[gatherer] = GathererStateId.IDLE;
  Gatherer.cooldown[gatherer] = 0;
  world.paths.delete(gatherer);
}

function sendHome(world: SimWorld, gatherer: number): void {
  Gatherer.state[gatherer] = GathererStateId.RETURNING;
  Gatherer.cooldown[gatherer] = 0;
  routeToNearestDropOff(world, gatherer);
}
