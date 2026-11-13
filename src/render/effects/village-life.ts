/**
 * Village life around the buildings, render-only:
 *
 *   chickens   peck about houses, farms, mills and town centres, scatter
 *              when a unit walks through
 *   dog        trots around a town centre, sits a while, trots on
 *   braziers   Castle and Gunpowder Age town centres and barracks get two
 *              flickering braziers at the front corners
 *   smoke      blocky voxel puffs out of the chimneys (VoxelSmoke, fed by
 *              BuildingFx with the per-art chimney mouths)
 */

import { hasComponent } from 'bitecs';
import { Building, ConstructionSite, Position } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId } from '@sim/defs';
import { buildingQuery } from '@sim/world';
import type { BuildingRenderer } from '../entities/building-renderer';
import { BLEND_ADD } from './fx-constants';
import { clamp01, type FxHost } from './fx-host';
import { FX_SHEET } from './fx-textures';
import { containerLifeLayer, entityLifeLayer, isOpenVisible, LifePool, type LifeRng, type UnitPresence } from './life-kit';
import { cycle, drawMob, fleeFrom, leashHome, makeMob, stepMob, wander, type Mob } from './life-mobs';
import { LIFE_SHEET, type LifeFrame } from './life-sprites';
import { reducedMotion } from './motion-prefs';

const MAX_CHICKENS = 7;
const SPAWN_MS = 1600;
const CHICKEN_HOMES: ReadonlySet<number> = new Set([
  BuildingDefId.HOUSE,
  BuildingDefId.FARM,
  BuildingDefId.MILL,
  BuildingDefId.TOWN_CENTER,
]);
const BRAZIER_DEFS: ReadonlySet<number> = new Set([BuildingDefId.TOWN_CENTER, BuildingDefId.BARRACKS]);
const MAX_BRAZIER_BUILDINGS = 4;
const MAX_PUFFS = 56;
const FLAMES: readonly LifeFrame[] = ['flame0', 'flame1', 'flame2'];

interface Brazier {
  stands: Phaser.GameObjects.Image[];
  flames: Phaser.GameObjects.Image[];
  glows: Phaser.GameObjects.Image[];
  phase: number;
}

