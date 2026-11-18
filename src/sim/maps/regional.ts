/**
 * Smaller hand-shaped skirmish maps (border forest, ore pass, Machovo jezero, Silesian marsh, flooded basin, Blaník night watch).
 */

import { dcos, dhypot, dsin } from '../core/dmath';
import type { Rng } from '../rng';
import {
  H,
  W,
  addDryIsland,
  addForestBlob,
  addLindenTreeFeature,
  addMountainRockSpires,
  addStonePocket,
  addVerticalCauseway,
  applySandFringe,
  carveDryRoad,
  carveForestClearing,
  clampElevation,
  clearSpawnPatch,
  createBaseMap,
  inBounds,
  mapIndex,
  pointSegmentDistance,
  rebuildWalkability,
  refreshBridgePositions,
  setSpawns,
} from './terrain';
import { type MapData, TileType } from './types';

export function generateBohemianBorderForestMap(): MapData {
  const map = createBaseMap(TileType.FOREST, 3);
  const p1 = { x: Math.round(W * 0.18), y: Math.round(H * 0.76) };
  const p2 = { x: Math.round(W * 0.82), y: Math.round(H * 0.24) };
  const center = { x: Math.round(W * 0.50), y: Math.round(H * 0.50) };
  const northwestMine = { x: Math.round(W * 0.22), y: Math.round(H * 0.22) };
  const southeastMine = { x: Math.round(W * 0.78), y: Math.round(H * 0.78) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(map, x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const northRidge = y < H * 0.24 && x > W * 0.18 && x < W * 0.82;
      const southRidge = y > H * 0.76 && x > W * 0.18 && x < W * 0.82;
      map.elevation[idx] = clampElevation(edge < 5 || northRidge || southRidge ? 4 : 3);
    }
  }

  carveForestClearing(map, p1.x, p1.y, 9, 7);
  carveForestClearing(map, p2.x, p2.y, 9, 7);
  carveForestClearing(map, center.x, center.y, 8, 7);
  carveForestClearing(map, northwestMine.x, northwestMine.y, 7, 6);
  carveForestClearing(map, southeastMine.x, southeastMine.y, 7, 6);
  carveForestClearing(map, Math.round(W * 0.36), Math.round(H * 0.30), 5, 4);
  carveForestClearing(map, Math.round(W * 0.64), Math.round(H * 0.70), 5, 4);

  carveDryRoad(map, p1, center, 1.7);
  carveDryRoad(map, center, p2, 1.7);
  carveDryRoad(map, northwestMine, center, 1.25);
  carveDryRoad(map, center, southeastMine, 1.25);
  carveDryRoad(map, p1, { x: Math.round(W * 0.07), y: Math.round(H * 0.70) }, 1.1);
  carveDryRoad(map, p2, { x: Math.round(W * 0.93), y: Math.round(H * 0.30) }, 1.1);

  addStonePocket(map, northwestMine.x - 2, northwestMine.y + 2, 4);
  addStonePocket(map, southeastMine.x + 2, southeastMine.y - 2, 4);
  addForestBlob(map, Math.round(W * 0.49), Math.round(H * 0.18), 7, 0.92);
  addForestBlob(map, Math.round(W * 0.51), Math.round(H * 0.82), 7, 0.92);

  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

export function generateOreMountainPassMap(): MapData {
  const map = createBaseMap(TileType.GRASS, 3);
  const p1 = { x: Math.round(W * 0.16), y: Math.round(H * 0.78) };
  const p2 = { x: Math.round(W * 0.84), y: Math.round(H * 0.22) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(map, x, y);
      const roadD = pointSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const ridgeBand = roadD > 10 || edge < 6;
      const shoulder = roadD > 4.8 && roadD <= 10;

      if (roadD <= 2.1) {
        map.tiles[idx] = TileType.DIRT;
        map.elevation[idx] = 3;
      } else if (roadD <= 4.8) {
        map.tiles[idx] = roadD <= 3.1 ? TileType.DIRT : TileType.GRASS;
        map.elevation[idx] = 3;
      } else if (shoulder) {
        map.elevation[idx] = roadD > 7.2 ? 5 : 4;
        map.tiles[idx] = TileType.GRASS;
      } else if (ridgeBand) {
        map.elevation[idx] = clampElevation(edge < 4 || roadD > 16 ? 7 : 6);
        map.tiles[idx] = TileType.STONE;
      }
    }
  }

  carveDryRoad(map, p1, p2, 2.1);
  addForestBlob(map, Math.round(W * 0.24), Math.round(H * 0.30), 8, 0.86);
  addForestBlob(map, Math.round(W * 0.70), Math.round(H * 0.72), 9, 0.86);
  addForestBlob(map, Math.round(W * 0.50), Math.round(H * 0.18), 6, 0.78);
  addForestBlob(map, Math.round(W * 0.78), Math.round(H * 0.42), 5, 0.72);
  addMountainRockSpires(map, p1, p2);

  clearSpawnPatch(map, p1.x, p1.y);
  clearSpawnPatch(map, p2.x, p2.y);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

export function generateMachovoJezeroMap(): MapData {
  const map = createBaseMap(TileType.GRASS, 3);
  const cx = Math.round(W * 0.5);
  const cy = Math.round(H * 0.5);
  const rx = Math.round(W * 0.30);
  const ry = Math.round(H * 0.21);
  const p1 = { x: Math.round(W * 0.16), y: Math.round(H * 0.78) };
  const p2 = { x: Math.round(W * 0.84), y: Math.round(H * 0.22) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(map, x, y);
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = dhypot(nx, ny);
      const shoreline = d
        + dsin((x + y) * 0.12) * 0.035
        + dcos((x - y) * 0.10) * 0.03;

      if (shoreline <= 0.68) {
        map.elevation[idx] = 0;
        map.tiles[idx] = TileType.WATER;
      } else if (shoreline <= 1.0) {
        map.elevation[idx] = 1;
        map.tiles[idx] = TileType.WATER_SHALLOW;
      } else if (shoreline <= 1.18) {
        map.elevation[idx] = 2;
        map.tiles[idx] = TileType.SAND;
      } else if (shoreline <= 1.42) {
        map.elevation[idx] = 3;
        map.tiles[idx] = TileType.GRASS;
      }
    }
  }

  carveDryRoad(map, p1, { x: Math.round(W * 0.31), y: Math.round(H * 0.68) }, 1.8);
  carveDryRoad(map, { x: Math.round(W * 0.69), y: Math.round(H * 0.32) }, p2, 1.8);
  addForestBlob(map, Math.round(W * 0.20), Math.round(H * 0.22), 11, 0.96);
  addForestBlob(map, Math.round(W * 0.80), Math.round(H * 0.78), 11, 0.96);
  addForestBlob(map, Math.round(W * 0.18), Math.round(H * 0.56), 9, 0.92);
  addForestBlob(map, Math.round(W * 0.82), Math.round(H * 0.44), 9, 0.92);
  addForestBlob(map, Math.round(W * 0.48), Math.round(H * 0.16), 8, 0.86);
  addForestBlob(map, Math.round(W * 0.52), Math.round(H * 0.84), 8, 0.86);
  addMachovoLindenTrees(map);

  clearSpawnPatch(map, p1.x, p1.y);
  clearSpawnPatch(map, p2.x, p2.y);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

export function generateSilesianMarshMap(rng: Rng): MapData {
  const map = createBaseMap(TileType.GRASS, 2);
  const p1 = { x: Math.round(W * 0.16), y: Math.round(H * 0.74) };
  const p2 = { x: Math.round(W * 0.84), y: Math.round(H * 0.26) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(map, x, y);
      map.elevation[idx] = 2;
      map.tiles[idx] = TileType.GRASS;
    }
  }

  const channels = [0.24, 0.39, 0.57, 0.74];
  for (const channel of channels) {
    const phase = rng.next() * Math.PI * 2;
    for (let x = 0; x < W; x++) {
      const centerY = Math.round(H * channel + dsin(x * 0.18 + phase) * 3);
      for (let dy = -3; dy <= 3; dy++) {
        const y = centerY + dy;
        if (!inBounds(map, x, y)) continue;
        const idx = mapIndex(map, x, y);
        map.tiles[idx] = Math.abs(dy) <= 2 ? TileType.WATER_SHALLOW : TileType.SAND;
        map.elevation[idx] = 1;
      }
    }
  }

  addDryIsland(map, Math.round(W * 0.18), Math.round(H * 0.74), 8);
  addDryIsland(map, Math.round(W * 0.82), Math.round(H * 0.26), 8);
  addDryIsland(map, Math.round(W * 0.50), Math.round(H * 0.50), 7);
  carveDryRoad(map, p1, p2, 2.2, TileType.BRIDGE);
  for (const x of [Math.round(W * 0.24), Math.round(W * 0.5), Math.round(W * 0.76)]) {
    addVerticalCauseway(map, x, 1);
  }

  addForestBlob(map, Math.round(W * 0.12), Math.round(H * 0.18), 6, 0.74);
  addForestBlob(map, Math.round(W * 0.88), Math.round(H * 0.82), 6, 0.74);
  addForestBlob(map, Math.round(W * 0.50), Math.round(H * 0.50), 5, 0.68);
  applySandFringe(map);
  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

export function generateFloodedBasinMap(): MapData {
  // The parked "circle" arena, kept as a 1v1 skirmish map: a round grassy basin
  // pocked with mud shell-craters, ringed by impassable floodwater, with
  // symmetric north/south bases.
  const map = createBaseMap(TileType.WATER, 0);
  const cx = Math.round(W * 0.5);
  const cy = Math.round(H * 0.5);
  const R = Math.round(Math.min(W, H) * 0.40);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(map, x, y);
      const d = dhypot(x - cx, y - cy);
      if (d <= R) {
        const crater = dsin(x * 0.45 + y * 0.31) + dcos(x * 0.21 - y * 0.6);
        if (crater > 1.55) {
          map.tiles[idx] = TileType.MUD;
          map.elevation[idx] = 2;
        } else {
          map.tiles[idx] = TileType.GRASS;
          map.elevation[idx] = 3;
        }
      } else if (d <= R + 1.4) {
        map.tiles[idx] = TileType.WATER_SHALLOW;
        map.elevation[idx] = 1;
      }
    }
  }

  // Mirrored woodland near each base + a neutral central copse. (The world's
  // resource scatter fills in gold/stone/berries on the open ground.)
  addForestBlob(map, cx - 11, cy + 11, 4, 0.78);
  addForestBlob(map, cx + 11, cy + 11, 4, 0.78);
  addForestBlob(map, cx - 11, cy - 11, 4, 0.78);
  addForestBlob(map, cx + 11, cy - 11, 4, 0.78);
  addForestBlob(map, cx, cy, 3, 0.6);

  rebuildWalkability(map);
  setSpawns(
    map,
    { x: cx, y: cy + Math.round(R * 0.72) },
    { x: cx, y: cy - Math.round(R * 0.72) }
  );
  refreshBridgePositions(map);
  return map;
}

