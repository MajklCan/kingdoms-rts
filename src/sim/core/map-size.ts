/**
 * Map size helpers. A map's size lives on world.map.width/height; MAP in
 * config.ts is the size of the standard maps.
 */

import { MAP } from '../../config';

export interface MapSize {
  width: number;
  height: number;
}

/**
 * A per-map count scaled to the map's area: exactly `count` on a standard map
 * (so its rng draws stay what they were), proportionally more on a large one.
 */
export function scaleByMapArea(size: MapSize, count: number): number {
  return Math.round((count * size.width * size.height) / (MAP.WIDTH * MAP.HEIGHT));
}
