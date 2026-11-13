/**
 * Building and resource node spawn helpers.
 */

import { addComponent } from 'bitecs';
import {
  AttackTarget,
  Building,
  Combat,
  ConstructionSite,
  Cooldown,
  DropOff,
  DropOffMask,
  FoundationTag,
  Health,
  Owner,
  Position,
  Producer,
  Resource,
  type ResourceKind,
  TownCenterTag,
} from '../components';
import { BUILDING_TABLE, type BuildingDef, BuildingDefId, getBuildingDef } from '../defs';
import { addSimEntity } from '../core/entities';
import { markFootprintBlocked } from '../core/grid';
import type { SimWorld } from '../core/types';
import { finaliseBuilding } from '../systems/construction';

/** Spawn a Resource node (tree, gold pile, stone pile, berry bush). */
export function spawnResource(
  world: SimWorld,
  kind: ResourceKind,
  x: number,
  y: number,
  amount: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Resource, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Resource.kind[eid] = kind;
  Resource.amount[eid] = amount;
  return eid;
}

/** Spawn a Town Center (always pre-built; acts as drop-off for all resources). */
export function spawnTownCenter(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, DropOff, eid);
  addComponent(ecs, TownCenterTag, eid);
  addComponent(ecs, Building, eid);
  addComponent(ecs, Producer, eid);
  addComponent(ecs, Health, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Owner.player[eid] = playerId;
  DropOff.acceptsMask[eid] = DropOffMask.ALL;
  Building.defId[eid] = BuildingDefId.TOWN_CENTER;
  Producer.currentProgress[eid] = 0;
  Health.hp[eid] = BUILDING_TABLE[BuildingDefId.TOWN_CENTER].hp;
  Health.hpMax[eid] = BUILDING_TABLE[BuildingDefId.TOWN_CENTER].hp;
  Health.armor[eid] = 0;
  // TC contributes pop cap.
  const tcDef = BUILDING_TABLE[BuildingDefId.TOWN_CENTER];
  world.population[playerId].cap += tcDef.popProvided;
  // Block the FULL TC footprint (3×3) - not just the centre - so units
  // can't walk underneath the visible building.
  markFootprintBlocked(world, x, y, tcDef.footprint.w, tcDef.footprint.h, true);
  return eid;
}

/**
 * Spawn a building foundation (under-construction). Buildings come into existence
 * through this path: villagers then add progress until totalTicks; finalisation
 * upgrades the entity from foundation → completed Building.
 */
export function spawnFoundation(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number {
  const def = getBuildingDef(defId);
  if (!def) throw new Error(`Unknown building defId ${defId}`);
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, Building, eid);
  addComponent(ecs, ConstructionSite, eid);
  addComponent(ecs, FoundationTag, eid);
  addComponent(ecs, Health, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Owner.player[eid] = playerId;
  Building.defId[eid] = defId;
  ConstructionSite.defId[eid] = defId;
  ConstructionSite.progress[eid] = 0;
  ConstructionSite.totalTicks[eid] = def.buildTimeTicks;
  // Foundation starts at 1 hp and grows in finaliseBuilding.
  Health.hp[eid] = 1;
  Health.hpMax[eid] = def.hp;
  Health.armor[eid] = 0;
  // Block the full footprint from the moment the foundation drops.
  markFootprintBlocked(world, x, y, def.footprint.w, def.footprint.h, true);
  return eid;
}

/** Spawn a completed building without costs or construction delay.
 *  Used by deterministic test saves and debug tooling. */
export function spawnCompletedBuilding(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number {
  const eid = spawnFoundation(world, defId, x, y, playerId);
  ConstructionSite.progress[eid] = ConstructionSite.totalTicks[eid];
  finaliseBuilding(world, eid);
  return eid;
}

export function attachBuildingCombat(world: SimWorld, eid: number, def: BuildingDef): void {
  if (!def.combat) return;
  addComponent(world.ecs, Combat, eid);
  addComponent(world.ecs, AttackTarget, eid);
  addComponent(world.ecs, Cooldown, eid);
  Combat.atk[eid] = def.combat.atk;
  Combat.range[eid] = def.combat.range;
  Combat.attackSpeedTicks[eid] = def.combat.attackSpeedTicks;
  Combat.aggroRadius[eid] = def.combat.aggroRadius;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  Cooldown.ticksRemaining[eid] = 0;
}