export function generateBlanikNightWatchMap(): MapData {
  // The night map: Blaník, a wooded hill with a bare stone crown, in the
  // middle; a home clearing in two opposite corners; a ring road around the
  // hill; and woods that break the open ground into pockets a torch can
  // hold. Point-mirrored through the centre, so both sides get the same land.
  const map = createBaseMap(TileType.GRASS, 3);
  const c = { x: Math.round(W * 0.5), y: Math.round(H * 0.5) };
  const mirror = (p: { x: number; y: number }) => ({ x: W - 1 - p.x, y: H - 1 - p.y });
  const at = (fx: number, fy: number) => ({ x: Math.round(W * fx), y: Math.round(H * fy) });
  const p1 = at(0.19, 0.79);
  const p2 = mirror(p1);
  const mine1 = at(0.2, 0.22);
  const mine2 = mirror(mine1);
  const west = { x: c.x - 16, y: c.y };
  const south = { x: c.x, y: c.y + 16 };
  const east = mirror(west);
  const north = mirror(south);

  // Woods first: the hill's skirt, the dark corners, and copses on the plain.
  addForestBlob(map, c.x, c.y, 12, 0.92);
  for (const [fx, fy, radius, fullness] of [
    [0.13, 0.13, 9, 0.9],
    [0.5, 0.05, 6, 0.85],
    [0.05, 0.5, 6, 0.85],
    [0.34, 0.72, 3, 0.8],
    [0.3, 0.4, 4, 0.8],
    [0.38, 0.9, 4, 0.8],
  ] as const) {
    const a = at(fx, fy);
    const b = mirror(a);
    addForestBlob(map, a.x, a.y, radius, fullness);
    addForestBlob(map, b.x, b.y, radius, fullness);
  }

  // The crown: bare rock two steps above the plain.
  addStonePocket(map, c.x, c.y, 5);

  for (const spawn of [p1, p2]) carveForestClearing(map, spawn.x, spawn.y, 8, 7);
  for (const mine of [mine1, mine2]) {
    carveForestClearing(map, mine.x, mine.y, 6, 5);
    addStonePocket(map, mine.x, mine.y, 2);
  }

  // Ring road around the hill, spurs to both homes and mines, and a sunken
  // trail up to the crown from the west and the east.
  const roads: Array<[{ x: number; y: number }, { x: number; y: number }, number]> = [
    [p1, west, 1.4],
    [p1, south, 1.4],
    [p2, east, 1.4],
    [p2, north, 1.4],
    [west, north, 1.2],
    [south, east, 1.2],
    [west, mine1, 1.1],
    [east, mine2, 1.1],
    [west, { x: c.x - 5, y: c.y }, 1],
    [east, { x: c.x + 5, y: c.y }, 1],
  ];
  for (const [a, b, radius] of roads) carveDryRoad(map, a, b, radius);

  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function addMachovoLindenTrees(map: MapData): void {
  const anchors = [
    { x: 0.18, y: 0.18 },
    { x: 0.25, y: 0.25 },
    { x: 0.31, y: 0.20 },
    { x: 0.20, y: 0.68 },
    { x: 0.14, y: 0.54 },
    { x: 0.22, y: 0.61 },
    { x: 0.47, y: 0.14 },
    { x: 0.55, y: 0.16 },
    { x: 0.78, y: 0.39 },
    { x: 0.80, y: 0.32 },
    { x: 0.86, y: 0.45 },
    { x: 0.74, y: 0.79 },
    { x: 0.83, y: 0.73 },
    { x: 0.48, y: 0.87 },
    { x: 0.56, y: 0.83 },
  ];

  for (const anchor of anchors) {
    addLindenTreeFeature(map, Math.round(W * anchor.x), Math.round(H * anchor.y));
  }
}
