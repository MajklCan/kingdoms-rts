/**
 * Save v3 -> v4: from age research to the tech rings.
 *
 * - A saved age becomes its starting preset: Castle = all of ring I,
 *   Gunpowder = rings I and II, Total War = every research.
 * - Researches that still exist keep their id. The old starting researches
 *   (lumber_huts, stone_mines) and the age researches are dropped.
 * - Unlocks that moved go with the research that used to bring them: the old
 *   Barracks research brought palisades (now Palisades), the old Archers
 *   research the defensive tower (now Watchtowers).
 * - An age advance in progress is dropped and its fee refunded.
 * - The era is raised to the highest ring the migrated researches open.
 * - A campaign that locked the Gunpowder (Castle) Age locks ring III (II).
 * - Gaia researches nothing.
 */

import { AgeId } from '../defs';
import {
  TechId,
  type TechIdValue,
  createStartingTechSetForAge,
  isTechId,
  openRing,
  ringEra,
  techIdsInRing,
} from '../tech-tree';
import type { SavedCampaignV1, SavedCampaignV4, SavedGameV3, SavedGameV4 } from './schema';

/** What advancing into each age cost before the rings ([food, wood, gold, stone]). */
const LEGACY_ADVANCE_COST: Record<number, readonly [number, number, number, number]> = {
  [AgeId.CASTLE]: [0, 750, 0, 500],
  [AgeId.GUNPOWDER]: [0, 1400, 1200, 1000],
  [AgeId.TOTAL_WAR]: [1600, 1800, 1800, 1400],
};

/** Old research -> the researches that now hold what it unlocked. */
const LEGACY_UNLOCK_GRANTS: Record<string, TechIdValue[]> = {
  [TechId.BARRACKS_PIKEMEN]: [TechId.PALISADES],
  [TechId.ARCHERS]: [TechId.WATCHTOWERS],
};

/** Old age research ids, mapped to the ring they kept shut when locked. */
const LEGACY_AGE_LOCKS: Record<string, 2 | 3> = { castle_age: 2, gunpowder_age: 3 };

export function migrateResearchV3(
  saved: readonly string[] | undefined,
  ageId: number
): Set<TechIdValue> {
  const techs = createStartingTechSetForAge(ageId);
  for (const id of saved ?? []) {
    if (!isTechId(id)) continue;
    techs.add(id);
    for (const granted of LEGACY_UNLOCK_GRANTS[id] ?? []) techs.add(granted);
  }
  return techs;
}

export function migrateLockedTechsV3(locked: readonly string[]): TechIdValue[] {
  const out = new Set<TechIdValue>();
  for (const id of locked) {
    const ring = LEGACY_AGE_LOCKS[id];
    if (ring !== undefined) {
      for (let r = ring; r <= 3; r++) for (const tech of techIdsInRing(r as 2 | 3)) out.add(tech);
    } else if (isTechId(id)) {
      out.add(id);
    }
  }
  return [...out];
}

function migrateCampaign(campaign: SavedCampaignV1 | null | undefined): SavedCampaignV4 | null | undefined {
  if (!campaign) return campaign;
  return { ...campaign, lockedTechs: migrateLockedTechsV3(campaign.lockedTechs ?? []) };
}

export function migrateSaveV3ToV4(save: SavedGameV3): SavedGameV4 {
  const resources = save.resources.map((bank) => bank.slice());
  const campaign = migrateCampaign(save.campaign);
  const researchedTechs = save.ages.map((age, playerId) =>
    playerId === 0 ? new Set<TechIdValue>() : migrateResearchV3(save.researchedTechs?.[playerId], age.current)
  );
  // Players past the saved ages list (never in practice) research nothing.
  while (researchedTechs.length < resources.length) researchedTechs.push(new Set());
  const ringWorld = {
    researchedTechs,
    ages: save.ages.map((age) => ({ current: age.current })),
    campaign: campaign ? { lockedTechs: campaign.lockedTechs } : null,
  };
  const ages = save.ages.map((age, playerId) => {
    const refund = age.progress >= 0 ? LEGACY_ADVANCE_COST[age.current + 1] : undefined;
    const bank = resources[playerId];
    if (refund && bank) for (let i = 0; i < 4; i++) bank[i] = (bank[i] ?? 0) + refund[i];
    const era = playerId === 0 ? AgeId.DARK : ringEra(openRing(ringWorld, playerId));
    return { current: Math.max(age.current, era) };
  });
  return {
    ...save,
    version: 4,
    resources,
    ages,
    researchedTechs: researchedTechs.map((set) => [...set]),
    campaign,
  };
}
