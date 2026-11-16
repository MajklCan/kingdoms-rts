/**
 * Research and the tech rings. A research is instant: pay, and it is done.
 * Opening a ring is automatic and free; the tick a ring opens, the player's
 * era (world.ages[p].current) moves up with the age fanfare, so building art
 * follows the highest open ring.
 */

import { hasComponent } from 'bitecs';
import { Building, ConstructionSite, Owner } from '../components';
import { BuildingDefId, canAfford, spend } from '../defs';
import {
  TechId,
  type TechIdValue,
  openRing,
  ringEra,
  techDef,
  techStatus,
} from '../tech-tree';
import { pushGameEvent, pushSoundCue } from '../core/events';
import { recordTechResearched } from '../core/match-stats';
import { getHousePopProvided, recalculatePlayerPopCap } from '../core/population';
import { buildingQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { upgradePlayerWalls } from '../core/walls';

export function applyResearchTech(world: SimWorld, playerId: number, techId: TechIdValue): void {
  const tech = techDef(techId);
  if (!tech) return;
  if (techStatus(world, playerId, techId) !== 'available') return;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, tech.cost)) return;

  const previousHousePop = getHousePopProvided(world, playerId);
  spend(bank, tech.cost);
  if (!world.researchedTechs[playerId]) world.researchedTechs[playerId] = new Set();
  world.researchedTechs[playerId].add(techId);
  if (techId === TechId.HOUSING_I || techId === TechId.HOUSING_II) {
    applyHousingPopUpgrade(world, playerId, previousHousePop);
  }
  if (techId === TechId.STONE_WALLS || techId === TechId.BRICK_WALLS) {
    // Palisade -> stone -> brick: standing walls take the new tier's hp.
    upgradePlayerWalls(world, playerId);
  }
  recordTechResearched(world, playerId);
  pushGameEvent(world, { kind: 'researchCompleted', playerId, techId });
  syncPlayerEra(world, playerId);
}

function applyHousingPopUpgrade(world: SimWorld, playerId: number, previousHousePop: number): void {
  if (getHousePopProvided(world, playerId) <= previousHousePop) return;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Building.defId[eid] !== BuildingDefId.HOUSE) continue;
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    recalculatePlayerPopCap(world, playerId);
    return;
  }
}

/**
 * Raise `playerId`'s era to its highest open ring, with the age fanfare and
 * the banner event when it moves. Never lowers it (a Total War preset keeps
 * its era). Returns true when the era changed.
 */
export function syncPlayerEra(world: SimWorld, playerId: number): boolean {
  const age = world.ages[playerId];
  if (!age) return false;
  const era = ringEra(openRing(world, playerId));
  if (era <= age.current) return false;
  age.current = era;
  // Non-spatial fanfare; render plays it only for the local player.
  pushSoundCue(world, 'age_up', 0, 0, playerId);
  pushGameEvent(world, { kind: 'ageAdvanced', playerId, ageId: era });
  return true;
}

/**
 * Catch rings opened outside the research command (scripted grants, a
 * harness adding techs): keeps every player's era equal to its open ring.
 * Gaia (player 0) researches nothing and is skipped.
 */
export function techRingSystem(world: SimWorld): void {
  for (let p = 1; p < world.ages.length; p++) {
    if (world.researchedTechs[p]?.size) syncPlayerEra(world, p);
  }
}

