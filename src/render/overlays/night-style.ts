/**
 * Night look shared by the night renderer and its tests: the colours of the
 * dark and of torchlight, how far a light reaches on the iso ground for a
 * sight radius from the sim, and the torch flicker. Pure maths, no Phaser.
 */

import { ISO } from '../../config';
import type { Facing } from '../sprites/facing';

/** What moonlight leaves of the scene's colours (multiplied over the world). */
export const NIGHT_AMBIENT = '#323d76';
/** Everywhere your torches reach: dim, warm light, well short of daylight. */
export const TORCH_REACH = '#9c8a69';
/** Right by a flame: the scene's own colours, warmed a little. */
export const TORCH_CORE = '#ffeac2';
/** Radius (tiles) of the pool a single flame brightens around itself. */
export const TORCH_CORE_TILES = 4.2;

/** Screen px per tile of ground distance, along the screen x and y axes. */
export const TILE_REACH_X = ISO.TILE_W / Math.SQRT2;
export const TILE_REACH_Y = ISO.TILE_H / Math.SQRT2;

/**
 * Tiles the glow runs past the sight radius before it is fully dark. The sim
 * reveals about one tile past the radius, so the light fades out right where
 * the fog begins.
 */
export const LIGHT_EDGE_TILES = 1.7;
/** A torch you can see but that is not yours lights only its bearer. */
export const FOREIGN_LIGHT_TILES = 1.6;

export interface LightEllipse {
  rx: number;
  ry: number;
}

/**
 * Ground ellipse (screen px) lit by something that sees `sightTiles` far;
 * `edgeTiles` is how far the glow runs past that.
 */
export function lightEllipse(sightTiles: number, edgeTiles = LIGHT_EDGE_TILES): LightEllipse {
  const reach = Math.max(0, sightTiles) + edgeTiles;
  return { rx: reach * TILE_REACH_X, ry: reach * TILE_REACH_Y };
}

/**
 * Torch flicker around 1 for a time and a per-torch seed: two slow waves and
 * a fast shiver, so neighbouring torches never pulse together. `depth` is the
 * swing (0 = steady, for reduced motion).
 */
export function torchFlicker(timeMs: number, seed: number, depth = 1): number {
  if (depth <= 0) return 1;
  const phase = seed * 2.399963;
  const slow = Math.sin(timeMs * 0.0047 + phase) * 0.5 + Math.sin(timeMs * 0.0113 + phase * 1.7) * 0.3;
  const fast = Math.sin(timeMs * 0.031 + phase * 3.1) * 0.2;
  return 1 + (slow + fast) * 0.06 * depth;
}

/** Which side of its bearer a hand torch is on (+1 = screen right). */
export function torchSide(facing: Facing): 1 | -1 {
  return facing === 'W' || facing === 'NW' || facing === 'SW' || facing === 'N' ? -1 : 1;
}

/** Whether a hand torch is drawn in front of its bearer (facing the camera). */
export function torchInFront(facing: Facing): boolean {
  return facing !== 'N' && facing !== 'NE' && facing !== 'NW';
}
