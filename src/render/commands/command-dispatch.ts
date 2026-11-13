/**
 * The single exit for player commands. Single-player pushes straight into
 * `world.inputs`; a live multiplayer match translates selection-relative
 * inputs into self-describing cmd* inputs (playerId + eids) and hands them to
 * the lockstep session, which schedules them for the same tick everywhere.
 */

import { hasComponent } from 'bitecs';
import { Owner, WorksiteWorker } from '@sim/components';
import { selectedQuery, type SimInput } from '@sim/world';
import type { SceneContext } from '../scene-context';

/** Selected entities this client may command: owned by the perspective player,
 *  excluding worksite workers (mirror of the sim's commandable selection). */
export function selectedCommandableEids(ctx: SceneContext): number[] {
  const out: number[] = [];
  for (const eid of selectedQuery(ctx.world.ecs)) {
    if (hasComponent(ctx.world.ecs, WorksiteWorker, eid)) continue;
    if (Owner.player[eid] === ctx.perspectivePlayerId) out.push(eid);
  }
  return out;
}

export function dispatchCommand(ctx: SceneContext, input: SimInput): void {
  const mp = ctx.multiplayer;
  if (mp && mp.state === 'playing') {
    mp.sendCommand(toNetworkCommand(ctx, input));
    return;
  }
  // Single-player (or pre-match): straight into the sim input queue.
  ctx.world.inputs.push(input);
}

function toNetworkCommand(ctx: SceneContext, input: SimInput): SimInput {
  const playerId = ctx.perspectivePlayerId;
  const eids = selectedCommandableEids(ctx);
  switch (input.type) {
    case 'moveSelected':
      return { type: 'cmdMove', playerId, eids, to: input.to };
    case 'attackSelected':
      return { type: 'cmdAttack', playerId, eids, targetEid: input.targetEid };
    case 'gatherSelected':
      return { type: 'cmdGather', playerId, eids, targetEid: input.targetEid };
    case 'stopSelected':
      return { type: 'cmdStop', playerId, eids };
    case 'attackMoveSelected':
      return { type: 'cmdAttackMove', playerId, eids, to: input.to };
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
    default:
      return input; // placeBuilding / trainUnit / researchTech / ... already carry playerId
  }
}
