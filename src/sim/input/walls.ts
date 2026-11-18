/**
 * Wall placement: one tile (placeBuilding with the WALL def) or a whole line
 * (placeWallLine). Self-describing, so it is wire-safe; the playerId is
 * checked against the sending slot by the net layer.
 */

import { Position } from '../components';
import { BuildingDefId, canAfford, getBuildingDef, spend } from '../defs';
import { isBuildingUnlocked } from '../tech-tree';
import { sortedEids } from '../core/entities';
import { unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { applyWallTierToFoundation, getPlayerWallTier, wallLineTiles } from '../core/walls';
import { spawnFoundation } from '../factories/buildings';
import { canPlaceBuildingAt, isPlacementInSight } from './buildings';
import { applyBuildCommand } from './unit-orders';

/**
 * Lay wall foundations along the 4-connected line (x0, y0) -> (x1, y1), start
 * first. Tiles that cannot take a wall (blocked, resource, building, a unit
 * standing there) are skipped, so a line around a tree still goes up; placing
 * stops when the player runs out of resources. `builderEids` are sent to
 * build the line. Returns the number placed.
 */
export function applyPlaceWallLine(
  world: SimWorld,
  playerId: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  builderEids: number[] = []
): number {
  if (![x0, y0, x1, y1].every(Number.isInteger)) return 0;
  if (!isTileInBounds(world, x0, y0) || !isTileInBounds(world, x1, y1)) return 0;
  if (!isBuildingUnlocked(world, playerId, BuildingDefId.WALL)) return 0;
  const bank = world.resources[playerId];
  const def = getBuildingDef(BuildingDefId.WALL);
  if (!bank || !def) return 0;

  const tier = getPlayerWallTier(world, playerId);
  const occupied = unitTiles(world);
  let placed = 0;
  for (const { x, y } of wallLineTiles(x0, y0, x1, y1)) {
    if (!canAfford(bank, tier.cost)) break;
    if (occupied.has(y * world.map.width + x)) continue;
    if (!canPlaceBuildingAt(world, def, x, y)) continue;
    if (!isPlacementInSight(world, playerId, def, x, y)) continue;
    spend(bank, tier.cost);
    const eid = spawnFoundation(world, BuildingDefId.WALL, x, y, playerId);
    applyWallTierToFoundation(eid, tier);
    // Builders start on the first segment; the builder system chains them
    // along the rest of the line as each one finishes.
    if (placed === 0) applyBuildCommand(world, playerId, builderEids, eid);
    placed++;
  }
  return placed;
}

function isTileInBounds(world: SimWorld, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.map.width && y < world.map.height;
}

/** Tiles a living unit stands on: a wall there would trap it. */
function unitTiles(world: SimWorld): Set<number> {
  const out = new Set<number>();
  for (const eid of sortedEids(world, unitQuery(world.ecs))) {
    const x = Math.round(Position.x[eid]);
    const y = Math.round(Position.y[eid]);
    if (isTileInBounds(world, x, y)) out.add(y * world.map.width + x);
  }
  return out;
}
