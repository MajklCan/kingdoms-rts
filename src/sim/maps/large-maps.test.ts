import { describe, expect, it } from 'vitest';
import { MAP } from '../../config';
import { resetBitecsGlobals } from '../../net/testing/mp-match';
import { checksumWorld } from '../checksum';
import { Position, Resource, ResourceKindId } from '../components';
import { AgeId } from '../defs';
import {
  MAP_DEFS,
  MapId,
  SKIRMISH_MAP_DEFS,
  TileType,
  generateMap,
  type MapData,
  type MapFeature,
  type MapIdValue,
} from '../map-gen';
import { Rng } from '../rng';
import { loadSimWorldSnapshot, serializeSimWorld } from '../save-load';
import { createAiPlayerState, createSimWorld, resourceQuery, step, type SimWorld } from '../world';

const LARGE_MAPS = MAP_DEFS.filter((def) => def.large).map((def) => def.id);

/** Tiles reachable from `starts`, moving like the pathfinder (8 ways, corners may be cut). */
function flood(map: MapData, starts: number[], open: (x: number, y: number) => boolean): Uint8Array {
  const { width: w, height: h } = map;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const idx of starts) {
    if (open(idx % w, Math.floor(idx / w)) && seen[idx] === 0) {
      seen[idx] = 1;
      stack.push(idx);
    }
  }
  while (stack.length > 0) {
    const idx = stack.pop() ?? 0;
    const x = idx % w;
    const y = Math.floor(idx / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open(nx, ny)) continue;
        const n = ny * w + nx;
        if (seen[n] === 0) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
  }
  return seen;
}

function around(map: MapData, p: { x: number; y: number }, radius: number): number[] {
  const out: number[] = [];
  for (let y = p.y - radius; y <= p.y + radius; y++) {
    for (let x = p.x - radius; x <= p.x + radius; x++) {
      if (x >= 0 && y >= 0 && x < map.width && y < map.height) out.push(y * map.width + x);
    }
  }
  return out;
}

function aiMatch(mapId: MapIdValue, seed: number): SimWorld {
  const world = createSimWorld(seed, { mapId, startingAge: AgeId.DARK, aiDifficulty: 'hard' });
  world.humanPlayers = new Set();
  world.aiPlayers[1] = { ...createAiPlayerState(0, 'medium'), difficulty: 'medium' };
  world.paused = false;
  return world;
}

