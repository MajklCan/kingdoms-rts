/**
 * Quiet life in the world around the camera, sparse and cheap:
 *
 *   cloud shadows  three huge soft blobs drifting with the wind
 *   birds          a small flock crosses the view every half minute or so
 *   butterflies    a few flutter over grass (temperate maps)
 *   fireflies      blinking glows over mud and shallows (marsh maps)
 *   mist           pale banks drifting low (marsh maps)
 *   snow           flakes falling across the view (winter maps)
 *   motes          sunlit dust drifting (non-winter maps)
 *   glints         twinkles on open water and on gold piles
 *
 * The climate comes from the map's tile mix, once per world. Everything is
 * spawned relative to the camera view, so cost does not grow with the map.
 * With prefers-reduced-motion only the static touches remain (glints, mist).
 */

import { MAP } from '../../config';
import { TileType } from '@sim/map-gen';
import type { ResourceRenderer } from '../entities/resource-renderer';
import { clamp01, type FxHost } from './fx-host';
import { rand } from './fx-particles';
import { FX_COLORS, glint } from './fx-recipes';
import { FX_CLOUD, FX_SHEET, type FxFrame } from './fx-textures';
import { reducedMotion } from './motion-prefs';

/** Wind, px/s (layer space): drifts clouds, smoke leans the same way. */
const WIND_X = 9;
const WIND_Y = 2.5;

interface Climate {
  snow: boolean;
  marsh: boolean;
  water: boolean;
}

interface Drifter {
  img: Phaser.GameObjects.Image;
  /** Offset from the view's top-left, px; wraps around the view. */
  ox: number;
  oy: number;
  speed: number;
}

interface Critter {
  img: Phaser.GameObjects.Image;
  frames: readonly [FxFrame, FxFrame];
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  phase: number;
  flapMs: number;
  active: boolean;
}

const SNOW_TILES: ReadonlySet<number> = new Set([TileType.SNOW, TileType.SNOW_FOREST, TileType.ICE, TileType.PACKED_SNOW]);
const WATER_TILES: ReadonlySet<number> = new Set([TileType.WATER, TileType.WATER_SHALLOW]);
const MARSH_TILES: ReadonlySet<number> = new Set([TileType.MUD, TileType.WATER_SHALLOW]);
const BUTTERFLY_TINTS = [0xffffff, 0xffe066, 0xa8d8ff, 0xffb3c7, 0xffd0a0] as const;

export class AmbientFx {
  private climate: Climate = { snow: false, marsh: false, water: false };
  private readonly back: Phaser.GameObjects.Container;
  private readonly front: Phaser.GameObjects.Container;
  private readonly clouds: Drifter[] = [];
  private readonly mist: Drifter[] = [];
  private readonly birds: Critter[] = [];
  private readonly flies: Critter[] = [];
  private nextFlock = 0;
  private lastWaterGlint = 0;
  private lastGoldGlint = 0;

  constructor(
    private readonly host: FxHost,
    private readonly resources: ResourceRenderer
  ) {
    const scene = host.ctx.scene;
    // Cloud shadows and mist sit over the entities but under rings and bars.
    this.back = scene.add.container(0, 0);
    host.ctx.layers.overlay.addAt(this.back, 0);
    // Birds fly over everything.
    this.front = scene.add.container(0, 0);
    host.ctx.layers.effects.add(this.front);
    for (let i = 0; i < 3; i++) {
      const img = scene.add.image(0, 0, FX_CLOUD).setTint(0x101418).setAlpha(0.085);
      img.setScale(rand(4.2, 5.6), rand(2.6, 3.2));
      this.back.add(img);
      this.clouds.push({ img, ox: 0, oy: 0, speed: rand(0.8, 1.2) });
    }
    for (let i = 0; i < 5; i++) {
      const img = scene.add.image(0, 0, FX_CLOUD).setTint(0xeef3f2).setAlpha(rand(0.24, 0.32));
      img.setScale(rand(2.2, 3.2), rand(0.8, 1.1));
      img.setVisible(false);
      this.back.add(img);
      this.mist.push({ img, ox: 0, oy: 0, speed: rand(0.35, 0.6) });
    }
  }

