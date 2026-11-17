/**
 * Save v3 -> v4: from age research to the tech rings (v4 -> v5 and v5 -> v6
 * at the end).
 *
 * - A saved age becomes its starting preset: Castle = all of ring I,
 *   Gunpowder = rings I and II, Total War = every research.
 * - Researches that still exist keep their id. The old starting researches
 *   (lumber_huts, stone_mines) and the age researches are dropped.
 * - Unlocks that moved go with the research that used to bring them: the old
 *   Barracks research brought palisades (now Palisades) and the Commander
 *   (now his own research), the old Archers research the defensive tower
 *   (now Towers).
 * - An age advance in progress is dropped and its fee refunded.
 * - The era is raised to the highest ring the migrated researches open.
 * - A campaign that locked the Gunpowder (Castle) Age locks ring III (II).
 * - Gaia researches nothing.
 */

import { AgeId } from '../defs';
import {
  TechId,
  type TechIdValue,
  type TechRing,
  type TechStateWorld,
  createStartingTechSetForAge,
  isRingOpen,
  isTechId,
  openRing,
  ringEra,
  techDef,
  techIdsInRing,
} from '../tech-tree';
import type { SavedCampaignV1, SavedCampaignV4, SavedGameV3, SavedGameV4, SavedGameV5, SavedGameV6 } from './schema';

/** What advancing into each age cost before the rings ([food, wood, gold, stone]). */
const LEGACY_ADVANCE_COST: Record<number, readonly [number, number, number, number]> = {
  [AgeId.CASTLE]: [0, 750, 0, 500],
  [AgeId.GUNPOWDER]: [0, 1400, 1200, 1000],
  [AgeId.TOTAL_WAR]: [1600, 1800, 1800, 1400],
};

/** Old research -> the researches that now hold what it unlocked. */
const LEGACY_UNLOCK_GRANTS: Record<string, TechIdValue[]> = {
  // The old Barracks research also brought the Commander (roles branch).
  [TechId.BARRACKS_PIKEMEN]: [TechId.PALISADES, TechId.COMMANDER],
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

/**
 * Save v4 (rings) -> v5: the Commander became a ring I research under
 * Barracks. A realm with Barracks gets it, so an arms path that was complete
 * in ring I stays complete and no open ring closes. Entities need nothing:
 * the roles fields (helpers, work memory, game) are optional.
 */
export function migrateSaveV4ToV5(save: SavedGameV4): SavedGameV5 {
  const researchedTechs = (save.researchedTechs ?? []).map((ids) =>
    ids.includes(TechId.BARRACKS_PIKEMEN) && !ids.includes(TechId.COMMANDER) ? [...ids, TechId.COMMANDER] : ids.slice()
  );
  return { ...save, version: 5, researchedTechs };
}

/**
 * Save v5 -> v6: Cavalry moved from ring II into ring I, as a branch after
 * Barracks, so the arms path is complete in ring I only with it and has no
 * ring II content any more. A realm keeps the rings its era says it had:
 *  - ring II open but closed for want of Cavalry alone: it gets Cavalry, as
 *    the Commander was granted in v5;
 *  - ring III open through arms (old ring II Cavalry) and one other path: it
 *    gets the ring II research of another path that needs the fewest grants
 *    (with any missing parents), first in tree order on a tie.
 * Nothing is granted when the grants would not reopen the ring. The night
 * flag and Shift-queued orders are new optional fields: absent means a day
 * match and nothing queued.
 */
export function migrateSaveV5ToV6(save: SavedGameV5): SavedGameV6 {
  const researched = (save.researchedTechs ?? []).map((ids) => new Set<TechIdValue>(ids));
  const ringWorld = {
    researchedTechs: researched,
    ages: (save.ages ?? []).map((age) => ({ current: age.current })),
    campaign: save.campaign ? { lockedTechs: save.campaign.lockedTechs ?? [] } : null,
  };
  researched.forEach((techs, playerId) => {
    if (playerId === 0) return;
    const era = ringWorld.ages[playerId]?.current ?? AgeId.DARK;
    if (era >= ringEra(2) && techs.has(TechId.ARCHERS) && !isRingOpen(ringWorld, playerId, 2)) {
      grantIfReopens(ringWorld, playerId, 2, [TechId.KNIGHTS]);
    }
    if (era >= ringEra(3) && isRingOpen(ringWorld, playerId, 2) && !isRingOpen(ringWorld, playerId, 3)) {
      const options = techIdsInRing(2)
        .filter((id) => !techs.has(id) && !isCampaignLockedId(ringWorld, id))
        .map((id) => withMissingParents(techs, id));
      const fewest = options.reduce<TechIdValue[] | null>((best, ids) => (best && best.length <= ids.length ? best : ids), null);
      if (fewest) grantIfReopens(ringWorld, playerId, 3, fewest);
    }
  });
  return { ...save, version: 6, researchedTechs: researched.map((set) => [...set]) };
}

/** Add `ids` to the realm's research, and take them back if `ring` stays shut. */
function grantIfReopens(world: TechStateWorld, playerId: number, ring: TechRing, ids: TechIdValue[]): void {
  const techs = world.researchedTechs[playerId];
  const added = ids.filter((id) => !techs.has(id));
  for (const id of added) techs.add(id);
  if (!isRingOpen(world, playerId, ring)) for (const id of added) techs.delete(id);
}

/** `id` and every ancestor the realm has not researched, parents first. */
function withMissingParents(techs: Set<TechIdValue>, id: TechIdValue): TechIdValue[] {
  const out: TechIdValue[] = [];
  const visit = (techId: TechIdValue) => {
    if (techs.has(techId) || out.includes(techId)) return;
    for (const parent of techDef(techId)?.parents ?? []) visit(parent);
    out.push(techId);
  };
  visit(id);
  return out;
}

function isCampaignLockedId(world: TechStateWorld, id: TechIdValue): boolean {
  return world.campaign?.lockedTechs.includes(id) ?? false;
}
