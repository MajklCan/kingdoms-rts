import { describe, expect, it } from 'vitest';
import { EMPTY_SPRITE_MANIFEST, atlasTextureKey, parseSpriteManifest } from './sprite-manifest';

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

  it('keeps valid atlases and entries', () => {
    const { manifest, problems } = parseSpriteManifest({
      version: 2,
      atlases: [{ key: 'b', image: 'b.png', json: 'b.json' }],
      sprites: {
        'building:HOUSE': {
          atlas: 'b',
          frame: 'house-{age}',
          originY: 0.8,
          scale: 0.5,
          teamMask: { frame: 'house-mask' },
        },
        'unit:ARCHER': { atlas: 'b', frame: 'archer-{anim}-{frame}', frames: { move: 4 } },
      },
    });
    expect(problems).toEqual([]);
    expect(manifest.version).toBe(2);
    expect(manifest.atlases).toEqual([{ key: 'b', image: 'b.png', json: 'b.json' }]);
    expect(manifest.sprites['building:HOUSE']).toEqual({
      atlas: 'b',
      frame: 'house-{age}',
      originY: 0.8,
      scale: 0.5,
      teamMask: { atlas: 'b', frame: 'house-mask' },
    });
    expect(manifest.sprites['unit:ARCHER'].frames).toEqual({ move: 4 });
  });

  it('drops invalid parts and reports each one', () => {
    const { manifest, problems } = parseSpriteManifest({
      atlases: [
        { key: 'a', image: 'a.png', json: 'a.json' },
        { key: 'a', image: 'dup.png', json: 'dup.json' },
        { key: 'x' },
      ],
      sprites: {
        'building:HOUSE': { atlas: 'missing', frame: 'h' },
        'building:MILL': { atlas: 'a' },
        'building:FARM': { atlas: 'a', frame: 'farm', originX: 'left', teamMask: { frame: 'm', atlas: 'nope' } },
        'unit:ARCHER': { atlas: 'a', frame: 'archer', frames: { move: 0, idle: 2 } },
      },
    });
    expect(manifest.atlases.map((a) => a.key)).toEqual(['a']);
    expect(Object.keys(manifest.sprites).sort()).toEqual(['building:FARM', 'unit:ARCHER']);
    expect(manifest.sprites['building:FARM']).toEqual({ atlas: 'a', frame: 'farm' });
    expect(manifest.sprites['unit:ARCHER'].frames).toEqual({ idle: 2 });
    expect(problems).toHaveLength(7);
  });

  it('namespaces atlas texture keys away from voxel keys', () => {
    expect(atlasTextureKey('buildings')).toBe('sprite-atlas:buildings');
  });
});
