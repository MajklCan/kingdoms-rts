import { describe, expect, it } from 'vitest';
import { UnitDefId } from '@sim/defs';
import { UnitAtlasSource } from './unit-atlas-source';
import { parseUnitManifest, unitFrameName } from './unit-manifest';

const RAW = {
  version: 1,
  atlases: [{ key: 'kr-units-0', image: 'units-0.png', json: 'units-0.json' }],
  units: {
    villager: {
      defIds: ['VILLAGER'],
      size: [100, 80],
      anchor: [50, 60],
      height: 37,
      ring: [24, 10],
      anims: {
        idle: { frames: 4, ms: 260, shadow: 'static' },
        move: { frames: 8, stride: 0.7 },
        chop: { frames: 6, ms: 110, hit: 3 },
        death: { frames: 4, ms: 110, once: true, shadow: 'frame' },
        harvest: { alias: 'chop' },
        attack: { alias: 'chop' },
      },
    },
    gunman: {
      defIds: ['GUNMAN'],
      size: [120, 90],
      anchor: [60, 70],
      height: 41,
      anims: { idle: { frames: 4, ms: 260 }, attack: { frames: 6, ms: 100, hit: 3 } },
      projectile: [[1, -2], [3, -4], [5, -6], [7, -8], [9, -10], [11, -12], [13, -14], [15, -16]],
    },
  },
};

describe('parseUnitManifest', () => {
  it('treats a missing manifest as no units, without problems', () => {
    expect(parseUnitManifest(undefined)).toEqual({ manifest: { version: 1, atlases: [], units: [] }, problems: [] });
  });

  it('reads units, anims, aliases and projectile points', () => {
    const { manifest, problems } = parseUnitManifest(RAW);
    expect(problems).toEqual([]);
    expect(manifest.atlases.map((a) => a.key)).toEqual(['kr-units-0']);
    const villager = manifest.units.find((u) => u.name === 'villager');
    expect(villager?.unitDefIds).toEqual([UnitDefId.VILLAGER]);
    expect(villager?.anims.chop).toEqual({ frames: 6, ms: 110, stride: 0, hit: 3, once: false, shadowPerFrame: false });
    expect(villager?.anims.death.shadowPerFrame).toBe(true);
    expect(villager?.anims.move.stride).toBe(0.7);
    expect(villager?.aliases).toEqual({ harvest: 'chop', attack: 'chop' });
    expect(manifest.units.find((u) => u.name === 'gunman')?.projectile?.[2]).toEqual([5, -6]);
  });

  it('drops invalid units and unknown aliases with a problem each', () => {
    const { manifest, problems } = parseUnitManifest({
      atlases: RAW.atlases,
      units: {
        ghost: { defIds: ['NOT_A_UNIT'], size: [1, 1], anchor: [0, 0], anims: { idle: { frames: 1 } } },
        archer: {
          defIds: ['ARCHER'],
          size: [10, 10],
          anchor: [5, 8],
          anims: { idle: { frames: 2 }, shoot: { alias: 'nope' } },
        },
      },
    });
    expect(manifest.units.map((u) => u.name)).toEqual(['archer']);
    expect(manifest.units[0].aliases).toEqual({});
    expect(problems).toHaveLength(2);
  });

  it('ignores units when no atlas is listed', () => {
    const { manifest, problems } = parseUnitManifest({ units: RAW.units });
    expect(manifest.units).toEqual([]);
    expect(problems.some((p) => p.includes('no atlases'))).toBe(true);
  });
});

describe('UnitAtlasSource', () => {
  const { manifest } = parseUnitManifest(RAW);
  const lookup = (frame: string): string | null => (frame.startsWith('villager/') || frame.startsWith('gunman/') ? 'tex' : null);
  const source = new UnitAtlasSource(manifest, lookup, [0x111111, 0x2e86de]);

  it('draws frames with the shared origin, team mask and shadow', () => {
    const ref = source.unit({ unitDefId: UnitDefId.VILLAGER, playerId: 1, facing: 'SE', anim: 'move', frame: 3 });
    expect(ref).toMatchObject({
      texture: 'tex',
      frame: unitFrameName('villager', 'move', 1, 3),
      originX: 0.5,
      originY: 0.75,
      scale: 1,
      top: 37,
      source: 'atlas',
    });
    expect(ref?.teamMask).toEqual({ texture: 'tex', frame: 'villager/move/1/3/m', tint: 0x2e86de });
    // static shadows come from frame 0 of the anim and facing
    expect(ref?.shadow?.frame).toBe('villager/move/1/0/s');
    const death = source.unit({ unitDefId: UnitDefId.VILLAGER, playerId: 1, facing: 'N', anim: 'death', frame: 2 });
    expect(death?.shadow?.frame).toBe('villager/death/6/2/s');
  });

  it('resolves aliases and old anim names, and falls back to idle', () => {
    const harvest = source.unit({ unitDefId: UnitDefId.VILLAGER, playerId: 1, facing: 'E', anim: 'harvest', frame: 1 });
    expect(harvest?.frame).toBe('villager/chop/0/1');
    expect(source.unitFrameCount(UnitDefId.VILLAGER, 'harvest')).toBe(6);
    expect(source.unitFrameCount(UnitDefId.VILLAGER, 'mine')).toBe(6);
    const odd = source.unit({ unitDefId: UnitDefId.VILLAGER, playerId: 1, facing: 'E', anim: 'dance', frame: 9 });
    expect(odd?.frame).toBe('villager/idle/0/3');
    expect(source.unitFrameCount(UnitDefId.VILLAGER, 'dance')).toBe(0);
  });

  it('caches refs so renderers can compare them by identity', () => {
    const q = { unitDefId: UnitDefId.GUNMAN, playerId: 1, facing: 'S' as const, anim: 'attack', frame: 3 };
    expect(source.unit(q)).toBe(source.unit({ ...q }));
  });

  it('exposes timing and muzzle points per facing', () => {
    const art = source.unitArt(UnitDefId.GUNMAN);
    expect(art?.anim('attack')).toEqual({ frames: 6, ms: 100, stride: 0, hit: 3, once: false });
    expect(art?.projectile('S')).toEqual({ dx: 5, dy: -6 });
    expect(source.unitArt(UnitDefId.CANNON)).toBeNull();
    expect(source.coveredUnitDefIds.sort()).toEqual([UnitDefId.VILLAGER, UnitDefId.GUNMAN].sort());
  });
});
