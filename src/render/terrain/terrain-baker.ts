/**
 * Bakes the Blender terrain tiles into chunk canvases with Canvas 2D:
 * periodic tile variants, transition masks mixed per tile (the neighbour's
 * ground is mixed into this tile's colour, this tile's alpha is kept), cliff
 * steps under raised tiles, and the barbed-wire overlay. Chunks with animated
 * water get one canvas per animation frame.
 *
 * Canvas coordinates are world-local pixels (tile 0,0 centre at the origin)
 * through a transform, so everything is placed exactly like the sprites.
 */

import { TileType, type MapData } from '@sim/map-gen';
import { ISO, MAP } from '../../config';
import type { ArtCatalog, ArtFrame } from '../sprites/art-catalog';
import { tileHash } from '../tile-hash';
import {
  ANIMATED_TERRAIN,
  CLIFF_KIND,
  tileTransitions,
  tileVariantKey,
} from './terrain-art';

/** A trimmed atlas frame inside its atlas image. */
export interface AtlasFrameImage {
  image: CanvasImageSource;
  cutX: number;
  cutY: number;
  cutW: number;
  cutH: number;
  /** Trim offset of the cut rect inside the full source frame. */
  offX: number;
  offY: number;
}

export type AtlasFrameResolver = (texture: string, frame: string) => AtlasFrameImage | null;

export interface TerrainChunkBake {
  /** Top-left in world-local pixels. */
  x: number;
  y: number;
  /** Size in world-local pixels (canvas size / scale). */
  width: number;
  height: number;
  /** One canvas per animation frame; length 1 for static chunks. */
  frames: HTMLCanvasElement[];
}

export interface TerrainBakeOptions {
  /** Canvas pixels per world pixel. */
  scale: number;
  /** Animation frames of animated terrain (water). */
  animFrames: number;
}

/** Bleed kept on tile edges shared with a same-height neighbour, in diamond units. */
const EDGE_BLEED = 0.12;
const HALF_W = ISO.TILE_W / 2;
const HALF_H = ISO.TILE_H / 2;

export class TerrainBaker {
  private readonly scratchT: CanvasRenderingContext2D;
  private readonly scratchN: CanvasRenderingContext2D;
  private readonly scratchM: CanvasRenderingContext2D;

  constructor(
    private readonly map: MapData,
    private readonly names: readonly string[],
    private readonly art: ArtCatalog,
    private readonly resolve: AtlasFrameResolver,
    private readonly opts: TerrainBakeOptions
  ) {
    this.scratchT = context2d(1, 1);
    this.scratchN = context2d(1, 1);
    this.scratchM = context2d(1, 1);
  }

