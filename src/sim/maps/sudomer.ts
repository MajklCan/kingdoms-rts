/**
 * Sudomer ponds: campaign map with two ponds, a dry choke and a fortified town.
 */

import {
  H,
  W,
  addForestBlob,
  addLindenTreeFeature,
  clearSpawnPatch,
  createBaseMap,
  ellipseDistance,
  inBounds,
  isWaterTile,
  mapIndex,
  pointSegmentDistance,
  rebuildWalkability,
  refreshBridgePositions,
  setSpawns,
} from './terrain';
import { type MapData, TileType } from './types';

export function generateSudomerPondsMap(): MapData {
  const map = createBaseMap(TileType.GRASS, 3);
  const town = { x: Math.round(W * 0.14), y: Math.round(H * 0.14) };
  const bottomAttack = { x: Math.round(W * 0.49), y: H - 5 };
  const leftPond = {
    cx: Math.round(W * 0.12),
    cy: Math.round(H * 0.62),
    rx: Math.round(W * 0.34),
    ry: Math.round(H * 0.27),
  };
  const rightPond = {
    cx: Math.round(W * 0.66),
    cy: Math.round(H * 0.52),
    rx: Math.round(W * 0.18),
    ry: Math.round(H * 0.25),
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      map.elevation[idx] = edge < 5 ? 4 : 3;
    }
  }

  paintSudomerPond(map, leftPond, 0.72, 0.93, 1.06);
  paintSudomerPond(map, rightPond, 0.62, 0.83, 1.0);
  clearSpawnPatch(map, town.x + 8, town.y + 8, 4);
  clearSpawnPatch(map, bottomAttack.x, bottomAttack.y, 5);
  clearSpawnPatch(map, W - 4, Math.round(H * 0.25), 5);
  paintSudomerRightMud(map, rightPond);
  carveSudomerDryChoke(map);
  carveSudomerTownSite(map, town);

  addForestBlob(map, Math.round(W * 0.05), Math.round(H * 0.12), 5, 0.70);
  addForestBlob(map, Math.round(W * 0.25), Math.round(H * 0.06), 7, 0.82);
  addForestBlob(map, Math.round(W * 0.34), Math.round(H * 0.18), 6, 0.74);
  addForestBlob(map, Math.round(W * 0.82), Math.round(H * 0.12), 9, 0.90);
  addForestBlob(map, Math.round(W * 0.91), Math.round(H * 0.32), 7, 0.82);
  addForestBlob(map, Math.round(W * 0.87), Math.round(H * 0.78), 9, 0.88);
  addForestBlob(map, Math.round(W * 0.68), Math.round(H * 0.86), 7, 0.78);
  addForestBlob(map, Math.round(W * 0.52), Math.round(H * 0.10), 5, 0.66);
  addForestBlob(map, Math.round(W * 0.18), Math.round(H * 0.40), 5, 0.70);
  addSudomerLindenTrees(map);

  rebuildWalkability(map);
  setSpawns(map, { x: town.x + 8, y: town.y + 8 }, bottomAttack);
  refreshBridgePositions(map);
  return map;
}

function paintSudomerPond(
  map: MapData,
  pond: { cx: number; cy: number; rx: number; ry: number },
  waterEdge: number,
  shallowEdge: number,
  sandEdge: number
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const d = ellipseDistance(x, y, pond.cx, pond.cy, pond.rx, pond.ry);
      const ripple =
        Math.sin(x * 0.34 + y * 0.17) * 0.035 +
        Math.cos(x * 0.19 - y * 0.27) * 0.025;
      const shoreline = d + ripple;
      if (shoreline <= waterEdge) {
        map.tiles[idx] = TileType.WATER;
        map.elevation[idx] = 0;
      } else if (shoreline <= shallowEdge) {
        map.tiles[idx] = TileType.WATER_SHALLOW;
        map.elevation[idx] = 1;
      } else if (shoreline <= sandEdge && map.tiles[idx] === TileType.GRASS) {
        map.tiles[idx] = TileType.SAND;
        map.elevation[idx] = 2;
      }
    }
  }
}

function paintSudomerRightMud(
  map: MapData,
  rightPond: { cx: number; cy: number; rx: number; ry: number }
): void {
  const mudMinX = rightPond.cx - 1;
  const guaranteedEdgeX = rightPond.cx + Math.round(rightPond.rx * 0.45);
  const edgeBandBottom = rightPond.cy + Math.round(rightPond.ry * 0.42);
  const routeStart = {
    x: rightPond.cx - 1,
    y: rightPond.cy - rightPond.ry + 4,
  };
  const routeEnd = {
    x: W - 1,
    y: Math.round(H * 0.12),
  };

  for (let y = 0; y <= edgeBandBottom; y++) {
    for (let x = mudMinX; x < W; x++) {
      if (!inBounds(x, y)) continue;
      const idx = mapIndex(x, y);
      if (isWaterTile(map.tiles[idx])) continue;
      const pondD = ellipseDistance(x, y, rightPond.cx, rightPond.cy, rightPond.rx, rightPond.ry);
      const routeD = pointSegmentDistance(
        x,
        y,
        routeStart.x,
        routeStart.y,
        routeEnd.x,
        routeEnd.y
      );
      const wetPatchNoise =
        Math.sin(x * 0.71 + y * 0.19) +
        Math.cos(x * 0.31 - y * 0.53);

      const reachesMapEdge = x >= guaranteedEdgeX;
      const northernRoute = routeD <= 8.5 && y <= rightPond.cy + 1;
      const pondShore = pondD > 0.82 && pondD < 1.58 && y <= edgeBandBottom;
      const unevenShore = pondShore && wetPatchNoise > -1.1;
      const easternShore = x >= rightPond.cx + Math.round(rightPond.rx * 0.2) && y <= edgeBandBottom;

      if (reachesMapEdge || northernRoute || easternShore || unevenShore) {
        map.tiles[idx] = TileType.MUD;
        map.elevation[idx] = 2;
      }
    }
  }
}

