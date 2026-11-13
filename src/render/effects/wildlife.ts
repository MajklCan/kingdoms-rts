/**
 * Wild animals as pure decor: a few deer graze in the open and bolt when a
 * unit comes close, rabbits sit and hop off, ducks paddle near the shore,
 * fish rise in rings on open water, frogs and dragonflies haunt the marsh.
 * Spawned only on visible tiles around the camera view, a handful at a time.
 */

import { MAP } from '../../config';
import { TileType } from '@sim/map-gen';
import { clamp01, type FxHost } from './fx-host';
import {
  containerLifeLayer,
  entityLifeLayer,
  groundPoint,
  isOpenVisible,
  LifePool,
  randomViewTile,
  tileAt,
  type LifeRng,
  type UnitPresence,
} from './life-kit';
import { cycle, drawMob, fleeFrom, makeMob, stepMob, wander, type Mob } from './life-mobs';
import type { LifeFrame } from './life-sprites';

type Kind = 'deer' | 'rabbit' | 'duck' | 'frog' | 'dragonfly';

const CAPS: Readonly<Record<Kind, number>> = { deer: 3, rabbit: 3, duck: 4, frog: 3, dragonfly: 3 };
const SPAWN_MS = 1400;
/** Tiles: animals keep this far from units when they appear. */
const SHY_RANGE = 5;
const MAX_RINGS = 3;

const OPEN_GRASS: ReadonlySet<number> = new Set([TileType.GRASS]);
const DEER_GROUND: ReadonlySet<number> = new Set([TileType.GRASS, TileType.FOREST, TileType.SNOW, TileType.SNOW_FOREST]);
const WATER: ReadonlySet<number> = new Set([TileType.WATER, TileType.WATER_SHALLOW]);
const MARSH: ReadonlySet<number> = new Set([TileType.MUD, TileType.WATER_SHALLOW]);

export interface WildClimate {
  snow: boolean;
  marsh: boolean;
  water: boolean;
}

interface Ring {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  born: number;
}

export class Wildlife {
  private readonly ground: LifePool;
  private readonly air: LifePool;
  private readonly flat: LifePool;
  private readonly mobs: Record<Kind, Mob[]> = { deer: [], rabbit: [], duck: [], frog: [], dragonfly: [] };
  private readonly rings: Ring[] = [];
  private climate: WildClimate = { snow: false, marsh: false, water: false };
  private nextSpawn = 0;
  private nextRing = 0;

  constructor(
    private readonly host: FxHost,
    private readonly units: UnitPresence,
    private readonly rng: LifeRng,
    front: Phaser.GameObjects.Container
  ) {
    const scene = host.ctx.scene;
    this.ground = new LifePool(scene, entityLifeLayer(host), CAPS.deer + CAPS.rabbit + CAPS.duck + CAPS.frog);
    this.air = new LifePool(scene, containerLifeLayer(front), CAPS.dragonfly);
    this.flat = new LifePool(scene, containerLifeLayer(host.ctx.layers.groundFx), MAX_RINGS);
  }

  reset(climate: WildClimate): void {
    this.clear();
    this.climate = climate;
    this.nextSpawn = this.host.time + 2500;
    this.nextRing = this.host.time + 3000;
  }

  update(dtMs: number, still: boolean): void {
    if (still) {
      this.clear();
      return;
    }
    if (dtMs <= 0) return;
    const now = this.host.time;
    if (now >= this.nextSpawn) {
      this.nextSpawn = now + SPAWN_MS;
      this.spawn(now);
    }
    this.stepDeer(dtMs, now);
    this.stepRabbits(dtMs, now);
    this.stepDucks(dtMs, now);
    this.stepFrogs(dtMs, now);
    this.stepDragonflies(dtMs, now);
    if (this.climate.water) this.stepRings(now);
  }

