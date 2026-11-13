// Camera-relative placement for world sounds: stereo pan from the horizontal
// offset, level from how far outside the view the source is. Pure.

export interface ViewRect {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface SpatialOptions {
  /** Max |pan|; never hard-pan a world sound into one ear. */
  maxPan?: number;
  /** Distance beyond the view edge, in view half-widths, where level hits 0. */
  fadeHalfWidths?: number;
  /** Minimum level wherever the source is (notifications such as "building
   *  complete" stay audible when the camera is elsewhere). */
  floor?: number;
}

export interface SpatialMix {
  pan: number;
  gain: number;
}

/** Below this a world sound is not worth a voice. */
export const SPATIAL_CULL_GAIN = 0.04;

export function spatialMix(x: number, y: number, view: ViewRect, opts: SpatialOptions = {}): SpatialMix {
  const maxPan = opts.maxPan ?? 0.7;
  const fade = opts.fadeHalfWidths ?? 0.6;
  const floor = opts.floor ?? 0;
  const halfW = Math.max(1, view.width / 2);
  const halfH = Math.max(1, view.height / 2);
  const dx = x - view.centerX;
  const dy = y - view.centerY;
  const pan = Math.max(-maxPan, Math.min(maxPan, (dx / halfW) * maxPan));
  const over = Math.hypot(Math.max(0, Math.abs(dx) - halfW), Math.max(0, Math.abs(dy) - halfH));
  // Inside the view: full level. Outside: squared falloff to 0 at `fade`.
  const t = Math.max(0, 1 - over / (halfW * fade));
  return { pan, gain: Math.max(floor, t * t) };
}

/** True when the point lies inside the view, grown by `margin` px. */
export function isInView(x: number, y: number, view: ViewRect, margin = 0): boolean {
  return (
    Math.abs(x - view.centerX) <= view.width / 2 + margin && Math.abs(y - view.centerY) <= view.height / 2 + margin
  );
}