interface Home {
  eid: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class VillageLife {
  private readonly ground: LifePool;
  private readonly chickens: Mob[] = [];
  private readonly chickenHome = new Map<Mob, number>();
  private dog: Mob | null = null;
  private dogHome = -1;
  private readonly braziers = new Map<number, Brazier>();
  private readonly seen = new Set<number>();
  private readonly homes: Home[] = [];
  private nextSpawn = 0;

  constructor(
    private readonly host: FxHost,
    private readonly buildings: BuildingRenderer,
    private readonly units: UnitPresence,
    private readonly rng: LifeRng
  ) {
    this.ground = new LifePool(host.ctx.scene, entityLifeLayer(host), MAX_CHICKENS + 1);
  }

  reset(): void {
    this.clear();
    this.nextSpawn = this.host.time + 2000;
  }

  update(dtMs: number, still: boolean): void {
    const now = this.host.time;
    this.collectHomes();
    this.drawBraziers(now, still);
    if (still) {
      this.clearAnimals();
      return;
    }
    if (dtMs <= 0) return;
    if (now >= this.nextSpawn) {
      this.nextSpawn = now + SPAWN_MS;
      this.spawnChicken(now);
      this.spawnDog(now);
    }
    this.stepChickens(dtMs, now);
    this.stepDog(dtMs, now);
  }

  clear(): void {
    this.clearAnimals();
    for (const b of this.braziers.values()) destroyBrazier(b);
    this.braziers.clear();
  }

  get count(): number {
    return this.chickens.length + (this.dog ? 1 : 0) + this.braziers.size * 2;
  }

  private clearAnimals(): void {
    for (const c of this.chickens) this.ground.give(c.img);
    this.chickens.length = 0;
    this.chickenHome.clear();
    if (this.dog) this.ground.give(this.dog.img);
    this.dog = null;
    this.dogHome = -1;
  }

  /** Completed, visible, on-screen buildings this frame. */
  private collectHomes(): void {
    this.homes.length = 0;
    const ctx = this.host.ctx;
    const ecs = ctx.world.ecs;
    for (const eid of buildingQuery(ecs)) {
      if (hasComponent(ecs, ConstructionSite, eid)) continue;
      const view = this.buildings.viewOf(eid);
      if (!view || !view.sprite.visible || view.sprite.isTinted) continue;
      if (!this.host.fx.onScreen(view.x, view.y - view.ref.top * 0.5, 80)) continue;
      const def = BUILDING_TABLE[Building.defId[eid]];
      if (!def) continue;
      this.homes.push({ eid, x: Position.x[eid], y: Position.y[eid], w: def.footprint.w, h: def.footprint.h });
    }
  }

  private home(eid: number): Home | undefined {
    return this.homes.find((h) => h.eid === eid);
  }

  // ── Chickens ────────────────────────────────────────────────────────────

  private spawnChicken(now: number): void {
    if (this.chickens.length >= MAX_CHICKENS) return;
    const homes = this.homes.filter((h) => CHICKEN_HOMES.has(Building.defId[h.eid]));
    if (homes.length === 0) return;
    const home = homes[this.rng.int(homes.length)];
    let here = 0;
    for (const e of this.chickenHome.values()) if (e === home.eid) here++;
    if (here >= 3) return;
    // In front of the building (the +x / +y sides face the camera).
    const front = this.rng.next() < 0.5;
    const x = home.x + (front ? home.w / 2 + this.rng.range(0.2, 0.9) : this.rng.range(-home.w / 2, home.w / 2));
    const y = home.y + (front ? this.rng.range(-home.h / 2, home.h / 2) : home.h / 2 + this.rng.range(0.2, 0.9));
    if (!isOpenVisible(this.host, x, y) || this.units.near(x, y, 1)) return;
    const img = this.ground.take('chicken0');
    if (!img) return;
    img.setAlpha(0);
    const m = makeMob(img, x, y, now, this.rng);
    this.chickens.push(m);
    this.chickenHome.set(m, home.eid);
  }

  private stepChickens(dtMs: number, now: number): void {
    for (let i = this.chickens.length - 1; i >= 0; i--) {
      const m = this.chickens[i];
      const homeEid = this.chickenHome.get(m) ?? -1;
      if (!this.home(homeEid) || !this.host.ctx.isTileVisible(Math.round(m.x), Math.round(m.y))) {
        this.ground.give(m.img);
        this.chickens.splice(i, 1);
        this.chickenHome.delete(m);
        continue;
      }
      const threat = m.state !== 'flee' ? this.units.near(m.x, m.y, 1) : null;
      if (threat) {
        m.state = 'flee';
        fleeFrom(m, threat, this.rng, 1.6);
        m.until = now + 600;
      } else if (now >= m.until) {
        if (m.state === 'idle' && this.rng.next() < 0.55) {
          m.state = 'move';
          if (!leashHome(m, 2.2, 0.5)) wander(m, this.rng, 0.5);
          m.until = now + this.rng.range(500, 1300);
        } else {
          m.state = 'idle';
          m.vx = m.vy = 0;
          m.until = now + this.rng.range(1500, 4000);
        }
      }
      stepMob(m, dtMs, (x, y) => !isOpenVisible(this.host, x, y));
      const frame: LifeFrame = m.state === 'idle' ? cycle('chicken0', 'chicken1', now, m.phase, 380) : cycle('chicken0', 'chicken1', now, m.phase, 110);
      drawMob(this.host, this.ground, m, frame, now);
    }
  }

  // ── Dog ─────────────────────────────────────────────────────────────────

  private spawnDog(now: number): void {
    if (this.dog) return;
    const tcs = this.homes.filter((h) => Building.defId[h.eid] === BuildingDefId.TOWN_CENTER);
    if (tcs.length === 0) return;
    const tc = tcs[this.rng.int(tcs.length)];
    const x = tc.x + tc.w / 2 + this.rng.range(0.4, 1.4);
    const y = tc.y + this.rng.range(-1, 1);
    if (!isOpenVisible(this.host, x, y) || this.units.near(x, y, 1)) return;
    const img = this.ground.take('dog0');
    if (!img) return;
    img.setAlpha(0);
    this.dog = makeMob(img, x, y, now, this.rng);
    this.dog.homeX = tc.x;
    this.dog.homeY = tc.y;
    this.dogHome = tc.eid;
  }

  private stepDog(dtMs: number, now: number): void {
    const m = this.dog;
    if (!m) return;
    if (!this.home(this.dogHome) || !this.host.ctx.isTileVisible(Math.round(m.x), Math.round(m.y))) {
      this.ground.give(m.img);
      this.dog = null;
      return;
    }
    if (now >= m.until) {
      if (m.state === 'idle') {
        m.state = 'move';
        if (!leashHome(m, 3.2, 1.3)) wander(m, this.rng, 1.3);
        m.until = now + this.rng.range(900, 1800);
      } else {
        m.state = 'idle';
        m.vx = m.vy = 0;
        m.until = now + this.rng.range(2000, 5000);
      }
    }
    stepMob(m, dtMs, (x, y) => !isOpenVisible(this.host, x, y));
    drawMob(this.host, this.ground, m, m.state === 'move' ? cycle('dog0', 'dog1', now, m.phase, 120) : 'dog0', now);
  }

  // ── Braziers ────────────────────────────────────────────────────────────

  private drawBraziers(now: number, still: boolean): void {
    this.seen.clear();
    const ctx = this.host.ctx;
    for (const home of this.homes) {
      if (this.seen.size >= MAX_BRAZIER_BUILDINGS) break;
      if (!BRAZIER_DEFS.has(Building.defId[home.eid])) continue;
      const view = this.buildings.viewOf(home.eid);
      if (!view) continue;
      const frame = String(view.sprite.frame.name);
      if (!frame.endsWith('_castle') && !frame.endsWith('_gunpowder')) continue;
      this.seen.add(home.eid);
      let b = this.braziers.get(home.eid);
      if (!b) {
        b = this.makeBrazier(home.eid);
        this.braziers.set(home.eid, b);
      }
      // Front corners of the footprint, a little in from the bottom corner.
      const c = ctx.buildingScreenPosition(home.eid);
      const spots = [
        tileOffset(home.w / 2 * 0.45, home.h / 2 + 0.12),
        tileOffset(home.w / 2 + 0.12, home.h / 2 * 0.45),
      ];
      for (let k = 0; k < 2; k++) {
        const x = Math.round(c.x + spots[k].x);
        const y = Math.round(c.y + spots[k].y);
        const stand = b.stands[k];
        const flame = b.flames[k];
        const glow = b.glows[k];
        stand.setPosition(x, y);
        ctx.layers.entities.setDepth(stand, y);
        const f = still ? 0 : Math.floor((now + b.phase + k * 170) / 110) % FLAMES.length;
        flame.setFrame(FLAMES[f]);
        flame.setPosition(x, y - 5);
        ctx.layers.entities.setDepth(flame, y + 0.001);
        const flicker = still ? 0.5 : 0.42 + 0.14 * Math.sin((now + b.phase) / 90 + k) + 0.06 * Math.sin((now + k * 400) / 37);
        glow.setPosition(x, y - 8).setAlpha(flicker);
        for (const img of [stand, flame, glow]) if (!img.visible) img.setVisible(true);
      }
    }
    for (const [eid, b] of this.braziers) {
      if (this.seen.has(eid)) continue;
      destroyBrazier(b);
      this.braziers.delete(eid);
    }
  }

  private makeBrazier(eid: number): Brazier {
    const scene = this.host.ctx.scene;
    const entities = this.host.ctx.layers.entities;
    const b: Brazier = { stands: [], flames: [], glows: [], phase: (eid * 977) % 1000 };
    for (let k = 0; k < 2; k++) {
      const stand = scene.add.image(0, 0, LIFE_SHEET, 'brazier').setOrigin(0.5, 1);
      const flame = scene.add.image(0, 0, LIFE_SHEET, 'flame0').setOrigin(0.5, 1);
      entities.add(stand);
      entities.add(flame);
      const glow = scene.add.image(0, 0, FX_SHEET, 'glow').setScale(0.75).setTint(0xffa040);
      glow.setBlendMode(BLEND_ADD);
      this.host.ctx.layers.effects.add(glow);
      b.stands.push(stand);
      b.flames.push(flame);
      b.glows.push(glow);
    }
    return b;
  }
}

/** Screen offset of a tile-space offset (dx, dy) from a footprint centre. */
function tileOffset(dx: number, dy: number): { x: number; y: number } {
  return { x: (dx - dy) * 32, y: (dx + dy) * 16 };
}

function destroyBrazier(b: Brazier): void {
  for (const img of [...b.stands, ...b.flames, ...b.glows]) img.destroy();
}

// ── Voxel chimney smoke ─────────────────────────────────────────────────────

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  alpha: number;
}

