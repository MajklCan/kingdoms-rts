/** Read-only per-player HUD queries: bank, population, age, tech tree, mission. */

import { ResourceKindId } from '@sim/components';
import { getAgeDef } from '@sim/defs';
import type { CampaignMissionIdValue } from '@sim/campaign';
import { TECH_TREE, techStatus, type TechIdValue } from '@sim/tech-tree';
import { pendingPopCapGain, type SimWorld } from '@sim/world';
import { canAffordCost, countQueuedPopCost, formatCost, nextAgeTechId } from '../commands/economy';

export interface TechTreeNode {
  id: TechIdValue;
  name: string;
  description: string;
  icon: string;
  path: string;
  x: number;
  y: number;
  cost: string;
  unlocks: string[];
  requires: TechIdValue[];
  requiresAny: TechIdValue[][];
  status: string;
  affordable: boolean;
  progressFrac: number;
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

export function getAge(world: SimWorld, playerId: number): {
  name: string;
  current: number;
  progressFrac: number;
  nextName: string | null;
  advancing: boolean;
} {
  const age = world.ages[playerId];
  if (!age) {
    return { name: 'Dark Age', current: 0, progressFrac: 0, nextName: null, advancing: false };
  }
  const def = getAgeDef(age.current);
  const nextDef = getAgeDef(age.current + 1);
  const advancing = age.progress >= 0;
  return {
    name: def?.name ?? 'Dark Age',
    current: age.current,
    progressFrac: advancing && age.totalTicks > 0 ? age.progress / age.totalTicks : 0,
    nextName: nextDef?.name ?? null,
    advancing,
  };
}

export function getTechTree(world: SimWorld, playerId: number): TechTreeNode[] {
  const age = world.ages[playerId];
  const ageTech = nextAgeTechId(world, playerId);
  return TECH_TREE.filter((tech) => tech.path !== 'start').map((tech) => ({
    id: tech.id,
    name: tech.name,
    description: tech.description,
    icon: tech.icon,
    path: tech.path,
    x: tech.x,
    y: tech.y,
    cost: formatCost(tech.cost),
    unlocks: tech.unlocks,
    requires: tech.requires ?? [],
    requiresAny: tech.requiresAny ?? [],
    status: techStatus(world, playerId, tech.id),
    affordable: canAffordCost(world, playerId, tech.cost),
    progressFrac:
      tech.id === ageTech && age && age.progress >= 0 && age.totalTicks > 0
        ? age.progress / age.totalTicks
        : 0,
  }));
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
