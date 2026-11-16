/**
 * Status line text for a selected villager: what he is doing, in words.
 * Reads the sim's villagerJob; render-only.
 */

import { hasComponent } from 'bitecs';
import { Building, GameAnimal, GameSpeciesId, ResourceCarry } from '@sim/components';
import { BUILDING_TABLE } from '@sim/defs';
import { WORKSITE_EXTRA_HELPER_RATE_PERCENT, villagerJob, type SimWorld } from '@sim/world';
import { resourceKindName } from './selection-info';

/** "building House", "helping at Farm", "hunting deer (4/10)", "idle"... or null for a non-villager. */
export function villagerStatusText(world: SimWorld, eid: number): string | null {
  const job = villagerJob(world, eid);
  if (!job) return null;
  const carry = hasComponent(world.ecs, ResourceCarry, eid) ? ResourceCarry.amount[eid] : 0;
  // The carried kind is named so the carry meter picks the right icon.
  const load = carry > 0 ? ` (${carry}/10 ${resourceKindName(ResourceCarry.kind[eid])})` : '';
  switch (job.job) {
    case 'building':
      return `building ${buildingName(world, job.siteEid)}`;
    case 'helping':
      return `helping at ${buildingName(world, job.siteEid)}${
        job.extra ? ` (extra hand, ${WORKSITE_EXTRA_HELPER_RATE_PERCENT}%)` : ''
      }${load}`;
    case 'crew':
      return `working at ${buildingName(world, job.siteEid)}${load}`;
    case 'hunting':
      return `hunting ${gameName(world, job.targetEid)}${load}`;
    case 'gathering':
      return `gathering ${resourceKindName(job.kind)}${load}`;
    case 'fighting':
      return 'fighting';
    case 'walking':
      return carry > 0 ? `walking${load}` : 'walking';
    case 'idle':
      return carry > 0 ? `idle${load}` : 'idle';
  }
}

function buildingName(world: SimWorld, eid: number): string {
  if (eid < 0 || !hasComponent(world.ecs, Building, eid)) return 'a building';
  return BUILDING_TABLE[Building.defId[eid]]?.name ?? 'a building';
}

function gameName(world: SimWorld, eid: number): string {
  if (eid < 0 || !hasComponent(world.ecs, GameAnimal, eid)) return 'game';
  return GameAnimal.species[eid] === GameSpeciesId.BOAR ? 'boar' : 'deer';
}
