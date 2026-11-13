/**
 * The single exit for player commands. Single-player pushes straight into
 * `world.inputs`; a live multiplayer match hands the command to the lockstep
 * session, which translates selection-relative inputs into self-describing
 * cmd* inputs (the shared `toSelfDescribingInput` in the sim) and schedules
 * them for the same tick everywhere. A session that is no longer playing
 * (desync, peer left, connection lost) swallows commands: the sim is frozen.
 */

import { selectedCommandableEids as selectedCommandableEidsFor, type SimInput } from '@sim/world';
import type { SceneContext } from '../scene-context';

/** Selected entities this client may command: owned by the perspective player,
 *  excluding worksite workers (mirror of the sim's commandable selection). */
export function selectedCommandableEids(ctx: SceneContext): number[] {
  return selectedCommandableEidsFor(ctx.world, ctx.perspectivePlayerId);
}

export function dispatchCommand(ctx: SceneContext, input: SimInput): void {
  const mp = ctx.multiplayer;
  if (mp) {
    if (mp.state === 'playing') mp.sendCommand(input);
    return;
  }
  // Single-player: straight into the sim input queue.
  ctx.world.inputs.push(input);
}
