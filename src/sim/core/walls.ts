/**
 * Walls: per-age tiers, line geometry and the age-up hp upgrade.
 *
 * A wall is a 1x1 WALL building per tile. Its cost, build time and hp come
 * from the owner's current age (defs.ts WALL_TIERS), so a palisade line
 * becomes stone when its owner reaches the Castle Age. Each tile blocks the
 * shared walkability grid like any building footprint (markFootprintBlocked),
 * which is the EasyStar grid itself, so paths see a wall the tick it is placed
 * and the tile frees again in cleanupSystem when it falls.
 *
 * Lines are 4-connected on purpose: EasyStar runs with diagonals and corner
 * cutting, so a Bresenham (8-connected) line would leave diagonal gaps units
 * could slip through.
 */

import { hasComponent } from 'bitecs';
import { Building, ConstructionSite, Health, Owner } from '../components';
import {
  AgeId,
  BuildingDefId,
  type CostTuple,
  type WallTier,
  getBuildingDef,
  getWallTier,
} from '../defs';
import { setFoundationMaxHp } from '../systems/construction';
import { sortedEids } from './entities';
import { buildingQuery } from './queries';
import type { SimWorld } from './types';

/** Longest line one placeWallLine command builds (tiles, endpoints included). */
export const WALL_LINE_MAX_TILES = 48;

export function getPlayerWallTier(world: SimWorld, playerId: number): WallTier {
  return getWallTier(world.ages[playerId]?.current ?? AgeId.DARK);
}

/** What `playerId` pays to place one `defId` right now (walls follow the age tier). */
export function getBuildingCost(world: SimWorld, playerId: number, defId: number): CostTuple {
  if (defId === BuildingDefId.WALL) return getPlayerWallTier(world, playerId).cost;
  return getBuildingDef(defId)?.cost ?? { food: 0, wood: 0, gold: 0, stone: 0 };
}

/** Build time in ticks for `playerId` placing one `defId` right now. */
export function getBuildingBuildTicks(world: SimWorld, playerId: number, defId: number): number {
  if (defId === BuildingDefId.WALL) return getPlayerWallTier(world, playerId).buildTimeTicks;
  return getBuildingDef(defId)?.buildTimeTicks ?? 0;
}

/** Display name for `defId` as `playerId` would build it now ("Stone Wall" in the Castle Age). */
export function getBuildingDisplayName(world: SimWorld, playerId: number, defId: number): string {
  if (defId === BuildingDefId.WALL) return getPlayerWallTier(world, playerId).name;
  return getBuildingDef(defId)?.name ?? '';
}

/**
 * Tiles of a 4-connected line from (x0, y0) to (x1, y1), start first, at most
 * `maxTiles` long. Integer only, so every peer walks the same tiles; ties step
 * along y.
 */
export function wallLineTiles(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxTiles = WALL_LINE_MAX_TILES
): Array<{ x: number; y: number }> {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;
  const out = [{ x: x0, y: y0 }];
  let x = x0;
  let y = y0;
  let ix = 0;
  let iy = 0;
  while ((ix < dx || iy < dy) && out.length < maxTiles) {
    // Step along x while the x progress lags the y progress (compared at tile centres).
    if ((1 + 2 * ix) * dy < (1 + 2 * iy) * dx) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push({ x, y });
  }
  return out;
}

/** Give a freshly spawned WALL foundation its tier's hp and build time. */
export function applyWallTierToFoundation(eid: number, tier: WallTier): void {
  ConstructionSite.totalTicks[eid] = tier.buildTimeTicks;
  Health.hpMax[eid] = tier.hp;
  Health.hp[eid] = Math.min(Health.hp[eid], tier.hp);
}

/**
 * The owner reached a new age: every wall it owns moves up to the new tier's
 * max hp. Finished walls gain the difference (damage stays damage);
 * foundations keep the damage they took below their build curve.
 */
export function upgradePlayerWalls(world: SimWorld, playerId: number): void {
  const tier = getPlayerWallTier(world, playerId);
  for (const eid of sortedEids(world, buildingQuery(world.ecs))) {
    if (Building.defId[eid] !== BuildingDefId.WALL) continue;
    if (!hasComponent(world.ecs, Owner, eid) || Owner.player[eid] !== playerId) continue;
    if (!hasComponent(world.ecs, Health, eid) || Health.hp[eid] <= 0) continue;
    const oldMax = Health.hpMax[eid];
    if (tier.hp <= oldMax) continue;
    if (hasComponent(world.ecs, ConstructionSite, eid)) {
      setFoundationMaxHp(eid, tier.hp);
    } else {
      Health.hp[eid] += tier.hp - oldMax;
      Health.hpMax[eid] = tier.hp;
    }
  }
}
