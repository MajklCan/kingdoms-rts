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
import { TileType, type MapData, type TileTypeValue } from '../../sim/map-gen';
import { tileToScreen } from '../iso';

interface TerrainSpriteAsset {
  key: string;
  path: string;
}

const STYLE2_TERRAIN_GROUPS = {
  grass: ['grass-0', 'grass-1', 'grass-2', 'grass-3', 'grass-4', 'grass-5'],
  dirt: ['dirt-0', 'dirt-1', 'dirt-2', 'dirt-3', 'dirt-4', 'dirt-5'],
  sand: ['sand-0', 'sand-1', 'sand-2', 'sand-3', 'sand-4', 'sand-5'],
} as const;

const STYLE2_TERRAIN_PREFIX = 'style2-terrain';
const STYLE2_TERRAIN_ORIGIN_Y = 0.42;

export const STYLE2_TERRAIN_ASSETS: TerrainSpriteAsset[] = Object.values(
  STYLE2_TERRAIN_GROUPS
).flatMap((names) =>
  names.map((name) => ({
    key: `${STYLE2_TERRAIN_PREFIX}-${name}`,
    path: `/assets/terrain/style2/${name}.png`,
  }))
);

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

  const KEY = 'terrain-bake';
  if (scene.textures.exists(KEY)) {
    scene.textures.remove(KEY);
  }
  const texture = scene.textures.createCanvas(KEY, w, h);
  if (!texture) {
    throw new Error('Failed to create terrain canvas texture');
  }
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

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
    const tileType = map.tiles[idx] as TileTypeValue;
    const e = map.elevation[idx];
    const colors = TILE_COLORS[tileType] ?? TILE_COLORS[TileType.GRASS];
    const sx = c.x + offX;
    const sy = c.y + offY - e * VPER;
    const sideH = e * VPER;
    const stampKey = style2TerrainKey(scene, tileType, x, y);

    // Side faces only if elevation > 0 — draw the SE (right) and SW (left)
    // verticals so the diamond looks raised.
    if (sideH > 0) {
      drawTerrainSideFaces(ctx, sx, sy, halfW, halfH, sideH, colors.right, colors.left);
    }

    if (stampKey) {
      drawTerrainStamp(scene, ctx, stampKey, sx, sy);
    } else {
      // Top diamond. Slight per-tile variation by hashing position for nicer
      // texture (no big flat colour fields).
      const variance = ((x * 13 + y * 7) % 7 - 3) * 2;
      const topColor = jitter(colors.top, variance);
      drawDiamond(ctx, sx, sy, halfW, halfH, topColor);
    }

    if (tileType === TileType.BRIDGE) {
      drawBridgeDetail(ctx, sx, sy, halfW, halfH);
    }

    // Water animated highlight overlay (foam) — static for now, just a couple of
    // brighter pixels to suggest reflection.
    if (tileType === TileType.WATER_SHALLOW) {
      fillCircle(ctx, sx + 4, sy - 2, 2, P.WATER_FOAM, 0.35);
    }

    if (tileType === TileType.MUD) {
      fillCircle(ctx, sx - 5, sy + 1, 2, 0x2f2b19, 0.18);
      fillCircle(ctx, sx + 6, sy - 2, 1, 0x2f2b19, 0.18);
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
        const N = 6;
        const points: Array<[number, number]> = [];
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * 2 - 1; // -1..1 along the belt
          const lat = lane + (i % 2 === 0 ? 1 : -1) * (1 + jit(i));
          const xx = sx + ex * t + lx * lat;
          const yy = sy + ey * t + ly * lat;
          points.push([xx, yy]);
        }
        strokeLine(ctx, points, color, 0.8);
      };
      strand(-1.1 + jit(1), 0x7c7565);
      strand(1.2 + jit(2), 0x9a9384);
      // A few short barbs poking off the wire at jittered points.
      for (let i = 1; i <= 3; i++) {
        const t = (i / 4) * 2 - 1 + jit(i) * 0.3;
        const bx = sx + ex * t + lx * jit(i + 3) * 2;
        const by = sy + ey * t + ly * jit(i + 3) * 2;
        strokeLine(ctx, [
          [bx - lx * 1.6, by - ly * 1.6],
          [bx + lx * 1.6, by + ly * 1.6],
        ], 0xb0a994, 0.8);
      }
    }

    if (tileType === TileType.SNOW || tileType === TileType.SNOW_FOREST) {
      fillCircle(ctx, sx - 7, sy - 1, 1, 0xffffff, 0.22);
      fillCircle(ctx, sx + 5, sy + 2, 1, 0xffffff, 0.22);
    }

    if (tileType === TileType.ICE) {
      strokeLine(ctx, [
        [sx - halfW * 0.42, sy + halfH * 0.05],
        [sx + halfW * 0.32, sy - halfH * 0.18],
      ], 0xe9fbff, 0.30);
      strokeLine(ctx, [
        [sx - halfW * 0.15, sy + halfH * 0.28],
        [sx + halfW * 0.48, sy + halfH * 0.03],
      ], 0x4f8aa0, 0.18);
    }
  }

  // Origin tile highlight removed in voxel terrain — natural ground reads fine.
  texture.refresh();

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

