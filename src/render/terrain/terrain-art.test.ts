import { describe, expect, it } from 'vitest';
import { TileType, type MapData } from '@sim/map-gen';
import { MAP } from '../../config';
import manifestJson from '../../../public/assets/sprites/manifest.json';
import { parseSpriteManifest } from '../sprites/sprite-manifest';
import { hashBytes, tileHash, valueNoise } from '../tile-hash';
import { TILE_TERRAIN, terrainNames, tileTransitions, tileVariantKey } from './terrain-art';

function flatMap(fill: number): MapData {
  const tiles = new Uint8Array(MAP.WIDTH * MAP.HEIGHT).fill(fill);
  const elevation = new Uint8Array(MAP.WIDTH * MAP.HEIGHT).fill(3);
  const walkability = Array.from({ length: MAP.HEIGHT }, () => new Array<number>(MAP.WIDTH).fill(0));
  return { tiles, elevation, walkability } as unknown as MapData;
}

describe('terrain art mapping', () => {
  it('has a terrain asset for every TileType', () => {
    const { manifest } = parseSpriteManifest(manifestJson);
    for (const [name, value] of Object.entries(TileType)) {
      const terrain = TILE_TERRAIN[value as number];
      expect(terrain, name).toBeDefined();
      expect(manifest.assets[`terrain.${terrain}`], `${name} -> ${terrain}`).toBeDefined();
    }
  });

  it('uses the periodic variant index', () => {
    expect(tileVariantKey(4, 5, 6)).toBe(String(1 + 4 * 2));
    expect(tileVariantKey(2, 3, 3, 2)).toBe('3.2');
  });

  it('turns noise patches of grass into meadow, deterministically', () => {
    const map = flatMap(TileType.GRASS);
    const a = terrainNames(map, 42);
    expect(a).toEqual(terrainNames(map, 42));
    expect(a.filter((n) => n === 'meadow').length).toBeGreaterThan(0);
    expect(a.filter((n) => n === 'grass').length).toBeGreaterThan(a.length / 2);
  });

  it('bleeds higher priority neighbours in with edge and corner masks', () => {
    const names = new Array<string>(MAP.WIDTH * MAP.HEIGHT).fill('dirt');
    names[5 * MAP.WIDTH + 6] = 'grass'; // +x neighbour of (5, 5)
    names[6 * MAP.WIDTH + 6] = 'forest'; // +x+y corner of (5, 5)
    const t = tileTransitions(names, 5, 5);
    expect(t.map((x) => x.neighbour)).toEqual(['grass', 'forest']);
    expect(t[0].masks[0]).toMatch(/^edge_px\.[0-2]$/);
    expect(t[1].masks).toEqual(['corner_px_py']);
    // Lower priority neighbours never bleed into a higher one.
    expect(tileTransitions(names, 6, 5).map((x) => x.neighbour)).toEqual(['forest']);
  });
});

describe('tile hash', () => {
  it('is stable and spread', () => {
    expect(tileHash(3, 4, 1)).toBe(tileHash(3, 4, 1));
    expect(tileHash(3, 4, 1)).not.toBe(tileHash(4, 3, 1));
    const n = valueNoise(10.5, 3, 5, 9);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
    expect(hashBytes([1, 2, 3])).not.toBe(hashBytes([3, 2, 1]));
  });
});
