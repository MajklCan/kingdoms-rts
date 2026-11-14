/**
 * Life in the trees: songbirds perch on crowns in view and flutter up as a
 * little flock when a unit walks under them or a tree nearby is chopped;
 * leaves drift down from broadleaf crowns; on winter maps snow slips off the
 * spruces in small clumps. Sparse, pooled, only around the camera view.
 */

import { MAP } from '../../config';
import { ResourceKindId } from '@sim/components';
import { TileType } from '@sim/map-gen';
import type { ResourceHit, ResourceRenderer } from '../entities/resource-renderer';
import type { SpriteView } from '../entities/sprite-view';
import { clamp01, type FxHost } from './fx-host';
import { containerLifeLayer, entityLifeLayer, LifePool, type LifeRng, type UnitPresence } from './life-kit';

const MAX_PERCHED = 7;
const MAX_FLYING = 12;
const MAX_LEAVES = 14;
/** How often an empty perch slot looks for a tree, ms. */
const PERCH_SCAN_MS = 900;
/** Tiles: a unit this close flushes the birds of a tree. */
const FLUSH_UNIT_RANGE = 2;
/** Tiles: a chop this close flushes them too. */
const FLUSH_HIT_RANGE = 3;
const FLY_MS = 2600;
const LEAF_TINTS = [0xffffff, 0xd8e070, 0xe0a040, 0xb8d070] as const;
const SNOW_TILES: ReadonlySet<number> = new Set([TileType.SNOW, TileType.SNOW_FOREST, TileType.PACKED_SNOW, TileType.ICE]);

interface Perched {
  img: Phaser.GameObjects.Image;
  tx: number;
  ty: number;
  /** Offset from the tree's anchor, px. */
  ox: number;
  oy: number;
  nextFidget: number;
  hopUntil: number;
}

interface Flyer {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  phase: number;
}

interface Leaf {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vy: number;
  born: number;
  life: number;
  phase: number;
}

export class ForestLife {
  private readonly perchPool: LifePool;
  private readonly airPool: LifePool;
  private readonly perched: Perched[] = [];
  private readonly flyers: Flyer[] = [];
  private readonly leaves: Leaf[] = [];
  private readonly hits: ResourceHit[] = [];
  private nextScan = 0;
  private nextLeaf = 0;
  private nextSlip = 0;
  private snowy = false;

  constructor(
    private readonly host: FxHost,
    private readonly resources: ResourceRenderer,
    private readonly units: UnitPresence,
    private readonly rng: LifeRng,
    front: Phaser.GameObjects.Container
  ) {
    this.perchPool = new LifePool(host.ctx.scene, entityLifeLayer(host), MAX_PERCHED);
    this.airPool = new LifePool(host.ctx.scene, containerLifeLayer(front), MAX_FLYING + MAX_LEAVES);
  }

  reset(snowy: boolean): void {
    this.clear();
    this.snowy = snowy;
    this.nextScan = this.host.time + 1500;
    this.nextLeaf = this.host.time + 2000;
    this.nextSlip = this.host.time + 4000;
  }

  /** A pile lost amount this frame (chopping flushes birds, shakes leaves). */
  onHit(hit: ResourceHit): void {
    if (hit.kind !== ResourceKindId.WOOD) return;
    if (this.hits.length < 8) this.hits.push(hit);
  }

  update(dtMs: number, still: boolean): void {
    if (still) {
      this.clear();
      return;
    }
    if (dtMs <= 0) return;
    const now = this.host.time;
    this.flushFromHits(now);
    this.stepPerched(now);
    if (now >= this.nextScan) {
      this.nextScan = now + PERCH_SCAN_MS;
      this.perch(now);
    }
    this.stepFlyers(dtMs, now);
    if (now >= this.nextLeaf) {
      this.nextLeaf = now + this.rng.range(500, 1100);
      if (!this.snowy) this.dropLeafSomewhere(now);
    }
    this.stepLeaves(dtMs, now);
    if (this.snowy && now >= this.nextSlip) {
      this.nextSlip = now + this.rng.range(1800, 3600);
      this.slipSnow();
    }
  }

  clear(): void {
    for (const p of this.perched) this.perchPool.give(p.img);
    for (const f of this.flyers) this.airPool.give(f.img);
    for (const l of this.leaves) this.airPool.give(l.img);
    this.perched.length = 0;
    this.flyers.length = 0;
    this.leaves.length = 0;
    this.hits.length = 0;
  }

  get count(): number {
    return this.perched.length + this.flyers.length + this.leaves.length;
  }

  // ── Perched birds ───────────────────────────────────────────────────────

