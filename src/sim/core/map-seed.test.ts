import { describe, expect, it } from 'vitest';
import { hashBytes } from '../../render/tile-hash';
import { checksumWorld } from '../checksum';
import {
  loadSimWorldSnapshot,
  migrateSavedGame,
  parseSavedGame,
  serializeSimWorld,
  type SavedGameV2,
} from '../save-load';
import { createSimWorld, getMapSeed, legacyMapSeed, normalizeMapSeed } from '../world';

describe('map seed', () => {
  it('is the creation seed as a uint32, for skirmish and campaign worlds alike', () => {
    expect(getMapSeed(createSimWorld(12345))).toBe(12345);
    expect(getMapSeed(createSimWorld(-1))).toBe(0xffffffff);
    expect(normalizeMapSeed(2 ** 32 + 7)).toBe(7);
    expect(normalizeMapSeed(Number.NaN)).toBe(0);
  });

  it('does not touch the rng or the checksum', () => {
    const a = createSimWorld(99);
    const b = createSimWorld(99);
    b.mapSeed = 1;
    expect(checksumWorld(a)).toBe(checksumWorld(b));
    expect(a.rng.getState()).toBe(b.rng.getState());
  });

  it('round-trips through a save', () => {
    const world = createSimWorld(4242);
    const text = JSON.stringify(serializeSimWorld(world, 'seed'));
    const parsed = parseSavedGame(text);
    expect(parsed?.version).toBe(3);
    expect(parsed?.mapSeed).toBe(4242);
    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, parsed!);
    expect(getMapSeed(restored)).toBe(4242);
  });

  it('derives a stable seed for v2 saves, equal to the hash render used for terrain', () => {
    const world = createSimWorld(777);
    const { mapSeed: _dropped, ...rest } = serializeSimWorld(world, 'old');
    const v2: SavedGameV2 = JSON.parse(JSON.stringify({ ...rest, version: 2 })) as SavedGameV2;
    const expected = hashBytes(world.map.elevation, hashBytes(world.map.tiles));
    expect(legacyMapSeed(world.map.tiles, world.map.elevation)).toBe(expected);
    expect(migrateSavedGame(v2)?.mapSeed).toBe(expected);
    expect(parseSavedGame(JSON.stringify(v2))?.mapSeed).toBe(expected);
    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, v2);
    expect(getMapSeed(restored)).toBe(expected);
  });
});
