import { describe, expect, it } from 'vitest';
import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';
import { buildGoldVoxels, buildSnowTreeVoxels, buildStoneVoxels } from './resources';

function footprint(voxels: Voxel[]): { width: number; depth: number } {
  const xs = voxels.map((voxel) => voxel.x);
  const ys = voxels.map((voxel) => voxel.y);
  return {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...ys) - Math.min(...ys) + 1,
  };
}

describe('resource voxel models', () => {
  it('uses broad tile-scale gold and stone deposits', () => {
    expect(footprint(buildGoldVoxels())).toMatchObject({ width: 11, depth: 10 });
    expect(footprint(buildStoneVoxels())).toMatchObject({ width: 11, depth: 10 });
  });

  it('adds snow-capped pine resource art', () => {
    const snowTree = buildSnowTreeVoxels();
    expect(footprint(snowTree)).toMatchObject({ width: 5, depth: 5 });
    expect(snowTree.some((voxel) => voxel.color === P.SNOW_L)).toBe(true);
    expect(snowTree.some((voxel) => voxel.color === P.TREE_CANOPY_M)).toBe(true);
  });
});
