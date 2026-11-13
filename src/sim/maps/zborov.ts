/**
 * Zborov lines: WWI trench corridor.
 */

import {
  H,
  W,
  createBaseMap,
  mapIndex,
  rebuildWalkability,
  refreshBridgePositions,
  setSpawns,
  valueNoise,
} from './terrain';
import { type MapData, TileType } from './types';

export function isZborovMudPatch(x: number, y: number): boolean {
  const broadPatch = valueNoise(x, y, 9, 29);
  const smallBreakup = valueNoise(x + 17, y - 11, 4, 83);
  const shellScarring = Math.sin(x * 0.33 + y * 0.21) + Math.cos(x * 0.17 - y * 0.37);
  return broadPatch * 0.58 + smallBreakup * 0.28 + shellScarring * 0.07 > 0.58;
}

export function generateZborovMap(): MapData {
  // A shell-torn CORRIDOR: churned dirt + mud only, with the flanks still
  // impassable so the assault can't just walk around the trench lines. Player
  // jump-off south, enemy lines + bunker north. Trench wire and machine-gun
  // nests are placed in the mission config.
  const map = createBaseMap(TileType.DIRT, 3);
  const cx = Math.round(W * 0.5);
  const corridorHalf = Math.round(W * 0.24);
  const leftEdge = cx - corridorHalf;
  const rightEdge = cx + corridorHalf;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const mudPatch = isZborovMudPatch(x, y);
      map.tiles[idx] = mudPatch ? TileType.MUD : TileType.DIRT;
      map.elevation[idx] = mudPatch ? 2 : 3;
    }
  }

  rebuildWalkability(map);
  // Seal the dirt/mud flanks - impassable, so the fight stays in the corridor.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < leftEdge || x > rightEdge) map.walkability[y][x] = 1;
    }
  }
  setSpawns(map, { x: cx, y: Math.round(H * 0.80) }, { x: cx, y: Math.round(H * 0.23) });
  refreshBridgePositions(map);
  return map;
}
