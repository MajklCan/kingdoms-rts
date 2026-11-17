/**
 * Building placement and removal commands.
 */

import { addComponent, hasComponent } from 'bitecs';
import { MAP } from '../../config';
import { Building, DeadTag, Health, Owner, type ResourceKind } from '../components';
import { type BuildingDef, BuildingDefId, canAfford, getBuildingDef, spend } from '../defs';
import { isBuildingUnlocked } from '../tech-tree';
import { houseLimitReached } from '../core/population';
import { isTileVisibleTo } from '../systems/visibility';
import { sortedEids } from '../core/entities';
import { findBuildingAt, findNearestResource, findResourceAt } from '../core/lookup';
import type { ResourceProbe } from '../core/placement-probe';
import { selectedQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnFoundation } from '../factories/buildings';
import { markWorksiteWorkersDead, worksiteUsesResourceNodes } from '../systems/worksites';
import { queueBuildOrders } from './order-queue';
import { applyBuildCommand } from './unit-orders';
import { applyPlaceWallLine } from './walls';

export function applyRemoveSelectedBuildings(world: SimWorld, playerId: number): void {
  for (const eid of sortedEids(world, selectedQuery(world.ecs))) {
    if (!isRemovableBuilding(world, eid, playerId)) continue;
    markWorksiteWorkersDead(world, eid);
    addComponent(world.ecs, DeadTag, eid);
  }
}

/** Self-describing (network-safe) building removal: the sender resolves the
 *  exact building eids, and we validate ownership here so a peer can replay it
 *  identically. NetId order keeps the mutation order the same on every client. */
export function applyRemoveBuildingsCommand(world: SimWorld, playerId: number, eids: number[]): void {
  for (const eid of sortedEids(world, eids)) {
    if (!isRemovableBuilding(world, eid, playerId)) continue;
    markWorksiteWorkersDead(world, eid);
    addComponent(world.ecs, DeadTag, eid);
  }
}

function isRemovableBuilding(world: SimWorld, eid: number, playerId: number): boolean {
  if (!hasComponent(world.ecs, Building, eid)) return false;
  if (!hasComponent(world.ecs, Owner, eid) || Owner.player[eid] !== playerId) return false;
  if (Health.hp[eid] <= 0) return false;
  return Building.defId[eid] !== BuildingDefId.TOWN_CENTER;
}

export function applyPlaceBuilding(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number,
  builderEids: number[] = [],
  queue = false
): void {
  const def = getBuildingDef(defId);
  if (!def) return;
  // Tiles only: a fractional spot indexes no grid row (a peer could crash us).
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return;
  if (defId === BuildingDefId.WALL) {
    // A one-tile line: same tier cost, hp and unit check as a dragged line.
    applyPlaceWallLine(world, playerId, x, y, x, y, builderEids);
    return;
  }

  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, def.cost)) return;
  if (!isBuildingUnlocked(world, playerId, defId)) return;
  if (houseLimitReached(world, playerId, defId)) return;
  if (!isPlacementInSight(world, playerId, def, x, y)) return;

  if (!canPlaceBuildingAt(world, def, x, y)) return;

  spend(bank, def.cost);
  const siteEid = spawnFoundation(world, defId, x, y, playerId);
  // A Shift-placed row: the builders take it after what they are doing.
  if (queue) queueBuildOrders(world, playerId, builderEids, siteEid);
  else applyBuildCommand(world, playerId, builderEids, siteEid);
}

/**
 * A human player builds only where they can see right now: every footprint
 * tile in current sight, not just explored. The computer player places by
 * its own rules and is not held to it.
 */
export function isPlacementInSight(
  world: SimWorld,
  playerId: number,
  def: BuildingDef,
  x: number,
  y: number
): boolean {
  if (!world.humanPlayers.has(playerId)) return true;
  const x0 = x - Math.floor(def.footprint.w / 2);
  const y0 = y - Math.floor(def.footprint.h / 2);
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      if (!isTileVisibleTo(world, playerId, x0 + dx, y0 + dy)) return false;
    }
  }
  return true;
}

/**
 * Footprint free and, for resource worksites, a node in reach. `probe` (for
 * batches of queries in one tick, like the AI's spot search) gives the same
 * answer from an index instead of scanning every resource node.
 */
export function canPlaceBuildingAt(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number,
  probe?: ResourceProbe
): boolean {
  if (worksiteUsesResourceNodes(def)) {
    const kind = def.harvestKind as ResourceKind;
    const radius = def.harvestRadius ?? 6;
    const inReach = probe
      ? probe.nearestDistance(x, y, kind, radius) !== null
      : findNearestResource(world, x, y, kind, radius) !== null;
    if (!inReach) return false;
  }

  const fw = def.footprint.w;
  const fh = def.footprint.h;
  const x0 = x - Math.floor(fw / 2);
  const y0 = y - Math.floor(fh / 2);
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
      if (world.map.walkability[ty][tx] !== 0) return false;
      if (probe ? probe.hasResourceAt(tx, ty, 0.6) : findResourceAt(world, tx, ty, 0.6) !== null) return false;
      if (findBuildingAt(world, tx, ty, 0.01) !== null) return false;
    }
  }
  return true;
}
