import { describe, expect, it } from 'vitest';
import { AgeId, BuildingDefId } from '@sim/defs';
import { VOXEL_KEYS, VOXEL_SHARED_BAKES, voxelBuildingSprite, voxelHasConstructionLook } from '../../sprites/voxel-models';
import { PALETTE as P } from '../palette';
import {
  buildDarkFarmSiteVoxels,
  buildDarkFarmVoxels,
  DARK_FARM_SITE_BOUNDS as B,
  DARK_FARM_SITE_STAGES,
} from './dark-farm';

const SOIL = new Set<number>([P.DIRT_L, P.DIRT_M, P.DIRT_D]);
const soilCount = (stage: number) =>
  buildDarkFarmSiteVoxels(stage).filter((v) => v.z === 0 && SOIL.has(v.color)).length;

describe('farm construction (voxel fallback)', () => {
  it('starts as a staked plot and is tilled row by row', () => {
    expect(soilCount(0)).toBe(0);
    for (let stage = 1; stage < DARK_FARM_SITE_STAGES; stage++) {
      expect(soilCount(stage)).toBeGreaterThan(soilCount(stage - 1));
    }
    // Fully tilled at the end: the whole bed inside the string.
    expect(soilCount(DARK_FARM_SITE_STAGES - 1)).toBe(14 * 14);
  });

  it('stays low: stakes and string, no timber frame', () => {
    for (let stage = 0; stage < DARK_FARM_SITE_STAGES; stage++) {
      const voxels = buildDarkFarmSiteVoxels(stage);
      for (const v of voxels) {
        expect(v.x >= B.minX && v.x <= B.maxX && v.y >= B.minY && v.y <= B.maxY && v.z >= B.minZ && v.z <= B.maxZ).toBe(true);
      }
      // Four corner stakes reach the top; nothing else is that tall but the spade.
      const tall = voxels.filter((v) => v.z === B.maxZ);
      expect(tall.length).toBeLessThanOrEqual(5);
    }
  });

  it('bakes into the finished farm\'s frame, so the plot does not jump on completion', () => {
    const done = buildDarkFarmVoxels();
    const extent = (pick: (v: { x: number; y: number; z: number }) => number) =>
      [Math.min(...done.map(pick)), Math.max(...done.map(pick))];
    expect(extent((v) => v.x)).toEqual([B.minX, B.maxX]);
    expect(extent((v) => v.y)).toEqual([B.minY, B.maxY]);
    expect(extent((v) => v.z)).toEqual([B.minZ, B.maxZ]);
    const finished = voxelBuildingSprite(BuildingDefId.FARM, AgeId.DARK, 1);
    const site = voxelBuildingSprite(BuildingDefId.FARM, AgeId.DARK, 1, undefined, 0.5);
    expect(site?.originY).toBe(finished?.originY);
  });

  it('picks a stage by progress and bakes every stage', () => {
    const key = (construction?: number) =>
      voxelBuildingSprite(BuildingDefId.FARM, AgeId.DARK, 1, undefined, construction)?.key;
    expect(key()).toBe(VOXEL_KEYS.FARM);
    expect(key(0)).toBe(`${VOXEL_KEYS.FARM_SITE_PREFIX}0`);
    expect(key(0.5)).toBe(`${VOXEL_KEYS.FARM_SITE_PREFIX}2`);
    expect(key(1)).toBe(`${VOXEL_KEYS.FARM_SITE_PREFIX}${DARK_FARM_SITE_STAGES - 1}`);
    const baked = new Set(VOXEL_SHARED_BAKES.map((bake) => bake.key));
    for (let stage = 0; stage < DARK_FARM_SITE_STAGES; stage++) {
      expect(baked.has(`${VOXEL_KEYS.FARM_SITE_PREFIX}${stage}`)).toBe(true);
    }
  });

  it('only the farm has its own construction look; the rest ghost their finished model', () => {
    expect(voxelHasConstructionLook(BuildingDefId.FARM)).toBe(true);
    expect(voxelHasConstructionLook(BuildingDefId.HOUSE)).toBe(false);
    expect(voxelBuildingSprite(BuildingDefId.HOUSE, AgeId.DARK, 1, undefined, 0.5)?.key).toBe(VOXEL_KEYS.HOUSE);
  });
});
