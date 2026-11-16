/**
 * Test helper: put a builder at every unstaffed foundation. Buildings only
 * rise while a villager works on them, so tests about what happens during or
 * after construction staff their sites with this instead of walking villagers
 * across the map first.
 */

import { BuildOrder, Owner, Position } from '../components';
import { sortedEids } from '../core/entities';
import { distToBuildingEdge, findSpawnSpot } from '../core/grid';
import { foundationQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnVillager } from '../factories/units';
import { BUILD_CONTACT_DISTANCE, countAssignedBuilders, isOpenFoundation } from '../systems/builders';

/**
 * Spawn one pop-free villager in contact with each open foundation that has
 * no builder yet (of `playerId`, or of every player). Returns the villagers.
 */
export function staffFoundations(world: SimWorld, playerId?: number): number[] {
  const builders: number[] = [];
  for (const site of sortedEids(world, foundationQuery(world.ecs))) {
    const owner = Owner.player[site];
    if (playerId !== undefined && owner !== playerId) continue;
    if (!isOpenFoundation(world, site, owner) || countAssignedBuilders(world, site) > 0) continue;
    const spot = findSpawnSpot(world, Position.x[site], Position.y[site], 4);
    if (!spot || distToBuildingEdge(world, spot.x, spot.y, site) > BUILD_CONTACT_DISTANCE) {
      throw new Error(`staffFoundations: no free tile next to foundation ${site}`);
    }
    const eid = spawnVillager(world, spot.x, spot.y, owner, 0);
    BuildOrder.targetEid[eid] = site;
    builders.push(eid);
  }
  return builders;
}
