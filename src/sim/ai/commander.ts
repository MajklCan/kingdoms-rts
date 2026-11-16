/**
 * AI commander: one veteran per AI player, bought once the army is massing.
 * The one-alive cap is enforced by aiQueueUnit (unit-limits), so this only
 * decides when to try. No rng, snapshot order only.
 */

import { Building } from '../components';
import { BuildingDefId, UnitDefId } from '../defs';
import type { SimWorld } from '../core/types';
import { aiDifficultyOf } from './difficulty';
import { aiQueueUnit } from './placement';
import { type AiSnapshot, aiIsCompletedBuilding } from './snapshot';

/** Army size at which the AI starts spending on a commander. */
export const AI_COMMANDER_MIN_ARMY = 6;

export function aiMaybeTrainCommander(
  world: SimWorld,
  playerId: number,
  snapshot: AiSnapshot
): void {
  if (aiDifficultyOf(world) === 'easy') return;
  if (world.aiPlayers[playerId]?.plan !== 'massing') return;
  if (snapshot.myMilitary.length < AI_COMMANDER_MIN_ARMY) return;
  for (const producerEid of snapshot.myBuildings) {
    if (Building.defId[producerEid] !== BuildingDefId.BARRACKS) continue;
    if (!aiIsCompletedBuilding(world, producerEid)) continue;
    if (aiQueueUnit(world, producerEid, UnitDefId.COMMANDER)) return;
  }
}
