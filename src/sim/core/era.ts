/**
 * Which era's art a building is drawn in. Every building follows its owner's
 * era (the highest tech ring it has opened), except walls: those show the wall
 * tier the owner has researched (palisade, stone, brick), which is also their
 * strength.
 */

import { BuildingDefId } from '../defs';
import { wallTierIndex } from '../tech-tree';
import type { SimWorld } from './types';

export function buildingEraFor(world: SimWorld, ownerId: number, defId: number): number {
  if (defId === BuildingDefId.WALL) return wallTierIndex(world, ownerId);
  return world.ages[ownerId]?.current ?? 0;
}
