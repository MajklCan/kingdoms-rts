/** Read-only per-player HUD queries: bank, population, era, tech tree and rings, mission. */

import { ResourceKindId } from '@sim/components';
import { getAgeDef } from '@sim/defs';
import type { CampaignMissionIdValue } from '@sim/campaign';
import {
  RING_PATHS_NEEDED,
  TECH_RINGS,
  TECH_TREE,
  type TechIdValue,
  type TechPath,
  type TechRing,
  isRingOpen,
  maxedPaths,
  openRing,
  pathsWithContent,
  ringEra,
  techLockedReason,
  techStatus,
} from '@sim/tech-tree';
import { pendingPopCapGain, type SimWorld } from '@sim/world';
import { canAffordCost, countQueuedPopCost, formatCost } from '../commands/economy';

export interface TechTreeNode {
  id: TechIdValue;
  name: string;
  description: string;
  /** Equal to the tech id; the UI maps it to a sheet icon. */
  icon: string;
  path: TechPath;
  ring: TechRing;
  /** All prerequisites: the same-path parent first, then any cross-path one. */
  parents: TechIdValue[];
  cost: string;
  unlocks: string[];
  /** Same as `parents` (kept for older panel code). */
  requires: TechIdValue[];
  /** Always empty: no research has alternative prerequisites any more. */
  requiresAny: TechIdValue[][];
  /** Always 0: rings, not ages, gate research now (see `ring`). */
  requiresAge: number;
  /** 'researched' | 'available' | 'locked' ('locked' also covers a closed ring). */
  status: string;
  /** Why it is locked, e.g. "Needs Gold Mining"; absent unless locked. */
  lockedReason?: string;
  affordable: boolean;
  /** Always 0: research is instant. */
  progressFrac: number;
}

export interface TechRingInfo {
  ring: TechRing;
  open: boolean;
  /** Maxed paths needed in the previous ring to open this one. */
  need: number;
  /** Paths maxed in this ring (every research of the path in this ring done). */
  maxedPaths: string[];
  /** Paths with at least one research in this ring. */
  pathsWithContent: string[];
}

export interface TechRingsView {
  openRing: TechRing;
  rings: TechRingInfo[];
}

export interface CampaignMissionInfo {
  id: CampaignMissionIdValue;
  name: string;
  description: string;
  briefing: string;
  lockedTechs: TechIdValue[];
  objectives: Array<{ id: string; label: string; optional: boolean; completed: boolean }>;
}

export function getResources(
  world: SimWorld,
  playerId: number
): { food: number; wood: number; gold: number; stone: number } {
  const r = world.resources[playerId];
  if (!r) return { food: 0, wood: 0, gold: 0, stone: 0 };
  return {
    food: r[ResourceKindId.FOOD],
    wood: r[ResourceKindId.WOOD],
    gold: r[ResourceKindId.GOLD],
    stone: r[ResourceKindId.STONE],
  };
}

/**
 * Population for the HUD: units alive, the housing cap, the places units in
 * training already hold (training is refused once alive + queued would pass
 * the cap, so the HUD must show them too), and the cap houses still under
 * construction will add once finished (not usable before that).
 */
export function getPop(
  world: SimWorld,
  playerId: number
): { current: number; cap: number; queued: number; rising: number } {
  const p = world.population[playerId];
  if (!p) return { current: 0, cap: 0, queued: 0, rising: 0 };
  return {
    current: p.current,
    cap: p.cap,
    queued: countQueuedPopCost(world, playerId),
    rising: pendingPopCapGain(world, playerId),
  };
}

/**
 * The player's era for the HUD: the age of its highest open ring, and how
 * far it is toward the next ring (paths maxed out of the two needed).
 */
export function getAge(world: SimWorld, playerId: number): {
  name: string;
  current: number;
  ring: TechRing;
  nextName: string | null;
  /** Paths maxed in the open ring toward the next one (0..need). */
  nextRingPaths: number;
  nextRingNeed: number;
  /** nextRingPaths / nextRingNeed; 0 at the last ring. */
  progressFrac: number;
} {
  const current = world.ages[playerId]?.current ?? 0;
  const ring = openRing(world, playerId);
  const atLast = ring >= 3;
  const nextRingPaths = atLast ? 0 : Math.min(RING_PATHS_NEEDED, maxedPaths(world, playerId, ring).length);
  return {
    name: getAgeDef(current)?.name ?? 'Dark Age',
    current,
    ring,
    nextName: atLast ? null : getAgeDef(ringEra((ring + 1) as TechRing))?.name ?? null,
    nextRingPaths,
    nextRingNeed: RING_PATHS_NEEDED,
    progressFrac: atLast ? 0 : nextRingPaths / RING_PATHS_NEEDED,
  };
}

export function getTechTree(world: SimWorld, playerId: number): TechTreeNode[] {
  return TECH_TREE.map((tech) => {
    const status = techStatus(world, playerId, tech.id);
    const lockedReason = status === 'locked' ? techLockedReason(world, playerId, tech.id) : undefined;
    return {
      id: tech.id,
      name: tech.name,
      description: tech.description,
      icon: tech.id,
      path: tech.path,
      ring: tech.ring,
      parents: tech.parents.slice(),
      cost: formatCost(tech.cost),
      unlocks: tech.unlocks.slice(),
      requires: tech.parents.slice(),
      requiresAny: [],
      requiresAge: 0,
      status,
      ...(lockedReason ? { lockedReason } : {}),
      affordable: canAffordCost(world, playerId, tech.cost),
      progressFrac: 0,
    };
  });
}

export function getTechRings(world: SimWorld, playerId: number): TechRingsView {
  return {
    openRing: openRing(world, playerId),
    rings: TECH_RINGS.map((ring) => ({
      ring,
      open: isRingOpen(world, playerId, ring),
      need: RING_PATHS_NEEDED,
      maxedPaths: maxedPaths(world, playerId, ring),
      pathsWithContent: pathsWithContent(ring),
    })),
  };
}

export function getCampaignMission(world: SimWorld): CampaignMissionInfo | null {
  const campaign = world.campaign;
  if (!campaign) return null;
  return {
    id: campaign.missionId,
    name: campaign.name,
    description: campaign.description,
    briefing: campaign.briefing,
    lockedTechs: campaign.lockedTechs.slice(),
    objectives: campaign.objectives.map((objective) => ({ ...objective })),
  };
}
