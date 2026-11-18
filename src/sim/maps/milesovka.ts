/**
 * Milešovka Uplands (large): the volcanic cones of the Central Bohemian
 * Uplands. Milešovka, the highest of them, stands in the middle with a crown
 * of rock that nothing passes. Two brooks run from its foot to the far
 * corners, so the way across is over a muddy ford, a bridge, or one of the
 * two saddles beside the summit. Smaller forested cones with bare rock tops
 * carry the stone and gold worth expanding to.
 */

import { dcos, dsin } from '../core/dmath';
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
  symmetrize,
} from './large-kit';
import { clearSpawnPatch, rebuildWalkability, refreshBridgePositions, setSpawns } from './terrain';
import { type MapData, TileType } from './types';

const GROUND = 3;

interface Cone {
  /** Fractions of the map size. */
  fx: number;
  fy: number;
  radius: number;
  peak: number;
  /** A rock tower on the summit. */
  crown: boolean;
}

/** Player 1's side; each cone also stands at its mirror. */
const CONES: readonly Cone[] = [
  { fx: 0.26, fy: 0.48, radius: 8, peak: 6, crown: true }, // Kletečná
  { fx: 0.44, fy: 0.72, radius: 9, peak: 6, crown: false }, // Lovoš
  { fx: 0.2, fy: 0.62, radius: 6, peak: 5, crown: false }, // Boreč
  { fx: 0.62, fy: 0.88, radius: 6, peak: 5, crown: false }, // Radobýl
  { fx: 0.1, fy: 0.32, radius: 7, peak: 6, crown: true }, // Oblík
];

/** Woods on player 1's side: [fx, fy, radius]. */
const WOODS: ReadonlyArray<readonly [number, number, number]> = [
  [0.05, 0.6, 7],
  [0.34, 0.97, 6],
  [0.03, 0.08, 8],
  [0.28, 0.86, 4],
  [0.52, 0.98, 5],
  [0.08, 0.98, 5],
];

export function generateMilesovkaUplandsMap(): MapData {
  const map = createLargeMap(TileType.GRASS, GROUND);
  const c = mapCentre(map);
  const p1 = at(map, 0.17, 0.83);
  const p2 = mirrorPoint(map, p1);
  const spires = new SpireField(map);

  // Rolling farmland between the hills.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const n = mirroredNoise(map, x, y, 14, 0x5e1);
      map.elevation[y * map.width + x] = GROUND + Math.round((n - 0.5) * 2.2);
    }
  }

  for (const [fx, fy, radius] of WOODS) {
    const a = at(map, fx, fy);
    for (const p of [a, mirrorPoint(map, a)]) paintWood(map, p, radius);
  }

  for (const cone of CONES) {
    const a = at(map, cone.fx, cone.fy);
    for (const p of [a, mirrorPoint(map, a)]) paintCone(map, p, cone.radius, cone.peak);
    if (cone.crown) spires.placePair(a.x, a.y, 2, TileType.STONE, cone.peak + 1);
  }

  // Milešovka: the big cone, bare rock above the woods, a crown of towers.
  paintCone(map, c, 15, 7, 0.36);
  spires.placePair(Math.floor(c.x) - 1, Math.floor(c.y) - 1, 4, TileType.STONE, 7);
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 6;
    const x = Math.round(c.x + dcos(angle) * 4.8 - 0.5);
    const y = Math.round(c.y + dsin(angle) * 4.8 - 0.5);
    spires.placePair(x, y, 2, TileType.STONE, 7);
  }

  // The brooks: from the foot of Milešovka out to the two far corners.
  const brook = brookLine(c);
  const fordA = brook[3];
  const bridge = brook[6];
  const fordB = brook[9];
  for (const line of [brook, mirrorPolyline(map, brook)]) {
    forPolyline(map, line, 1.25, (idx) => paint(map, idx, TileType.WATER_SHALLOW, GROUND - 1));
    forPolyline(map, line, 2.4, (idx, d) => {
      if (d > 1.25 && map.tiles[idx] === TileType.FOREST) paint(map, idx, TileType.GRASS);
    });
  }

  // Roads from each home over its two bridges and to the foot of the
  // mountain. Player 1 sits on the x < y side of both brooks; a road crosses
  // to the far bank along (+1, -1).
  const across = (p: Point): Point => ({ x: p.x + 3, y: p.y - 3 });
  const farBridge = mirrorPoint(map, bridge);
  const toward = { x: c.x - 11, y: c.y + 11 };
  const roads: Point[][] = [
    [p1, { x: p1.x + 6, y: p1.y - 22 }, bridge, across(bridge)],
    [p1, { x: p1.x + 24, y: p1.y - 2 }, farBridge, across(farBridge)],
    [p1, { x: p1.x + 14, y: p1.y - 14 }, toward],
  ];
  for (const road of roads) {
    for (const line of [road, mirrorPolyline(map, road)]) {
      forPolyline(map, line, 1.1, (idx) => {
        const t = map.tiles[idx];
        if (t === TileType.WATER_SHALLOW || t === TileType.BRIDGE) paint(map, idx, TileType.BRIDGE, GROUND);
        else paint(map, idx, TileType.DIRT, GROUND);
      });
    }
  }

  // Muddy fords: walkable, but they slow everything down.
  for (const ford of [fordA, fordB]) {
    for (const p of [ford, mirrorPoint(map, ford)]) {
      forDisc(map, p.x, p.y, 2.3, (idx) => paint(map, idx, TileType.MUD, GROUND - 1));
    }
  }

  for (const p of [p1, p2]) clearHome(map, p, 10);

  // Stone on the bare summits, gold on Kletečná and on Milešovka's saddles.
  const borec = at(map, CONES[2].fx, CONES[2].fy);
  const kletecna = at(map, CONES[0].fx, CONES[0].fy);
  const saddle = { x: Math.round(c.x - 6.5), y: Math.round(c.y - 6.5) };
  addDepositCluster(map, 'stone', { x: borec.x - 1, y: borec.y - 1 }, 4, 'flank');
  addDepositCluster(map, 'gold', { x: kletecna.x + 2, y: kletecna.y + 2 }, 3, 'flank');
  addDepositCluster(map, 'gold', saddle, 3, 'center');
  addDepositCluster(map, 'stone', { x: saddle.x - 3, y: saddle.y + 1 }, 2, 'center');

  symmetrize(map);
  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

