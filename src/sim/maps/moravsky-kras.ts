/**
 * Moravský Kras (large): a limestone plateau under beech woods. The Macocha
 * abyss sinks through the middle to a lake far below. Two long dry gorges cut
 * the plateau on the flanks: walled by cliffs and entered only down a few
 * ramps, they are fast hidden roads with gold in their cave mouths. Sinkhole
 * ponds pock the high ground and break up a marching line.
 */

import { dcos, dhypot, dsin } from '../core/dmath';
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
  polylineDistance,
  symmetrize,
} from './large-kit';
import { clearSpawnPatch, rebuildWalkability, refreshBridgePositions, setSpawns } from './terrain';
import { type MapData, TileType } from './types';

const PLATEAU = 5;
const FLOOR = 1;
/** Unit vector from player 1 toward player 2 (lower-left to upper-right). */
const U = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
/** Unit vector across it (toward the lower-right corner). */
const V = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
/** How far the gorge runs off the centre line, and its half widths. */
const GORGE_OFFSET = 30;
const GORGE_FLOOR = 3.2;
const GORGE_WALL = 4.7;
const GORGE_RIM = 6.8;
/** Along-gorge positions of the ramps up to the plateau. */
const RAMPS = [-35, -13, 11, 33];
const RAMP_HALF_WIDTH = 2.6;
/** Along-gorge positions of the cave mouths (gold), on the outer wall. */
const CAVES = [-23, 23];
const CAVE_RADIUS = 2.6;

/** Sinkhole ponds on player 1's side: [fx, fy, radius]. */
const SINKHOLES: ReadonlyArray<readonly [number, number, number]> = [
  [0.3, 0.62, 2.2],
  [0.24, 0.4, 2.4],
  [0.12, 0.55, 2],
  [0.42, 0.62, 1.8],
  [0.36, 0.83, 1.8],
  [0.13, 0.25, 1.8],
  [0.06, 0.74, 1.6],
];

