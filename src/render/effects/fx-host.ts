/**
 * What every world-VFX module gets from {@link WorldFx}: the scene context,
 * the particle pools, a game-time clock that stops while the match is paused,
 * and a camera shake scaled by distance to the view centre.
 */

import type { SceneContext } from '../scene-context';
import type { FxParticles } from './fx-particles';

export interface FxHost {
  readonly ctx: SceneContext;
  readonly fx: FxParticles;
  /** Game time, ms: scaled by game speed, frozen while paused. */
  readonly time: number;
  /**
   * Camera shake from an event at layer-local (x, y): full `intensity`
   * (fraction of the viewport) at the view centre, fading to nothing about a
   * screen away. Skipped under prefers-reduced-motion.
   */
  shake(x: number, y: number, intensity: number, durationMs: number): void;
}

/** Ease-in quad. */
export function easeIn(t: number): number {
  return t * t;
}

/** Ease-out quad. */
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Stable 0..1 hash of an integer pair (render-local, never the sim RNG). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
