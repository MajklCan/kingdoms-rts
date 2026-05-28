/**
 * Terrain renderer — bakes the entire map (tiles + heightmap) into a single
 * Phaser RenderTexture at scene boot. Each tile is drawn as an iso diamond
 * with optional vertical side faces showing elevation steps. One big texture =
 * one draw call per frame for the entire ground layer.
 */

import { ISO, MAP } from '../../config';
// (Sharper terrain: render the tile diamonds at 2× to match the new voxel
//  bake size. Adjust TILE rendering scale here so the whole world stays in
//  proportion when we change the bake resolution.)
import { PALETTE as P } from './palette';
import { TileType, type MapData } from '../../sim/map-gen';
import { tileToScreen } from '../iso';

/**
 * Top, right-face, left-face colours for each tile type. The 3-tone iso shading
 * keeps the terrain looking consistent with the voxel sprites.
 */
const TILE_COLORS: Record<number, { top: number; right: number; left: number }> = {
  [TileType.GRASS]:         { top: P.GRASS_L, right: P.GRASS_M, left: P.GRASS_D },
  [TileType.FOREST]:        { top: P.GRASS_M, right: P.GRASS_D, left: 0x2b3a18 },
  [TileType.DIRT]:          { top: P.DIRT_L, right: P.DIRT_M, left: P.DIRT_D },
  [TileType.SAND]:          { top: P.SAND_L, right: P.SAND_M, left: P.SAND_D },
  [TileType.WATER]:         { top: P.WATER_M, right: P.WATER_D, left: P.WATER_D },
  [TileType.WATER_SHALLOW]: { top: P.WATER_L, right: P.WATER_M, left: P.WATER_M },
  [TileType.STONE]:         { top: P.STONE_ORE_L, right: P.STONE_ORE_M, left: P.STONE_ORE_D },
  [TileType.BRIDGE]:        { top: P.WOOD_L, right: P.WOOD_M, left: P.WOOD_D },
};

/**
 * Bake the terrain into a RenderTexture and add it to the world container.
 * Returns the GameObject so the scene can position it.
 */
