/**
 * Shared bits of the ambient life (birds, wildlife, village life): a seeded
 * render RNG, a pool of pixel-art images on the life sheet, the "is a unit
 * close" lookup animals react to, and tile helpers.
 *
 * Render-only: the sim is read, never written, and nothing here is ever
 * interactive (no input hooks), so the life can never be selected or change
 * the cursor.
 */

import { MAP } from '../../config';
import { Position } from '@sim/components';
import { unitQuery } from '@sim/world';
import type { FxHost } from './fx-host';
import { LIFE_SHEET, type LifeFrame } from './life-sprites';

/** Mulberry32: deterministic render-side randomness (never the sim RNG). */
export class LifeRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(ratePerSec: number, dtMs: number): boolean {
    return this.next() < (ratePerSec * dtMs) / 1000;
  }
}

/** Seed for a map: a hash of its tiles, so every peer sees the same life. */
export function mapLifeSeed(tiles: ArrayLike<number>): number {
  let h = 2166136261;
  for (let i = 0; i < tiles.length; i += 7) {
    h ^= tiles[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Where pooled images go: the painter-sorted entity layer or a plain container. */
export interface LifeLayer {
  add(img: Phaser.GameObjects.Image): void;
  depth(img: Phaser.GameObjects.Image, depth: number): void;
}

export function entityLifeLayer(host: FxHost): LifeLayer {
  const entities = host.ctx.layers.entities;
  return {
    add: (img) => entities.add(img),
    depth: (img, depth) => entities.setDepth(img, depth),
  };
}

export function containerLifeLayer(container: Phaser.GameObjects.Container): LifeLayer {
  return {
    add: (img) => container.add(img),
    depth: () => undefined,
  };
}

/** Fixed-size pool of life-sheet images; hidden when free. */
export class LifePool {
  private readonly free: Phaser.GameObjects.Image[] = [];
  private made = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: LifeLayer,
    private readonly max: number
  ) {}

  take(frame: LifeFrame): Phaser.GameObjects.Image | null {
    let img = this.free.pop();
    if (!img) {
      if (this.made >= this.max) return null;
      this.made++;
      img = this.scene.add.image(0, 0, LIFE_SHEET, frame).setOrigin(0.5, 1);
      this.layer.add(img);
    }
    img.setFrame(frame).setVisible(true).setAlpha(1).setFlipX(false).clearTint();
    return img;
  }

  give(img: Phaser.GameObjects.Image): void {
    img.setVisible(false);
    this.free.push(img);
  }

  setDepth(img: Phaser.GameObjects.Image, depth: number): void {
    this.layer.depth(img, depth);
  }
}

/** Tiles with a visible unit on them, refreshed a few times a second. */
export class UnitPresence {
  private readonly tiles = new Set<number>();
  private refreshedAt = -Infinity;

  constructor(private readonly host: FxHost) {}

  refresh(now: number): void {
    if (now - this.refreshedAt < 200 && now >= this.refreshedAt) return;
    this.refreshedAt = now;
    this.tiles.clear();
    const ctx = this.host.ctx;
    for (const eid of unitQuery(ctx.world.ecs)) {
      const x = Math.round(Position.x[eid]);
      const y = Math.round(Position.y[eid]);
      if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
      if (!ctx.isTileVisible(x, y)) continue;
      this.tiles.add(y * MAP.WIDTH + x);
    }
  }

  /** Nearest unit tile within `r` tiles (Chebyshev), or null. */
  near(tx: number, ty: number, r: number): { x: number; y: number } | null {
    if (this.tiles.size === 0) return null;
    const cx = Math.round(tx);
    const cy = Math.round(ty);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= MAP.HEIGHT) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= MAP.WIDTH || !this.tiles.has(y * MAP.WIDTH + x)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  clear(): void {
    this.tiles.clear();
    this.refreshedAt = -Infinity;
  }
}

/** Tile type at a tile, or -1 off the map. */
export function tileAt(host: FxHost, x: number, y: number): number {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return -1;
  return host.ctx.world.map.tiles[ty * MAP.WIDTH + tx];
}

/** Open, visible ground (no building, tree or rock on it). */
export function isOpenVisible(host: FxHost, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
  if (host.ctx.world.map.walkability[ty]?.[tx] !== 0) return false;
  return host.ctx.isTileVisible(tx, ty);
}

/** A random tile under the camera view (layer px -> tile), or null off the map. */
export function randomViewTile(host: FxHost, rng: LifeRng, inset = 0.08): { x: number; y: number } | null {
  const v = host.fx.view;
  const w = v.right - v.left;
  const h = v.bottom - v.top;
  const lx = v.left + w * rng.range(inset, 1 - inset);
  const ly = v.top + h * rng.range(inset, 1 - inset);
  const root = host.ctx.layers.root;
  const t = host.ctx.pickTile(lx + root.x, ly + root.y);
  if (t.tx < 0 || t.ty < 0 || t.tx >= MAP.WIDTH || t.ty >= MAP.HEIGHT) return null;
  return { x: t.tx, y: t.ty };
}

/** Screen (layer) position of a fractional tile, snapped to whole px. */
export function groundPoint(host: FxHost, x: number, y: number): { x: number; y: number } {
  const p = host.ctx.tileToScreen(x, y);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
