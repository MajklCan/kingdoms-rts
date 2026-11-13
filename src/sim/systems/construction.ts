/**
 * Foundation build progress and building completion.
 */

import { addComponent, removeComponent } from 'bitecs';
import {
  ConstructionSite,
  DropOff,
  FoundationTag,
  Health,
  Owner,
  Position,
  Producer,
  ResourceWorksite,
  TownCenterTag,
} from '../components';
import { BuildingDefId, getBuildingDef } from '../defs';
import { sortedEids } from '../core/entities';
import { pushGameEvent, pushSoundCue } from '../core/events';
import { recordBuildingBuilt } from '../core/match-stats';
import { getBuildingPopProvided, recalculatePlayerPopCap } from '../core/population';
import { foundationQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { attachBuildingCombat } from '../factories/buildings';
import { trySpawnInitialWorksiteWorker } from './worksites';

export function constructionSystem(world: SimWorld): void {
  const sites = sortedEids(world, foundationQuery(world.ecs));
  for (const siteEid of sites) {
    // Killed this tick: leave it for the death system, never build it back up.
    if (Health.hp[siteEid] <= 0) continue;
    const total = Math.max(1, ConstructionSite.totalTicks[siteEid]);
    const builtBefore = builtHp(siteEid, ConstructionSite.progress[siteEid], total);
    // Damage taken so far is kept as a deficit below the built curve, so hits
    // on a foundation stick instead of being healed by the next tick.
    const deficit = Math.max(0, builtBefore - Health.hp[siteEid]);
    ConstructionSite.progress[siteEid] += 1;
    Health.hp[siteEid] = builtHp(siteEid, ConstructionSite.progress[siteEid], total) - deficit;
    if (ConstructionSite.progress[siteEid] >= total) {
      const defId = ConstructionSite.defId[siteEid];
      finaliseBuilding(world, siteEid);
      // Completion does not repair damage the foundation took.
      Health.hp[siteEid] = Math.max(1, Health.hp[siteEid] - deficit);
      const playerId = Owner.player[siteEid];
      recordBuildingBuilt(world, playerId);
      pushGameEvent(world, {
        kind: 'buildingCompleted',
        playerId,
        buildingDefId: defId,
        eid: siteEid,
        x: Position.x[siteEid],
        y: Position.y[siteEid],
      });
    }
  }
}

/** HP an undamaged foundation has at `progress` ticks: grows with the build, never below 1. */
function builtHp(siteEid: number, progress: number, total: number): number {
  const frac = Math.min(1, progress / total);
  return Math.max(1, Math.floor(Health.hpMax[siteEid] * frac));
}

export function finaliseBuilding(world: SimWorld, siteEid: number): void {
  const defId = ConstructionSite.defId[siteEid];
  const def = getBuildingDef(defId);
  if (!def) return;
  const playerId = Owner.player[siteEid];
  pushSoundCue(world, 'build_complete', Position.x[siteEid], Position.y[siteEid], playerId);

  removeComponent(world.ecs, ConstructionSite, siteEid);
  removeComponent(world.ecs, FoundationTag, siteEid);

  // Attach role-specific components based on the def.
  if (def.isDropOff) {
    addComponent(world.ecs, DropOff, siteEid);
    DropOff.acceptsMask[siteEid] = def.dropOffMask;
  }
  if (def.trains.length > 0 || def.harvestKind !== undefined) {
    addComponent(world.ecs, Producer, siteEid);
    Producer.currentProgress[siteEid] = 0;
  }
  if (def.harvestKind !== undefined) {
    addComponent(world.ecs, ResourceWorksite, siteEid);
    ResourceWorksite.kind[siteEid] = def.harvestKind;
    ResourceWorksite.assignedWorkers[siteEid] = 0;
    ResourceWorksite.freeWorkersSpawned[siteEid] = 0;
    ResourceWorksite.progress[siteEid] = 0;
    trySpawnInitialWorksiteWorker(world, siteEid);
  }
  if (defId === BuildingDefId.TOWN_CENTER) {
    addComponent(world.ecs, TownCenterTag, siteEid);
  }
  attachBuildingCombat(world, siteEid, def);
  // Heal foundation up to full HP on completion.
  Health.hp[siteEid] = def.hp;
  Health.hpMax[siteEid] = def.hp;
  // Apply pop cap bonus.
  const popProvided = getBuildingPopProvided(world, playerId, defId);
  if (popProvided > 0) recalculatePlayerPopCap(world, playerId);
}
