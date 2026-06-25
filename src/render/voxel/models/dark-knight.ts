import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import {
  SCOUT_CAVALRY_ANIMS,
  SCOUT_CAVALRY_FACINGS,
  SCOUT_CAVALRY_FRAME_COUNTS,
  buildScoutCavalryVoxels,
  type ScoutCavalryAnim,
  type ScoutCavalryFacing,
} from './dark-scout-cavalry';

export const KNIGHT_FACINGS = SCOUT_CAVALRY_FACINGS;
export const KNIGHT_ANIMS = SCOUT_CAVALRY_ANIMS;
export const KNIGHT_FRAME_COUNTS = SCOUT_CAVALRY_FRAME_COUNTS;

export type KnightFacing = ScoutCavalryFacing;
export type KnightAnim = ScoutCavalryAnim;

export const KNIGHT_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: -2,
  maxX: 22,
  minY: -2,
  maxY: 22,
  minZ: 0,
  maxZ: 22,
};

export function buildKnightVoxels(
  teamColor: number,
  pose: { facing?: KnightFacing; anim?: KnightAnim; frame?: number } = {}
): Voxel[] {
  return buildScoutCavalryVoxels(teamColor, { ...pose, variant: 'knight' });
}