  clear(): void {
    for (const kind of Object.keys(this.mobs) as Kind[]) {
      const pool = kind === 'dragonfly' ? this.air : this.ground;
      for (const m of this.mobs[kind]) pool.give(m.img);
      this.mobs[kind].length = 0;
    }
    for (const r of this.rings) this.flat.give(r.img);
    this.rings.length = 0;
  }

  get count(): number {
    let n = this.rings.length;
    for (const kind of Object.keys(this.mobs) as Kind[]) n += this.mobs[kind].length;
    return n;
  }

  // ── Spawning ────────────────────────────────────────────────────────────

  private spawn(now: number): void {
    // One try per tick, rotating through what this map can host.
    const order: Kind[] = ['deer', 'rabbit', 'duck', 'frog', 'dragonfly'];
    const kind = order[this.rng.int(order.length)];
    if (this.mobs[kind].length >= CAPS[kind]) return;
    const t = randomViewTile(this.host, this.rng);
    if (!t || this.units.near(t.x, t.y, SHY_RANGE)) return;
    const tile = tileAt(this.host, t.x, t.y);
    switch (kind) {
      case 'deer':
        if (this.mobs.deer.length > 0 || !DEER_GROUND.has(tile) || !isOpenVisible(this.host, t.x, t.y)) return;
        for (let i = 0, n = 2 + this.rng.int(2); i < n; i++) {
          this.add('deer', t.x + this.rng.range(-0.8, 0.8), t.y + this.rng.range(-0.8, 0.8), 'deer_graze', now);
        }
        return;
      case 'rabbit':
        if (this.climate.snow || !OPEN_GRASS.has(tile) || !isOpenVisible(this.host, t.x, t.y)) return;
        this.add('rabbit', t.x + this.rng.range(-0.3, 0.3), t.y + this.rng.range(-0.3, 0.3), 'rabbit_sit', now);
        return;
      case 'duck':
        if (!WATER.has(tile) || !this.nearLand(t.x, t.y) || !this.host.ctx.isTileVisible(t.x, t.y)) return;
        for (let i = 0, n = 1 + this.rng.int(2); i < n; i++) {
          this.add('duck', t.x + this.rng.range(-0.4, 0.4), t.y + this.rng.range(-0.4, 0.4), 'duck0', now);
        }
        return;
      case 'frog':
        if (!this.climate.marsh || !MARSH.has(tile) || !this.host.ctx.isTileVisible(t.x, t.y)) return;
        this.add('frog', t.x + this.rng.range(-0.3, 0.3), t.y + this.rng.range(-0.3, 0.3), 'frog0', now);
        return;
      case 'dragonfly': {
        if (!(this.climate.marsh || this.climate.water) || this.climate.snow) return;
        if (!(MARSH.has(tile) || (WATER.has(tile) && this.nearLand(t.x, t.y)))) return;
        if (!this.host.ctx.isTileVisible(t.x, t.y)) return;
        const m = this.add('dragonfly', t.x, t.y, 'fly_drag0', now);
        if (m) m.lift = Math.round(this.rng.range(8, 14));
        return;
      }
    }
  }

  private add(kind: Kind, x: number, y: number, frame: LifeFrame, now: number): Mob | null {
    if (this.mobs[kind].length >= CAPS[kind]) return null;
    const pool = kind === 'dragonfly' ? this.air : this.ground;
    const img = pool.take(frame);
    if (!img) return null;
    img.setAlpha(0);
    const m = makeMob(img, x, y, now, this.rng);
    img.setFlipX(this.rng.next() < 0.5);
    this.mobs[kind].push(m);
    return m;
  }

  /** Drop mobs that left, got fogged or scrolled far away. Returns false when `m` was removed. */
  private keep(kind: Kind, i: number, m: Mob): boolean {
    const p = groundPoint(this.host, m.x, m.y);
    const gone =
      m.state === 'gone' ||
      !this.host.fx.onScreen(p.x, p.y, 260) ||
      !this.host.ctx.isTileVisible(Math.round(m.x), Math.round(m.y));
    if (!gone) return true;
    (kind === 'dragonfly' ? this.air : this.ground).give(m.img);
    this.mobs[kind].splice(i, 1);
    return false;
  }

