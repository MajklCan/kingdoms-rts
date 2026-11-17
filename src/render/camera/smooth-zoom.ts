/**
 * Pure math for continuous (smooth) wheel zoom: wheel deltas to a zoom
 * target, frame-rate independent easing toward it, and the rule that settles
 * an idle zoom onto a crisp resting level.
 *
 * Zoom is eased in log space, so a step feels the same at 0.5x and at 3x.
 */

import { ZOOM_LEVELS, ZOOM_MAX, ZOOM_MIN } from './zoom-levels';

/** Zoom factor of one physical mouse notch (about 11%). */
export const NOTCH_FACTOR = 1.11;
/** Wheel px that count as one notch for small (trackpad, high-res) deltas. */
export const SMALL_DELTA_NOTCH_PX = 100;
/** Events at least this big are discrete notches; smaller ones are continuous. */
export const DISCRETE_MIN_PX = 40;
/** Most notches one merged wheel event may move. */
export const MAX_NOTCHES_PER_EVENT = 3;
/** Time constant of the exponential ease toward the target. */
export const ZOOM_TAU_MS = 100;
/** Wheel idle time before the zoom settles onto a resting level. */
export const SETTLE_IDLE_MS = 150;
/** Settle onto a level only when the target is this close to it (|ln ratio|, about 10%). */
export const SETTLE_MAX_LOG = 0.1;
/** Below this log distance the ease is done and lands exactly. */
const DONE_LOG = 0.0004;

/**
 * Wheel delta (px, + = scroll down = zoom out) to notches (+ = zoom in).
 * A discrete event is a whole number of notches (a notch is 100 px on one
 * screen and 200 px on a 2x one, so its size is learned: `notchPx` is the
 * smallest discrete event seen, Infinity before the first). Small deltas
 * (trackpads, high-resolution wheels) add up fractionally, so any amount of
 * wheel moves the zoom a proportional bit.
 */
export function wheelNotches(deltaPx: number, notchPx = Infinity): { notches: number; notch: number } {
  const size = Math.abs(deltaPx);
  if (size >= DISCRETE_MIN_PX) {
    const notch = Math.min(notchPx, size);
    const n = Math.min(MAX_NOTCHES_PER_EVENT, Math.max(1, Math.round(size / notch)));
    return { notches: -Math.sign(deltaPx) * n, notch };
  }
  const n = Math.min(MAX_NOTCHES_PER_EVENT, size / SMALL_DELTA_NOTCH_PX);
  return { notches: -Math.sign(deltaPx) * n, notch: notchPx };
}

export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/** New target after `notches` (+ = in), multiplicative and clamped to the range. */
export function targetAfterNotches(target: number, notches: number): number {
  return clampZoom(target * Math.pow(NOTCH_FACTOR, notches));
}

/**
 * One frame of exponential smoothing toward `target`, independent of the
 * frame rate and without overshoot. Lands exactly when close enough.
 */
export function easeZoom(current: number, target: number, dtMs: number, tauMs = ZOOM_TAU_MS): number {
  const gap = Math.log(target / current);
  if (Math.abs(gap) < DONE_LOG) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return current * Math.exp(gap * k);
}

/** The resting level `target` should settle on, or null when none is close enough. */
export function settleLevel(target: number, maxLog = SETTLE_MAX_LOG): number | null {
  let best = ZOOM_LEVELS[0]!;
  for (const z of ZOOM_LEVELS) {
    if (Math.abs(Math.log(z / target)) < Math.abs(Math.log(best / target))) best = z;
  }
  return Math.abs(Math.log(best / target)) <= maxLog ? best : null;
}
