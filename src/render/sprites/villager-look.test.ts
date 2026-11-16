import { addComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { WorksiteWorker } from '@sim/components';
import { BuildingDefId } from '@sim/defs';
import { createSimWorld } from '@sim/world';
import { spawnCompletedBuilding } from '@sim/factories/buildings';
import { spawnVillager } from '@sim/factories/units';
import { lookForRole, villagerLook } from './villager-look';

describe('villagerLook', () => {
  it('maps roles to unit-manifest looks', () => {
    expect(lookForRole('builder')).toBeUndefined();
    expect(lookForRole(null)).toBeUndefined();
    expect(lookForRole('lumberjack')).toBe('lumberjack');
    expect(lookForRole('gold-miner')).toBe('gold-miner');
    expect(lookForRole('miller')).toBe('farmer');
  });

  it('draws free villagers as builders and crews by their worksite', () => {
    const world = createSimWorld(7);
    const free = spawnVillager(world, 10, 10, 1);
    expect(villagerLook(world, free)).toBeUndefined();
    const site = spawnCompletedBuilding(world, BuildingDefId.LUMBER_CAMP, 14, 14, 1);
    const crew = spawnVillager(world, 12, 12, 1);
    addComponent(world.ecs, WorksiteWorker, crew);
    WorksiteWorker.siteEid[crew] = site;
    expect(villagerLook(world, crew)).toBe('lumberjack');
  });
});
