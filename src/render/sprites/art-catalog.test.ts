import { describe, expect, it } from 'vitest';
import { ArtCatalog, type AtlasFrameLookup } from './art-catalog';
import { parseSpriteManifest } from './sprite-manifest';

const v = (frame: string, extra: Record<string, unknown> = {}) => ({
  atlas: 'a',
  frame,
  anchor: [50, 80],
  size: [100, 100],
  ...extra,
});

const { manifest } = parseSpriteManifest({
  version: 1,
  scale: 0.5,
  eraOrder: ['dark', 'castle', 'gunpowder'],
  atlases: [{ key: 'a', image: 'a.png', json: 'a.json' }],
  assets: {
    'building.house': {
      kind: 'building',
      defId: 'HOUSE',
      footprint: [1, 1],
      default: 'dark',
      variants: { dark: v('house_dark', { mask: 'house_dark__mask' }), gunpowder: v('house_gp') },
    },
    'building.wall': {
      kind: 'building',
      defId: 'WALL',
      footprint: [1, 1],
      default: 'dark.5',
      variants: { 'dark.5': v('wall_dark_5'), 'castle.10': v('wall_castle_10') },
    },
    'construction.1x1': {
      kind: 'construction',
      footprint: [1, 1],
      default: '0',
      variants: { '0': v('c0', { progress: 0 }), '1': v('c1', { progress: 0.34 }), '2': v('c2', { progress: 0.67 }) },
    },
    'resource.gold': {
      kind: 'resource',
      footprint: [1, 1],
      default: 'full',
      variants: { full: v('g1', { amount: 1 }), half: v('g2', { amount: 0.5 }), low: v('g3', { amount: 0.2 }) },
    },
    'resource.missing': { kind: 'resource', footprint: [1, 1], default: 'x', variants: { x: v('not_in_atlas') } },
  },
});

const lookup: AtlasFrameLookup = {
  hasFrame: (texture, frame) => texture === 'sprite-atlas:a' && frame !== 'not_in_atlas',
  trimTop: () => 20,
};
const art = new ArtCatalog(manifest, lookup);

describe('ArtCatalog', () => {
  it('maps BuildingDefId keys to assets', () => {
    expect(art.buildingAssetId('HOUSE')).toBe('building.house');
    expect(art.buildingAssetId('NOPE')).toBeUndefined();
  });

  it('derives origin, scale, top and mask from the variant', () => {
    expect(art.frame('building.house', 'dark')).toMatchObject({
      texture: 'sprite-atlas:a',
      frame: 'house_dark',
      originX: 0.5,
      originY: 0.8,
      scale: 0.5,
      mask: 'house_dark__mask',
      top: 30,
    });
  });

  it('falls back to the nearest earlier era, then the default', () => {
    expect(art.eraFrame('building.house', 'castle')?.frame).toBe('house_dark');
    expect(art.eraFrame('building.house', 'gunpowder')?.frame).toBe('house_gp');
    expect(art.eraFrame('building.house', 'total_war')?.frame).toBe('house_dark');
  });

  it('keeps the wall shape before the era', () => {
    expect(art.eraFrame('building.wall', 'gunpowder', '10')?.frame).toBe('wall_castle_10');
    expect(art.eraFrame('building.wall', 'dark', '10')?.frame).toBe('wall_castle_10');
    expect(art.eraFrame('building.wall', 'dark', '7')?.frame).toBe('wall_dark_5');
  });

  it('picks construction stages by progress', () => {
    expect(art.stageFrame('construction.1x1', 0)?.frame).toBe('c0');
    expect(art.stageFrame('construction.1x1', 0.5)?.frame).toBe('c1');
    expect(art.stageFrame('construction.1x1', 0.99)?.frame).toBe('c2');
  });

  it('picks resource piles by remaining amount', () => {
    expect(art.amountFrame('resource.gold', 0.95)?.frame).toBe('g1');
    expect(art.amountFrame('resource.gold', 0.4)?.frame).toBe('g2');
    expect(art.amountFrame('resource.gold', 0.05)?.frame).toBe('g3');
  });

  it('returns null for frames missing from the loaded atlas', () => {
    expect(art.frame('resource.missing', 'x')).toBeNull();
    expect(art.defaultFrame('resource.nope')).toBeNull();
  });

  it('picks variants deterministically by hash', () => {
    expect(art.pickFrame('resource.gold', 7)?.frame).toBe(art.pickFrame('resource.gold', 7)?.frame);
  });
});
