/**
 * Shared terrain primitives: noise, painting, carving, features, spawns and walkability.
 */

import { MAP } from '../../config';
import {
  type MapData,
  type MapFeature,
  MapFeatureKind,
  TileType,
  type TileTypeValue,
} from './types';

export const W = MAP.WIDTH;
export const H = MAP.HEIGHT;

function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) ^ Math.imul(y - seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smoothstep(gx - x0);
  const fy = smoothstep(gy - y0);
  const a = hash01(x0, y0, seed);
  const b = hash01(x0 + 1, y0, seed);
  const c = hash01(x0, y0 + 1, seed);
  const d = hash01(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

export function isWaterTile(tile: number): boolean {
  return tile === TileType.WATER || tile === TileType.WATER_SHALLOW;
}

export function ellipseDistance(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): number {
  const nx = (x - cx) / Math.max(1, rx);
  const ny = (y - cy) / Math.max(1, ry);
  return Math.hypot(nx, ny);
}

export function mapIndex(x: number, y: number): number {
  return y * W + x;
}

export function createBaseMap(tileType: TileTypeValue, elevationLevel: number): MapData {
  const tiles = new Uint8Array(W * H);
  const elevation = new Uint8Array(W * H);
  tiles.fill(tileType);
  elevation.fill(clampElevation(elevationLevel));
  const walkability = Array.from({ length: H }, () => Array.from({ length: W }, () => 0));
  return {
    tiles,
    elevation,
    bridgePositions: [],
    walkability,
    spawns: [{ x: 0, y: 0 }],
    features: [],
  };
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

export function clampElevation(value: number): number {
  return Math.max(0, Math.min(7, value));
}

export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  return Math.hypot(px - cx, py - cy);
}

export function carveDryRoad(
  map: MapData,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  waterTile: number = TileType.DIRT
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = isWaterTile(map.tiles[idx]) ? waterTile : TileType.DIRT;
      map.elevation[idx] = Math.max(2, Math.min(3, map.elevation[idx]));
    }
  }
}

export function addVerticalCauseway(map: MapData, centerX: number, radius: number): void {
  for (let y = 2; y < H - 2; y++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = centerX + dx;
      if (!inBounds(x, y)) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = isWaterTile(map.tiles[idx]) ? TileType.BRIDGE : TileType.DIRT;
      map.elevation[idx] = Math.max(2, map.elevation[idx]);
    }
  }
}

export function addDryIsland(map: MapData, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      map.elevation[idx] = d < radius * 0.6 ? 3 : 2;
      map.tiles[idx] = d < radius * 0.78 ? TileType.GRASS : TileType.SAND;
    }
  }
}

export function addForestBlob(
  map: MapData,
  cx: number,
  cy: number,
  radius: number,
  fullness: number
): void {
  const clampedFullness = Math.max(0, Math.min(1, fullness));
  const effectiveRadius = radius * (0.62 + clampedFullness * 0.38);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      const edge = effectiveRadius
        * (1 + Math.sin((x + cx) * 0.34) * 0.04 + Math.cos((y - cy) * 0.31) * 0.04);
      if (d > edge) continue;
      const idx = mapIndex(x, y);
      const tile = map.tiles[idx];
      if (
        isWaterTile(tile)
        || tile === TileType.BRIDGE
        || tile === TileType.DIRT
        || tile === TileType.SAND
        || tile === TileType.MUD
      ) {
        continue;
      }
      map.tiles[idx] = TileType.FOREST;
    }
  }
}

export function carveForestClearing(
  map: MapData,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      if (!inBounds(x, y)) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const boundary = nx * nx + ny * ny
        + Math.sin((x + cx) * 0.27) * 0.045
        + Math.cos((y - cy) * 0.31) * 0.045;
      if (boundary > 1) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

export function addStonePocket(map: MapData, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      if (map.tiles[idx] === TileType.DIRT) continue;
      map.tiles[idx] = TileType.STONE;
      map.elevation[idx] = d < radius * 0.55 ? 5 : 4;
    }
  }
}

