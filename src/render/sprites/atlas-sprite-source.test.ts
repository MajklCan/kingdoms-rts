import { describe, expect, it } from 'vitest';
import { AgeId, BUILDING_TABLE, BuildingDefId, UnitDefId } from '@sim/defs';
import { ResourceKindId } from '@sim/components';
import manifestJson from '../../../public/assets/sprites/manifest.json';
import { ArtCatalog } from './art-catalog';
import { AtlasSpriteSource } from './atlas-sprite-source';
import { parseSpriteManifest } from './sprite-manifest';
import { SpriteSourceRegistry } from './sprite-registry';
import type { SpriteRef, SpriteSource } from './sprite-source';
import { wallAxisForMask } from './voxel-sprite-source';

const { manifest } = parseSpriteManifest(manifestJson);
const art = new ArtCatalog(manifest, { hasFrame: () => true });
const source = new AtlasSpriteSource(art, [0x888888, 0x3b82f6, 0xef4444]);

describe('AtlasSpriteSource (shipped manifest)', () => {
  it('draws every building in every age', () => {
    BUILDING_TABLE.forEach((def, defId) => {
      for (const age of Object.values(AgeId)) {
        const ref = source.building({ defId, age, playerId: 1 });
        expect(ref, `${def.id} age ${age}`).not.toBeNull();
        expect(ref?.anchor).toBe('footprint');
      }
    });
  });

  it('team-tints live buildings but not construction sites', () => {
    const house = source.building({ defId: BuildingDefId.HOUSE, age: AgeId.CASTLE, playerId: 2 });
    expect(house?.frame).toBe('house_castle');
    expect(house?.teamMask?.tint).toBe(0xef4444);
    const site = source.building({ defId: BuildingDefId.HOUSE, age: AgeId.CASTLE, playerId: 2, construction: 0.5 });
    expect(site?.frame).not.toBe('house_castle');
    expect(site?.teamMask).toBeUndefined();
  });

  it('maps Total War to the gunpowder look', () => {
    expect(source.building({ defId: BuildingDefId.HOUSE, age: AgeId.TOTAL_WAR, playerId: 1 })?.frame)
      .toBe(source.building({ defId: BuildingDefId.HOUSE, age: AgeId.GUNPOWDER, playerId: 1 })?.frame);
  });

  it('draws walls per neighbour mask and farms per stage', () => {
    const frames = new Set<string | undefined>();
    for (let mask = 0; mask < 16; mask++) {
      frames.add(source.building({ defId: BuildingDefId.WALL, age: AgeId.DARK, playerId: 1, wallMask: mask })?.frame);
    }
    expect(frames.size).toBe(16);
    const stages = ['sown', 'growing', 'ripe', 'depleted'] as const;
    const farmFrames = stages.map(
      (farmStage) => source.building({ defId: BuildingDefId.FARM, age: AgeId.DARK, playerId: 1, farmStage })?.frame
    );
    expect(new Set(farmFrames).size).toBe(4);
  });

  it('has rubble and stumps', () => {
    expect(source.rubble(BuildingDefId.TOWN_CENTER)).not.toBeNull();
    expect(source.stump(true)?.frame).not.toBe(source.stump(false)?.frame);
  });

  it('picks tree species from the tile, stable across calls', () => {
    const a = source.resource({ kind: ResourceKindId.WOOD, x: 10, y: 12, variant: 'conifer' });
    const b = source.resource({ kind: ResourceKindId.WOOD, x: 10, y: 12, variant: 'conifer' });
    expect(a).toBe(b);
    const species = new Set<string | undefined>();
    for (let i = 0; i < 40; i++) {
      species.add(source.resource({ kind: ResourceKindId.WOOD, x: i, y: 3, variant: 'broadleaf' })?.frame);
    }
    expect(species.size).toBeGreaterThan(2);
  });

  it('shows depletion on piles', () => {
    const full = source.resource({ kind: ResourceKindId.GOLD, x: 0, y: 0, remaining: 1 });
    const low = source.resource({ kind: ResourceKindId.GOLD, x: 0, y: 0, remaining: 0.1 });
    expect(full?.frame).not.toBe(low?.frame);
  });

  it('leaves units to the voxel fallback', () => {
    expect(source.unit()).toBeNull();
  });
});

describe('wallAxisForMask', () => {
  it('runs along y only when the neighbours are on the y axis', () => {
    expect(wallAxisForMask(0)).toBe('x');
    expect(wallAxisForMask(1 | 4)).toBe('x');
    expect(wallAxisForMask(2 | 8)).toBe('y');
    expect(wallAxisForMask(2)).toBe('y');
  });
});

describe('SpriteSourceRegistry', () => {
  const ref = (texture: string): SpriteRef => ({
    texture,
    originX: 0.5,
    originY: 0.5,
    scale: 1,
    anchor: 'center',
    top: 10,
    source: texture.startsWith('atlas') ? 'atlas' : 'voxel',
  });

  function fakeSource(answer: SpriteRef | null, frames: number): SpriteSource {
    return {
      building: () => answer,
      rubble: () => answer,
      unit: () => answer,
      unitFrameCount: () => frames,
      resource: () => answer,
      stump: () => answer,
      mapFeature: () => answer,
    };
  }

  const buildingQuery = { defId: BuildingDefId.HOUSE, age: AgeId.DARK, playerId: 1 };

  it('uses the override when it answers and the fallback otherwise', () => {
    const voxel = fakeSource(ref('voxel-house'), 2);
    expect(new SpriteSourceRegistry(voxel, fakeSource(ref('atlas-house'), 6)).building(buildingQuery)?.texture)
      .toBe('atlas-house');
    const partial = new SpriteSourceRegistry(voxel, fakeSource(null, 0));
    expect(partial.building(buildingQuery)?.texture).toBe('voxel-house');
    expect(partial.unitFrameCount(UnitDefId.ARCHER, 'move')).toBe(2);
    expect(new SpriteSourceRegistry(voxel).resource({ kind: ResourceKindId.GOLD, x: 0, y: 0 })?.texture)
      .toBe('voxel-house');
  });
});