export function bakeTerrain(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  map: MapData
): Phaser.GameObjects.Sprite {
  const halfW = ISO.TILE_W / 2;
  const halfH = ISO.TILE_H / 2;
  // Vertical pixels per elevation step (shared constant — keep entity rendering
  // in sync via ISO.VPER as well).
  const VPER = ISO.VPER;

  // Compute bounds of the rendered terrain.
  let minSx = Infinity, maxSx = -Infinity;
  let minSy = Infinity, maxSy = -Infinity;
  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      const c = tileToScreen(x, y);
      const e = map.elevation[y * MAP.WIDTH + x];
      const sy = c.y - e * VPER;
      const sx0 = c.x - halfW;
      const sx1 = c.x + halfW;
      const sy0 = sy - halfH;
      const sy1 = c.y + halfH + e * VPER;
      if (sx0 < minSx) minSx = sx0;
      if (sx1 > maxSx) maxSx = sx1;
      if (sy0 < minSy) minSy = sy0;
      if (sy1 > maxSy) maxSy = sy1;
    }
  }
  const PAD = 8;
  const w = Math.ceil(maxSx - minSx) + PAD * 2;
  const h = Math.ceil(maxSy - minSy) + PAD * 2;
  const offX = -minSx + PAD;
  const offY = -minSy + PAD;

  const g = scene.add.graphics();
  g.setVisible(false);

  // Sort tiles back-to-front (painter's algorithm). For iso, back tiles are
  // lower x+y; paint them first.
  const tileOrder: Array<{ x: number; y: number; key: number }> = [];
  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      tileOrder.push({ x, y, key: x + y });
    }
  }
  tileOrder.sort((a, b) => a.key - b.key);

  for (const { x, y } of tileOrder) {
    const c = tileToScreen(x, y);
    const idx = y * MAP.WIDTH + x;
    const tileType = map.tiles[idx];
    const e = map.elevation[idx];
    const colors = TILE_COLORS[tileType] ?? TILE_COLORS[TileType.GRASS];
    const sx = c.x + offX;
    const sy = c.y + offY - e * VPER;
    const sideH = e * VPER;

    // Side faces only if elevation > 0 — draw the SE (right) and SW (left)
    // verticals so the diamond looks raised.
    if (sideH > 0) {
      // Right side parallelogram.
      g.fillStyle(colors.right, 1);
      g.beginPath();
      g.moveTo(sx + halfW, sy);
      g.lineTo(sx + halfW, sy + sideH);
      g.lineTo(sx, sy + halfH + sideH);
      g.lineTo(sx, sy + halfH);
      g.closePath();
      g.fillPath();
      // Left side.
      g.fillStyle(colors.left, 1);
      g.beginPath();
      g.moveTo(sx - halfW, sy);
      g.lineTo(sx - halfW, sy + sideH);
      g.lineTo(sx, sy + halfH + sideH);
      g.lineTo(sx, sy + halfH);
      g.closePath();
      g.fillPath();
    }

    // Top diamond. Slight per-tile variation by hashing position for nicer
    // texture (no big flat colour fields).
    const variance = ((x * 13 + y * 7) % 7 - 3) * 2;
    const topColor = jitter(colors.top, variance);
    g.fillStyle(topColor, 1);
    g.beginPath();
    g.moveTo(sx, sy - halfH);
    g.lineTo(sx + halfW, sy);
    g.lineTo(sx, sy + halfH);
    g.lineTo(sx - halfW, sy);
    g.closePath();
    g.fillPath();
    // Hairline tile edge — thin and dark, helps readability.
    g.lineStyle(1, 0x000000, 0.15);
    g.strokePath();

    if (tileType === TileType.BRIDGE) {
      drawBridgeDetail(g, sx, sy, halfW, halfH);
    }

    // Water animated highlight overlay (foam) — static for now, just a couple of
    // brighter pixels to suggest reflection.
    if (tileType === TileType.WATER_SHALLOW) {
      g.fillStyle(P.WATER_FOAM, 0.35);
      g.fillCircle(sx + 4, sy - 2, 2);
    }
  }

  // Origin tile highlight removed in voxel terrain — natural ground reads fine.

  const KEY = 'terrain-bake';
  if (scene.textures.exists(KEY)) {
    scene.textures.remove(KEY);
  }
  g.generateTexture(KEY, w, h);
  g.destroy();

  const sprite = scene.add.sprite(0, 0, KEY);
  // Position so terrain origin lines up with worldContainer's 0,0.
  sprite.setOrigin(0, 0);
  sprite.setPosition(-offX, -offY);
  sprite.setDepth(-10000); // always behind everything
  container.add(sprite);
  return sprite;
}

/** Per-tile colour jitter for subtle texture variation. */
function jitter(color: number, delta: number): number {
  const r = clamp(((color >> 16) & 0xff) + delta);
  const g = clamp(((color >> 8) & 0xff) + delta);
  const b = clamp((color & 0xff) + delta);
  return (r << 16) | (g << 8) | b;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function drawBridgeDetail(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number
): void {
  g.lineStyle(1, P.WOOD_D, 0.45);
  for (let i = -1; i <= 1; i++) {
    const ox = i * halfW * 0.25;
    const topY = sy - halfH + Math.abs(ox) * (halfH / halfW);
    const bottomY = sy + halfH - Math.abs(ox) * (halfH / halfW);
    g.beginPath();
    g.moveTo(sx + ox, topY);
    g.lineTo(sx + ox, bottomY);
    g.strokePath();
  }

  g.lineStyle(2, P.WOOD_DOOR, 0.55);
  g.beginPath();
  g.moveTo(sx - halfW * 0.72, sy - halfH * 0.18);
  g.lineTo(sx, sy - halfH * 0.92);
  g.lineTo(sx + halfW * 0.72, sy - halfH * 0.18);
  g.strokePath();
  g.beginPath();
  g.moveTo(sx - halfW * 0.72, sy + halfH * 0.18);
  g.lineTo(sx, sy + halfH * 0.92);
  g.lineTo(sx + halfW * 0.72, sy + halfH * 0.18);
  g.strokePath();
}