describe('large skirmish maps', () => {
  it('offers three large maps in the skirmish list', () => {
    expect(LARGE_MAPS).toEqual([MapId.MILESOVKA_UPLANDS, MapId.ADRSPACH_ROCK_TOWN, MapId.MORAVSKY_KRAS]);
    for (const id of LARGE_MAPS) expect(SKIRMISH_MAP_DEFS.some((def) => def.id === id)).toBe(true);
  });

  it.each(LARGE_MAPS)('%s is a fixed layout of 112 x 112 that ignores the match rng', (id) => {
    const a = generateMap(new Rng(1), id);
    const b = generateMap(new Rng(987), id);
    expect(a.width).toBe(MAP.LARGE_SIZE);
    expect(a.height).toBe(MAP.LARGE_SIZE);
    expect(a.tiles.length).toBe(MAP.LARGE_SIZE * MAP.LARGE_SIZE);
    expect(a.walkability.length).toBe(MAP.LARGE_SIZE);
    expect(a.walkability[0].length).toBe(MAP.LARGE_SIZE);
    expect(Array.from(b.tiles)).toEqual(Array.from(a.tiles));
    expect(Array.from(b.elevation)).toEqual(Array.from(a.elevation));
    expect(b.features).toEqual(a.features);
  });

  it.each(LARGE_MAPS)('%s gives both sides the same land', (id) => {
    const map = generateMap(new Rng(3), id);
    const { width: w, height: h } = map;
    const n = w * h;
    for (let idx = 0; idx < n; idx++) {
      expect(map.tiles[n - 1 - idx], `tile ${idx}`).toBe(map.tiles[idx]);
      expect(map.elevation[n - 1 - idx], `elevation ${idx}`).toBe(map.elevation[idx]);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) expect(map.walkability[h - 1 - y][w - 1 - x]).toBe(map.walkability[y][x]);
    }
    const key = (f: MapFeature) => `${f.kind}:${f.x}:${f.y}:${f.size ?? 1}`;
    const features = new Set(map.features.map(key));
    for (const f of map.features) {
      const size = f.size ?? 1;
      expect(features.has(key({ ...f, x: w - size - f.x, y: h - size - f.y })), key(f)).toBe(true);
    }
    expect(map.spawns[2]).toEqual({ x: w - 1 - map.spawns[1].x, y: h - 1 - map.spawns[1].y });
  });

  it.each(LARGE_MAPS)('%s lets each town reach the other and every gold and stone deposit', (id) => {
    resetBitecsGlobals();
    const world = createSimWorld(11, { mapId: id });
    const { map } = world;
    const [p1, p2] = [map.spawns[1], map.spawns[2]];
    expect(Math.hypot(p1.x - p2.x, p1.y - p2.y)).toBeGreaterThan(95);
    const reach = flood(map, around(map, p1, 5), (x, y) => world.grid[y][x] === 0);
    expect(around(map, p2, 5).some((idx) => reach[idx] === 1)).toBe(true);
    let mines = 0;
    for (const eid of resourceQuery(world.ecs)) {
      const kind = Resource.kind[eid];
      if (kind !== ResourceKindId.GOLD && kind !== ResourceKindId.STONE) continue;
      mines++;
      const tile = { x: Math.floor(Position.x[eid]), y: Math.floor(Position.y[eid]) };
      expect(around(map, tile, 1).some((idx) => reach[idx] === 1), `deposit at ${tile.x},${tile.y}`).toBe(true);
    }
    expect(mines).toBeGreaterThan(60);
  });

  it.each(LARGE_MAPS)('%s splits gold and stone evenly between the sides', (id) => {
    resetBitecsGlobals();
    const world = createSimWorld(5, { mapId: id });
    const [p1, p2] = [world.map.spawns[1], world.map.spawns[2]];
    const totals = { gold: [0, 0], stone: [0, 0] };
    for (const eid of resourceQuery(world.ecs)) {
      const kind = Resource.kind[eid];
      if (kind !== ResourceKindId.GOLD && kind !== ResourceKindId.STONE) continue;
      const x = Position.x[eid];
      const y = Position.y[eid];
      const d1 = Math.hypot(x - p1.x - 0.5, y - p1.y - 0.5);
      const d2 = Math.hypot(x - p2.x - 0.5, y - p2.y - 0.5);
      if (Math.abs(d1 - d2) < 1e-6) continue;
      totals[kind === ResourceKindId.GOLD ? 'gold' : 'stone'][d1 < d2 ? 0 : 1] += Resource.amount[eid];
    }
    expect(totals.gold[0]).toBe(totals.gold[1]);
    expect(totals.stone[0]).toBe(totals.stone[1]);
    expect(totals.gold[0]).toBeGreaterThan(10_000);
  });

  it('Moravský Kras gorges are walled in, entered only down the ramps', () => {
    const map = generateMap(new Rng(1), MapId.MORAVSKY_KRAS);
    const w = map.width;
    const isRamp = (x: number, y: number) => map.tiles[y * w + x] === TileType.DIRT && map.elevation[y * w + x] === 3;
    const nearRamp = (x: number, y: number) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < map.height && isRamp(nx, ny)) return true;
        }
      }
      return false;
    };
    const floor: number[] = [];
    for (let idx = 0; idx < w * map.height; idx++) if (map.elevation[idx] === 1) floor.push(idx);
    expect(floor.length).toBeGreaterThan(500);
    const open = (x: number, y: number) => map.walkability[y][x] === 0;
    const withRamps = flood(map, floor, open);
    const withoutRamps = flood(map, floor, (x, y) => open(x, y) && !nearRamp(x, y));
    const town = around(map, map.spawns[1], 4);
    expect(town.some((idx) => withRamps[idx] === 1)).toBe(true);
    expect(town.some((idx) => withoutRamps[idx] === 1)).toBe(false);
  });

  it('a mid-game save on a large map loads and plays on identically', () => {
    resetBitecsGlobals();
    const world = aiMatch(MapId.ADRSPACH_ROCK_TOWN, 21);
    for (let i = 0; i < 900; i++) step(world);
    const saved = JSON.parse(JSON.stringify(serializeSimWorld(world)));
    const loaded = createSimWorld(21, { mapId: MapId.ADRSPACH_ROCK_TOWN, startingAge: AgeId.DARK, aiDifficulty: 'hard' });
    loadSimWorldSnapshot(loaded, saved);
    expect(loaded.map.width).toBe(MAP.LARGE_SIZE);
    expect(loaded.visibility[1].explored.length).toBe(MAP.LARGE_SIZE * MAP.LARGE_SIZE);
    expect(checksumWorld(loaded)).toBe(checksumWorld(world));
    for (let i = 0; i < 600; i++) {
      step(world);
      step(loaded);
    }
    expect(checksumWorld(loaded)).toBe(checksumWorld(world));
  });
});
