/**
 * Output-only event buffers (sound cues, AI messages). Sim appends, render drains.
 */

import { type ResourceKind, ResourceKindId } from '../components';
import type { SimWorld, SoundCueKind } from './types';

export function pushAiEvent(world: SimWorld, playerId: number, message: string): void {
  world.aiEvents.push({ tick: world.tick, playerId, message });
  if (world.aiEvents.length > 12) world.aiEvents.splice(0, world.aiEvents.length - 12);
}

export function gatherCueForKind(kind: ResourceKind): SoundCueKind {
  switch (kind) {
    case ResourceKindId.WOOD:
      return 'gather_wood';
    case ResourceKindId.STONE:
      return 'gather_stone';
    case ResourceKindId.GOLD:
      return 'gather_gold';
    default:
      return 'gather_food';
  }
}

/** Maximum buffered sound cues. The render layer drains every frame; this cap
 *  only matters in headless runs (tests) where nothing drains — it bounds
 *  memory by dropping the oldest cues. Output-only, so determinism-safe. */
const MAX_SOUND_CUES = 256;

export function pushSoundCue(
  world: SimWorld,
  kind: SoundCueKind,
  x: number,
  y: number,
  player: number
): void {
  world.soundCues.push({ kind, x, y, player });
  if (world.soundCues.length > MAX_SOUND_CUES) {
    world.soundCues.splice(0, world.soundCues.length - MAX_SOUND_CUES);
  }
}
