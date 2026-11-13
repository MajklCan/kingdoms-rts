/**
 * Unit spawn helpers.
 */

import { addComponent } from 'bitecs';
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

/** Spawn an Archer at tile (x,y) owned by playerId. */
export function spawnArcher(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, ArcherTag, eid);
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
  Speed.value[eid] = 2.25;
  UnitKind.kind[eid] = UnitKindId.ARCHER;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 35;
  Health.hpMax[eid] = 35;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 5;
  Combat.range[eid] = 5;
  Combat.attackSpeedTicks[eid] = 30;
  Combat.aggroRadius[eid] = 7;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Spearman at tile (x,y) owned by playerId. */
export function spawnSpearman(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, SpearmanTag, eid);
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
  Speed.value[eid] = 2.1;
  UnitKind.kind[eid] = UnitKindId.SPEARMAN;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 55;
  Health.hpMax[eid] = 55;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 5;
  Combat.range[eid] = 0.65;
  Combat.attackSpeedTicks[eid] = 25;
  Combat.aggroRadius[eid] = 6;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Scout Cavalry at tile (x,y) owned by playerId. */
export function spawnScoutCavalry(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, ScoutCavalryTag, eid);
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
  Speed.value[eid] = 3.45;
  UnitKind.kind[eid] = UnitKindId.SCOUT_CAVALRY;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 60;
  Health.hpMax[eid] = 60;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 6;
  Combat.range[eid] = 1;
  Combat.attackSpeedTicks[eid] = 22;
  Combat.aggroRadius[eid] = 7;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Gunpowder Age gunman at tile (x,y) owned by playerId. */
export function spawnGunman(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, GunmanTag, eid);
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
  Speed.value[eid] = 1.9;
  UnitKind.kind[eid] = UnitKindId.GUNMAN;
  PopulationCost.value[eid] = 1;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 45;
  Health.hpMax[eid] = 45;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 14;
  Combat.range[eid] = 5.5;
  Combat.attackSpeedTicks[eid] = 45;
  Combat.aggroRadius[eid] = 7;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 1;
  return eid;
}

/** Spawn a Gunpowder Age field cannon at tile (x,y) owned by playerId. */
export function spawnCannon(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, CannonTag, eid);
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
  Speed.value[eid] = 1.05;
  UnitKind.kind[eid] = UnitKindId.CANNON;
  PopulationCost.value[eid] = 3;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 120;
  Health.hpMax[eid] = 120;
  Health.armor[eid] = 1;
  Combat.atk[eid] = 65;
  Combat.range[eid] = 8.5;
  Combat.attackSpeedTicks[eid] = 110;
  Combat.aggroRadius[eid] = 9;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 3;
  return eid;
}

/** Spawn a Total War Age machine gun team at tile (x,y) owned by playerId. */
export function spawnMachineGun(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, MachineGunTag, eid);
  addComponent(ecs, MachineGunDeployment, eid);
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
  Speed.value[eid] = 1.55;
  UnitKind.kind[eid] = UnitKindId.MACHINE_GUN;
  PopulationCost.value[eid] = 2;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 70;
  Health.hpMax[eid] = 70;
  Health.armor[eid] = 0;
  Combat.atk[eid] = 9;
  Combat.range[eid] = 6.5;
  Combat.attackSpeedTicks[eid] = 3;
  Combat.aggroRadius[eid] = 8;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  MachineGunDeployment.deployed[eid] = 1;
  MachineGunDeployment.setupTicks[eid] = 0;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 2;
  return eid;
}

/** Spawn a Total War Age mortar team at tile (x,y) owned by playerId. */
export function spawnMortar(
  world: SimWorld,
  x: number,
  y: number,
  playerId: number
): number {
  const { ecs } = world;
  const eid = addSimEntity(world);
  addComponent(ecs, Position, eid);
  addComponent(ecs, Velocity, eid);
  addComponent(ecs, Speed, eid);
  addComponent(ecs, UnitKind, eid);
  addComponent(ecs, PopulationCost, eid);
  addComponent(ecs, Owner, eid);
  addComponent(ecs, MortarTag, eid);
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
  Speed.value[eid] = 1.2;
  UnitKind.kind[eid] = UnitKindId.MORTAR;
  PopulationCost.value[eid] = 2;
  Owner.player[eid] = playerId;
  Health.hp[eid] = 55;
  Health.hpMax[eid] = 55;
  Health.armor[eid] = 0;
  // Longest reach in the game (out-ranges MG 6.5 and Cannon 8.5) with arcing
  // splash; slow reload and the cavalry counter keep it honest.
  Combat.atk[eid] = 40;
  Combat.range[eid] = 10;
  Combat.attackSpeedTicks[eid] = 85;
  Combat.aggroRadius[eid] = 10;
  AttackTarget.targetEid[eid] = -1;
  AttackTarget.retainGoal[eid] = 0;
  UnitStance.stance[eid] = UnitStanceId.AUTO_DEFEND;
  UnitStance.anchorX[eid] = x;
  UnitStance.anchorY[eid] = y;
  Cooldown.ticksRemaining[eid] = 0;
  world.population[playerId].current += 2;
  return eid;
}
