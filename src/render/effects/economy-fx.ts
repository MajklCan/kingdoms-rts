/**
 * The economy you can see working:
 *
 *   chopping   wood chips fly and a leaf drifts down on every hit (the tree
 *              itself shakes in ResourceRenderer, then topples in RemainsFx)
 *   mining     stone chips and dust; gold chips with a glint of sparks
 *   foraging   a few berry and leaf bits
 *   drop-off   a small icon + amount floats up when one of your villagers
 *              unloads at a drop site
 *
 * Hits come from ResourceRenderer (a visible pile's amount went down this
 * frame); drop-offs from your villagers' carry going from full to empty while
 * returning. Both are rate limited so a crowd of workers stays readable.
 */

import { hasComponent } from 'bitecs';
import { Gatherer, GathererStateId, Owner, ResourceCarry, ResourceKindId } from '@sim/components';
import { unitQuery } from '@sim/world';
import type { ResourceHit } from '../entities/resource-renderer';
import type { UnitRenderer } from '../entities/unit-renderer';
import { clamp01, easeOut, type FxHost } from './fx-host';
import { rand } from './fx-particles';
import { chips, dustPuff, FX_COLORS, sparks } from './fx-recipes';
import { FX_SHEET, type FxFrame } from './fx-textures';

/** Minimum ms between chip bursts on one pile. */
const HIT_GAP = 170;
const POP_MS = 1100;
const POP_RISE = 18;
const MAX_POPS = 10;
/** Minimum ms between two pops (a crowd unloading at once stays tidy). */
const POP_GAP = 90;

const ICONS: Readonly<Record<number, FxFrame>> = {
  [ResourceKindId.FOOD]: 'icon-food',
  [ResourceKindId.WOOD]: 'icon-wood',
  [ResourceKindId.GOLD]: 'icon-gold',
  [ResourceKindId.STONE]: 'icon-stone',
};

interface Pop {
  icon: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
  born: number;
  kind: number;
  amount: number;
  x: number;
  y: number;
  active: boolean;
}

interface CarryState {
  amount: number;
  kind: number;
  state: number;
}

export class EconomyFx {
  private readonly lastHit = new Map<number, number>();
  private readonly carry = new Map<number, CarryState>();
  private readonly seen = new Set<number>();
  private readonly pops: Pop[] = [];
  private lastPop = -Infinity;
  private container: Phaser.GameObjects.Container;

  constructor(
    private readonly host: FxHost,
    private readonly units: UnitRenderer
  ) {
    this.container = host.ctx.scene.add.container(0, 0);
    host.ctx.layers.effects.add(this.container);
  }

  onResourceHit(hit: ResourceHit): void {
    const now = this.host.time;
    const last = this.lastHit.get(hit.eid);
    if (last !== undefined && now - last < HIT_GAP) return;
    this.lastHit.set(hit.eid, now);
    const fx = this.host.fx;
    const { x, y } = hit.screen;
    const h = Math.max(6, y - hit.top);
    switch (hit.kind) {
      case ResourceKindId.WOOD: {
        const side = Math.random() < 0.5 ? -1 : 1;
        chips(fx, x + side * 3, y - 9, FX_COLORS.wood, 3, FX_COLORS.bark);
        if (Math.random() < 0.4) this.leaf(x + rand(-12, 12), hit.top + h * rand(0.15, 0.4));
        break;
      }
      case ResourceKindId.STONE: {
        const px = x + rand(-6, 6);
        const py = y - h * rand(0.25, 0.45);
        chips(fx, px, py, FX_COLORS.stone, 3, FX_COLORS.debrisStone);
        if (Math.random() < 0.5) dustPuff(fx, px, py + 4, 0.4, 0xb9b4aa, 1);
        break;
      }
      case ResourceKindId.GOLD: {
        const px = x + rand(-6, 6);
        const py = y - h * rand(0.25, 0.45);
        chips(fx, px, py, FX_COLORS.gold, 2, 0xb08a2a);
        sparks(fx, px, py, 2, FX_COLORS.goldGlint, 70);
        break;
      }
      case ResourceKindId.FOOD:
        chips(fx, x + rand(-5, 5), y - h * 0.4, 0xb8322a, 2, FX_COLORS.leaf);
        break;
    }
  }

  update(): void {
    this.trackDropOffs();
    this.stepPops();
    if (this.lastHit.size > 256) {
      const old = this.host.time - 1000;
      for (const [eid, at] of this.lastHit) if (at < old) this.lastHit.delete(eid);
    }
  }

  clear(): void {
    this.lastHit.clear();
    this.carry.clear();
    for (const p of this.pops) this.hide(p);
    this.lastPop = -Infinity;
  }

