/**
 * Things that outlive their entity for a moment, copied from the last frame
 * the entity was drawn with:
 *
 *   corpse    a dead soldier tips over, darkens, lies there a few seconds and
 *             fades (no blood); crewed guns tilt and smoke instead
 *   tree      a felled tree topples away from its stump and lands in a puff
 *             of dust and leaves, then fades (the stump stays)
 *   collapse  a destroyed building sinks into its own dust cloud while the
 *             ruin fades in underneath
 *
 * Copies are plain Images: corpses lie in the ground-FX layer (units walk
 * over them, fog dims them), trees and collapsing buildings are depth-sorted
 * in the entity layer like the sprite they replace.
 */

import { ISO } from '../../config';
import { UnitDefId } from '@sim/defs';
import type { BuildingRemoval } from '../entities/building-renderer';
import type { TreeFall } from '../entities/resource-renderer';
import type { SpriteSnapshot } from '../entities/sprite-view';
import type { UnitDeath } from '../entities/unit-renderer';
import { clamp01, easeIn, easeOut, type FxHost } from './fx-host';
import { rand } from './fx-particles';
import { collapse, dustPuff, dustRing, FX_COLORS, smoke } from './fx-recipes';

type RemainsKind = 'corpse' | 'wreck' | 'tree' | 'collapse';

interface Remains {
  kind: RemainsKind;
  img: Phaser.GameObjects.Image;
  mask: Phaser.GameObjects.Image | null;
  born: number;
  /** Fall direction (+1 / -1). */
  dir: number;
  x: number;
  y: number;
  scale: number;
  /** Collapse: sink depth px; tree: top px. */
  size: number;
  landed: boolean;
}

const MAX_CORPSES = 48;

/** Corpse timeline, ms. */
const CORPSE_FALL = 280;
const CORPSE_HOLD = 7000;
const CORPSE_FADE = 2200;
/** Tree timeline, ms. */
const TREE_FALL = 720;
const TREE_HOLD = 1500;
const TREE_FADE = 700;
/** Collapse length, ms. */
const COLLAPSE_MS = 1150;

const WRECKS: ReadonlySet<number> = new Set([UnitDefId.CANNON, UnitDefId.MACHINE_GUN, UnitDefId.MORTAR]);

export class RemainsFx {
  private readonly items: Remains[] = [];
  private corpses = 0;

  constructor(private readonly host: FxHost) {}

  unitDied(death: UnitDeath): void {
    const s = death.sprite;
    const wreck = WRECKS.has(death.unitDefId);
    if (!wreck && this.corpses >= MAX_CORPSES) this.dropOldestCorpse();
    const img = this.copy(s, this.host.ctx.layers.groundFx, false);
    if (!img) return;
    if (!wreck) this.corpses++;
    this.items.push({
      kind: wreck ? 'wreck' : 'corpse',
      img,
      mask: null,
      born: this.host.time,
      dir: s.flipX ? -1 : Math.random() < 0.5 ? -1 : 1,
      x: s.x,
      y: s.y,
      scale: s.scale,
      size: s.top,
      landed: false,
    });
    const fx = this.host.fx;
    dustPuff(fx, s.x, s.y, wreck ? 1.2 : 0.8, FX_COLORS.dust, wreck ? 6 : 4);
    if (wreck) {
      for (let i = 0; i < 3; i++) smoke(fx, s.x + rand(-4, 4), s.y - 8, FX_COLORS.smokeDark, 0.8, 0.45);
    }
  }

  treeFell(fall: TreeFall): void {
    const s = fall.sprite;
    const img = this.copy(s, null, true);
    if (!img) return;
    // Topple around the foot of the trunk (lowest opaque row), not the
    // sprite anchor, which can sit lower on the ground diamond.
    const f = img.frame;
    const footY = Math.min(s.originY * f.realHeight, f.y + f.cutHeight - 2);
    const lift = (s.originY * f.realHeight - footY) * s.scale;
    img.setOrigin(s.originX, footY / Math.max(1, f.realHeight));
    img.y = s.y - lift;
    this.items.push({
      kind: 'tree',
      img,
      mask: null,
      born: this.host.time,
      dir: Math.random() < 0.5 ? -1 : 1,
      x: s.x,
      y: s.y - lift,
      scale: s.scale,
      size: s.top,
      landed: false,
    });
  }

