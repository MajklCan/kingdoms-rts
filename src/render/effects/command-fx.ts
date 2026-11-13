/**
 * Entity-level order feedback: when your selected units are told to attack
 * a specific enemy, that enemy flashes with two red rings pulsing out from
 * under it. Read from the sim, not from input: a selected unit's attack
 * target switching to a new, explicitly ordered one (`retainGoal` = 1).
 */

import { hasComponent } from 'bitecs';
import { ISO } from '../../config';
import { AttackTarget, Building, Owner } from '@sim/components';
import { BUILDING_TABLE } from '@sim/defs';
import { selectedQuery } from '@sim/world';
import type { UnitRenderer } from '../entities/unit-renderer';
import { addLayerGraphics } from '../world-layers';
import { clamp01, easeOut, type FxHost } from './fx-host';

const FLASH_MS = 620;
const FLASH_COLOR = 0xff4757;
const MAX_FLASHES = 8;

export class CommandFx {
  private readonly gfx: Phaser.GameObjects.Graphics;
  /** eid -> last seen (target, retain) of selected own units, packed. */
  private readonly orders = new Map<number, number>();
  private readonly flashEid = new Int32Array(MAX_FLASHES).fill(-1);
  private readonly flashAt = new Float64Array(MAX_FLASHES);

  constructor(
    private readonly host: FxHost,
    private readonly units: UnitRenderer
  ) {
    this.gfx = addLayerGraphics(host.ctx.scene, host.ctx.layers.overlay);
  }

  update(): void {
    const ctx = this.host.ctx;
    const ecs = ctx.world.ecs;
    const now = this.host.time;
    for (const eid of selectedQuery(ecs)) {
      if (Owner.player[eid] !== ctx.perspectivePlayerId || !hasComponent(ecs, AttackTarget, eid)) continue;
      const target = AttackTarget.targetEid[eid];
      const retain = AttackTarget.retainGoal[eid];
      const packed = target * 2 + retain;
      const prev = this.orders.get(eid);
      if (prev === packed) continue;
      this.orders.set(eid, packed);
      if (prev !== undefined && retain === 1 && target >= 0) this.flash(target, now);
    }
    if (this.orders.size > 400) this.orders.clear();
    this.draw(now);
  }

  clear(): void {
    this.orders.clear();
    this.flashEid.fill(-1);
    this.gfx.clear();
  }

  private flash(target: number, now: number): void {
    let slot = 0;
    for (let i = 0; i < MAX_FLASHES; i++) {
      if (this.flashEid[i] === target) {
        if (now - this.flashAt[i] < 250) return;
        slot = i;
        break;
      }
      if (this.flashAt[i] < this.flashAt[slot]) slot = i;
    }
    this.flashEid[slot] = target;
    this.flashAt[slot] = now;
  }

  private draw(now: number): void {
    const g = this.gfx;
    g.clear();
    const ctx = this.host.ctx;
    const ecs = ctx.world.ecs;
    for (let i = 0; i < MAX_FLASHES; i++) {
      const eid = this.flashEid[i];
      if (eid < 0) continue;
      const age = now - this.flashAt[i];
      if (age >= FLASH_MS || !ctx.isEntityVisible(eid)) {
        this.flashEid[i] = -1;
        continue;
      }
      const building = hasComponent(ecs, Building, eid);
      const at = building ? ctx.buildingScreenPosition(eid) : this.units.anchorOf(eid);
      if (!at) continue;
      const def = building ? BUILDING_TABLE[Building.defId[eid]] : undefined;
      const span = def ? (def.footprint.w + def.footprint.h) / 2 : 0;
      for (let k = 0; k < 2; k++) {
        const t = clamp01((age - k * 170) / (FLASH_MS - 170));
        if (t <= 0 || t >= 1) continue;
        const grow = easeOut(t);
        const alpha = (1 - t) * 0.95;
        g.lineStyle(k === 0 ? 2.5 : 1.5, FLASH_COLOR, alpha);
        if (def) {
          const s = 0.55 + grow * 0.35;
          const hw = span * (ISO.TILE_W / 2) * s * 1.1;
          const hh = span * (ISO.TILE_H / 2) * s * 1.1;
          g.beginPath();
          g.moveTo(at.x, at.y - hh);
          g.lineTo(at.x + hw, at.y);
          g.lineTo(at.x, at.y + hh);
          g.lineTo(at.x - hw, at.y);
          g.closePath();
          g.strokePath();
        } else {
          g.strokeEllipse(at.x, at.y + 2, 20 + grow * 22, 8 + grow * 9);
        }
      }
    }
  }
}
