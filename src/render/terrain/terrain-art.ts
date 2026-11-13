/**
 * Phaser-free terrain rules for the Blender tiles: which terrain asset each
 * sim TileType draws with, transition masks between kinds, cliff kinds and
 * the deterministic per-tile variant. See docs/BLENDER_SPRITE_PIPELINE.md
 * ("Terrain tiles", "Transitions", "Elevation").
 */

import { TileType, type MapData } from '@sim/map-gen';
import { MAP } from '../../config';
import { valueNoise } from '../tile-hash';

/**
 * Terrain asset name (`terrain.<name>`) per TileType. GRASS also draws as
 * `meadow` in noise patches; BRIDGE as `bridge_x` / `bridge_y` by direction.
 * BARBED_WIRE has no tile of its own: mud, with wire drawn on top.
 */
export const TILE_TERRAIN: Readonly<Record<number, string>> = {
  [TileType.GRASS]: 'grass',
  [TileType.FOREST]: 'forest',
  [TileType.DIRT]: 'dirt',
  [TileType.SAND]: 'sand',
  [TileType.WATER]: 'water',
  [TileType.WATER_SHALLOW]: 'water_shallow',
  [TileType.STONE]: 'stone',
  [TileType.BRIDGE]: 'bridge_x',
  [TileType.MUD]: 'mud',
  [TileType.SNOW]: 'snow',
  [TileType.SNOW_FOREST]: 'snow_forest',
  [TileType.ICE]: 'ice',
  [TileType.PACKED_SNOW]: 'packed_snow',
  [TileType.BARBED_WIRE]: 'mud',
};

/**
 * Transition priority: a neighbour of higher priority bleeds over this tile.
 * Bridges never take part (they are drawn as clean decks).
 */
export const TRANSITION_PRIORITY: Readonly<Record<string, number>> = {
  water: 0,
  water_shallow: 1,
  ice: 2,
  sand: 3,
  mud: 4,
  dirt: 5,
  stone: 6,
  grass: 7,
  meadow: 8,
  forest: 9,
  packed_snow: 10,
  snow: 11,
  snow_forest: 12,
};

/** Cliff face kind under a raised tile of this terrain. */
export const CLIFF_KIND: Readonly<Record<string, string>> = {
  grass: 'earth',
  meadow: 'earth',
  forest: 'earth',
  dirt: 'earth',
  mud: 'earth',
  water: 'earth',
  water_shallow: 'earth',
  bridge_x: 'earth',
  bridge_y: 'earth',
  stone: 'rock',
  sand: 'sand',
  snow: 'snow',
  snow_forest: 'snow',
  packed_snow: 'snow',
  ice: 'snow',
};

/** Terrains with looping animation frames (variant "<index>.<frame>"). */
export const ANIMATED_TERRAIN: ReadonlySet<string> = new Set(['water', 'water_shallow']);

const MEADOW_THRESHOLD = 0.64;
const MEADOW_CELL = 5;

/** Terrain asset name for every tile of the map, row-major. */
export function terrainNames(map: MapData, seed: number): string[] {
  const names = new Array<string>(MAP.WIDTH * MAP.HEIGHT);
  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      const tile = map.tiles[y * MAP.WIDTH + x];
      let name = TILE_TERRAIN[tile] ?? 'grass';
      if (tile === TileType.GRASS && valueNoise(x, y, MEADOW_CELL, seed) > MEADOW_THRESHOLD) {
        name = 'meadow';
      } else if (tile === TileType.BRIDGE) {
        name = bridgeName(map, x, y);
      }
      names[y * MAP.WIDTH + x] = name;
    }
  }
  return names;
}

/** Planks run across the direction of travel: the axis whose neighbours are not water. */
function bridgeName(map: MapData, x: number, y: number): string {
  const open = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return 0;
    const t = map.tiles[ty * MAP.WIDTH + tx];
    return t === TileType.WATER || t === TileType.WATER_SHALLOW ? 0 : 1;
  };
  const alongX = open(x - 1, y) + open(x + 1, y);
  const alongY = open(x, y - 1) + open(x, y + 1);
  return alongY > alongX ? 'bridge_y' : 'bridge_x';
}

/** Variant key of a tile: `(x mod p) + p * (y mod p)`, plus `.frame` when animated. */
export function tileVariantKey(period: number, x: number, y: number, frame?: number): string {
  const p = Math.max(1, period);
  const index = String((x % p) + p * (y % p));
  return frame === undefined ? index : `${index}.${frame}`;
}

export interface TileTransition {
  /** Terrain bleeding in. */
  neighbour: string;
  /** Transition mask variant keys (`terrain.transition`), combined with max. */
  masks: string[];
}

const EDGES: ReadonlyArray<readonly [number, number, string]> = [
  [1, 0, 'px'],
  [-1, 0, 'mx'],
  [0, 1, 'py'],
  [0, -1, 'my'],
];

/**
 * Neighbour terrains that bleed into tile (x, y), lowest priority first (so
 * higher ones are mixed in last), with the masks for each.
 */
export function tileTransitions(names: readonly string[], x: number, y: number): TileTransition[] {
  const self = nameAt(names, x, y);
  if (!self || isBridge(self)) return [];
  const own = TRANSITION_PRIORITY[self] ?? 0;
  const byNeighbour = new Map<string, string[]>();
  const bleeds = (n: string | null): n is string =>
    n !== null && n !== self && !isBridge(n) && (TRANSITION_PRIORITY[n] ?? 0) > own;
  const variant = (x * 7 + y * 13) % 3;
  for (const [dx, dy, key] of EDGES) {
    const n = nameAt(names, x + dx, y + dy);
    if (!bleeds(n)) continue;
    push(byNeighbour, n, `edge_${key}.${variant}`);
  }
  for (const dx of [1, -1]) {
    for (const dy of [1, -1]) {
      const n = nameAt(names, x + dx, y + dy);
      if (!bleeds(n)) continue;
      if (nameAt(names, x + dx, y) === n || nameAt(names, x, y + dy) === n) continue;
      push(byNeighbour, n, `corner_${dx > 0 ? 'px' : 'mx'}_${dy > 0 ? 'py' : 'my'}`);
    }
  }
  return [...byNeighbour.entries()]
    .sort((a, b) => (TRANSITION_PRIORITY[a[0]] ?? 0) - (TRANSITION_PRIORITY[b[0]] ?? 0))
    .map(([neighbour, masks]) => ({ neighbour, masks }));
}

function isBridge(name: string): boolean {
  return name === 'bridge_x' || name === 'bridge_y';
}

function nameAt(names: readonly string[], x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return null;
  return names[y * MAP.WIDTH + x] ?? null;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
