/**
 * AI builders with nothing to build go to work instead of standing around:
 * help at the AI's own worksite with the most room (nearest on a tie), else
 * hunt game or gather food or wood near the town center. A new foundation
 * pulls them back (aiManageBuilders), and their work memory brings them back
 * here once it is built.
 */

import { dhypot } from '../core/dmath';
import { hasComponent } from 'bitecs';
import { Owner, Position, Resource, ResourceKindId, TownCenterTag } from '../components';
import { compareDeterministicEids, sortedEids } from '../core/entities';
import { isIdleVillager } from '../core/idle-villagers';
import { buildingQuery, resourceQuery, resourceWorksiteQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { isGameAnimal } from '../systems/hunting';
import {
  countWorksiteHelpers,
  helpRefusal,
  worksiteHelperCapacity,
} from '../systems/worksite-helpers';
import { activeAiActuator } from './direct-actuator';

/** How far from its town center an idle AI builder looks for food or wood. */
const AI_HAND_GATHER_RANGE = 18;

export function aiPutIdleBuildersToWork(world: SimWorld, playerId: number, villagers: number[]): void {
  const idle = villagers.filter((eid) => isIdleVillager(world, eid, playerId));
  for (const eid of idle) {
    const site = bestWorksiteToHelp(world, playerId, eid);
    if (site !== null) {
      activeAiActuator().assignWorksite(world, playerId, [eid], site);
      continue;
    }
    const node = bestHandGatherNode(world, playerId);
    if (node !== null) activeAiActuator().gather(world, playerId, [eid], node);
  }
}

function bestWorksiteToHelp(world: SimWorld, playerId: number, eid: number): number | null {
  let best: number | null = null;
  let bestRoom = 0;
  let bestDist = Infinity;
  for (const site of sortedEids(world, resourceWorksiteQuery(world.ecs))) {
    if (helpRefusal(world, site, playerId) !== null) continue;
    const room = worksiteHelperCapacity(world, site) - countWorksiteHelpers(world, site);
    const dist = dhypot(Position.x[site] - Position.x[eid], Position.y[site] - Position.y[eid]);
    if (room > bestRoom || (room === bestRoom && dist < bestDist)) {
      best = site;
      bestRoom = room;
      bestDist = dist;
    }
  }
  return best;
}

/** Game first, then berries, then wood, nearest the town center within range. */
function bestHandGatherNode(world: SimWorld, playerId: number): number | null {
  const tc = sortedEids(world, buildingQuery(world.ecs)).find(
    (eid) => hasComponent(world.ecs, TownCenterTag, eid) && Owner.player[eid] === playerId
  );
  if (tc === undefined) return null;
  const x = Position.x[tc];
  const y = Position.y[tc];
  const scored = resourceQuery(world.ecs)
    .filter((node) => Resource.amount[node] > 0)
    .map((node) => {
      const game = isGameAnimal(world, node);
      const kind = Resource.kind[node];
      const tier = game ? 0 : kind === ResourceKindId.FOOD ? 1 : kind === ResourceKindId.WOOD ? 2 : 3;
      return { node, tier, dist: dhypot(Position.x[node] - x, Position.y[node] - y) };
    })
    .filter((c) => c.tier < 3 && c.dist <= AI_HAND_GATHER_RANGE)
    .sort((a, b) => a.tier - b.tier || a.dist - b.dist || compareDeterministicEids(world, a.node, b.node));
  return scored[0]?.node ?? null;
}
