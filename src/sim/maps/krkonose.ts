/**
 * Krkonose winter crown: mirrored snow map.
 */

import {
  H,
  W,
  clampElevation,
  createBaseMap,
  inBounds,
  isWaterTile,
  mapIndex,
  pointSegmentDistance,
  rebuildWalkability,
  refreshBridgePositions,
  setSpawns,
} from './terrain';
import { type MapData, TileType } from './types';

export function generateKrkonoseWinterCrownMap(): MapData {
  const map = createBaseMap(TileType.SNOW, 3);
  const p1 = { x: Math.round(W * 0.18), y: Math.round(H * 0.78) };
  const p2 = mirrorMapPoint(p1);
  const centerX = (W - 1) / 2;
  const centerY = (H - 1) / 2;
  const mainPassA = p1;
  const mainPassB = p2;
  const crossPassA = { x: Math.round(W * 0.18), y: Math.round(H * 0.30) };
  const crossPassB = mirrorMapPoint(crossPassA);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const mainPassD = pointSegmentDistance(x, y, mainPassA.x, mainPassA.y, mainPassB.x, mainPassB.y);
      const crossPassD = pointSegmentDistance(x, y, crossPassA.x, crossPassA.y, crossPassB.x, crossPassB.y);
      const crownD = Math.abs(
        Math.hypot((x - centerX) / (W * 0.28), (y - centerY) / (H * 0.22)) - 1
      );
      const shoulderD = Math.abs(
        Math.hypot((x - centerX) / (W * 0.38), (y - centerY) / (H * 0.34)) - 1
      );

      let elevation = 3;
      if (edge < 4) elevation = 6;
      else if (edge < 8) elevation = 5;
      if (shoulderD < 0.06) elevation = Math.max(elevation, 4);
      if (crownD < 0.15 && mainPassD > 4.0 && crossPassD > 3.0) elevation = Math.max(elevation, 5);
      if (crownD < 0.07 && mainPassD > 4.6 && crossPassD > 3.4) elevation = Math.max(elevation, 6);
      if (mainPassD < 2.6 || crossPassD < 1.6) elevation = Math.min(elevation, 3);

      map.elevation[idx] = clampElevation(elevation);
      map.tiles[idx] = elevation >= 6 ? TileType.STONE : TileType.SNOW;
    }
  }

  carvePackedSnowRoad(map, mainPassA, mainPassB, 2.0);
  carvePackedSnowRoad(map, crossPassA, crossPassB, 1.15);
  paintCentralIce(map, centerX, centerY);

  addMirroredSnowForestBlob(map, Math.round(W * 0.10), Math.round(H * 0.68), 8, 0.95);
  addMirroredSnowForestBlob(map, Math.round(W * 0.24), Math.round(H * 0.87), 9, 0.92);
  addMirroredSnowForestBlob(map, Math.round(W * 0.34), Math.round(H * 0.64), 7, 0.86);
  addMirroredSnowForestBlob(map, Math.round(W * 0.14), Math.round(H * 0.91), 6, 0.84);
  addMirroredSnowForestBlob(map, Math.round(W * 0.30), Math.round(H * 0.37), 6, 0.76);
  addMirroredSnowForestBlob(map, Math.round(W * 0.42), Math.round(H * 0.20), 6, 0.76);

  addMirroredSnowStonePocket(map, Math.round(W * 0.28), Math.round(H * 0.57), 4);
  addMirroredSnowStonePocket(map, Math.round(W * 0.17), Math.round(H * 0.47), 3);
  addMirroredSnowStonePocket(map, Math.round(W * 0.40), Math.round(H * 0.78), 3);

  clearSnowSpawnPatch(map, p1.x, p1.y, 5);
  clearSnowSpawnPatch(map, p2.x, p2.y, 5);

  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function mirrorMapPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: W - 1 - point.x, y: H - 1 - point.y };
}

function carvePackedSnowRoad(
  map: MapData,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = TileType.PACKED_SNOW;
      map.elevation[idx] = Math.min(map.elevation[idx], 3);
    }
  }
}

function paintCentralIce(map: MapData, centerX: number, centerY: number): void {
  const rx = W * 0.16;
  const ry = H * 0.12;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const d = Math.hypot((x - centerX) / rx, (y - centerY) / ry);
      const frostRipple = Math.cos((x - centerX) * 0.54) * 0.025
        + Math.cos((y - centerY) * 0.46) * 0.025;
      const edge = d + frostRipple;
      if (edge <= 0.82) {
        map.tiles[idx] = TileType.ICE;
        map.elevation[idx] = 2;
      } else if (edge <= 1.04 && map.tiles[idx] !== TileType.STONE) {
        map.tiles[idx] = TileType.PACKED_SNOW;
        map.elevation[idx] = Math.min(map.elevation[idx], 3);
      }
    }
  }
}

function addMirroredSnowForestBlob(
  map: MapData,
  cx: number,
  cy: number,
  radius: number,
  fullness: number
): void {
  addSnowForestBlob(map, cx, cy, radius, fullness);
  const mirrored = mirrorMapPoint({ x: cx, y: cy });
  if (mirrored.x !== cx || mirrored.y !== cy) {
    addSnowForestBlob(map, mirrored.x, mirrored.y, radius, fullness);
  }
}

function addSnowForestBlob(
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
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const edge = effectiveRadius
        * (1 + Math.cos(dx * 0.41 + dy * 0.17) * 0.04 + Math.cos((dx - dy) * 0.29) * 0.04);
      if (d > edge) continue;
      const idx = mapIndex(x, y);
      const tile = map.tiles[idx];
      if (
        tile === TileType.ICE
        || tile === TileType.PACKED_SNOW
        || tile === TileType.STONE
        || isWaterTile(tile)
      ) {
        continue;
      }
      map.tiles[idx] = TileType.SNOW_FOREST;
    }
  }
}

function addMirroredSnowStonePocket(map: MapData, cx: number, cy: number, radius: number): void {
  addSnowStonePocket(map, cx, cy, radius);
  const mirrored = mirrorMapPoint({ x: cx, y: cy });
  if (mirrored.x !== cx || mirrored.y !== cy) {
    addSnowStonePocket(map, mirrored.x, mirrored.y, radius);
  }
}

function addSnowStonePocket(map: MapData, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      if (map.tiles[idx] === TileType.ICE || map.tiles[idx] === TileType.PACKED_SNOW) continue;
      map.tiles[idx] = TileType.STONE;
      map.elevation[idx] = d < radius * 0.55 ? 5 : 4;
    }
  }
}

function clearSnowSpawnPatch(
  map: MapData,
  cx: number,
  cy: number,
  radius: number
): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = Math.abs(x - cx) + Math.abs(y - cy) <= 1
        ? TileType.PACKED_SNOW
        : TileType.SNOW;
      map.elevation[idx] = 3;
    }
  }
}