  // ── Deer ────────────────────────────────────────────────────────────────

  private stepDeer(dtMs: number, now: number): void {
    const list = this.mobs.deer;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!this.keep('deer', i, m)) continue;
      if (m.state !== 'flee') {
        const threat = this.units.near(m.x, m.y, 3);
        if (threat) {
          // The whole herd bolts together.
          for (const d of list) {
            if (d.state === 'flee') continue;
            d.state = 'flee';
            fleeFrom(d, threat, this.rng, this.rng.range(2.4, 2.9));
            d.leaving = now + 1700;
          }
        }
      }
      if (m.state === 'flee') {
        stepMob(m, dtMs, (x, y) => tileAt(this.host, x, y) < 0 || WATER.has(tileAt(this.host, x, y)));
        drawMob(this.host, this.ground, m, cycle('deer_run0', 'deer_run1', now, m.phase, 110), now);
        continue;
      }
      if (now >= m.until) this.nextDeerState(m, now);
      stepMob(m, dtMs, (x, y) => !isOpenVisible(this.host, x, y));
      const frame: LifeFrame =
        m.state === 'idle' ? 'deer_graze' : m.state === 'alt' ? 'deer_stand' : cycle('deer_stand', 'deer_run1', now, m.phase, 260);
      drawMob(this.host, this.ground, m, frame, now);
    }
  }

  private nextDeerState(m: Mob, now: number): void {
    const r = this.rng.next();
    if (r < 0.5) {
      m.state = 'idle';
      m.vx = m.vy = 0;
      m.until = now + this.rng.range(2200, 5200);
    } else if (r < 0.8) {
      m.state = 'alt';
      m.vx = m.vy = 0;
      m.until = now + this.rng.range(1200, 2600);
    } else {
      m.state = 'move';
      wander(m, this.rng, 0.35);
      m.until = now + this.rng.range(1000, 2000);
    }
  }

  // ── Rabbits ─────────────────────────────────────────────────────────────

  private stepRabbits(dtMs: number, now: number): void {
    const list = this.mobs.rabbit;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!this.keep('rabbit', i, m)) continue;
      if (m.state !== 'flee') {
        const threat = this.units.near(m.x, m.y, 2);
        if (threat) {
          m.state = 'flee';
          fleeFrom(m, threat, this.rng, 2.2);
          m.leaving = now + 1100;
        } else if (now >= m.until) {
          if (m.state === 'move' || this.rng.next() < 0.45) {
            m.state = 'idle';
            m.vx = m.vy = 0;
            m.until = now + this.rng.range(1200, 4000);
          } else {
            m.state = 'move';
            wander(m, this.rng, 0.8);
            m.until = now + this.rng.range(400, 800);
          }
        }
      }
      stepMob(m, dtMs, (x, y) => m.state !== 'flee' && !isOpenVisible(this.host, x, y));
      const hopping = m.state === 'move' || m.state === 'flee';
      drawMob(this.host, this.ground, m, hopping ? cycle('rabbit_hop0', 'rabbit_hop1', now, m.phase, 120) : 'rabbit_sit', now);
    }
  }

  // ── Ducks ───────────────────────────────────────────────────────────────

  private stepDucks(dtMs: number, now: number): void {
    const list = this.mobs.duck;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!this.keep('duck', i, m)) continue;
      if (now >= m.until) {
        m.until = now + this.rng.range(2500, 6000);
        if (this.rng.next() < 0.6) wander(m, this.rng, this.rng.range(0.12, 0.22));
        else m.vx = m.vy = 0;
      }
      // Paddle away from a unit wading close.
      const threat = this.units.near(m.x, m.y, 1);
      if (threat) fleeFrom(m, threat, this.rng, 0.6);
      stepMob(m, dtMs, (x, y) => !WATER.has(tileAt(this.host, x, y)));
      drawMob(this.host, this.ground, m, cycle('duck0', 'duck1', now, m.phase, 640), now);
    }
  }

  // ── Frogs and dragonflies ───────────────────────────────────────────────

  private stepFrogs(dtMs: number, now: number): void {
    const list = this.mobs.frog;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!this.keep('frog', i, m)) continue;
      const threat = m.state !== 'flee' ? this.units.near(m.x, m.y, 1) : null;
      if (threat) {
        m.state = 'flee';
        fleeFrom(m, threat, this.rng, 1.6);
        m.leaving = now + 500;
      } else if (m.state !== 'flee' && now >= m.until) {
        if (m.state === 'move') {
          m.state = 'idle';
          m.vx = m.vy = 0;
          m.until = now + this.rng.range(2000, 6000);
        } else {
          m.state = 'move';
          wander(m, this.rng, 1.4);
          m.until = now + 220;
        }
      }
      stepMob(m, dtMs, (x, y) => tileAt(this.host, x, y) < 0);
      drawMob(this.host, this.ground, m, m.state === 'idle' || m.state === 'alt' ? 'frog0' : 'frog1', now);
    }
  }

  private stepDragonflies(dtMs: number, now: number): void {
    const list = this.mobs.dragonfly;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.leaving === Infinity && now - m.born > 16000) m.leaving = now;
      if (!this.keep('dragonfly', i, m)) continue;
      if (now >= m.until) {
        // Dart, hover, dart.
        if (m.state === 'move') {
          m.state = 'idle';
          m.vx = m.vy = 0;
          m.until = now + this.rng.range(500, 1400);
        } else {
          m.state = 'move';
          const dx = m.homeX - m.x;
          const dy = m.homeY - m.y;
          wander(m, this.rng, this.rng.range(1.6, 2.4));
          if (Math.hypot(dx, dy) > 1.5) {
            m.vx = dx * 1.4;
            m.vy = dy * 1.4;
          }
          m.until = now + this.rng.range(180, 380);
        }
      }
      stepMob(m, dtMs, (x, y) => tileAt(this.host, x, y) < 0);
      drawMob(this.host, this.air, m, cycle('fly_drag0', 'fly_drag1', now, m.phase, 45), now);
    }
  }

  // ── Fish rings ──────────────────────────────────────────────────────────

  private stepRings(now: number): void {
    if (now >= this.nextRing && this.rings.length < MAX_RINGS) {
      this.nextRing = now + this.rng.range(1500, 3500);
      const t = randomViewTile(this.host, this.rng);
      if (t && WATER.has(tileAt(this.host, t.x, t.y)) && !this.nearLand(t.x, t.y, 1) && this.host.ctx.isTileVisible(t.x, t.y)) {
        const img = this.flat.take('ring0');
        if (img) {
          img.setOrigin(0.5, 0.5);
          const p = groundPoint(this.host, t.x + this.rng.range(-0.3, 0.3), t.y + this.rng.range(-0.3, 0.3));
          this.rings.push({ img, x: p.x, y: p.y, born: now });
        }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const age = now - r.born;
      if (age >= 1500) {
        r.img.setOrigin(0.5, 1);
        this.flat.give(r.img);
        this.rings.splice(i, 1);
        continue;
      }
      const frame: LifeFrame = age < 350 ? 'ring0' : age < 800 ? 'ring1' : 'ring2';
      if (r.img.frame.name !== frame) r.img.setFrame(frame);
      r.img.setPosition(r.x, r.y);
      r.img.setAlpha(0.75 * clamp01((1500 - age) / 700));
    }
  }

  /** Land within `r` tiles (ducks keep near the bank, fish rise in open water). */
  private nearLand(x: number, y: number, r = 2): boolean {
    const tiles = this.host.ctx.world.map.tiles;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) continue;
        if (!WATER.has(tiles[ty * MAP.WIDTH + tx])) return true;
      }
    }
    return false;
  }
}