/** Blocky smoke puffs that grow through three voxel frames as they rise. */
export class VoxelSmoke {
  private readonly pool: LifePool;
  private readonly puffs: Puff[] = [];

  constructor(
    private readonly host: FxHost,
    private readonly rng: LifeRng,
    layer: Phaser.GameObjects.Container
  ) {
    this.pool = new LifePool(host.ctx.scene, containerLifeLayer(layer), MAX_PUFFS);
  }

  /** One puff at a chimney mouth (layer px). */
  puff(x: number, y: number, alpha: number, dark = false): void {
    if (reducedMotion() || !this.host.fx.onScreen(x, y, 60)) return;
    const img = this.pool.take('puff0');
    if (!img) return;
    img.setTint(dark ? 0x7d7f86 : 0xffffff);
    this.puffs.push({
      img,
      x: x + this.rng.range(-1, 1),
      y,
      vx: this.rng.range(4, 8) * (dark ? 1.2 : 1),
      vy: -this.rng.range(9, 13),
      born: this.host.time,
      life: this.rng.range(2300, 3100) * (dark ? 1.25 : 1),
      alpha: Math.min(0.85, alpha * 1.9),
    });
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return;
    const now = this.host.time;
    const dt = dtMs / 1000;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      const age = now - p.born;
      if (age >= p.life) {
        this.pool.give(p.img);
        this.puffs.splice(i, 1);
        continue;
      }
      const t = age / p.life;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - 0.25 * dt;
      const frame: LifeFrame = t < 0.25 ? 'puff0' : t < 0.6 ? 'puff1' : 'puff2';
      if (p.img.frame.name !== frame) p.img.setFrame(frame);
      p.img.setPosition(Math.round(p.x), Math.round(p.y));
      p.img.setAlpha(p.alpha * clamp01(age / 250) * clamp01((p.life - age) / (p.life * 0.45)));
    }
  }

  clear(): void {
    for (const p of this.puffs) this.pool.give(p.img);
    this.puffs.length = 0;
  }

  get count(): number {
    return this.puffs.length;
  }
}