  buildingRemoved(removal: BuildingRemoval): void {
    const fx = this.host.fx;
    const c = removal.center;
    const hw = ((removal.w + removal.h) * ISO.TILE_W) / 4;
    const hh = ((removal.w + removal.h) * ISO.TILE_H) / 4;
    if (removal.foundation) {
      dustRing(fx, c.x, c.y, hw * 0.7, hh * 0.7, 8, FX_COLORS.dust, 0.8);
      return;
    }
    const s = removal.sprite;
    const top = s?.top ?? 40;
    collapse(fx, c.x, c.y, hw, hh, top);
    this.host.shake(c.x, c.y - top * 0.3, 0.0065, 320);
    if (!s) return;
    const img = this.copy(s, null, true);
    if (!img) return;
    const mask = s.mask ? this.copy({ ...s, frame: s.mask.frame ?? s.frame }, null, true) : null;
    if (mask && s.mask) mask.setTint(s.mask.tint);
    this.items.push({
      kind: 'collapse',
      img,
      mask,
      born: this.host.time,
      dir: 1,
      x: s.x,
      y: s.y,
      scale: s.scale,
      size: Math.max(12, top * 0.42),
      landed: false,
    });
  }

  update(): void {
    const now = this.host.time;
    let i = 0;
    while (i < this.items.length) {
      const r = this.items[i];
      const alive = this.step(r, now - r.born);
      if (alive) {
        i++;
        continue;
      }
      this.release(r);
      this.items[i] = this.items[this.items.length - 1];
      this.items.pop();
    }
  }

  clear(): void {
    for (const r of this.items) this.release(r);
    this.items.length = 0;
    this.corpses = 0;
  }

  get count(): number {
    return this.items.length;
  }

  private step(r: Remains, age: number): boolean {
    switch (r.kind) {
      case 'corpse':
        return this.stepCorpse(r, age, 1.32);
      case 'wreck':
        return this.stepCorpse(r, age, 0.22);
      case 'tree':
        return this.stepTree(r, age);
      case 'collapse':
        return this.stepCollapse(r, age);
    }
  }

  private stepCorpse(r: Remains, age: number, lean: number): boolean {
    const total = CORPSE_FALL + CORPSE_HOLD + CORPSE_FADE;
    if (age >= total) return false;
    const fall = easeIn(clamp01(age / CORPSE_FALL));
    r.img.rotation = r.dir * lean * fall;
    // Darken as it settles: 0xffffff -> 0x8c8478.
    const k = clamp01(age / 700);
    r.img.setTint(lerpColor(0xffffff, 0x8c8478, k));
    r.img.setAlpha(age < CORPSE_FALL + CORPSE_HOLD ? 1 : 1 - (age - CORPSE_FALL - CORPSE_HOLD) / CORPSE_FADE);
    if (!r.landed && age >= CORPSE_FALL) {
      r.landed = true;
      if (r.kind === 'corpse') {
        const reach = r.size * 0.55;
        dustPuff(this.host.fx, r.x + r.dir * reach, r.y - 2, 0.6, FX_COLORS.dust, 3);
      }
    }
    return true;
  }