function carveSudomerDryChoke(map: MapData): void {
  const minX = Math.round(W * 0.45);
  const maxX = minX + 2;
  const minY = Math.round(H * 0.48);
  const maxY = Math.round(H * 0.80);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inBounds(x, y)) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = Math.abs(x - Math.round((minX + maxX) / 2)) <= 1
        ? TileType.DIRT
        : TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

function carveSudomerTownSite(map: MapData, town: { x: number; y: number }): void {
  const minX = 0;
  const maxX = Math.min(W - 2, town.x + 18);
  const minY = 0;
  const maxY = Math.min(H - 2, town.y + 14);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = mapIndex(x, y);
      map.tiles[idx] = isSudomerTownRoad(x, y, town)
        ? TileType.DIRT
        : TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

function isSudomerTownRoad(x: number, y: number, town: { x: number; y: number }): boolean {
  const mainRoad = [
    { x: 0, y: town.y + 3 },
    { x: town.x - 6, y: town.y + 2 },
    { x: town.x - 2, y: town.y },
    { x: town.x + 3, y: town.y },
    { x: town.x + 9, y: town.y + 1 },
    { x: town.x + 15, y: town.y + 4 },
    { x: town.x + 19, y: town.y + 7 },
  ];
  const northLane = [
    { x: town.x - 2, y: town.y },
    { x: town.x - 3, y: town.y - 4 },
    { x: town.x - 1, y: 0 },
  ];
  const eastLane = [
    { x: town.x + 3, y: town.y },
    { x: town.x + 7, y: town.y - 4 },
    { x: town.x + 14, y: town.y - 4 },
    { x: town.x + 18, y: town.y - 2 },
  ];
  const lowerLane = [
    { x: town.x - 2, y: town.y },
    { x: town.x - 3, y: town.y + 5 },
    { x: town.x - 6, y: town.y + 9 },
  ];
  const westLane = [
    { x: town.x - 8, y: town.y - 4 },
    { x: town.x - 8, y: town.y + 2 },
    { x: town.x - 6, y: town.y + 4 },
  ];
  const topLane = [
    { x: town.x - 5, y: town.y - 7 },
    { x: town.x + 1, y: town.y - 7 },
    { x: town.x + 7, y: town.y - 5 },
  ];
  const innerLane = [
    { x: town.x - 1, y: town.y + 3 },
    { x: town.x + 3, y: town.y + 2 },
    { x: town.x + 8, y: town.y + 3 },
    { x: town.x + 13, y: town.y + 5 },
  ];
  const southEdgeLane = [
    { x: town.x - 4, y: town.y + 7 },
    { x: town.x + 1, y: town.y + 7 },
    { x: town.x + 8, y: town.y + 9 },
    { x: town.x + 17, y: town.y + 9 },
  ];
  const easternLoop = [
    { x: town.x + 13, y: town.y - 2 },
    { x: town.x + 17, y: town.y + 1 },
    { x: town.x + 17, y: town.y + 9 },
  ];
  const roadSets = [
    mainRoad,
    northLane,
    eastLane,
    lowerLane,
    westLane,
    topLane,
    innerLane,
    southEdgeLane,
    easternLoop,
  ];
  for (const road of roadSets) {
    for (let i = 1; i < road.length; i++) {
      if (pointSegmentDistance(x, y, road[i - 1].x, road[i - 1].y, road[i].x, road[i].y) <= 1.15) {
        return true;
      }
    }
  }
  return Math.abs(x - (town.x + 2)) <= 2 && Math.abs(y - town.y) <= 1;
}

function addSudomerLindenTrees(map: MapData): void {
  const anchors = [
    { x: 0.24, y: 0.06 },
    { x: 0.32, y: 0.16 },
    { x: 0.52, y: 0.10 },
    { x: 0.76, y: 0.12 },
    { x: 0.86, y: 0.18 },
    { x: 0.91, y: 0.32 },
    { x: 0.83, y: 0.76 },
    { x: 0.70, y: 0.86 },
    { x: 0.20, y: 0.40 },
    { x: 0.12, y: 0.31 },
    { x: 0.38, y: 0.09 },
    { x: 0.74, y: 0.76 },
  ];
  for (const anchor of anchors) {
    addLindenTreeFeature(map, Math.round(W * anchor.x), Math.round(H * anchor.y));
  }
}
