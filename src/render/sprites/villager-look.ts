/**
 * Which unit-atlas look a villager is drawn with. The role comes from the sim
 * (`villagerRole`, read-only); this only maps it to the art's look names
 * (`look` in units-manifest.json, see docs/UNIT_SPRITES.md "Villager roles").
 *
 * The builder (every free villager) is the villager's default art, so it has
 * no look. Roles without art of their own borrow a near one; anything the
 * atlas lacks falls back to the default art in `UnitAtlasSource`.
 */

import { hasComponent } from 'bitecs';
import { VillagerTag } from '@sim/components';
import { villagerRole, type VillagerRole } from '@sim/core/villager-role';
import type { SimWorld } from '@sim/core/types';

/** Role -> look name in the unit manifest (undefined = default villager art). */
const ROLE_LOOK: Readonly<Record<VillagerRole, string | undefined>> = {
  builder: undefined,
  lumberjack: 'lumberjack',
  farmer: 'farmer',
  quarryman: 'quarryman',
  'gold-miner': 'gold-miner',
  // No mill art yet: millers wear the farmer's straw hat.
  miller: 'farmer',
};

/** Look name for a role (undefined = the default villager art). */
export function lookForRole(role: VillagerRole | null): string | undefined {
  return role ? ROLE_LOOK[role] : undefined;
}

/** Look name for unit `eid` (undefined for builders and every non-villager). */
export function villagerLook(world: SimWorld, eid: number): string | undefined {
  if (!hasComponent(world.ecs, VillagerTag, eid)) return undefined;
  return lookForRole(villagerRole(world, eid));
}
