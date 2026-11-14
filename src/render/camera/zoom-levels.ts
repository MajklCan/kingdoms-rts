/**
 * Pure zoom math for the camera: the resting levels, the scroll grid that
 * keeps the pixel art still at each level, easing, and the scroll that keeps
 * a screen point over the same world point while the zoom changes.
 *
 * Resting levels are quarter steps from 0.5 to 3. A level p/4 scales every
 * texel by a fixed repeating pattern, and that pattern holds still while
 * panning as long as the scroll moves in multiples of the reduced
 * denominator (`grid`): 1.25 = 5/4 needs 4 world px, 1.5 = 3/2 needs 2.
 * Terrain chunk origins sit on a 4 px grid (terrain-baker.ts), so every level
 * here rounds every chunk to screen pixels the same way.
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
const ZOOM_QUANTUM = 4;

export const ZOOM_LEVELS: readonly number[] = buildLevels();

function buildLevels(): number[] {
  const out: number[] = [];
  for (let n = ZOOM_MIN * ZOOM_QUANTUM; n <= ZOOM_MAX * ZOOM_QUANTUM; n++) out.push(n / ZOOM_QUANTUM);
  return out;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** World-pixel scroll step that keeps the texel pattern still at `zoom` (a resting level). */
export function scrollGridFor(zoom: number): number {
  const n = Math.round(zoom * ZOOM_QUANTUM);
  if (Math.abs(n / ZOOM_QUANTUM - zoom) > 1e-6) return 1;
  return ZOOM_QUANTUM / gcd(n, ZOOM_QUANTUM);
}

/** Index of the resting level closest to `zoom`. */
export function nearestLevelIndex(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    if (Math.abs(ZOOM_LEVELS[i]! - zoom) < Math.abs(ZOOM_LEVELS[best]! - zoom)) best = i;
  }
  return best;
}

export function nearestLevel(zoom: number): number {
  return ZOOM_LEVELS[nearestLevelIndex(zoom)]!;
}

/** The level `steps` away from the level nearest `zoom`, clamped to the range. */
export function stepLevel(zoom: number, steps: number): number {
  const i = nearestLevelIndex(zoom) + Math.trunc(steps);
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i))]!;
}

/** Continuous zoom (pinch) range: a little rubber band past the ends. */
export function clampContinuousZoom(zoom: number): number {
  return Math.max(ZOOM_MIN * 0.9, Math.min(ZOOM_MAX * 1.1, zoom));
}

export function easeOutCubic(t: number): number {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

/**
 * Scroll that puts world point (wx, wy) under screen point (sx, sy) at
 * `zoom`. Phaser draws a camera of size (w, h) with its origin at the centre:
 * screen = (world - scroll - half) * zoom + half.
 */
export function anchoredScroll(
  wx: number,
  wy: number,
  sx: number,
  sy: number,
  zoom: number,
  width: number,
  height: number
): { x: number; y: number } {
  const hx = width / 2;
  const hy = height / 2;
  return { x: wx - hx - (sx - hx) / zoom, y: wy - hy - (sy - hy) / zoom };
}

/** World point under screen point (sx, sy); the inverse of {@link anchoredScroll}. */
export function screenToWorld(
  sx: number,
  sy: number,
  scrollX: number,
  scrollY: number,
  zoom: number,
  width: number,
  height: number
): { x: number; y: number } {
  const hx = width / 2;
  const hy = height / 2;
  return { x: (sx - hx) / zoom + hx + scrollX, y: (sy - hy) / zoom + hy + scrollY };
}

/** Wheel px per zoom level (one mouse notch is about 100 px in every browser). */
export const WHEEL_PX_PER_LEVEL = 100;

/** WheelEvent delta in px, whatever the delta mode. */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

/**
 * Wheel accumulator: a discrete notch (one big event) is exactly one level,
 * and small trackpad deltas add up to a level per {@link WHEEL_PX_PER_LEVEL}.
 * A notch is 100 px on one screen and 200 px on a 2x screen, so its size is
 * learned: `notchPx` is the smallest discrete event seen so far (Infinity
 * before the first), and an event that carries several notches (the browser
 * merges a fast spin into one event per frame) moves up to three levels.
 * Returns the whole levels to move (+ = zoom in), the remainder to carry and
 * the notch size to pass back next time.
 */
export function wheelLevels(
  accPx: number,
  deltaPx: number,
  notchPx = Infinity
): { levels: number; rest: number; notch: number } {
  const size = Math.abs(deltaPx);
  if (size >= 40) {
    const notch = Math.min(notchPx, size);
    const levels = -Math.sign(deltaPx) * Math.min(3, Math.max(1, Math.round(size / notch)));
    return { levels, rest: 0, notch };
  }
  // A small delta against the carried direction drops the carry.
  const acc = Math.sign(accPx) === -Math.sign(deltaPx) ? deltaPx : accPx + deltaPx;
  if (Math.abs(acc) < WHEEL_PX_PER_LEVEL) return { levels: 0, rest: acc, notch: notchPx };
  return { levels: -Math.sign(acc), rest: acc - Math.sign(acc) * WHEEL_PX_PER_LEVEL, notch: notchPx };
}
