/**
 * The computer player's late economy: once the deposits of a resource around
 * its town are nearly gone it raises the endless worksite for it (mint,
 * brickworks, forester's lodge; all open with ring II).
 */

import { Position, Resource, type ResourceKind, ResourceKindId } from '../components';
import { BuildingDefId } from '../defs';
import { isBuildingUnlocked } from '../tech-tree';
import { resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { aiDifficultyOf } from './difficulty';
import type { AiSnapshot } from './snapshot';

interface EndlessSite {
  kind: ResourceKind;
  defId: number;
  /** How far from the town center deposits still count as in reach. */
  reach: number;
  /** Below this much left in reach the endless site goes up. */
  lowAmount: number;
}

const ENDLESS_SITES: readonly EndlessSite[] = [
  { kind: ResourceKindId.GOLD, defId: BuildingDefId.MINT, reach: 34, lowAmount: 800 },
  { kind: ResourceKindId.STONE, defId: BuildingDefId.BRICKWORKS, reach: 34, lowAmount: 800 },
  { kind: ResourceKindId.WOOD, defId: BuildingDefId.FORESTER, reach: 42, lowAmount: 2000 },
];

const ENDLESS_SITES_PER_KIND = { easy: 1, medium: 2, hard: 3 } as const;

/** Resource of `kind` left in nodes within `reach` tiles of (x, y). */
export function aiResourceLeftNear(world: SimWorld, x: number, y: number, kind: ResourceKind, reach: number): number {
  let left = 0;
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] !== kind || Resource.amount[eid] <= 0) continue;
    const dx = Position.x[eid] - x;
    const dy = Position.y[eid] - y;
    if (dx * dx + dy * dy <= reach * reach) left += Resource.amount[eid];
  }
  return left;
}

/** Endless worksites the AI wants now: none until a resource runs low near its town. */
export function aiEndlessSiteTargets(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot
): Array<{ defId: number; target: number; enabled: boolean }> {
  const x = Position.x[snapshot.tcEid];
  const y = Position.y[snapshot.tcEid];
  const perKind = ENDLESS_SITES_PER_KIND[aiDifficultyOf(world)];
  return ENDLESS_SITES.map((site) => {
    const enabled = isBuildingUnlocked(world, playerId, site.defId) &&
      aiResourceLeftNear(world, x, y, site.kind, site.reach) < site.lowAmount;
    return { defId: site.defId, target: enabled ? perKind : 0, enabled };
  });
}