export function addMountainRockSpires(
  map: MapData,
  roadStart: { x: number; y: number },
  roadEnd: { x: number; y: number }
): void {
  const anchors: Array<{ x: number; y: number; size: 2 | 4 }> = [
    { x: 0.10, y: 0.18, size: 4 },
    { x: 0.09, y: 0.65, size: 4 },
    { x: 0.34, y: 0.18, size: 2 },
    { x: 0.27, y: 0.48, size: 2 },
    { x: 0.45, y: 0.86, size: 4 },
    { x: 0.58, y: 0.13, size: 2 },
    { x: 0.69, y: 0.84, size: 2 },
    { x: 0.76, y: 0.56, size: 2 },
    { x: 0.88, y: 0.82, size: 4 },
    { x: 0.91, y: 0.34, size: 4 },
  ];

  for (const anchor of anchors) {
    const x = Math.round(W * anchor.x);
    const y = Math.round(H * anchor.y);
    if (pointSegmentDistance(x, y, roadStart.x, roadStart.y, roadEnd.x, roadEnd.y) < 6.5) {
      continue;
    }
    addRockSpireFeature(map, x, y, anchor.size, roadStart, roadEnd);
  }
}

function addRockSpireFeature(
  map: MapData,
  cx: number,
  cy: number,
  size: 2 | 4,
  roadStart: { x: number; y: number },
  roadEnd: { x: number; y: number }
): void {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = Math.round(cx + dx - (size - 1) / 2);
        const y = Math.round(cy + dy - (size - 1) / 2);
        if (!canPlaceRockSpire(map, x, y, size, roadStart, roadEnd)) continue;
        forRockSpireFootprint(x, y, size, (tx, ty) => {
          const idx = mapIndex(tx, ty);
          map.tiles[idx] = TileType.STONE;
          const centerBoost = Math.hypot(tx - (x + (size - 1) / 2), ty - (y + (size - 1) / 2)) < size * 0.36;
          map.elevation[idx] = clampElevation(Math.max(map.elevation[idx], centerBoost ? 7 : 6));
        });
        map.features.push({ kind: MapFeatureKind.ROCK_SPIRE, x, y, size });
        return;
      }
    }
  }
}

function canPlaceRockSpire(
  map: MapData,
  x: number,
  y: number,
  size: number,
  roadStart: { x: number; y: number },
  roadEnd: { x: number; y: number }
): boolean {
  if (x < 1 || y < 1 || x + size >= W - 1 || y + size >= H - 1) return false;
  for (const feature of map.features) {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) continue;
    if (rockSlicesOverlap(x, y, size, feature.x, feature.y, rockFeatureSize(feature), 2)) {
      return false;
    }
  }
  let stoneOrHighGround = false;
  let canPlace = true;
  forRockSpireFootprint(x, y, size, (tx, ty) => {
    const idx = mapIndex(tx, ty);
    const tile = map.tiles[idx];
    if (
      isWaterTile(tile)
      || tile === TileType.BRIDGE
      || tile === TileType.DIRT
      || tile === TileType.SAND
      || pointSegmentDistance(tx, ty, roadStart.x, roadStart.y, roadEnd.x, roadEnd.y) < 5.4
    ) {
      canPlace = false;
      return;
    }
    if (tile === TileType.STONE || map.elevation[idx] >= 5) stoneOrHighGround = true;
  });
  if (!canPlace) return false;
  return stoneOrHighGround;
}

function rockSlicesOverlap(
  ax: number,
  ay: number,
  asize: number,
  bx: number,
  by: number,
  bsize: number,
  padding: number
): boolean {
  return (
    ax - padding < bx + bsize
    && ax + asize + padding > bx
    && ay - padding < by + bsize
    && ay + asize + padding > by
  );
}

