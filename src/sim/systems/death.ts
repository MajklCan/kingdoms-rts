/**
 * Death flagging and entity cleanup.
 */

import { addComponent, hasComponent } from 'bitecs';
import {
  AttackTarget,
  BuildOrder,
  Building,
  ConstructionSite,
  DeadTag,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  PopulationCost,
  Position,
} from '../components';
import { BUILDING_TABLE, getUnitDef, refund } from '../defs';
import { removeSimEntity, sortedEids } from '../core/entities';
import { pushSoundCue } from '../core/events';
import { markFootprintBlocked } from '../core/grid';
import { getBuildingPopProvided, recalculatePlayerPopCap } from '../core/population';
import {
  combatQuery,
  damageableQuery,
  deadQuery,
  gathererQuery,
  movableQuery,
} from '../core/queries';
import type { SimWorld } from '../core/types';
import { clearFormationSpeedCap } from '../world';
import { markWorksiteWorkersDead } from './worksites';

export function deathSystem(world: SimWorld): void {
  const ents = sortedEids(world, damageableQuery(world.ecs));
  for (const eid of ents) {
    if (Health.hp[eid] <= 0 && !hasComponent(world.ecs, DeadTag, eid)) {
      addComponent(world.ecs, DeadTag, eid);
      const isBuilding = hasComponent(world.ecs, Building, eid);
      pushSoundCue(
        world,
        isBuilding ? 'building_destroyed' : 'unit_death',
        Position.x[eid],
        Position.y[eid],
        Owner.player[eid]
      );
    }
  }
}

export function cleanupSystem(world: SimWorld): void {
  const dead = sortedEids(world, deadQuery(world.ecs));
  for (const eid of dead) {
    let recalculatePopFor: number | null = null;
    // Update population counters.
    if (hasComponent(world.ecs, PopulationCost, eid)) {
      const p = Owner.player[eid];
      if (world.population[p]) {
        world.population[p].current = Math.max(
          0,
          world.population[p].current - PopulationCost.value[eid]
        );
      }
    }
    if (hasComponent(world.ecs, Building, eid)) {
      const defId = Building.defId[eid];
      const def = BUILDING_TABLE[defId];
      const p = Owner.player[eid];
      // CRITICAL: only decrement pop cap for COMPLETED buildings. Foundations
      // that haven't been finalised never granted cap, so destroying them
      // mid-build should not reduce cap.
      const wasFoundation = hasComponent(world.ecs, ConstructionSite, eid);
      if (!wasFoundation && def && getBuildingPopProvided(world, p, defId) > 0) {
        recalculatePopFor = p;
      }
      // Refund any queued production (resources were spent at queue time).
      const queue = world.productionQueues.get(eid);
      if (queue) {
        for (const qDef of queue) {
          const unitDef = getUnitDef(qDef);
          if (unitDef && world.resources[p]) {
            refund(world.resources[p], unitDef.cost);
          }
        }
      }
      world.productionQueues.delete(eid);
      if (def) {
        markFootprintBlocked(
          world,
          Position.x[eid],
          Position.y[eid],
          def.footprint.w,
          def.footprint.h,
          false
        );
      }
      markWorksiteWorkersDead(world, eid);
    }
    // Clear any attack targets pointing at us — AND drop the path that was
    // chasing us. Without this, attackers keep walking to the deceased's last
    // tile (the "targeting a previous position" bug).
    const attackers = sortedEids(world, combatQuery(world.ecs));
    for (const a of attackers) {
      if (AttackTarget.targetEid[a] === eid) {
        AttackTarget.targetEid[a] = -1;
        world.paths.delete(a);
        clearFormationSpeedCap(world, a);
      }
    }
    world.cannonWindups.delete(eid);
    // Clear gatherer targets pointing at us (resource depleted, etc.).
    const gatherers = sortedEids(world, gathererQuery(world.ecs));
    for (const g of gatherers) {
      if (Gatherer.targetEid[g] === eid) {
        Gatherer.state[g] = GathererStateId.IDLE;
        Gatherer.targetEid[g] = -1;
        world.paths.delete(g);
        clearFormationSpeedCap(world, g);
      }
    }
    // Clear builders' BuildOrder pointing at us.
    if (hasComponent(world.ecs, Building, eid)) {
      const allMovable = sortedEids(world, movableQuery(world.ecs));
      for (const m of allMovable) {
        if (
          hasComponent(world.ecs, BuildOrder, m) &&
          BuildOrder.targetEid[m] === eid
        ) {
          BuildOrder.targetEid[m] = -1;
          world.paths.delete(m);
          clearFormationSpeedCap(world, m);
        }
      }
    }
    world.paths.delete(eid);
    clearFormationSpeedCap(world, eid);
    removeSimEntity(world, eid);
    if (recalculatePopFor !== null) recalculatePlayerPopCap(world, recalculatePopFor);
  }
}
