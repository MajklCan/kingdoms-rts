import { describe, expect, it } from 'vitest';
import { BUILDING_TABLE } from '@sim/defs';
import manifestJson from '../../../public/assets/sprites/manifest.json';
import { EMPTY_SPRITE_MANIFEST, atlasTextureKey, parseSpriteManifest } from './sprite-manifest';

const variant = (frame: string, extra: Record<string, unknown> = {}) => ({
  atlas: 'kr-buildings-0',
  frame,
  anchor: [64, 120],
  size: [128, 128],
  ...extra,
});

describe('parseSpriteManifest', () => {
  it('treats a missing manifest as empty without problems', () => {
    expect(parseSpriteManifest(undefined)).toEqual({ manifest: EMPTY_SPRITE_MANIFEST, problems: [] });
    expect(parseSpriteManifest(null)).toEqual({ manifest: EMPTY_SPRITE_MANIFEST, problems: [] });
  });

  it('rejects a non-object manifest', () => {
    const { manifest, problems } = parseSpriteManifest([1, 2]);
    expect(manifest).toEqual(EMPTY_SPRITE_MANIFEST);
    expect(problems).toHaveLength(1);
  });

  it('keeps valid assets and drops invalid variants with a problem each', () => {
    const { manifest, problems } = parseSpriteManifest({
      version: 1,
      scale: 0.5,
      tile: { w: 64, h: 32, elevationStepPx: 4 },
      eraOrder: ['dark', 'castle', 'gunpowder'],
      atlases: [{ key: 'kr-buildings-0', image: 'buildings-0.png', json: 'buildings-0.json' }],
      assets: {
        'building.house': {
          kind: 'building',
          defId: 'HOUSE',
          footprint: [1, 1],
          default: 'dark',
          variants: {
            dark: variant('house_dark', { mask: 'house_dark__mask', shadow: 'house_dark__shadow' }),
            castle: { atlas: 'kr-buildings-0', frame: 'house_castle' },
          },
        },
        'building.broken': { kind: 'building', footprint: [1, 1], default: 'x', variants: { x: { frame: 1 } } },
      },
    });
    expect(manifest.scale).toBe(0.5);
    expect(manifest.elevationStepPx).toBe(4);
    expect(manifest.eraOrder).toEqual(['dark', 'castle', 'gunpowder']);
    expect(Object.keys(manifest.assets)).toEqual(['building.house']);
    expect(Object.keys(manifest.assets['building.house'].variants)).toEqual(['dark']);
    expect(manifest.assets['building.house'].variants.dark.mask).toBe('house_dark__mask');
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });

  it('parses the shipped Blender manifest without problems', () => {
    const { manifest, problems } = parseSpriteManifest(manifestJson);
    expect(problems).toEqual([]);
    expect(manifest.atlases.map((a) => a.key)).toContain('kr-terrain-0');
    for (const id of ['terrain.grass', 'terrain.transition', 'terrain.cliff_earth', 'resource.tree']) {
      expect(manifest.assets[id], id).toBeDefined();
    }
  });

  it('has art for every building with the sim footprint', () => {
    const { manifest } = parseSpriteManifest(manifestJson);
    for (const def of BUILDING_TABLE) {
      const asset = Object.values(manifest.assets).find((a) => a.kind === 'building' && a.defId === def.id);
      expect(asset, def.id).toBeDefined();
      expect(asset?.footprint, def.id).toEqual([def.footprint.w, def.footprint.h]);
    }
  });

  it('prefixes atlas texture keys', () => {
    expect(atlasTextureKey('kr-buildings-0')).toBe('sprite-atlas:kr-buildings-0');
  });
});
