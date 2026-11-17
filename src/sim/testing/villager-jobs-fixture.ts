/**
 * Shared setup for the villager job tests (helpers, hunting, return to work).
 * Test-only: never imported by the game.
 */

import { BuildOrder, Owner, Position } from '../components';
import { getBuildingDef } from '../defs';
import { findSpawnSpot } from '../core/grid';
import { townCenterQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnCompletedBuilding } from '../factories/buildings';
import { spawnVillager } from '../factories/units';
import { canPlaceBuildingAt } from '../input/buildings';
import { createSimWorld, step } from '../world';

export const P1 = 1;
export const P2 = 2;

/** An unpaused world where both seats are human (no AI interference). */
export function quietWorld(seed = 77): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([P1, P2]);
  world.resources[P1] = Int32Array.of(5000, 5000, 5000, 5000);
  world.resources[P2] = Int32Array.of(5000, 5000, 5000, 5000);
  return world;
}

export function stepN(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) step(world);
}

export function tcOf(world: SimWorld, playerId: number): number {
  return townCenterQuery(world.ecs).find((eid) => Owner.player[eid] === playerId)!;
}

/** A free spot for `defId` a few tiles from the player's town center. */
export function buildingSpot(world: SimWorld, defId: number, playerId = P1, skip = 0): { x: number; y: number } {
  const tc = tcOf(world, playerId);
  const def = getBuildingDef(defId)!;
  let seen = 0;
  for (let r = 4; r < 14; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]] as const) {
      const x = Position.x[tc] + dx;
      const y = Position.y[tc] + dy;
      if (!canPlaceBuildingAt(world, def, x, y)) continue;
      if (seen++ === skip) return { x, y };
    }
  }
  throw new Error('no building spot');
}

export function completedBuilding(world: SimWorld, defId: number, playerId = P1, skip = 0): number {
  const spot = buildingSpot(world, defId, playerId, skip);
  return spawnCompletedBuilding(world, defId, spot.x, spot.y, playerId);
}

/** Free villagers of `playerId` standing next to `near`. */
export function villagersNear(world: SimWorld, near: number, count: number, playerId = P1): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const spot = findSpawnSpot(world, Position.x[near] + 1, Position.y[near] + 1, 5)!;
    const eid = spawnVillager(world, spot.x, spot.y, playerId);
    BuildOrder.targetEid[eid] = -1;
    out.push(eid);
  }
  return out;
}