  /** Bake the tiles x0..x1-1, y0..y1-1. Null when the range has no tiles. */
  bakeChunk(x0: number, y0: number, x1: number, y1: number): TerrainChunkBake | null {
    const tiles: Array<[number, number]> = [];
    for (let y = y0; y < Math.min(y1, MAP.HEIGHT); y++) {
      for (let x = x0; x < Math.min(x1, MAP.WIDTH); x++) tiles.push([x, y]);
    }
    if (tiles.length === 0) return null;
    tiles.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let animated = false;
    for (const [x, y] of tiles) {
      const b = this.bottomCorner(x, y);
      const steps = Math.max(this.dropTo(x, y + 1, x, y), this.dropTo(x + 1, y, x, y));
      minX = Math.min(minX, b.x - HALF_W - 6);
      maxX = Math.max(maxX, b.x + HALF_W + 6);
      minY = Math.min(minY, b.y - ISO.TILE_H - 4);
      maxY = Math.max(maxY, b.y + steps * ISO.VPER + 6);
      if (ANIMATED_TERRAIN.has(this.nameAt(x, y))) animated = true;
    }
    const s = this.opts.scale;
    const ox = Math.floor(minX);
    const oy = Math.floor(minY);
    const width = Math.ceil(maxX) - ox;
    const height = Math.ceil(maxY) - oy;
    const frameCount = animated ? this.opts.animFrames : 1;
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < frameCount; f++) {
      const ctx = context2d(Math.ceil(width * s), Math.ceil(height * s));
      ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
      for (const [x, y] of tiles) this.drawTile(ctx, x, y, f);
      frames.push(ctx.canvas);
    }
    return { x: ox, y: oy, width, height, frames };
  }

  private drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
    const b = this.bottomCorner(x, y);
    this.drawCliffs(ctx, x, y, b);
    const tile = this.tileFrame(this.nameAt(x, y), x, y, frame);
    if (!tile) return;
    const composite = this.composeTile(tile, x, y, frame);
    const k = this.art.scale;
    const ax = tile.variant.anchor[0] * k;
    const ay = tile.variant.anchor[1] * k;
    ctx.save();
    this.clipTile(ctx, x, y, b);
    ctx.drawImage(
      composite.canvas,
      b.x - ax,
      b.y - ay,
      composite.canvas.width / this.opts.scale,
      composite.canvas.height / this.opts.scale
    );
    if (this.map.tiles[y * MAP.WIDTH + x] === TileType.BARBED_WIRE) {
      drawBarbedWire(ctx, b.x, b.y - HALF_H, x, y);
    }
    ctx.restore();
  }

  /** Tile frame with every transition mixed in, in a scratch canvas. */
  private composeTile(tile: ArtFrame, x: number, y: number, frame: number): CanvasRenderingContext2D {
    const s = this.opts.scale;
    const k = this.art.scale;
    const w = Math.ceil(tile.variant.size[0] * k * s);
    const h = Math.ceil(tile.variant.size[1] * k * s);
    const ax = tile.variant.anchor[0] * k;
    const ay = tile.variant.anchor[1] * k;
    const t = resetContext(this.scratchT, w, h, s);
    this.drawFrame(t, tile, ax, ay);
    for (const transition of tileTransitions(this.names, x, y)) {
      const neighbour = this.tileFrame(transition.neighbour, x, y, frame);
      if (!neighbour) continue;
      const m = resetContext(this.scratchM, w, h, s);
      let masked = false;
      for (const key of transition.masks) {
        const mask = this.art.frame('terrain.transition', key);
        if (!mask) continue;
        this.drawFrame(m, mask, ax, ay);
        masked = true;
      }
      if (!masked) continue;
      const n = resetContext(this.scratchN, w, h, s);
      this.drawFrame(n, neighbour, ax, ay);
      n.setTransform(1, 0, 0, 1, 0, 0);
      n.globalCompositeOperation = 'destination-in';
      n.drawImage(m.canvas, 0, 0);
      n.globalCompositeOperation = 'source-over';
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-atop';
      t.drawImage(n.canvas, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.setTransform(s, 0, 0, s, 0, 0);
    }
    return t;
  }

  /** Stacked cliff steps under the front edges, down to the lower neighbour. */
  private drawCliffs(ctx: CanvasRenderingContext2D, x: number, y: number, b: { x: number; y: number }): void {
    const kind = CLIFF_KIND[this.nameAt(x, y)] ?? 'earth';
    const asset = `terrain.cliff_${kind}`;
    const sides: ReadonlyArray<readonly ['left' | 'right', number]> = [
      ['left', this.dropTo(x, y + 1, x, y)],
      ['right', this.dropTo(x + 1, y, x, y)],
    ];
    for (const [side, steps] of sides) {
      for (let step = 0; step < steps; step++) {
        const face = (step === 0 ? this.art.frame(asset, `${side}_lip`) : null) ??
          this.art.frame(asset, side) ?? this.art.frame('terrain.cliff_earth', side);
        if (!face) continue;
        this.drawFrame(ctx, face, b.x, b.y + step * ISO.VPER);
      }
    }
  }

  /**
   * Clip to the tile diamond. Edges shared with a same-height neighbour keep
   * a little bleed (no seams under filtering); edges at a height change or the
   * map border are cut exactly, so the bleed never paints over a cliff face.
   */
  private clipTile(ctx: CanvasRenderingContext2D, x: number, y: number, b: { x: number; y: number }): void {
    const e = this.elevation(x, y);
    const kOf = (nx: number, ny: number): number =>
      inside(nx, ny) && this.elevation(nx, ny) === e ? EDGE_BLEED : 0;
    const kTR = kOf(x, y - 1);
    const kBR = kOf(x + 1, y);
    const kBL = kOf(x, y + 1);
    const kTL = kOf(x - 1, y);
    const cx = b.x;
    const cy = b.y - HALF_H;
    const corners: Array<[number, number]> = [
      [(kTR - kTL) / 2, -(2 + kTL + kTR) / 2],
      [(2 + kTR + kBR) / 2, (kBR - kTR) / 2],
      [(kBR - kBL) / 2, (2 + kBR + kBL) / 2],
      [-(2 + kBL + kTL) / 2, (kBL - kTL) / 2],
    ];
    ctx.beginPath();
    for (const [i, [u, v]] of corners.entries()) {
      const px = cx + u * HALF_W;
      const py = cy + v * HALF_H;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();
  }

  /** Draw a frame so its anchor lands on (ax, ay) in the context's coordinates. */
  private drawFrame(ctx: CanvasRenderingContext2D, frame: ArtFrame, ax: number, ay: number): void {
    const img = this.resolve(frame.texture, frame.frame);
    if (!img) return;
    const k = frame.scale;
    ctx.drawImage(
      img.image,
      img.cutX,
      img.cutY,
      img.cutW,
      img.cutH,
      ax - (frame.variant.anchor[0] - img.offX) * k,
      ay - (frame.variant.anchor[1] - img.offY) * k,
      img.cutW * k,
      img.cutH * k
    );
  }

  private tileFrame(name: string, x: number, y: number, frame: number): ArtFrame | null {
    const id = `terrain.${name}`;
    const asset = this.art.asset(id);
    if (!asset) return name === 'grass' ? null : this.tileFrame('grass', x, y, frame);
    const animated = ANIMATED_TERRAIN.has(name);
    const key = tileVariantKey(asset.period ?? 1, x, y, animated ? frame % this.opts.animFrames : undefined);
    return this.art.frame(id, key) ??
      (animated ? this.art.frame(id, tileVariantKey(asset.period ?? 1, x, y, 0)) : null) ??
      this.art.defaultFrame(id);
  }

  /** Steps a tile drops toward its front neighbour (all of its height at the map edge). */
  private dropTo(nx: number, ny: number, x: number, y: number): number {
    const e = this.elevation(x, y);
    const n = inside(nx, ny) ? this.elevation(nx, ny) : 0;
    return Math.max(0, e - n);
  }

  private bottomCorner(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - y) * HALF_W,
      y: (x + y) * HALF_H + HALF_H - this.elevation(x, y) * ISO.VPER,
    };
  }

  private elevation(x: number, y: number): number {
    return this.map.elevation[y * MAP.WIDTH + x];
  }

  private nameAt(x: number, y: number): string {
    return this.names[y * MAP.WIDTH + x] ?? 'grass';
  }
}