  private stepTree(r: Remains, age: number): boolean {
    const total = TREE_FALL + TREE_HOLD + TREE_FADE;
    if (age >= total) return false;
    const angle = 1.42;
    let rot: number;
    if (age < TREE_FALL) {
      rot = angle * easeIn(age / TREE_FALL);
    } else {
      // A small bounce on landing.
      const b = (age - TREE_FALL) / 260;
      rot = angle - (b < 1 ? Math.sin(b * Math.PI) * 0.07 : 0);
    }
    r.img.rotation = r.dir * rot;
    r.img.setAlpha(age < TREE_FALL + TREE_HOLD ? 1 : 1 - (age - TREE_FALL - TREE_HOLD) / TREE_FADE);
    if (!r.landed && age >= TREE_FALL) {
      r.landed = true;
      const fx = this.host.fx;
      const len = r.size * 0.8;
      for (let k = 1; k <= 3; k++) {
        dustPuff(fx, r.x + r.dir * len * (k / 3), r.y - 2 + k, 0.7, FX_COLORS.dust, 2);
      }
      const crownX = r.x + r.dir * len * 0.75;
      for (let k = 0; k < 7; k++) {
        fx.emit('normal', {
          frame: 'leaf',
          x: crownX + rand(-10, 10),
          y: r.y - rand(2, 10),
          vx: rand(-20, 20),
          vy: rand(-40, -15),
          ay: 40,
          drag: 1.4,
          life: rand(900, 1500),
          scale: rand(0.8, 1.2),
          alpha: 0.95,
          fadeOut: 0.4,
          tint: Math.random() < 0.7 ? FX_COLORS.leaf : 0x9bb24a,
          rotation: rand(0, Math.PI),
          spin: rand(-5, 5),
        });
      }
      this.host.shake(r.x, r.y, 0.0012, 90);
    }
    return true;
  }

  private stepCollapse(r: Remains, age: number): boolean {
    if (age >= COLLAPSE_MS) return false;
    const t = age / COLLAPSE_MS;
    const sink = r.size * easeIn(t);
    const jitter = (1 - t) * 1.6 * Math.sin(age * 0.09);
    this.placeSunk(r.img, r, sink, jitter);
    const alpha = t < 0.45 ? 1 : 1 - easeOut((t - 0.45) / 0.55);
    r.img.setAlpha(alpha);
    if (r.mask) {
      this.placeSunk(r.mask, r, sink, jitter);
      r.mask.setAlpha(alpha);
    }
    return true;
  }

  private placeSunk(img: Phaser.GameObjects.Image, r: Remains, sink: number, jitter: number): void {
    img.x = r.x + jitter;
    img.y = r.y + sink;
    const f = img.frame;
    const cutTex = sink / Math.max(0.01, r.scale);
    img.setCrop(0, 0, f.realWidth, Math.max(1, f.realHeight - cutTex - (f.realHeight - (f.y + f.cutHeight))));
  }

  private copy(s: SpriteSnapshot, into: Phaser.GameObjects.Container | null, sorted: boolean): Phaser.GameObjects.Image | null {
    const scene = this.host.ctx.scene;
    if (!scene.textures.exists(s.texture)) return null;
    const img = scene.add.image(s.x, s.y, s.texture, s.frame);
    img.setOrigin(s.originX, s.originY);
    img.setScale(s.scale);
    img.setFlipX(s.flipX);
    img.setAlpha(s.alpha);
    if (sorted) {
      const layer = this.host.ctx.layers.entities;
      layer.add(img);
      layer.setDepth(img, s.depth);
    } else {
      into?.add(img);
    }
    return img;
  }

  private release(r: Remains): void {
    if (r.kind === 'corpse') this.corpses--;
    r.img.destroy();
    r.mask?.destroy();
  }

  private dropOldestCorpse(): void {
    let oldest = -1;
    for (let i = 0; i < this.items.length; i++) {
      const r = this.items[i];
      if (r.kind !== 'corpse') continue;
      if (oldest < 0 || r.born < this.items[oldest].born) oldest = i;
    }
    if (oldest < 0) return;
    this.release(this.items[oldest]);
    this.items[oldest] = this.items[this.items.length - 1];
    this.items.pop();
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const q = Math.round(t * 16) / 16;
  const r = Math.round(((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * q));
  const g = Math.round(((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * q));
  const bl = Math.round((a & 0xff) + (((b & 0xff) - (a & 0xff)) * q));
  return (r << 16) | (g << 8) | bl;
}
