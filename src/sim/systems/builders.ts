/**
 * Villager builders: walk to a foundation, stand at its edge and work on it.
 * A foundation only gains progress while at least one builder is in contact
 * (see constructionSystem), so buildings no longer raise themselves.
 */

import { defineQuery, hasComponent } from 'bitecs';
import {
  BuildOrder,
  DeadTag,
  FoundationTag,
  Health,
  Owner,
  Position,
  VillagerTag,
  WorksiteWorker,
} from '../components';
import { compareDeterministicEids, sortedEids } from '../core/entities';
import { distToBuildingEdge } from '../core/grid';
import { pathToBuildingContact } from '../core/navigation';
import { foundationQuery } from '../core/queries';
import type { SimWorld } from '../core/types';

/** Edge distance at which a villager counts as working on the foundation. */
export const BUILD_CONTACT_DISTANCE = 0.8;
/** A builder whose foundation is done (or gone) takes the next one this close. */
export const BUILDER_CHAIN_RADIUS = 10;

const builderQuery = defineQuery([BuildOrder, VillagerTag, Position, Owner]);

/** A living, unfinished foundation owned by `playerId`. */
export function isOpenFoundation(world: SimWorld, eid: number, playerId: number): boolean {
  const ecs = world.ecs;
  if (eid < 0 || !hasComponent(ecs, FoundationTag, eid)) return false;
  if (hasComponent(ecs, DeadTag, eid) || Health.hp[eid] <= 0) return false;
  return Owner.player[eid] === playerId;
}

/** Can `eid` be given a build order: a living free villager (not a worksite crew member). */
export function canBuild(world: SimWorld, eid: number): boolean {
  const ecs = world.ecs;
  if (!hasComponent(ecs, VillagerTag, eid) || !hasComponent(ecs, BuildOrder, eid)) return false;
  if (hasComponent(ecs, WorksiteWorker, eid) || hasComponent(ecs, DeadTag, eid)) return false;
  return Health.hp[eid] > 0;
}

/**
 * Construction speed for `builders` villagers in contact, as work ticks to add
 * this sim tick. One builder gives 1 per tick; each extra one adds a third
 * ((n + 2) / 3), so crews help with diminishing returns. The fraction is
 * spread over ticks from the tick number, so no extra state is saved.
 */
export function buildWorkThisTick(builders: number, tick: number): number {
  if (builders <= 0) return 0;
  const rate = builders + 2;
  return Math.floor((rate * (tick + 1)) / 3) - Math.floor((rate * tick) / 3);
}

/**
 * Advance every builder one tick and return how many stand in contact with
 * each foundation. Builders out of reach walk there; builders whose
 * foundation is finished or destroyed move on to the nearest open one.
 */
export function builderSystem(world: SimWorld): Map<number, number> {
  const inContact = new Map<number, number>();
  for (const eid of sortedEids(world, builderQuery(world.ecs))) {
    let site = BuildOrder.targetEid[eid];
    if (site < 0) continue;
    if (!canBuild(world, eid)) {
      BuildOrder.targetEid[eid] = -1;
      continue;
    }
    const playerId = Owner.player[eid];
    if (!isOpenFoundation(world, site, playerId)) {
      site = findNearestOpenFoundation(world, eid, playerId, BUILDER_CHAIN_RADIUS);
      BuildOrder.targetEid[eid] = site;
      world.paths.delete(eid);
      if (site < 0) continue;
    }
    const dist = distToBuildingEdge(world, Position.x[eid], Position.y[eid], site);
    if (dist <= BUILD_CONTACT_DISTANCE) {
      world.paths.delete(eid);
      inContact.set(site, (inContact.get(site) ?? 0) + 1);
      continue;
    }
    const path = world.paths.get(eid);
    if (path && path.length > 0) continue;
    // Walled in or otherwise unreachable: drop the order instead of
    // re-running the pathfinder every tick.
    if (!pathToBuildingContact(world, eid, site)) BuildOrder.targetEid[eid] = -1;
  }
  return inContact;
}

/** Nearest open foundation of `playerId` within `radius` tiles of `eid`, or -1. */
export function findNearestOpenFoundation(
  world: SimWorld,
  eid: number,
  playerId: number,
  radius: number
): number {
  let best = -1;
  let bestDist = radius;
  for (const site of sortedEids(world, foundationQuery(world.ecs))) {
    if (!isOpenFoundation(world, site, playerId)) continue;
    const dist = distToBuildingEdge(world, Position.x[eid], Position.y[eid], site);
    if (dist < bestDist || (dist === bestDist && best >= 0 && compareDeterministicEids(world, site, best) < 0)) {
      best = site;
      bestDist = dist;
    }
  }
  return best;
}

/** How many living builders are ordered onto `siteEid` (walking or working). */
export function countAssignedBuilders(world: SimWorld, siteEid: number): number {
  let count = 0;
  for (const eid of builderQuery(world.ecs)) {
    if (BuildOrder.targetEid[eid] === siteEid && canBuild(world, eid)) count++;
  }
  return count;
}
