/**
 * Unit spawn helpers. Military units are table-driven: a new unit is one
 * MilitaryUnitSpec plus one MILITARY_UNIT_SPECS entry keyed by its UnitDefId.
 */

import { addComponent, type Component } from 'bitecs';
import {
  ArcherTag,
  AttackMoveGoal,
  AttackTarget,
  BuildOrder,
  CannonTag,
  Combat,
  Cooldown,
  Gatherer,
  GathererStateId,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MortarTag,
  Owner,
  PopulationCost,
  Position,
  PrevPosition,
  ResourceCarry,
  ScoutCavalryTag,
  SpearmanTag,
  Speed,
  UnitKind,
  UnitKindId,
  UnitStance,
  UnitStanceId,
  Velocity,
  VillagerTag,
} from '../components';
import { UnitDefId } from '../defs';
import { addSimEntity } from '../core/entities';
import type { SimWorld } from '../core/types';

/** Spawn a Villager at tile (x,y) owned by playerId. Returns the new eid. */
export function spawnVillager(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number,
  popCost = 1
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, VillagerTag, eid);
  addComponent(ecs, Gatherer, eid);
  addComponent(ecs, ResourceCarry, eid);

  addComponent(ecs, BuildOrder, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = 2.5;
  UnitKind.kind[eid] = UnitKindId.VILLAGER;
  PopulationCost.value[eid] = popCost;
  Owner.player[eid] = playerId;
  Gatherer.targetEid[eid] = -1;
  Gatherer.state[eid] = GathererStateId.IDLE;
  Gatherer.cooldown[eid] = 0;
  ResourceCarry.kind[eid] = 0;
  ResourceCarry.amount[eid] = 0;
  BuildOrder.targetEid[eid] = -1;
  Health.hp[eid] = 25;
  Health.hpMax[eid] = 25;
  Health.armor[eid] = 0;
  // Villagers can defend themselves weakly.
  Combat.atk[eid] = 1;
  Combat.range[eid] = 1;
  Combat.attackSpeedTicks[eid] = 30;
  Combat.aggroRadius[eid] = 0; // villagers don't auto-aggro
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  Cooldown.ticksRemaining[eid] = 0;
  // Count toward population.
  world.population[playerId].current += popCost;
  return eid;
}

/** Spawn-time stats of a military unit. UNIT_TABLE in defs.ts carries costs,
 *  train times and unlocks; these are the live combat numbers. */
interface MilitaryUnitSpec {
  /** Kind tag component (ArcherTag, CannonTag, ...). */
  tag: Component;
  kind: number;
  speed: number;
  popCost: number;
  hp: number;
  armor: number;
  atk: number;
  range: number;
  attackSpeedTicks: number;
  aggroRadius: number;
  /** Machine guns carry a deploy/pack-up state (MachineGunDeployment). */
  deployable?: boolean;
}

const ARCHER_SPEC: MilitaryUnitSpec = {
  tag: ArcherTag, kind: UnitKindId.ARCHER, speed: 2.25, popCost: 1,
  hp: 35, armor: 0, atk: 5, range: 5, attackSpeedTicks: 30, aggroRadius: 7,
};
const SPEARMAN_SPEC: MilitaryUnitSpec = {
  tag: SpearmanTag, kind: UnitKindId.SPEARMAN, speed: 2.1, popCost: 1,
  hp: 55, armor: 0, atk: 5, range: 0.65, attackSpeedTicks: 25, aggroRadius: 6,
};
const SCOUT_CAVALRY_SPEC: MilitaryUnitSpec = {
  tag: ScoutCavalryTag, kind: UnitKindId.SCOUT_CAVALRY, speed: 3.45, popCost: 1,
  hp: 60, armor: 0, atk: 6, range: 1, attackSpeedTicks: 22, aggroRadius: 7,
};
const GUNMAN_SPEC: MilitaryUnitSpec = {
  tag: GunmanTag, kind: UnitKindId.GUNMAN, speed: 1.9, popCost: 1,
  hp: 45, armor: 0, atk: 14, range: 5.5, attackSpeedTicks: 45, aggroRadius: 7,
};
const CANNON_SPEC: MilitaryUnitSpec = {
  tag: CannonTag, kind: UnitKindId.CANNON, speed: 1.05, popCost: 3,
  hp: 120, armor: 1, atk: 65, range: 8.5, attackSpeedTicks: 110, aggroRadius: 9,
};
const MACHINE_GUN_SPEC: MilitaryUnitSpec = {
  tag: MachineGunTag, kind: UnitKindId.MACHINE_GUN, speed: 1.55, popCost: 2,
  hp: 70, armor: 0, atk: 9, range: 6.5, attackSpeedTicks: 3, aggroRadius: 8,
  deployable: true,
};
/** Longest reach in the game (out-ranges MG 6.5 and Cannon 8.5) with arcing
 *  splash; slow reload and the cavalry counter keep it honest. */
