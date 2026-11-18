/**
 * Building blocks for the large (MAP.LARGE_SIZE) skirmish maps. Every large
 * map is point-mirrored through its centre: shapes are painted in mirrored
 * pairs and symmetrize() makes the halves exactly equal at the end, so both
 * sides always get the same land. No rng: the shapes come from fixed anchors
 * and the deterministic hash noise in terrain.ts.
 */

import { MAP } from '../../config';
import { dhypot } from '../core/dmath';
import { clampElevation, createBaseMap, pointSegmentDistance, valueNoise } from './terrain';
import { type MapData, type MapDeposit, MapFeatureKind, type TileTypeValue } from './types';

export interface Point {
  x: number;
  y: number;
}

/** A fresh large map filled with one tile type at one elevation. */
export function createLargeMap(tileType: TileTypeValue, elevationLevel: number): MapData {
  const map = createBaseMap(tileType, elevationLevel, MAP.LARGE_SIZE, MAP.LARGE_SIZE);
  map.deposits = [];
  return map;
}

/** The tile point-mirrored through the middle of the map. */
export function mirrorPoint(map: MapData, p: Point): Point {
  return { x: map.width - 1 - p.x, y: map.height - 1 - p.y };
}

/** Exact centre of the map (between tiles on an even-sized map). */
export function mapCentre(map: MapData): Point {
  return { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
}

/** A point at fractions of the map size, rounded to a tile. */
export function at(map: MapData, fx: number, fy: number): Point {
  return { x: Math.round((map.width - 1) * fx), y: Math.round((map.height - 1) * fy) };
}

/** Value noise that reads the same at a tile and at its mirror. */
export function mirroredNoise(map: MapData, x: number, y: number, scale: number, seed: number): number {
  const m = mirrorPoint(map, { x, y });
  return (valueNoise(x, y, scale, seed) + valueNoise(m.x, m.y, scale, seed)) / 2;
}

/** Visit every tile within `radius` of (cx, cy) with its distance. */
export function forDisc(
  map: MapData,
  cx: number,
  cy: number,
  radius: number,
  visit: (idx: number, d: number, x: number, y: number) => void
): void {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = dhypot(x - cx, y - cy);
      if (d <= radius) visit(y * map.width + x, d, x, y);
    }
  }
}

/** Visit every tile within `radius` of a polyline with its distance to it. */
export function forPolyline(
  map: MapData,
  points: readonly Point[],
  radius: number,
  visit: (idx: number, d: number, x: number, y: number) => void
): void {
  const best = new Map<number, number>();
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
    const x1 = Math.min(map.width - 1, Math.ceil(Math.max(a.x, b.x) + radius));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
    const y1 = Math.min(map.height - 1, Math.ceil(Math.max(a.y, b.y) + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
        if (d > radius) continue;
        const idx = y * map.width + x;
        const prev = best.get(idx);
        if (prev === undefined || d < prev) best.set(idx, d);
      }
    }
  }
  // Ascending tile order, so the visit order never depends on the segments.
  for (const idx of [...best.keys()].sort((p, q) => p - q)) {
    visit(idx, best.get(idx) ?? 0, idx % map.width, Math.floor(idx / map.width));
  }
}

/** The same polyline on the other side of the map. */
export function mirrorPolyline(map: MapData, points: readonly Point[]): Point[] {
  return points.map((p) => mirrorPoint(map, p));
}

/** Set a tile's type and elevation. */
export function paint(map: MapData, idx: number, tile: TileTypeValue, elevation?: number): void {
  map.tiles[idx] = tile;
  if (elevation !== undefined) map.elevation[idx] = clampElevation(elevation);
}

/**
 * Tracks which tiles hold a rock spire so spires never overlap. Spires block
 * movement (rebuildWalkability) and are drawn as rock towers.
 */
export class SpireField {
  private readonly taken: Uint8Array;

  constructor(private readonly map: MapData) {
    this.taken = new Uint8Array(map.width * map.height);
  }

  /** Whether a size x size spire with its top-left tile at (x, y) fits. */
  fits(x: number, y: number, size: number, margin = 1): boolean {
    const { map } = this;
    if (x < margin || y < margin || x + size > map.width - margin || y + size > map.height - margin) {
      return false;
    }
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.taken[(y + dy) * map.width + x + dx] === 1) return false;
      }
    }
    return true;
  }

  /**
   * Place a spire and its mirror. The ground under it turns to `ground` at
   * the given elevation. Returns false (placing nothing) when either does
   * not fit. `margin` is the strip along the map edge kept free of spires.
   */
  placePair(
    x: number,
    y: number,
    size: number,
    ground: TileTypeValue,
    elevation: number,
    margin = 1
  ): boolean {
    const { map } = this;
    const mx = map.width - size - x;
    const my = map.height - size - y;
    if (!this.fits(x, y, size, margin) || !this.fits(mx, my, size, margin)) return false;
    const overlapsOwnMirror = x < mx + size && mx < x + size && y < my + size && my < y + size;
    if (overlapsOwnMirror && (mx !== x || my !== y)) return false;
    for (const [sx, sy] of mx === x && my === y ? [[x, y]] : [[x, y], [mx, my]]) {
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const idx = (sy + dy) * map.width + sx + dx;
          this.taken[idx] = 1;
          paint(map, idx, ground, elevation);
        }
      }
      map.features.push({ kind: MapFeatureKind.ROCK_SPIRE, x: sx, y: sy, size });
    }
    return true;
  }
}

/** Distance from (x, y) to a polyline. */
export function polylineDistance(points: readonly Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    best = Math.min(best, pointSegmentDistance(x, y, a.x, a.y, b.x, b.y));
  }
  return best;
}