  private perch(now: number): void {
    if (this.perched.length >= MAX_PERCHED) return;
    // Reservoir-pick one visible, on-screen tree without birds and no unit close.
    let pick: { x: number; y: number; view: SpriteView } | null = null;
    let seen = 0;
    for (const tree of this.resources.liveTrees.values()) {
      const view = this.resources.treeViewAt(tree.x, tree.y);
      if (!view || !view.sprite.visible || view.sprite.isTinted) continue;
      if (!this.host.fx.onScreen(view.x, view.y - view.ref.top, -24)) continue;
      if (this.perched.some((p) => p.tx === tree.x && p.ty === tree.y)) continue;
      seen++;
      if (this.rng.next() * seen < 1) pick = { x: tree.x, y: tree.y, view };
    }
    if (!pick || this.units.near(pick.x, pick.y, FLUSH_UNIT_RANGE + 1)) return;
    // A small group lands together on one crown.
    const n = Math.min(MAX_PERCHED - this.perched.length, 1 + this.rng.int(3));
    const top = pick.view.ref.top;
    for (let i = 0; i < n; i++) {
      const img = this.perchPool.take('bird_perch');
      if (!img) return;
      const p: Perched = {
        img,
        tx: pick.x,
        ty: pick.y,
        ox: Math.round(this.rng.range(-0.22, 0.22) * Math.max(16, top * 0.55)),
        oy: -Math.round(top * this.rng.range(0.62, 0.86)),
        nextFidget: now + this.rng.range(600, 2400),
        hopUntil: 0,
      };
      img.setFlipX(this.rng.next() < 0.5);
      this.perched.push(p);
    }
  }

  private stepPerched(now: number): void {
    for (let i = this.perched.length - 1; i >= 0; i--) {
      const p = this.perched[i];
      const view = this.resources.treeViewAt(p.tx, p.ty);
      if (!view || !view.sprite.visible || view.sprite.isTinted || !this.host.fx.onScreen(view.x, view.y, 160)) {
        // Tree felled: off they go. Fogged or scrolled away: just gone.
        if (!view) this.flush(i, now);
        else this.dropPerched(i);
        continue;
      }
      if (this.units.near(p.tx, p.ty, FLUSH_UNIT_RANGE)) {
        // The whole group on the tree goes at once: the list may now be shorter.
        this.flushTree(p.tx, p.ty, now);
        i = Math.min(i, this.perched.length);
        continue;
      }
      if (now >= p.nextFidget) {
        p.nextFidget = now + this.rng.range(900, 3200);
        if (this.rng.next() < 0.5) p.img.setFlipX(!p.img.flipX);
        else p.hopUntil = now + 140;
      }
      const hop = now < p.hopUntil ? -1 : 0;
      p.img.setPosition(Math.round(view.x + p.ox), Math.round(view.y + p.oy + hop));
      this.perchPool.setDepth(p.img, view.sprite.depth + 0.01);
    }
  }

  private flushFromHits(now: number): void {
    for (const hit of this.hits) {
      this.flushNear(hit.x, hit.y, FLUSH_HIT_RANGE, now);
      if (!this.snowy) this.leafBurst(hit.screen.x, hit.top + (hit.screen.y - hit.top) * 0.35, now);
    }
    this.hits.length = 0;
  }

  private flushTree(tx: number, ty: number, now: number): void {
    this.flushNear(tx, ty, 1, now);
  }

  private flushNear(tx: number, ty: number, r: number, now: number): void {
    for (let i = this.perched.length - 1; i >= 0; i--) {
      const p = this.perched[i];
      if (Math.abs(p.tx - tx) <= r && Math.abs(p.ty - ty) <= r) this.flush(i, now);
    }
  }

  /** Perched bird `i` takes off. */
  private flush(i: number, now: number): void {
    const p = this.perched[i];
    const x = p.img.x;
    const y = p.img.y;
    this.dropPerched(i);
    const img = this.airPool.take('bird_fly0');
    if (!img || this.flyers.length >= MAX_FLYING) {
      if (img) this.airPool.give(img);
      return;
    }
    const dir = this.rng.next() < 0.5 ? -1 : 1;
    img.setFlipX(dir < 0);
    this.flyers.push({
      img,
      x,
      y,
      vx: dir * this.rng.range(34, 56),
      vy: -this.rng.range(26, 42),
      born: now - this.rng.range(0, 80),
      phase: this.rng.range(0, 200),
    });
  }

  private dropPerched(i: number): void {
    this.perchPool.give(this.perched[i].img);
    this.perched.splice(i, 1);
  }