export function addLindenTreeFeature(map: MapData, cx: number, cy: number): void {
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!canPlaceLindenTree(map, x, y)) continue;
        map.features.push({ kind: MapFeatureKind.LINDEN_TREE, x, y });
        return;
      }
    }
  }
}

function canPlaceLindenTree(map: MapData, x: number, y: number): boolean {
  if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
  const tile = map.tiles[mapIndex(x, y)];
  if (tile !== TileType.FOREST && tile !== TileType.GRASS) return false;
  for (const feature of map.features) {
    if (Math.hypot(feature.x - x, feature.y - y) < 4) return false;
  }
  return true;
}

export function clearSpawnPatch(
  map: MapData,
  cx: number,
  cy: number,
  radius = 3
): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = Math.abs(x - cx) + Math.abs(y - cy) <= 1 ? TileType.DIRT : TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

export function applySandFringe(map: MapData): void {
  const next = Uint8Array.from(map.tiles);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      if (map.tiles[idx] !== TileType.GRASS) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!inBounds(x + dx, y + dy)) continue;
          if (isWaterTile(map.tiles[mapIndex(x + dx, y + dy)])) {
            nearWater = true;
            break;
          }
        }
      }
      if (nearWater) next[idx] = TileType.SAND;
    }
  }
  map.tiles.set(next);
}

function forRockSpireFootprint(
  x: number,
  y: number,
  size: number,
  visit: (x: number, y: number) => void
): void {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(tx, ty)) continue;
      visit(tx, ty);
    }
  }
}

function rockFeatureSize(feature: MapFeature): number {
  return feature.kind === MapFeatureKind.ROCK_SPIRE ? Math.max(2, feature.size ?? 2) : 1;
}

export function rebuildWalkability(map: MapData): void {
  for (let y = 0; y < H; y++) {
    if (!map.walkability[y]) map.walkability[y] = [];
    for (let x = 0; x < W; x++) {
      map.walkability[y][x] = isWaterTile(map.tiles[mapIndex(x, y)]) ? 1 : 0;
    }
  }
  for (const feature of map.features) {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) continue;
    forRockSpireFootprint(feature.x, feature.y, rockFeatureSize(feature), (x, y) => {
      map.walkability[y][x] = 1;
    });
  }
}

export function setSpawns(
  map: MapData,
  p1Prefer: { x: number; y: number },
  p2Prefer: { x: number; y: number }
): void {
  map.spawns[1] = findClearSpawn(map, p1Prefer.x, p1Prefer.y);
  map.spawns[2] = findClearSpawn(map, p2Prefer.x, p2Prefer.y);
}

function findClearSpawn(map: MapData, preferX: number, preferY: number): { x: number; y: number } {
  for (let r = 0; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = preferX + dx;
        const y = preferY + dy;
        if (x < 4 || y < 4 || x >= W - 4 || y >= H - 4) continue;
        if (map.walkability[y][x] !== 0) continue;
        const tile = map.tiles[mapIndex(x, y)];
        if (
          tile !== TileType.GRASS
          && tile !== TileType.DIRT
          && tile !== TileType.SNOW
          && tile !== TileType.PACKED_SNOW
        ) continue;
        if (hasNearbyWater(map, x, y, 2)) continue;
        return { x, y };
      }
    }
  }
  return { x: preferX, y: preferY };
}

function hasNearbyWater(map: MapData, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (isWaterTile(map.tiles[mapIndex(nx, ny)])) return true;
    }
  }
  return false;
}

export function refreshBridgePositions(map: MapData): void {
  map.bridgePositions.length = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map.tiles[mapIndex(x, y)] === TileType.BRIDGE) {
        map.bridgePositions.push({ x, y });
      }
    }
  }
}

/** Helper for the render layer — get tile type at (x, y). */
export function getTile(map: MapData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= W || y >= H) return TileType.GRASS;
  return map.tiles[y * W + x];
}

/** Helper — get elevation at (x, y). */
export function getElevation(map: MapData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= W || y >= H) return 3;
  return map.elevation[y * W + x];
}