  private leaf(x: number, y: number): void {
    this.host.fx.emit('normal', {
      frame: 'leaf',
      x,
      y,
      vx: rand(-8, 8),
      vy: rand(8, 16),
      drag: 0.4,
      life: rand(1300, 1900),
      scale: rand(0.8, 1.1),
      alpha: 0.95,
      fadeOut: 0.35,
      tint: Math.random() < 0.75 ? FX_COLORS.leaf : 0xb3a24a,
      rotation: rand(0, Math.PI),
      spin: rand(-3, 3),
    });
  }

  /** Own villagers that just unloaded (carry full -> empty while returning). */
  private trackDropOffs(): void {
    const ctx = this.host.ctx;
    const ecs = ctx.world.ecs;
    const me = ctx.perspectivePlayerId;
    this.seen.clear();
    for (const eid of unitQuery(ecs)) {
      if (Owner.player[eid] !== me) continue;
      if (!hasComponent(ecs, ResourceCarry, eid) || !hasComponent(ecs, Gatherer, eid)) continue;
      this.seen.add(eid);
      const amount = ResourceCarry.amount[eid];
      const kind = ResourceCarry.kind[eid];
      const state = Gatherer.state[eid];
      let c = this.carry.get(eid);
      if (!c) {
        c = { amount, kind, state };
        this.carry.set(eid, c);
        continue;
      }
      const unloaded = c.amount > 0 && amount === 0 &&
        (c.state === GathererStateId.RETURNING || c.state === GathererStateId.DEPOSITING);
      if (unloaded) this.pop(eid, c.kind, c.amount);
      c.amount = amount;
      c.kind = kind;
      c.state = state;
    }
    if (this.carry.size > this.seen.size) {
      for (const eid of this.carry.keys()) if (!this.seen.has(eid)) this.carry.delete(eid);
    }
  }

  private pop(eid: number, kind: number, amount: number): void {
    const now = this.host.time;
    const at = this.units.anchorOf(eid);
    if (!at || !this.host.fx.onScreen(at.x, at.y, 0)) return;
    const icon = ICONS[kind];
    if (!icon) return;
    // Two workers unloading at the same drop site: one pop with the sum.
    for (const q of this.pops) {
      if (!q.active || q.kind !== kind || now - q.born > 450) continue;
      if (Math.abs(q.x - at.x) > 40 || Math.abs(q.y - (at.y - 38)) > 30) continue;
      q.amount += amount;
      q.text.setText(`+${Math.round(q.amount)}`);
      return;
    }
    if (now - this.lastPop < POP_GAP) return;
    const p = this.freePop();
    if (!p) return;
    this.lastPop = now;
    p.active = true;
    p.born = now;
    p.kind = kind;
    p.amount = amount;
    p.x = at.x;
    p.y = at.y - 38;
    p.icon.setFrame(icon);
    p.text.setText(`+${Math.round(amount)}`);
    p.icon.setVisible(true);
    p.text.setVisible(true);
    this.placePop(p, 0);
  }

  private stepPops(): void {
    const now = this.host.time;
    for (const p of this.pops) {
      if (!p.active) continue;
      const t = (now - p.born) / POP_MS;
      if (t >= 1) {
        this.hide(p);
        continue;
      }
      this.placePop(p, t);
    }
  }

  private placePop(p: Pop, t: number): void {
    const rise = POP_RISE * easeOut(clamp01(t / 0.7));
    const alpha = t < 0.12 ? t / 0.12 : t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    const w = p.icon.width * p.icon.scaleX + 2 + p.text.width;
    const left = p.x - w / 2;
    const y = Math.round(p.y - rise);
    p.icon.setPosition(Math.round(left + (p.icon.width * p.icon.scaleX) / 2), y);
    p.text.setPosition(Math.round(left + p.icon.width * p.icon.scaleX + 2), y);
    p.icon.setAlpha(alpha);
    p.text.setAlpha(alpha);
  }

  private freePop(): Pop | null {
    for (const p of this.pops) if (!p.active) return p;
    if (this.pops.length >= MAX_POPS) return null;
    const scene = this.host.ctx.scene;
    const icon = scene.add.image(0, 0, FX_SHEET, 'icon-wood').setScale(0.9);
    const text = scene.add.text(0, 0, '', {
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#fff4d6',
      stroke: '#2a1d10',
      strokeThickness: 3,
      resolution: 2,
    });
    text.setOrigin(0, 0.5);
    this.container.add(icon);
    this.container.add(text);
    const p: Pop = { icon, text, born: 0, kind: 0, amount: 0, x: 0, y: 0, active: false };
    this.pops.push(p);
    return p;
  }

  private hide(p: Pop): void {
    p.active = false;
    p.icon.setVisible(false);
    p.text.setVisible(false);
  }
}
