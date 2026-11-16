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

/** Work anims of a crew role, in the art's own names (see docs/UNIT_SPRITES.md). */
const ROLE_WORK: Readonly<Record<VillagerRole, readonly string[]>> = {
  builder: ['build'],
  lumberjack: ['chop'],
  // Two ways to tend a field: mow with a scythe, or water the rows.
  farmer: ['farm', 'water'],
  quarryman: ['mine'],
  'gold-miner': ['mine'],
  miller: ['farm', 'water'],
};

/**
 * Work anim a crew member plays while he works at his site. `variant` is any
 * stable number of that worker (his NetId): a farmer keeps mowing or watering,
 * and a field's crew mixes both. Render-side only, no sim state.
 */
export function roleWorkAnim(role: VillagerRole, variant: number): string {
  const anims = ROLE_WORK[role];
  return anims[Math.abs(Math.trunc(variant) * 2654435761 % 7919) % anims.length] ?? anims[0];
}

/** Every work anim a role can play (tests and art checks). */
export function roleWorkAnims(role: VillagerRole): readonly string[] {
  return ROLE_WORK[role];
}