function inside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP.WIDTH && y < MAP.HEIGHT;
}

function context2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Clear (resizing when needed) and scale a scratch context. */
function resetContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number
): CanvasRenderingContext2D {
  const canvas = ctx.canvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

/**
 * WW1 wire entanglement across the tile, running toward the +x neighbour so
 * adjacent tiles join up, jittered per tile so the belt looks messy.
 */
function drawBarbedWire(ctx: CanvasRenderingContext2D, sx: number, sy: number, x: number, y: number): void {
  const h = tileHash(x, y, 0xb1e);
  const jit = (n: number): number => ((h >> ((n % 7) * 4)) & 15) / 15 - 0.5;
  const ex = HALF_W * 0.5;
  const ey = HALF_H * 0.5;
  const lx = HALF_W * 0.13;
  const ly = -HALF_H * 0.13;
  const strand = (lane: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 - 1;
      const lat = lane + (i % 2 === 0 ? 1 : -1) * (1 + jit(i));
      const px = sx + ex * t + lx * lat;
      const py = sy + ey * t + ly * lat;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  strand(-1.1 + jit(1), 'rgba(60, 56, 48, 0.85)');
  strand(1.2 + jit(2), 'rgba(122, 116, 102, 0.85)');
  ctx.strokeStyle = 'rgba(150, 144, 128, 0.85)';
  for (let i = 1; i <= 3; i++) {
    const t = (i / 4) * 2 - 1 + jit(i) * 0.3;
    const bx = sx + ex * t + lx * jit(i + 3) * 2;
    const by = sy + ey * t + ly * jit(i + 3) * 2;
    ctx.beginPath();
    ctx.moveTo(bx - lx * 1.6, by - ly * 1.6);
    ctx.lineTo(bx + lx * 1.6, by + ly * 1.6);
    ctx.stroke();
  }
}
