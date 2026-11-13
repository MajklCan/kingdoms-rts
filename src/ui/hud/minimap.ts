/** Minimap canvas: terrain, entity dots, combat pings; click pans the camera. */

import type { GameScene } from '../../render/game-scene';
import { TileType } from '../../sim/map-gen';
import { byId } from '../dom';
import { getScene } from '../game-bridge';

const MM_SIZE = 170;

const TILE_COLORS: Record<number, string> = {
  [TileType.GRASS]: '#547034',
  [TileType.FOREST]: '#2b3a18',
  [TileType.DIRT]: '#7e5a32',
  [TileType.SAND]: '#c4ab70',
  [TileType.WATER]: '#1f4870',
  [TileType.WATER_SHALLOW]: '#346e98',
  [TileType.STONE]: '#8c8a82',
  [TileType.BRIDGE]: '#7e5a32',
  [TileType.MUD]: '#55502d',
  [TileType.BARBED_WIRE]: '#5e4a30',
  [TileType.SNOW]: '#dcecf4',
  [TileType.SNOW_FOREST]: '#9fb9c6',
  [TileType.ICE]: '#83bfd4',
  [TileType.PACKED_SNOW]: '#cbdce6',
};

const TEAM_HEX: Record<number, string> = {
  0: '#b0a68a',
  1: '#2e86de',
  2: '#ee5253',
};

let mmFrame = 0;

export function renderMinimap(scene: GameScene): void {
  const minimapCanvas = byId<HTMLCanvasElement>('minimap-canvas');
  const minimapCtx = minimapCanvas?.getContext('2d') ?? null;
  if (!minimapCtx) return;
  mmFrame++;
  if (mmFrame % 6 !== 0) return; // throttle to ~10 fps
  const data = scene.getMinimapData();
  const tileSize = MM_SIZE / Math.max(data.mapW, data.mapH);
  minimapCtx.fillStyle = '#0a0810';
  minimapCtx.fillRect(0, 0, MM_SIZE, MM_SIZE);
  // Terrain
  for (let y = 0; y < data.mapH; y++) {
    for (let x = 0; x < data.mapW; x++) {
      const t = data.tiles[y * data.mapW + x];
      minimapCtx.fillStyle = TILE_COLORS[t] ?? '#000';
      minimapCtx.fillRect(
        Math.floor(x * tileSize),
        Math.floor(y * tileSize),
        Math.ceil(tileSize),
        Math.ceil(tileSize)
      );
    }
  }
  // Entities - units brighter, buildings as squares, resources as small dots.
  for (const e of data.entities) {
    const sx = Math.floor(e.x * tileSize);
    const sy = Math.floor(e.y * tileSize);
    if (e.kind === 3) {
      // Building - 3x3 square in team color
      minimapCtx.fillStyle = TEAM_HEX[e.player] ?? '#fff';
      minimapCtx.fillRect(sx - 1, sy - 1, 4, 4);
      minimapCtx.strokeStyle = '#000';
      minimapCtx.lineWidth = 0.5;
      minimapCtx.strokeRect(sx - 1, sy - 1, 4, 4);
    } else if (e.kind === 1 || e.kind === 2) {
      // Unit - small filled circle
      minimapCtx.fillStyle = TEAM_HEX[e.player] ?? '#fff';
      minimapCtx.beginPath();
      minimapCtx.arc(sx, sy, e.kind === 2 ? 1.5 : 1.2, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    // Resources are baked into terrain colors via FOREST/STONE/etc.; skip extra dots.
  }
  for (const alert of data.combatAlerts) {
    const sx = Math.floor(alert.x * tileSize);
    const sy = Math.floor(alert.y * tileSize);
    const pulse = 1 - alert.age;
    const radius = 4 + 10 * pulse;
    minimapCtx.strokeStyle = `rgba(255, 54, 54, ${0.25 + 0.65 * pulse})`;
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.arc(sx, sy, radius, 0, Math.PI * 2);
    minimapCtx.stroke();
    minimapCtx.fillStyle = `rgba(255, 230, 110, ${0.35 + 0.45 * pulse})`;
    minimapCtx.fillRect(sx - 1, sy - 1, 3, 3);
  }
}

export function bindMinimapClick(): void {
  const minimapCanvas = byId<HTMLCanvasElement>('minimap-canvas');
  // Minimap click -> pan camera to that tile.
  minimapCanvas?.addEventListener('click', (ev) => {
    const scene = getScene();
    if (!scene) return;
    const rect = minimapCanvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const data = scene.getMinimapData();
    const tileSize = MM_SIZE / Math.max(data.mapW, data.mapH);
    const tx = Math.floor(x / tileSize);
    const ty = Math.floor(y / tileSize);
    scene.panToTile(tx, ty);
  });
}
