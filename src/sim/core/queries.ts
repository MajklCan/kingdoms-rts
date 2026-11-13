/**
 * Shared bitECS queries.
 */

import { defineQuery } from 'bitecs';
import {
  AttackTarget,
  Building,
  Combat,
  ConstructionSite,
  Cooldown,
  DeadTag,
  DropOff,
  Gatherer,
  Health,
  Owner,
  Position,
  Producer,
  Resource,
  ResourceCarry,
  ResourceWorksite,
  Selected,
  Speed,
  TownCenterTag,
  UnitKind,
  Velocity,
  WorksiteWorker,
} from '../components';

export const positionQuery = defineQuery([Position]);
export const movableQuery = defineQuery([Position, Velocity, Speed]);
export const selectedQuery = defineQuery([Position, Selected]);
export const gathererQuery = defineQuery([Position, Gatherer, ResourceCarry]);
export const resourceQuery = defineQuery([Position, Resource]);
export const dropOffQuery = defineQuery([Position, DropOff, Owner]);
export const resourceWorksiteQuery = defineQuery([Position, ResourceWorksite, Owner, Building]);
export const worksiteWorkerQuery = defineQuery([Position, WorksiteWorker, Gatherer, Owner]);
export const townCenterQuery = defineQuery([Position, TownCenterTag, Owner]);
export const buildingQuery = defineQuery([Position, Building, Owner]);
export const foundationQuery = defineQuery([
  Position,
  Building,
  ConstructionSite,
  Owner,
]);
export const producerQuery = defineQuery([Producer, Owner]);
export const combatQuery = defineQuery([
  Position,
  Combat,
  AttackTarget,
  Cooldown,
  Owner,
  Health,
]);
export const damageableQuery = defineQuery([Position, Health, Owner]);
export const unitQuery = defineQuery([Position, UnitKind, Owner, Health]);
export const deadQuery = defineQuery([DeadTag]);