  /** Read the map's climate and scatter the drifters (new world). */
  reset(): void {
    const tiles = this.host.ctx.world.map.tiles;
    let snow = 0;
    let marsh = 0;
    let water = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (SNOW_TILES.has(t)) snow++;
      if (MARSH_TILES.has(t)) marsh++;
      if (WATER_TILES.has(t)) water++;
    }
    const n = Math.max(1, tiles.length);
    this.climate = { snow: snow / n > 0.2, marsh: marsh / n > 0.06, water: water > 0 };
    const v = this.host.fx.view;
    const w = Math.max(1, v.right - v.left);
    const h = Math.max(1, v.bottom - v.top);
    for (const c of this.clouds) {
      c.ox = rand(0, w + 900);
      c.oy = rand(0, h + 500);
    }
    for (const m of this.mist) {
      m.ox = rand(0, w + 600);
      m.oy = rand(0, h + 200);
      m.img.setVisible(this.climate.marsh);
    }
    for (const b of this.birds) this.retire(b);
    for (const f of this.flies) this.retire(f);
    this.nextFlock = this.host.time + rand(6000, 14000);
  }

  update(dtMs: number): void {
    const still = reducedMotion();
    const v = this.host.fx.view;
    this.drift(this.clouds, still ? 0 : dtMs, 900, 500, !still);
    if (this.climate.marsh) this.drift(this.mist, still ? 0 : dtMs, 600, 200, true);
    if (dtMs <= 0) return;
    const fx = this.host.fx;
    const now = this.host.time;

    if (still) {
      for (const b of this.birds) if (b.active) this.retire(b);
      for (const f of this.flies) if (f.active) this.retire(f);
    } else {
      this.flocks(now);
      this.stepCritters(this.birds, dtMs, now);
      if (!this.climate.snow) this.butterflies(now);
      this.stepCritters(this.flies, dtMs, now);
      const area = ((v.right - v.left) * (v.bottom - v.top)) / 1e6;
      if (this.climate.snow) this.snow(dtMs, area);
      else this.motes(dtMs, area);
      if (this.climate.marsh) this.fireflies(dtMs, area);
    }

    // Glints: twinkles, not motion, so they stay with reduced motion.
    if (this.climate.water && now - this.lastWaterGlint > 110 && fx.headroom('add') > 120) {
      for (let k = 0; k < 3; k++) {
        const x = rand(v.left, v.right);
        const y = rand(v.top, v.bottom);
        if (!this.isTile(x, y, WATER_TILES)) continue;
        glint(fx, x, y, 0xf4fbff, rand(0.35, 0.6));
        this.lastWaterGlint = now;
        break;
      }
    }
    const golds = this.resources.goldInViewCount;
    if (golds > 0 && now - this.lastGoldGlint > 260) {
      this.lastGoldGlint = now;
      const spot = this.resources.goldInView[Math.floor(Math.random() * golds)];
      glint(fx, spot.x + rand(-9, 9), spot.y + rand(-6, 6), FX_COLORS.goldGlint, rand(0.6, 0.9));
    }
  }

  clear(): void {
    for (const b of this.birds) this.retire(b);
    for (const f of this.flies) this.retire(f);
  }

  // ── Drifters (clouds, mist) ─────────────────────────────────────────────

  private drift(items: Drifter[], dtMs: number, padX: number, padY: number, visible: boolean): void {
    const v = this.host.fx.view;
    const w = v.right - v.left + padX;
    const h = v.bottom - v.top + padY;
    const dt = dtMs / 1000;
    for (const d of items) {
      d.ox = wrap(d.ox + WIND_X * d.speed * dt, w);
      d.oy = wrap(d.oy + WIND_Y * d.speed * dt, h);
      d.img.setPosition(v.left - padX / 2 + d.ox, v.top - padY / 2 + d.oy);
      if (d.img.visible !== visible && items === this.clouds) d.img.setVisible(visible);
    }
  }

  // ── Birds ───────────────────────────────────────────────────────────────

  private flocks(now: number): void {
    if (now < this.nextFlock) return;
    this.nextFlock = now + rand(22000, 46000);
    const v = this.host.fx.view;
    const fromLeft = Math.random() < 0.5;
    const dir = fromLeft ? 1 : -1;
    const speed = rand(42, 58);
    const n = 3 + Math.floor(Math.random() * 3);
    const y0 = rand(v.top + 40, v.top + (v.bottom - v.top) * 0.6);
    const x0 = fromLeft ? v.left - 40 : v.right + 40;
    const climb = rand(-6, 6);
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
      const b = this.critter(this.birds, ['bird0', 'bird1'], this.front);
      if (!b) return;
      b.x = x0 - dir * Math.abs(rank) * 14;
      b.y = y0 + rank * 9;
      b.vx = dir * speed;
      b.vy = climb;
      b.born = now;
      b.life = ((v.right - v.left + 160) / speed) * 1000;
      b.phase = rand(0, 300);
      b.flapMs = rand(120, 160);
      b.img.setTint(0xffffff).setAlpha(0.85).setScale(1).setFlipX(!fromLeft);
    }
  }

  // ── Butterflies ─────────────────────────────────────────────────────────

  private butterflies(now: number): void {
    let active = 0;
    for (const f of this.flies) if (f.active) active++;
    if (active >= 5 || Math.random() > 0.02) return;
    const v = this.host.fx.view;
    const cx = (v.left + v.right) / 2;
    const cy = (v.top + v.bottom) / 2;
    const x = cx + rand(-0.4, 0.4) * (v.right - v.left);
    const y = cy + rand(-0.4, 0.4) * (v.bottom - v.top);
    if (!this.isTile(x, y, GRASS_TILES)) return;
    const f = this.critter(this.flies, ['fly0', 'fly1'], this.front);
    if (!f) return;
    f.x = x;
    f.y = y - rand(6, 14);
    f.vx = rand(-14, 14);
    f.vy = rand(-6, 6);
    f.born = now;
    f.life = rand(9000, 15000);
    f.phase = rand(0, 1000);
    f.flapMs = rand(90, 130);
    f.img.setTint(BUTTERFLY_TINTS[Math.floor(Math.random() * BUTTERFLY_TINTS.length)]).setScale(0.9).setFlipX(false);
  }

  private stepCritters(items: Critter[], dtMs: number, now: number): void {
    const dt = dtMs / 1000;
    for (const c of items) {
      if (!c.active) continue;
      const age = now - c.born;
      if (age >= c.life) {
        this.retire(c);
        continue;
      }
      if (items === this.flies) {
        // Wander: steer with slow sines, flutter up and down.
        c.vx += Math.sin((age + c.phase) / 700) * 18 * dt;
        c.vy += Math.cos((age + c.phase) / 900) * 10 * dt;
        c.vx = Math.max(-18, Math.min(18, c.vx));
        c.vy = Math.max(-9, Math.min(9, c.vy));
        c.img.setFlipX(c.vx < 0);
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      const bob = items === this.flies ? Math.sin((age + c.phase) / 140) * 1.5 : 0;
      c.img.setPosition(c.x, c.y + bob);
      c.img.setFrame(c.frames[Math.floor((age + c.phase) / c.flapMs) % 2]);
      const fade = clamp01(age / 500) * clamp01((c.life - age) / 600);
      c.img.setAlpha((items === this.birds ? 0.85 : 0.95) * fade);
    }
  }

  private critter(items: Critter[], frames: readonly [FxFrame, FxFrame], into: Phaser.GameObjects.Container): Critter | null {
    for (const c of items) {
      if (c.active) continue;
      c.active = true;
      c.frames = frames;
      c.img.setVisible(true);
      return c;
    }
    if (items.length >= 8) return null;
    const img = this.host.ctx.scene.add.image(0, 0, FX_SHEET, frames[0]);
    into.add(img);
    const c: Critter = { img, frames, x: 0, y: 0, vx: 0, vy: 0, born: 0, life: 0, phase: 0, flapMs: 140, active: true };
    items.push(c);
    return c;
  }

  private retire(c: Critter): void {
    c.active = false;
    c.img.setVisible(false);
  }

  // ── Weather and motes (pooled particles) ────────────────────────────────

  private snow(dtMs: number, areaMpx: number): void {
    const fx = this.host.fx;
    if (fx.headroom('normal') < 260) return;
    const v = this.host.fx.view;
    const n = spawnCount(70 * areaMpx, dtMs);
    for (let i = 0; i < n; i++) {
      const big = Math.random() < 0.25;
      fx.emit('normal', {
        frame: 'dot',
        x: rand(v.left - 40, v.right),
        y: rand(v.top - 30, v.bottom - 40),
        vx: WIND_X * 1.6 + rand(-5, 5),
        vy: rand(24, 38) * (big ? 1.25 : 1),
        life: rand(3600, 5200),
        scale: big ? rand(0.55, 0.75) : rand(0.3, 0.45),
        alpha: big ? 0.9 : 0.75,
        fadeIn: 0.15,
        fadeOut: 0.25,
        tint: FX_COLORS.snowDust,
      });
    }
  }

  private motes(dtMs: number, areaMpx: number): void {
    const fx = this.host.fx;
    if (fx.headroom('add') < 200) return;
    const v = this.host.fx.view;
    const n = spawnCount(2.2 * areaMpx, dtMs);
    for (let i = 0; i < n; i++) {
      fx.emit('add', {
        frame: 'dot',
        x: rand(v.left, v.right),
        y: rand(v.top, v.bottom),
        vx: WIND_X * 0.7 + rand(-3, 3),
        vy: rand(-5, -1),
        life: rand(4000, 6500),
        scale: rand(0.25, 0.4),
        alpha: 0.22,
        fadeIn: 0.35,
        fadeOut: 0.4,
        tint: 0xfff3d2,
      });
    }
  }

  private fireflies(dtMs: number, areaMpx: number): void {
    const fx = this.host.fx;
    if (fx.headroom('add') < 200) return;
    const v = this.host.fx.view;
    const n = spawnCount(5 * areaMpx, dtMs);
    for (let i = 0; i < n; i++) {
      const x = rand(v.left, v.right);
      const y = rand(v.top, v.bottom);
      if (!this.isTile(x, y, MARSH_TILES)) continue;
      fx.emit('add', {
        frame: 'glow',
        x,
        y: y - rand(4, 14),
        vx: rand(-6, 6),
        vy: rand(-4, 2),
        life: rand(1400, 2200),
        scale: rand(0.12, 0.18),
        alpha: 0.75,
        fadeIn: 0.45,
        fadeOut: 0.5,
        tint: 0xd9ff7a,
      });
    }
  }

  /** Tile under a layer-local point is visible to the player and in `kinds`. */
  private isTile(x: number, y: number, kinds: ReadonlySet<number>): boolean {
    const ctx = this.host.ctx;
    const t = ctx.pickTile(x + ctx.layers.root.x, y + ctx.layers.root.y);
    if (t.tx < 0 || t.ty < 0 || t.tx >= MAP.WIDTH || t.ty >= MAP.HEIGHT) return false;
    if (!kinds.has(ctx.world.map.tiles[t.ty * MAP.WIDTH + t.tx])) return false;
    return ctx.isTileVisible(t.tx, t.ty);
  }
}

const GRASS_TILES: ReadonlySet<number> = new Set([TileType.GRASS, TileType.FOREST]);

function wrap(v: number, size: number): number {
  if (size <= 0) return 0;
  const r = v % size;
  return r < 0 ? r + size : r;
}

function spawnCount(ratePerSec: number, dtMs: number): number {
  const expected = (ratePerSec * dtMs) / 1000;
  const whole = Math.floor(expected);
  return whole + (Math.random() < expected - whole ? 1 : 0);
}