export interface CellTowerOptions {
  /** Whether the aligned 2 x 2 cell (i, j), tiles (2i..2i+1, 2j..2j+1), is rock. */
  rock: (i: number, j: number) => boolean;
  /** Whether an open cell may be filled to close a diagonal gap. */
  canSeal: (i: number, j: number) => boolean;
  ground: TileTypeValue;
  elevation: number;
  /** Merge whole aligned 4 x 4 blocks of rock into one big tower. */
  merge?: boolean;
  /**
   * A tile every open cell should connect to. Open cells walled off from it
   * (pockets a unit could never reach) are filled with rock where `canSeal`
   * allows, so no path search ever has to give up on one.
   */
  reachFrom?: Point;
}

/**
 * Rock towers on the aligned 2 x 2 grid. Paths may cut corners, so two towers
 * that touch only at a corner leave a gap a unit walks through; every such
 * gap is closed by filling one of the two open cells beside it (the one
 * farther from the middle, both on a tie, never one `canSeal` refuses). The
 * rule reads the same at a cell and at its mirror, so the result stays
 * symmetric. Towers may stand right at the map edge.
 */
export function placeCellTowers(map: MapData, spires: SpireField, options: CellTowerOptions): void {
  const cols = map.width / 2;
  const rows = map.height / 2;
  let rock = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) rock[j * cols + i] = options.rock(i, j) ? 1 : 0;
  }
  const centre = { x: (cols - 1) / 2, y: (rows - 1) / 2 };
  const far = (i: number, j: number) => (i - centre.x) ** 2 + (j - centre.y) ** 2;
  for (let pass = 0; pass < 6; pass++) {
    const next = rock.slice();
    let changed = false;
    const isRock = (i: number, j: number) => rock[j * cols + i] === 1;
    const seal = (a: readonly [number, number], b: readonly [number, number]) => {
      const fa = far(a[0], a[1]);
      const fb = far(b[0], b[1]);
      const okA = options.canSeal(a[0], a[1]);
      const okB = options.canSeal(b[0], b[1]);
      const pick: Array<readonly [number, number]> = [];
      if (okA && (fa >= fb || !okB)) pick.push(a);
      if (okB && (fb >= fa || !okA)) pick.push(b);
      for (const [i, j] of pick) {
        if (next[j * cols + i] === 0) {
          next[j * cols + i] = 1;
          changed = true;
        }
      }
    };
    for (let j = 0; j + 1 < rows; j++) {
      for (let i = 0; i + 1 < cols; i++) {
        const tl = isRock(i, j);
        const tr = isRock(i + 1, j);
        const bl = isRock(i, j + 1);
        const br = isRock(i + 1, j + 1);
        if (tl && br && !tr && !bl) seal([i + 1, j], [i, j + 1]);
        if (tr && bl && !tl && !br) seal([i, j], [i + 1, j + 1]);
      }
    }
    rock = next;
    if (!changed) break;
  }
  if (options.reachFrom) {
    const seen = new Uint8Array(cols * rows);
    const start = Math.floor(options.reachFrom.y / 2) * cols + Math.floor(options.reachFrom.x / 2);
    const stack = rock[start] === 0 ? [start] : [];
    seen[start] = 1;
    while (stack.length > 0) {
      const c = stack.pop() ?? 0;
      const ci = c % cols;
      const cj = Math.floor(c / cols);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const n = nj * cols + ni;
          if (seen[n] === 0 && rock[n] === 0) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    for (let c = 0; c < cols * rows; c++) {
      if (rock[c] === 0 && seen[c] === 0 && options.canSeal(c % cols, Math.floor(c / cols))) rock[c] = 1;
    }
  }
  const isRock = (i: number, j: number) => i < cols && j < rows && rock[j * cols + i] === 1;
  for (let b = 0; b < rows; b += 2) {
    for (let a = 0; a < cols; a += 2) {
      if (options.merge && isRock(a, b) && isRock(a + 1, b) && isRock(a, b + 1) && isRock(a + 1, b + 1)) {
        if (spires.placePair(2 * a, 2 * b, 4, options.ground, options.elevation, 0)) continue;
      }
      for (const [i, j] of [[a, b], [a + 1, b], [a, b + 1], [a + 1, b + 1]]) {
        if (isRock(i, j)) spires.placePair(2 * i, 2 * j, 2, options.ground, options.elevation, 0);
      }
    }
  }
}

/**
 * Make the map exactly point-symmetric: every tile of the half holding
 * player 1 (the lower rows) is copied onto its mirror. Painting in mirrored
 * pairs already gets close; this removes the last one-tile differences.
 */
export function symmetrize(map: MapData): void {
  const n = map.width * map.height;
  for (let idx = Math.ceil(n / 2); idx < n; idx++) {
    const mirror = n - 1 - idx;
    map.tiles[mirror] = map.tiles[idx];
    map.elevation[mirror] = map.elevation[idx];
  }
}

/** Add an authored deposit on player 1's side (its mirror is implied). */
export function addDeposit(map: MapData, deposit: MapDeposit): void {
  if (!map.deposits) map.deposits = [];
  map.deposits.push(deposit);
}

/** A few deposits of one kind in a small cluster around (x, y). */
export function addDepositCluster(
  map: MapData,
  kind: MapDeposit['kind'],
  centre: Point,
  count: number,
  tier: MapDeposit['tier']
): void {
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 0],
    [0, -1],
  ];
  for (const [dx, dy] of offsets.slice(0, count)) {
    addDeposit(map, { kind, x: centre.x + dx, y: centre.y + dy, tier });
  }
}