  private stepFlyers(dtMs: number, now: number): void {
    const dt = dtMs / 1000;
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      const age = now - f.born;
      if (age >= FLY_MS) {
        this.airPool.give(f.img);
        this.flyers.splice(i, 1);
        continue;
      }
      // Climb steeply first, then level off and speed away.
      f.vy *= 1 - 0.9 * dt;
      f.vx *= 1 + 0.35 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.img.setFrame(Math.floor((age + f.phase) / 85) % 2 === 0 ? 'bird_fly0' : 'bird_fly1');
      f.img.setPosition(Math.round(f.x), Math.round(f.y));
      f.img.setAlpha(clamp01((FLY_MS - age) / 600));
    }
  }

  // ── Leaves ──────────────────────────────────────────────────────────────

  private dropLeafSomewhere(now: number): void {
    let pick: SpriteView | null = null;
    let seen = 0;
    for (const tree of this.resources.liveTrees.values()) {
      if (tree.conifer) continue;
      const view = this.resources.treeViewAt(tree.x, tree.y);
      if (!view || !view.sprite.visible || view.sprite.isTinted) continue;
      if (!this.host.fx.onScreen(view.x, view.y - view.ref.top * 0.5, -16)) continue;
      seen++;
      if (this.rng.next() * seen < 1) pick = view;
    }
    if (!pick) return;
    const top = pick.ref.top;
    this.leaf(pick.x + this.rng.range(-0.3, 0.3) * top * 0.6, pick.y - top * this.rng.range(0.45, 0.75), now, top * 0.5);
  }

  private leafBurst(x: number, y: number, now: number): void {
    const n = 2 + this.rng.int(2);
    for (let i = 0; i < n; i++) this.leaf(x + this.rng.range(-10, 10), y + this.rng.range(-6, 6), now, 26);
  }

  private leaf(x: number, y: number, now: number, fall: number): void {
    if (this.leaves.length >= MAX_LEAVES) return;
    const img = this.airPool.take('leaf');
    if (!img) return;
    img.setTint(LEAF_TINTS[this.rng.int(LEAF_TINTS.length)]);
    const vy = this.rng.range(9, 14);
    this.leaves.push({
      img,
      x,
      y,
      vy,
      born: now,
      life: Math.min(3200, Math.max(1200, (fall / vy) * 1000)),
      phase: this.rng.range(0, Math.PI * 2),
    });
  }

  private stepLeaves(dtMs: number, now: number): void {
    const dt = dtMs / 1000;
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i];
      const age = now - l.born;
      if (age >= l.life) {
        this.airPool.give(l.img);
        this.leaves.splice(i, 1);
        continue;
      }
      l.y += l.vy * dt;
      l.x += 3 * dt;
      const sway = Math.sin(age / 260 + l.phase) * 3;
      l.img.setPosition(Math.round(l.x + sway), Math.round(l.y));
      l.img.setFlipX(Math.cos(age / 260 + l.phase) < 0);
      l.img.setAlpha(clamp01((l.life - age) / 400));
    }
  }

  // ── Snow slipping off spruces ───────────────────────────────────────────

  private slipSnow(): void {
    let pick: SpriteView | null = null;
    let seen = 0;
    const tiles = this.host.ctx.world.map.tiles;
    for (const tree of this.resources.liveTrees.values()) {
      if (!tree.conifer) continue;
      const t = tiles[Math.round(tree.y) * MAP.WIDTH + Math.round(tree.x)];
      if (!SNOW_TILES.has(t)) continue;
      const view = this.resources.treeViewAt(tree.x, tree.y);
      if (!view || !view.sprite.visible || view.sprite.isTinted) continue;
      if (!this.host.fx.onScreen(view.x, view.y - view.ref.top * 0.5, -16)) continue;
      seen++;
      if (this.rng.next() * seen < 1) pick = view;
    }
    if (!pick) return;
    const fx = this.host.fx;
    if (fx.headroom('normal') < 60) return;
    const top = pick.ref.top;
    const side = this.rng.next() < 0.5 ? -1 : 1;
    const x = pick.x + side * top * this.rng.range(0.12, 0.22);
    const y = pick.y - top * this.rng.range(0.35, 0.6);
    const floorY = pick.y - this.rng.range(0, 4);
    for (let i = 0; i < 9; i++) {
      fx.emit('normal', {
        frame: 'chip',
        x: Math.round(x + this.rng.range(-3, 3)),
        y: Math.round(y + this.rng.range(-2, 2)),
        vx: side * this.rng.range(4, 12),
        vy: this.rng.range(-6, 4),
        ay: 160,
        life: this.rng.range(900, 1300),
        scale: this.rng.range(0.25, 0.5),
        alpha: 0.95,
        fadeOut: 0.3,
        tint: 0xf2f7fc,
        floorY,
        delay: i * 18,
      });
    }
  }
}
