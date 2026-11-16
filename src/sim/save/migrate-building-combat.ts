/**
 * Saves written before a building learned to shoot hold that building without
 * its combat data (the town center got the tower's arrows after v4 shipped).
 * Give every finished building whose def is armed the def's attack, so an old
 * save defends itself like a new match. Saves that already carry the data,
 * foundations and unarmed buildings pass through untouched, which is why this
 * needs no save version of its own.
 */

import { getBuildingDef } from '../defs';
import type { SavedEntityV1 } from './schema';

export function armSavedBuildings<T extends { entities: SavedEntityV1[] }>(save: T): T {
  if (!save.entities.some(needsCombat)) return save;
  return { ...save, entities: save.entities.map((entity) => (needsCombat(entity) ? armed(entity) : entity)) };
}

function needsCombat(entity: SavedEntityV1): boolean {
  if (!entity.building || entity.constructionSite || entity.foundation || entity.combat) return false;
  return getBuildingDef(entity.building.defId)?.combat !== undefined;
}

function armed(entity: SavedEntityV1): SavedEntityV1 {
  const combat = getBuildingDef(entity.building!.defId)!.combat!;
  return {
    ...entity,
    combat: { ...combat },
    attackTarget: entity.attackTarget ?? { targetEid: -1, retainGoal: 0 },
    cooldown: entity.cooldown ?? { ticksRemaining: 0 },
  };
}
