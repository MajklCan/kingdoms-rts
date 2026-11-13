/**
 * Selection-relative inputs (moveSelected, attackSelected, ...) read the
 * Selected component, which is client-local, and act for LOCAL_PLAYER_ID. They
 * are fine for single-player but meaningless to a peer. toSelfDescribingInput
 * rewrites them into their cmd* equivalents that carry the player id and the
 * exact entity list. The render command layer and the multiplayer session
 * both call this, so every networked command is translated the same way.
 */

import { hasComponent } from 'bitecs';
import { Owner, WorksiteWorker } from '../components';
import { sortedEids } from '../core/entities';
import { selectedQuery } from '../core/queries';
import type { SimInput, SimWorld } from '../core/types';

/** Selected entities `playerId` may command: owned, not worksite workers.
 *  Ascending eid order, same as the sim's own iteration. */
export function selectedCommandableEids(world: SimWorld, playerId: number): number[] {
  const out: number[] = [];
  for (const eid of sortedEids(world, selectedQuery(world.ecs))) {
    if (hasComponent(world.ecs, WorksiteWorker, eid)) continue;
    if (hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId) out.push(eid);
  }
  return out;
}

export type SelectionRelativeInput = Extract<
  SimInput,
  {
    type:
      | 'moveSelected'
      | 'gatherSelected'
      | 'stopSelected'
      | 'toggleSelectedUnitStance'
      | 'setSelectedUnitStance'
      | 'setFormationMode'
      | 'adjustFormationMode'
      | 'rotateSelectedFormation'
      | 'reformSelectedFormation'
      | 'attackSelected'
      | 'attackMoveSelected'
      | 'removeSelectedBuildings';
  }
>;

const SELECTION_RELATIVE = new Set<SimInput['type']>([
  'moveSelected',
  'gatherSelected',
  'stopSelected',
  'toggleSelectedUnitStance',
  'setSelectedUnitStance',
  'setFormationMode',
  'adjustFormationMode',
  'rotateSelectedFormation',
  'reformSelectedFormation',
  'attackSelected',
  'attackMoveSelected',
  'removeSelectedBuildings',
]);

export function isSelectionRelativeInput(input: SimInput): input is SelectionRelativeInput {
  return SELECTION_RELATIVE.has(input.type);
}

/**
 * Translate a selection-relative input into its self-describing form for
 * `playerId`, using the selection as it is right now. Self-describing inputs
 * pass through unchanged.
 */
export function toSelfDescribingInput(world: SimWorld, playerId: number, input: SimInput): SimInput {
  if (!isSelectionRelativeInput(input)) return input;
  const eids = selectedCommandableEids(world, playerId);
  switch (input.type) {
    case 'moveSelected':
      return { type: 'cmdMove', playerId, eids, to: { ...input.to } };
    case 'attackSelected':
      return { type: 'cmdAttack', playerId, eids, targetEid: input.targetEid };
    case 'gatherSelected':
      return { type: 'cmdGather', playerId, eids, targetEid: input.targetEid };
    case 'stopSelected':
      return { type: 'cmdStop', playerId, eids };
    case 'attackMoveSelected':
      return { type: 'cmdAttackMove', playerId, eids, to: { ...input.to } };
    case 'toggleSelectedUnitStance':
      return { type: 'cmdToggleStance', playerId, eids };
    case 'setSelectedUnitStance':
      return { type: 'cmdSetStance', playerId, eids, stance: input.stance };
    case 'setFormationMode':
      return { type: 'cmdSetFormationMode', playerId, eids, mode: input.mode };
    case 'adjustFormationMode':
      return { type: 'cmdAdjustFormationMode', playerId, eids, delta: input.delta };
    case 'rotateSelectedFormation':
      return { type: 'cmdRotateFormation', playerId, eids, delta: input.delta };
    case 'reformSelectedFormation':
      return { type: 'cmdReformFormation', playerId, eids };
    case 'removeSelectedBuildings':
      return { type: 'cmdRemoveBuildings', playerId, eids };
  }
}
