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
  [TileType.MUD]:           { top: 0x5b5630, right: 0x494325, left: 0x3a351e },
  [TileType.BARBED_WIRE]:   { top: 0x6e5a38, right: 0x55432a, left: 0x3f311d },
  [TileType.SNOW]:          { top: P.SNOW_L, right: P.SNOW_M, left: P.SNOW_D },
  [TileType.SNOW_FOREST]:   { top: P.SNOW_M, right: P.SNOW_D, left: P.SNOW_SHADOW },
  [TileType.ICE]:           { top: P.ICE_L, right: P.ICE_M, left: P.ICE_D },
  [TileType.PACKED_SNOW]:   { top: P.SNOW_M, right: P.SNOW_D, left: P.SNOW_SHADOW },
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

    if (tileType === TileType.MUD) {
      g.fillStyle(0x2f2b19, 0.18);
      g.fillCircle(sx - 5, sy + 1, 2);
      g.fillCircle(sx + 6, sy - 2, 1);
    }

    if (tileType === TileType.BARBED_WIRE) {
      // Tangled wire running continuously along the belt (down-right, toward the
      // +x neighbour so adjacent tiles join up), wavy and jittered per tile so it
      // reads as a messy entanglement instead of a repeated stamp.
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const jit = (n: number) => ((h >> ((n % 7) * 4)) & 15) / 15 - 0.5;
      const ex = halfW * 0.5;   // half-vector along the belt axis
      const ey = halfH * 0.5;
      const lx = halfW * 0.13;  // lateral (perpendicular) step
      const ly = -halfH * 0.13;
      const strand = (lane: number, color: number) => {
        g.lineStyle(1, color, 0.8);
        g.beginPath();
        const N = 6;
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * 2 - 1; // -1..1 along the belt
          const lat = lane + (i % 2 === 0 ? 1 : -1) * (1 + jit(i));
          const xx = sx + ex * t + lx * lat;
          const yy = sy + ey * t + ly * lat;
          if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.strokePath();
      };
      strand(-1.1 + jit(1), 0x7c7565);
      strand(1.2 + jit(2), 0x9a9384);
      // A few short barbs poking off the wire at jittered points.
      g.lineStyle(1, 0xb0a994, 0.8);
      for (let i = 1; i <= 3; i++) {
        const t = (i / 4) * 2 - 1 + jit(i) * 0.3;
        const bx = sx + ex * t + lx * jit(i + 3) * 2;
        const by = sy + ey * t + ly * jit(i + 3) * 2;
        g.beginPath();
        g.moveTo(bx - lx * 1.6, by - ly * 1.6);
        g.lineTo(bx + lx * 1.6, by + ly * 1.6);
        g.strokePath();
      }
    }

    if (tileType === TileType.SNOW || tileType === TileType.SNOW_FOREST) {
      g.fillStyle(0xffffff, 0.22);
      g.fillCircle(sx - 7, sy - 1, 1);
      g.fillCircle(sx + 5, sy + 2, 1);
    }

    if (tileType === TileType.ICE) {
      g.lineStyle(1, 0xe9fbff, 0.30);
      g.beginPath();
      g.moveTo(sx - halfW * 0.42, sy + halfH * 0.05);
      g.lineTo(sx + halfW * 0.32, sy - halfH * 0.18);
      g.strokePath();
      g.lineStyle(1, 0x4f8aa0, 0.18);
      g.beginPath();
      g.moveTo(sx - halfW * 0.15, sy + halfH * 0.28);
      g.lineTo(sx + halfW * 0.48, sy + halfH * 0.03);
      g.strokePath();
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
