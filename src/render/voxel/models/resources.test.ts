import { describe, expect, it } from 'vitest';
import type { Voxel } from '../voxel-render';
import { buildGoldVoxels, buildStoneVoxels } from './resources';

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
});
