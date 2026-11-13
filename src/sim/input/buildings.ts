/**
 * Building placement and removal commands.
 */

import { addComponent, hasComponent } from 'bitecs';
import { MAP } from '../../config';
import { Building, DeadTag, Health, Owner, type ResourceKind } from '../components';
import { type BuildingDef, BuildingDefId, canAfford, getBuildingDef, spend } from '../defs';
import { isBuildingUnlocked } from '../tech-tree';
import { sortedEids } from '../core/entities';
import { findBuildingAt, findNearestResource, findResourceAt } from '../core/lookup';
import { selectedQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnFoundation } from '../factories/buildings';
import { markWorksiteWorkersDead, worksiteUsesResourceNodes } from '../systems/worksites';

export function applyRemoveSelectedBuildings(world: SimWorld, playerId: number): void {
  for (const eid of sortedEids(world, selectedQuery(world.ecs))) {
    if (!isRemovableBuilding(world, eid, playerId)) continue;
    markWorksiteWorkersDead(world, eid);
    addComponent(world.ecs, DeadTag, eid);
  }
}

/** Self-describing (network-safe) building removal: the sender resolves the
 *  exact building eids, and we validate ownership here so a peer can replay it
 *  identically. Ascending eid order keeps the mutation order deterministic. */
export function applyRemoveBuildingsCommand(world: SimWorld, playerId: number, eids: number[]): void {
  for (const eid of [...eids].sort((a, b) => a - b)) {
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
  playerId: number
): void {
  const def = getBuildingDef(defId);
  if (!def) return;
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return;

  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, def.cost)) return;
  if (!isBuildingUnlocked(world, playerId, defId)) return;

  if (!canPlaceBuildingAt(world, def, x, y)) return;

  spend(bank, def.cost);
  spawnFoundation(world, defId, x, y, playerId);
}

export function canPlaceBuildingAt(
  world: SimWorld,
  def: BuildingDef,
  x: number,
  y: number
): boolean {
  if (
    worksiteUsesResourceNodes(def) &&
    findNearestResource(
      world,
      x,
      y,
      def.harvestKind as ResourceKind,
      def.harvestRadius ?? 6
    ) === null
  ) {
    return false;
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
      if (findResourceAt(world, tx, ty, 0.6) !== null) return false;
      if (findBuildingAt(world, tx, ty, 0.01) !== null) return false;
    }
  }
  return true;
}