function style2TerrainKey(
  scene: Phaser.Scene,
  tileType: TileTypeValue,
  x: number,
  y: number
): string | null {
  const hash = Math.abs((x * 73856093) ^ (y * 19349663));
  let variants: readonly string[] | null = null;
  if (tileType === TileType.GRASS || tileType === TileType.FOREST) {
    variants = STYLE2_TERRAIN_GROUPS.grass;
  } else if (tileType === TileType.DIRT) {
    variants = STYLE2_TERRAIN_GROUPS.dirt;
  } else if (tileType === TileType.SAND) {
    variants = STYLE2_TERRAIN_GROUPS.sand;
  }
  if (!variants) return null;

  const key = `${STYLE2_TERRAIN_PREFIX}-${variants[hash % variants.length]}`;
  return scene.textures.exists(key) ? key : null;
}

function drawTerrainStamp(
  scene: Phaser.Scene,
  ctx: CanvasRenderingContext2D,
  key: string,
  sx: number,
  sy: number
): void {
  const source = scene.textures.get(key).getSourceImage() as CanvasImageSource & {
    width: number;
    height: number;
  };
  const dx = Math.round(sx - source.width / 2);
  const dy = Math.round(sy - source.height * STYLE2_TERRAIN_ORIGIN_Y);
  ctx.drawImage(source, dx, dy);
}

function drawTerrainSideFaces(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
  sideH: number,
  rightColor: number,
  leftColor: number
): void {
  fillPolygon(ctx, [
    [sx + halfW, sy],
    [sx + halfW, sy + sideH],
    [sx, sy + halfH + sideH],
    [sx, sy + halfH],
  ], rightColor);
  fillPolygon(ctx, [
    [sx - halfW, sy],
    [sx - halfW, sy + sideH],
    [sx, sy + halfH + sideH],
    [sx, sy + halfH],
  ], leftColor);
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
  color: number
): void {
  const points: Array<[number, number]> = [
    [sx, sy - halfH],
    [sx + halfW, sy],
    [sx, sy + halfH],
    [sx - halfW, sy],
  ];
  fillPolygon(ctx, points, color);
  strokeLine(ctx, [...points, points[0]], 0x000000, 0.15);
}

function drawBridgeDetail(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number
): void {
  for (let i = -1; i <= 1; i++) {
    const ox = i * halfW * 0.25;
    const topY = sy - halfH + Math.abs(ox) * (halfH / halfW);
    const bottomY = sy + halfH - Math.abs(ox) * (halfH / halfW);
    strokeLine(ctx, [[sx + ox, topY], [sx + ox, bottomY]], P.WOOD_D, 0.45);
  }

  strokeLine(ctx, [
    [sx - halfW * 0.72, sy - halfH * 0.18],
    [sx, sy - halfH * 0.92],
    [sx + halfW * 0.72, sy - halfH * 0.18],
  ], P.WOOD_DOOR, 0.55, 2);
  strokeLine(ctx, [
    [sx - halfW * 0.72, sy + halfH * 0.18],
    [sx, sy + halfH * 0.92],
    [sx + halfW * 0.72, sy + halfH * 0.18],
  ], P.WOOD_DOOR, 0.55, 2);
}

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  color: number,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colorToCss(color);
  ctx.beginPath();
  const [first, ...rest] = points;
  ctx.moveTo(first[0], first[1]);
  for (const point of rest) {
    ctx.lineTo(point[0], point[1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function fillCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: number,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colorToCss(color);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  color: number,
  alpha = 1,
  lineWidth = 1
): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colorToCss(color);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
  ctx.restore();
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