const MORTAR_SPEC: MilitaryUnitSpec = {
  tag: MortarTag, kind: UnitKindId.MORTAR, speed: 1.2, popCost: 2,
  hp: 55, armor: 0, atk: 40, range: 10, attackSpeedTicks: 85, aggroRadius: 10,
};

/** Trainable military units by UnitDefId (villager and legacy militia excluded). */
const MILITARY_UNIT_SPECS: ReadonlyMap<number, MilitaryUnitSpec> = new Map([
  [UnitDefId.ARCHER, ARCHER_SPEC],
  [UnitDefId.SPEARMAN, SPEARMAN_SPEC],
  [UnitDefId.SCOUT_CAVALRY, SCOUT_CAVALRY_SPEC],
  [UnitDefId.GUNMAN, GUNMAN_SPEC],
  [UnitDefId.CANNON, CANNON_SPEC],
  [UnitDefId.MACHINE_GUN, MACHINE_GUN_SPEC],
  [UnitDefId.MORTAR, MORTAR_SPEC],
]);

/**
 * Spawn a military unit at tile (x,y) owned by playerId. Component add order
 * is part of the determinism contract (query membership order): keep it.
 */
function spawnMilitaryUnit(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number,
  spec: MilitaryUnitSpec
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, spec.tag, eid);
  if (spec.deployable) addComponent(ecs, MachineGunDeployment, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Combat, eid);
  addComponent(ecs, AttackTarget, eid);
  addComponent(ecs, AttackMoveGoal, eid);
  addComponent(ecs, UnitStance, eid);
  addComponent(ecs, Cooldown, eid);
  addComponent(ecs, PrevPosition, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Speed.value[eid] = spec.speed;
  UnitKind.kind[eid] = spec.kind;
  PopulationCost.value[eid] = spec.popCost;
  Owner.player[eid] = playerId;
  Health.hp[eid] = spec.hp;
  Health.hpMax[eid] = spec.hp;
  Health.armor[eid] = spec.armor;
  Combat.atk[eid] = spec.atk;
  Combat.range[eid] = spec.range;
  Combat.attackSpeedTicks[eid] = spec.attackSpeedTicks;
  Combat.aggroRadius[eid] = spec.aggroRadius;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  if (spec.deployable) {
    MachineGunDeployment.deployed[eid] = 1;
    MachineGunDeployment.setupTicks[eid] = 0;
  }
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += spec.popCost;
  return eid;
}

/** Spawn the military unit trained as `defId`; null when defId is not a
 *  trainable military unit (villager, legacy militia, unknown). */
export function spawnMilitaryUnitByDefId(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  playerId: number
): number | null {
  const spec = MILITARY_UNIT_SPECS.get(defId);
  return spec ? spawnMilitaryUnit(world, x, y, playerId, spec) : null;
}

/** Spawn an Archer at tile (x,y) owned by playerId. */
export function spawnArcher(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, ARCHER_SPEC);
}

/** Spawn a Spearman at tile (x,y) owned by playerId. */
export function spawnSpearman(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, SPEARMAN_SPEC);
}

/** Spawn a Scout Cavalry at tile (x,y) owned by playerId. */
export function spawnScoutCavalry(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, SCOUT_CAVALRY_SPEC);
}

/** Spawn a Gunpowder Age gunman at tile (x,y) owned by playerId. */
export function spawnGunman(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, GUNMAN_SPEC);
}

/** Spawn a Gunpowder Age field cannon at tile (x,y) owned by playerId. */
export function spawnCannon(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, CANNON_SPEC);
}

/** Spawn a Total War Age machine gun team at tile (x,y) owned by playerId. */
export function spawnMachineGun(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, MACHINE_GUN_SPEC);
}

/** Spawn a Total War Age mortar team at tile (x,y) owned by playerId. */
export function spawnMortar(world: SimWorld, x: number, y: number, playerId: number): number {
  return spawnMilitaryUnit(world, x, y, playerId, MORTAR_SPEC);
}