/** A cone: rising ground, a bare rock top, forest on the slopes with glades. */
function paintCone(map: MapData, p: Point, radius: number, peak: number, rockShare = 0.32): void {
  forDisc(map, p.x, p.y, radius, (idx, d, x, y) => {
    const k = 1 - d / radius;
    const rise = Math.round((peak - GROUND) * k * k * (3 - 2 * k));
    map.elevation[idx] = Math.max(map.elevation[idx], GROUND + rise);
    if (d < radius * rockShare) {
      map.tiles[idx] = TileType.STONE;
    } else if (d < radius * 0.86 && mirroredNoise(map, x, y, 4, 0xc0e) < 0.7) {
      map.tiles[idx] = TileType.FOREST;
    }
  });
}

/** A wood with a ragged edge. */
function paintWood(map: MapData, p: Point, radius: number): void {
  forDisc(map, p.x, p.y, radius * 1.3, (idx, d, x, y) => {
    const edge = radius * (0.8 + 0.5 * mirroredNoise(map, x, y, 3, 0x7d));
    if (d <= edge && map.tiles[idx] === TileType.GRASS) map.tiles[idx] = TileType.FOREST;
  });
}

/** Meandering brook from the foot of the mountain to the top-left corner. */
function brookLine(c: Point): Point[] {
  const start = { x: c.x - 9.5, y: c.y - 9.5 };
  const end = { x: -2, y: -2 };
  const points: Point[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wobble = 4 * dsin(t * Math.PI * 3);
    points.push({
      x: start.x + (end.x - start.x) * t + wobble * 0.7071,
      y: start.y + (end.y - start.y) * t - wobble * 0.7071,
    });
  }
  return points;
}

/** Open ground for a town: grass at ground level, no wood or rock. */
function clearHome(map: MapData, p: Point, radius: number): void {
  forDisc(map, p.x, p.y, radius, (idx) => {
    const t = map.tiles[idx];
    if (t === TileType.DIRT || t === TileType.BRIDGE) return;
    paint(map, idx, TileType.GRASS, GROUND);
  });
}
