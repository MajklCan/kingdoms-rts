/**
 * The 8 screen facings every directional unit sprite is authored in. Voxel
 * models and atlas sheets share this order (index = 45 degree step from east,
 * clockwise in screen space).
 */

export const FACINGS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

export type Facing = (typeof FACINGS)[number];

/** Default facing for a unit that has never moved or targeted anything. */
export const DEFAULT_FACING: Facing = 'SE';

/** Snap a tile-space direction vector to the nearest of the 8 facings. */
export function facingFromVector(dx: number, dy: number): Facing {
  const angle = Math.atan2(dy, dx);
  const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
  const index = Math.round(normalized / (Math.PI / 4)) % FACINGS.length;
  return FACINGS[index];
}
