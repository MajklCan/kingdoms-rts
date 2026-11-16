/**
 * Which anim a villager plays: a pure function of his state, so a test can walk
 * every role and Gatherer state and prove a crew member never falls back to the
 * builder's art when his own look has the work.
 *
 * Worksite crews (farm, camp, mine, quarry) work in Gatherer state BUILDING.
 * That state means "tend the site", not "construct", so a crew member plays his
 * role's own work anim there. Only a free villager (the builder) plays 'build'.
 */

import { roleWorkAnim } from '../sprites/villager-look';
import type { VillagerRole } from '@sim/core/villager-role';

/** Gatherer state ids the pick cares about (see GathererStateId). */
export type VillagerWorkState = 'gathering' | 'building' | 'depositing' | 'other' | 'none';

export interface VillagerAnimInput {
  role: VillagerRole | null;
  /** Stable per-worker number (his NetId) that picks between a role's work variants. */
  variant: number;
  moving: boolean;
  /** A builder standing at his foundation. */
  atBuildSite: boolean;
  state: VillagerWorkState;
  /** Work anim of the gather target (chop, mine, farm, forage, harvest). */
  gatherWork: string;
  /** Anim for what he carries, or null when his hands are empty. */
  carry: string | null;
  /** Does the art he is drawn with have this exact anim (or its alias)? */
  owns: (anim: string) => boolean;
}

export function pickVillagerAnim(i: VillagerAnimInput): string {
  const crew = i.role !== null && i.role !== 'builder';
  if (i.atBuildSite) return 'build';
  if (i.state === 'gathering') {
    // A farm's two ways to tend it: both are the farmer's own art.
    if (crew && i.gatherWork === 'farm') return roleWorkAnim(i.role as VillagerRole, i.variant);
    return i.owns(i.gatherWork) ? i.gatherWork : 'harvest';
  }
  if (i.state === 'building') return crew ? roleWorkAnim(i.role as VillagerRole, i.variant) : 'build';
  if ((i.moving || i.state === 'depositing') && i.carry) return i.carry;
  return i.moving ? 'move' : 'idle';
}
