/**
 * Adršpach Rock Town (large): a broad band of sandstone towers runs corner to
 * corner between the two homes. Inside it a maze of narrow sandy lanes winds
 * between the rocks, opening into a central glade with the contested gold
 * and two glades around quiet quarry lakes. Five lanes cross the whole band;
 * the rest end in pockets. Pine woods and meadows surround the homes, and
 * stone is everywhere along the rocks.
 */

import {
  type Point,
  SpireField,
  addDepositCluster,
  at,
  createLargeMap,
  forDisc,
  forPolyline,
  mapCentre,
  mirrorPoint,
  mirrorPolyline,
  mirroredNoise,
  paint,
  placeCellTowers,
  symmetrize,
} from './large-kit';
import { clearSpawnPatch, rebuildWalkability, refreshBridgePositions, setSpawns } from './terrain';
import { type MapData, TileType, type TileTypeValue } from './types';

const GROUND = 3;
/** Rock ground under the towers stands this high above the lanes. */
const ROCK = 5;
/** Half width of the rock band, measured along the line between the homes. */
const BAND = 16;
const LANE_RADIUS = 1.35;

/**
 * Lanes on player 1's half as (t, s) points: t runs along the band (toward
 * the lower-right corner), s across it (toward player 2). Each is also laid
 * at its mirror (-t, -s).
 */
const LANES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // Through the middle into the central glade.
  [[0, -24], [-7, -17], [6, -10], [-2, -4]],
  // Right-hand crossing, end to end.
  [[26, -24], [22, -13], [28, -4], [23, 6], [27, 15], [22, 24]],
  // Corner crossings.
  [[46, -20], [43, -7], [48, 5], [44, 20]],
  [[62, -15], [60, -4], [64, 6], [61, 15]],
  // Cross links inside the band.
  [[-25, -9], [-15, -11], [-6, -5]],
  [[-7, -17], [10, -17], [22, -13]],
  [[28, -4], [37, -2], [43, -7]],
  // Spur to the lake glade.
  [[14, -4], [6, -6], [1, -5]],
  // Dead ends.
  [[14, -21], [12, -16]],
  [[34, 3], [38, 9]],
  [[-36, -14], [-40, -6]],
];

/** Lake glade centre on player 1's half, in (t, s). */
const LAKE: readonly [number, number] = [14, -4];
/** Lone towers out in the woods on player 1's side: [fx, fy, size]. */
const LONE_TOWERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.07, 0.68, 3],
  [0.32, 0.97, 2],
  [0.04, 0.95, 3],
  [0.22, 0.58, 2],
];

export function generateAdrspachRockTownMap(): MapData {
  const map = createLargeMap(TileType.GRASS, GROUND);
  const c = mapCentre(map);
  const p1 = at(map, 0.15, 0.85);
  const p2 = mirrorPoint(map, p1);
  const spires = new SpireField(map);
  const toXY = (t: number, s: number): Point => ({
    x: c.x + (t + s) * Math.SQRT1_2,
    y: c.y + (t - s) * Math.SQRT1_2,
  });
  const acrossBand = (x: number, y: number): number => (x - c.x - (y - c.y)) * Math.SQRT1_2;

  // Pine woods and meadows; the band itself is bare sandstone.
  const inBand = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const idx = y * map.width + x;
      const edge = BAND + 6 * (mirroredNoise(map, x, y, 9, 0xad5) - 0.5);
      if (Math.abs(acrossBand(x, y)) < edge) {
        inBand[idx] = 1;
        paint(map, idx, TileType.SAND, ROCK);
      } else if (mirroredNoise(map, x, y, 8, 0x91e) > 0.56) {
        map.tiles[idx] = TileType.FOREST;
        map.elevation[idx] = GROUND + Math.round(mirroredNoise(map, x, y, 12, 0x3) - 0.3);
      }
    }
  }

  // Lanes and glades: open sand at ground level.
  const carved = new Uint8Array(map.width * map.height);
  const open = (idx: number, tile: TileTypeValue = TileType.SAND) => {
    carved[idx] = 1;
    paint(map, idx, tile, GROUND);
  };
  for (const lane of LANES) {
    const line = lane.map(([t, s]) => toXY(t, s));
    for (const path of [line, mirrorPolyline(map, line)]) {
      forPolyline(map, path, LANE_RADIUS, (idx) => open(idx));
    }
  }
  forDisc(map, c.x, c.y, 6.5, (idx, d) => open(idx, d < 5 ? TileType.GRASS : TileType.SAND));
  const lake = toXY(LAKE[0], LAKE[1]);
  for (const p of [lake, mirrorPoint(map, lake)]) {
    forDisc(map, p.x, p.y, 5.6, (idx, d) => {
      carved[idx] = 1;
      if (d < 2.7) paint(map, idx, TileType.WATER, GROUND - 2);
      else if (d < 3.7) paint(map, idx, TileType.SAND, GROUND);
      else paint(map, idx, TileType.GRASS, GROUND);
    });
  }

  // Towers on a 2-tile grid inside the band; whole 4x4 blocks become one big
  // tower. A few cells stay open as sandy pockets.
  const cellInRock = (i: number, j: number): boolean => {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const idx = (2 * j + dy) * map.width + 2 * i + dx;
        if (inBand[idx] === 0 || carved[idx] === 1) return false;
      }
    }
    return true;
  };
  placeCellTowers(map, spires, {
    rock: (i, j) => cellInRock(i, j) && mirroredNoise(map, 2 * i + 0.5, 2 * j + 0.5, 3, 0x51) < 0.8,
    canSeal: cellInRock,
    ground: TileType.STONE,
    elevation: ROCK,
    merge: true,
    reachFrom: p1,
  });

  for (const [fx, fy, size] of LONE_TOWERS) {
    const a = at(map, fx, fy);
    spires.placePair(a.x, a.y, size, TileType.STONE, ROCK);
  }

  for (const p of [p1, p2]) {
    forDisc(map, p.x, p.y, 11, (idx) => paint(map, idx, TileType.GRASS, GROUND));
  }

  // Stone along the rock edge at every lane mouth, gold by the lake.
  for (const lane of [LANES[0], LANES[1], LANES[2]]) {
    const [t, s] = lane[0];
    const mouth = toXY(t, s - 2.5);
    addDepositCluster(map, 'stone', { x: Math.round(mouth.x) - 2, y: Math.round(mouth.y) }, 3, 'natural');
  }
  addDepositCluster(map, 'gold', { x: Math.round(lake.x) + 3, y: Math.round(lake.y) + 2 }, 3, 'flank');
  // The central glade: the contested field, stone on one side, gold on the other.
  const stoneField = toXY(4, -1.5);
  const goldField = toXY(-4, -1.5);
  addDepositCluster(map, 'stone', { x: Math.round(stoneField.x), y: Math.round(stoneField.y) }, 3, 'center');
  addDepositCluster(map, 'gold', { x: Math.round(goldField.x), y: Math.round(goldField.y) }, 2, 'center');
  addDepositCluster(map, 'stone', { x: Math.round(lake.x) - 4, y: Math.round(lake.y) - 1 }, 2, 'flank');

  symmetrize(map);
  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}
