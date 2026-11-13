import { describe, expect, it } from 'vitest';
import { AgeId, BuildingDefId, UnitDefId } from '@sim/defs';
import { ResourceKindId } from '@sim/components';
import { AtlasSpriteSource, fillPattern, type AtlasFrameLookup } from './atlas-sprite-source';
import { parseSpriteManifest } from './sprite-manifest';
import { SpriteSourceRegistry } from './sprite-registry';
import type { SpriteRef, SpriteSource } from './sprite-source';

const TEAM_COLORS = [0x999999, 0x3366ff, 0xff3333];

function lookupOf(frames: Record<string, string[]>): AtlasFrameLookup {
  return { hasFrame: (key, frame) => frames[key]?.includes(frame) ?? false };
}

function sourceOf(sprites: Record<string, unknown>, frames: Record<string, string[]>) {
  const { manifest, problems } = parseSpriteManifest({
    atlases: [
      { key: 'b', image: 'b.png', json: 'b.json' },
      { key: 'u', image: 'u.png', json: 'u.json' },
    ],
    sprites,
  });
  expect(problems).toEqual([]);
  return new AtlasSpriteSource(manifest, lookupOf(frames), TEAM_COLORS);
}

describe('AtlasSpriteSource', () => {
  it('is empty without entries and answers nothing', () => {
    const source = sourceOf({}, {});
    expect(source.isEmpty).toBe(true);
    expect(source.building({ defId: BuildingDefId.HOUSE, age: AgeId.DARK, playerId: 1 })).toBeNull();
  });

  it('prefers the age entry and falls back to the generic one', () => {
    const source = sourceOf(
      {
        'building:TOWN_CENTER:CASTLE': { atlas: 'b', frame: 'tc-castle' },
        'building:TOWN_CENTER': { atlas: 'b', frame: 'tc-{age}', originY: 0.8 },
      },
      { 'sprite-atlas:b': ['tc-castle', 'tc-dark'] }
    );
    const castle = source.building({ defId: BuildingDefId.TOWN_CENTER, age: AgeId.CASTLE, playerId: 1 });
    expect(castle).toMatchObject({ texture: 'sprite-atlas:b', frame: 'tc-castle', originX: 0.5, originY: 0.5 });
    const dark = source.building({ defId: BuildingDefId.TOWN_CENTER, age: AgeId.DARK, playerId: 1 });
    expect(dark).toMatchObject({ frame: 'tc-dark', originY: 0.8, scale: 1, source: 'atlas' });
    // Frame missing from the atlas: no ref, so the registry falls back to voxels.
    expect(source.building({ defId: BuildingDefId.TOWN_CENTER, age: AgeId.GUNPOWDER, playerId: 1 })).toBeNull();
  });

  it('tints the team mask with the owner colour', () => {
    const source = sourceOf(
      { 'building:HOUSE': { atlas: 'b', frame: 'house', teamMask: { frame: 'house-mask-p{player}' } } },
      { 'sprite-atlas:b': ['house', 'house-mask-p2'] }
    );
    const p2 = source.building({ defId: BuildingDefId.HOUSE, age: AgeId.DARK, playerId: 2 });
    expect(p2?.teamMask).toEqual({ texture: 'sprite-atlas:b', frame: 'house-mask-p2', tint: 0xff3333 });
    // Mask frame missing for player 1: sprite still resolves, without a mask.
    const p1 = source.building({ defId: BuildingDefId.HOUSE, age: AgeId.DARK, playerId: 1 });
    expect(p1?.frame).toBe('house');
    expect(p1?.teamMask).toBeUndefined();
  });

  it('fills unit placeholders and exposes per-anim frame counts', () => {
    const source = sourceOf(
      { 'unit:ARCHER': { atlas: 'u', frame: 'archer-{anim}-{facing}-{frame}', frames: { move: 4 } } },
      { 'sprite-atlas:u': ['archer-move-SW-3'] }
    );
    const ref = source.unit({ unitDefId: UnitDefId.ARCHER, playerId: 1, facing: 'SW', anim: 'move', frame: 3 });
    expect(ref?.frame).toBe('archer-move-SW-3');
    expect(source.unitFrameCount(UnitDefId.ARCHER, 'move')).toBe(4);
    expect(source.unitFrameCount(UnitDefId.ARCHER, 'idle')).toBe(0);
    expect(source.unitFrameCount(UnitDefId.VILLAGER, 'move')).toBe(0);
  });

  it('resolves resource variants before the plain kind', () => {
    const source = sourceOf(
      {
        'resource:WOOD:snow': { atlas: 'b', frame: 'tree-snow' },
        'resource:WOOD': { atlas: 'b', frame: 'tree' },
      },
      { 'sprite-atlas:b': ['tree-snow', 'tree'] }
    );
    expect(source.resource({ kind: ResourceKindId.WOOD, variant: 'snow' })?.frame).toBe('tree-snow');
    expect(source.resource({ kind: ResourceKindId.WOOD })?.frame).toBe('tree');
    expect(source.resource({ kind: ResourceKindId.GOLD })).toBeNull();
  });

  it('blanks unknown placeholders', () => {
    expect(fillPattern('a-{age}-{nope}-{frame}', { age: 'dark', frame: 0 })).toBe('a-dark--0');
  });
});

describe('SpriteSourceRegistry', () => {
  const ref = (texture: string): SpriteRef => ({
    texture,
    originX: 0.5,
    originY: 0.5,
    scale: 1,
    source: texture.startsWith('atlas') ? 'atlas' : 'voxel',
  });

  function fakeSource(answer: SpriteRef | null, frames: number): SpriteSource {
    return {
      building: () => answer,
      unit: () => answer,
      unitFrameCount: () => frames,
      resource: () => answer,
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
    expect(new SpriteSourceRegistry(voxel).resource({ kind: ResourceKindId.GOLD })?.texture).toBe('voxel-house');
  });
});
