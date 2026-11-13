/**
 * Age advancement and technology research.
 */

import { hasComponent } from 'bitecs';
import { Building, ConstructionSite, Owner } from '../components';
import { AGE_TABLE, AgeId, BuildingDefId, canAfford, getAgeDef, spend } from '../defs';
import {
  TechId,
  type TechIdValue,
  createStartingTechSet,
  hasTech,
  techDef,
  techPrereqsMet,
} from '../tech-tree';
import { pushGameEvent, pushSoundCue } from '../core/events';
import { recordTechResearched } from '../core/match-stats';
import { getHousePopProvided, recalculatePlayerPopCap } from '../core/population';
import { buildingQuery } from '../core/queries';
import type { SimWorld } from '../core/types';

export function applyAdvanceAge(world: SimWorld, playerId: number): void {
  const age = world.ages[playerId];
  if (!age) return;
  if (age.progress >= 0) return; // already advancing
  if (age.current >= AGE_TABLE.length - 1) return; // at max
  const nextDef = getAgeDef(age.current + 1);
  if (!nextDef) return;
  if (nextDef.id === AgeId.GUNPOWDER && isCampaignTechLocked(world, TechId.GUNPOWDER_AGE)) return;
  // Total War is scaffolded for unit testing and cheats, but has no live tech path yet.
  if (nextDef.id === AgeId.TOTAL_WAR) return;
  if (nextDef.id === AgeId.CASTLE && !canStartCastleAge(world, playerId)) return;
  if (nextDef.id === AgeId.GUNPOWDER && !canStartGunpowderAge(world, playerId)) return;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, nextDef.advanceCost)) return;
  spend(bank, nextDef.advanceCost);
  age.progress = 0;
  age.totalTicks = nextDef.advanceTicks;
}

export function applyResearchTech(world: SimWorld, playerId: number, techId: TechIdValue): void {
  const tech = techDef(techId);
  if (!tech) return;
  if (isCampaignTechLocked(world, techId)) return;
  if (hasTech(world, playerId, techId)) return;
  if (!techPrereqsMet(world, playerId, tech)) return;
  const bank = world.resources[playerId];
  if (!bank || !canAfford(bank, tech.cost)) return;

  if (techId === TechId.CASTLE_AGE || techId === TechId.GUNPOWDER_AGE) {
    const age = world.ages[playerId];
    const targetAge = techId === TechId.CASTLE_AGE ? AgeId.CASTLE : AgeId.GUNPOWDER;
    if (!age || age.progress >= 0 || age.current >= targetAge) return;
    spend(bank, tech.cost);
    age.progress = 0;
    age.totalTicks = AGE_TABLE[targetAge].advanceTicks;
    return;
  }

  const previousHousePop = getHousePopProvided(world, playerId);
  spend(bank, tech.cost);
  if (!world.researchedTechs[playerId]) {
    world.researchedTechs[playerId] = createStartingTechSet();
  }
  world.researchedTechs[playerId].add(techId);
  if (techId === TechId.HOUSING_I || techId === TechId.HOUSING_II) {
    applyHousingPopUpgrade(world, playerId, previousHousePop);
  }
  recordTechResearched(world, playerId);
  pushGameEvent(world, { kind: 'researchCompleted', playerId, techId });
}

function applyHousingPopUpgrade(
  world: SimWorld,
  playerId: number,
  previousHousePop: number
): void {
  const nextHousePop = getHousePopProvided(world, playerId);
  const delta = nextHousePop - previousHousePop;
  if (delta <= 0) return;
  let completedHouses = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Building.defId[eid] !== BuildingDefId.HOUSE) continue;
    if (hasComponent(world.ecs, ConstructionSite, eid)) continue;
    completedHouses++;
  }
  if (completedHouses <= 0) return;
  recalculatePlayerPopCap(world, playerId);
}

export function canStartCastleAge(world: SimWorld, playerId: number): boolean {
  const castleTech = techDef(TechId.CASTLE_AGE);
  return castleTech ? techPrereqsMet(world, playerId, castleTech) : false;
}

export function canStartGunpowderAge(world: SimWorld, playerId: number): boolean {
  if (isCampaignTechLocked(world, TechId.GUNPOWDER_AGE)) return false;
  const gunpowderTech = techDef(TechId.GUNPOWDER_AGE);
  return gunpowderTech ? techPrereqsMet(world, playerId, gunpowderTech) : false;
}

function isCampaignTechLocked(world: SimWorld, techId: TechIdValue): boolean {
  return world.campaign?.lockedTechs.includes(techId) ?? false;
}

/** Advance any in-flight age progressions by one tick. */
export function ageProgressionSystem(world: SimWorld): void {
  for (let p = 0; p < world.ages.length; p++) {
    const age = world.ages[p];
    if (age.progress < 0) continue;
    age.progress += 1;
    if (age.progress >= age.totalTicks) {
      age.current += 1;
      age.progress = -1;
      age.totalTicks = 0;
      // Non-spatial fanfare; render plays it only for the local player.
      pushSoundCue(world, 'age_up', 0, 0, p);
      pushGameEvent(world, { kind: 'ageAdvanced', playerId: p, ageId: age.current });
    }
  }
}