export function generateMoravskyKrasMap(): MapData {
  const map = createLargeMap(TileType.GRASS, PLATEAU);
  const c = mapCentre(map);
  const p1 = at(map, 0.16, 0.84);
  const p2 = mirrorPoint(map, p1);
  const spires = new SpireField(map);
  /** Tiles a sinkhole must keep away from (gorge, abyss, homes). */
  const reserved = new Uint8Array(map.width * map.height);

  // Beech woods over a gently rolling plateau.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const idx = y * map.width + x;
      const n = mirroredNoise(map, x, y, 16, 0x4a5);
      map.elevation[idx] = PLATEAU + Math.round((n - 0.5) * 1.6);
      if (mirroredNoise(map, x, y, 7, 0xbee) > 0.6) map.tiles[idx] = TileType.FOREST;
    }
  }

  // Gorge on the lower-right flank (its mirror is the upper-left one).
  const along = (s: number): Point => {
    const off = GORGE_OFFSET + 3 * dsin(s * 0.09);
    return { x: c.x + U.x * s + V.x * off, y: c.y + U.y * s + V.y * off };
  };
  const gorge: Point[] = [];
  for (let s = -52; s <= 52; s += 4) gorge.push(along(s));
  for (const line of [gorge, mirrorPolyline(map, gorge)]) {
    forPolyline(map, line, GORGE_RIM + 2, (idx) => {
      reserved[idx] = 1;
    });
    forPolyline(map, line, GORGE_RIM, (idx, d) => {
      if (d < GORGE_FLOOR) paint(map, idx, d < 0.8 ? TileType.DIRT : TileType.GRASS, FLOOR);
      else if (d < GORGE_WALL + 0.6) paint(map, idx, TileType.STONE, FLOOR + 2);
      else paint(map, idx, TileType.STONE, PLATEAU - 1);
    });
  }

  // Ramps down into the gorge, and cave niches in its outer wall.
  const open = new Uint8Array(map.width * map.height);
  for (const s of RAMPS) {
    const mid = along(s);
    const ramp = [
      { x: mid.x - V.x * (GORGE_RIM + 1), y: mid.y - V.y * (GORGE_RIM + 1) },
      { x: mid.x + V.x * (GORGE_RIM + 1), y: mid.y + V.y * (GORGE_RIM + 1) },
    ];
    for (const line of [ramp, mirrorPolyline(map, ramp)]) {
      forPolyline(map, line, RAMP_HALF_WIDTH, (idx) => {
        open[idx] = 1;
        paint(map, idx, TileType.DIRT, FLOOR + 2);
      });
    }
  }
  const caves = CAVES.map((s) => {
    const mid = along(s);
    return { x: mid.x + V.x * (GORGE_WALL + 0.5), y: mid.y + V.y * (GORGE_WALL + 0.5) };
  });
  const allCaves = caves.flatMap((cave) => [cave, mirrorPoint(map, cave)]);
  for (const p of allCaves) {
    forDisc(map, p.x, p.y, CAVE_RADIUS, (idx) => {
      open[idx] = 1;
      paint(map, idx, TileType.DIRT, FLOOR);
    });
  }

  // Cliff towers line both gorge walls and wrap around the back of each
  // cave, broken only by the ramps.
  const gorges = [gorge, mirrorPolyline(map, gorge)];
  const cellCentre = (i: number, j: number) => ({ x: 2 * i + 0.5, y: 2 * j + 0.5 });
  const gorgeDistance = (p: Point) => Math.min(...gorges.map((line) => polylineDistance(line, p.x, p.y)));
  const caveDistance = (p: Point) => Math.min(...allCaves.map((cv) => dhypot(cv.x - p.x, cv.y - p.y)));
  const cellOpen = (i: number, j: number) => {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (open[(2 * j + dy) * map.width + 2 * i + dx] === 1) return true;
      }
    }
    return false;
  };
  placeCellTowers(map, spires, {
    rock: (i, j) => {
      if (cellOpen(i, j)) return false;
      const p = cellCentre(i, j);
      const d = gorgeDistance(p);
      const cd = caveDistance(p);
      if (cd < CAVE_RADIUS + 2.6 && d > GORGE_WALL - 0.5) return cd > CAVE_RADIUS + 0.4;
      return Math.abs(d - GORGE_WALL) <= 1.45;
    },
    canSeal: (i, j) => !cellOpen(i, j) && gorgeDistance(cellCentre(i, j)) >= GORGE_FLOOR - 0.6,
    ground: TileType.STONE,
    elevation: PLATEAU,
  });

  // Macocha: a cliff ring falling to a lake. Gaps face both homes.
  forDisc(map, c.x, c.y, 9.5, (idx) => {
    reserved[idx] = 1;
  });
  forDisc(map, c.x, c.y, 7.6, (idx, d) => {
    if (d < 4.3) paint(map, idx, TileType.WATER, 0);
    else if (d < 6) paint(map, idx, TileType.STONE, 2);
    else paint(map, idx, TileType.STONE, PLATEAU - 1);
  });
  for (let k = 0; k < 12; k += 1) {
    const angle = (k * Math.PI) / 12;
    // 135 degrees points at player 1 (and, mirrored, 315 at player 2).
    if (Math.abs(angle - (3 * Math.PI) / 4) < 0.3) continue;
    const x = Math.round(c.x + dcos(angle) * 6.6 - 0.5);
    const y = Math.round(c.y + dsin(angle) * 6.6 - 0.5);
    spires.placePair(x, y, 2, TileType.STONE, PLATEAU);
  }

  // Homes on open plateau.
  for (const p of [p1, p2]) {
    forDisc(map, p.x, p.y, 13, (idx) => {
      reserved[idx] = 1;
    });
    forDisc(map, p.x, p.y, 10, (idx) => paint(map, idx, TileType.GRASS, PLATEAU));
  }

  // Sinkholes: shallow ponds in a muddy hollow, never in the gorge or a home.
  for (const [fx, fy, radius] of SINKHOLES) {
    const a = at(map, fx, fy);
    let clear = true;
    forDisc(map, a.x, a.y, radius + 1.5, (idx) => {
      if (reserved[idx] === 1) clear = false;
    });
    if (!clear) continue;
    for (const p of [a, mirrorPoint(map, a)]) {
      forDisc(map, p.x, p.y, radius + 1.2, (idx, d) => {
        if (d < radius) paint(map, idx, TileType.WATER_SHALLOW, PLATEAU - 2);
        else paint(map, idx, TileType.MUD, PLATEAU - 1);
      });
    }
  }

  // A cart track from each home to the abyss rim.
  const track = [p1, { x: p1.x + 14, y: p1.y - 10 }, { x: c.x - 7.5, y: c.y + 7.5 }];
  for (const line of [track, mirrorPolyline(map, track)]) {
    forPolyline(map, line, 1, (idx) => {
      if (map.tiles[idx] !== TileType.WATER && map.tiles[idx] !== TileType.WATER_SHALLOW) {
        paint(map, idx, TileType.DIRT);
      }
    });
  }

  // Gold in the cave mouths, stone and gold on the abyss's flanks.
  for (const cave of caves) addDepositCluster(map, 'gold', { x: Math.round(cave.x), y: Math.round(cave.y) }, 3, 'flank');
  const flank = { x: Math.round(c.x + V.x * 11), y: Math.round(c.y + V.y * 11) };
  addDepositCluster(map, 'gold', flank, 3, 'center');
  addDepositCluster(map, 'stone', { x: flank.x + 3, y: flank.y + 3 }, 3, 'center');

  symmetrize(map);
  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}
