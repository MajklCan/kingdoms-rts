/**
 * Selection rings, health bars, villager carry dots and build markers, plus
 * the red hover ring under an attackable enemy. Immediate mode: cleared and
 * redrawn every frame.
 *
 * Rings are split so they read as lying on the ground: the back half is drawn
 * on the ground layer (hidden behind the entity's art), the front half on the
 * overlay layer above every entity. Bars and dots always go on the overlay.
 */

import { hasComponent } from 'bitecs';
import {
  AttackTarget,
  Building,
  Combat,
  ConstructionSite,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  Position,
  ResourceCarry,
  ResourceKindId,
  UnitKind,
} from '@sim/components';
import { BUILDING_TABLE } from '@sim/defs';
import { findEntityNear, isEnemyOf, selectedQuery } from '@sim/world';
import { ISO } from '../../config';
import type { ScreenPos } from '../iso';
import type { SceneContext } from '../scene-context';
import { addLayerGraphics } from '../world-layers';
import { UNIT_SELECTION_ELLIPSE, type PickedTile, type SelectionEllipse } from '../world-projection';

const SELECTION_COLOR = 0xfeca57;
const ATTACK_HOVER_COLOR = 0xff4757;
/** Footprint ring padding, in tiles. */
const RING_PAD = 0.12;
const ELLIPSE_SEGMENTS = 20;

const RESOURCE_COLOR: Record<number, number> = {
  [ResourceKindId.FOOD]: 0xc0392b,
  [ResourceKindId.WOOD]: 0x2e7d32,
  [ResourceKindId.GOLD]: 0xe8b923,
  [ResourceKindId.STONE]: 0x9aa0a6,
};

export class StatusOverlay {
  /** Back halves of rings, under the entities. */
  private readonly ringsBack: Phaser.GameObjects.Graphics;
  /** Front halves of rings, above the entities. */
  private readonly ringsFront: Phaser.GameObjects.Graphics;
  /** Health bars, carry dots, build markers. Drawn above the rings. */
  private readonly status: Phaser.GameObjects.Graphics;

  constructor(private readonly ctx: SceneContext) {
    this.ringsBack = addLayerGraphics(ctx.scene, ctx.layers.ground);
    this.ringsFront = addLayerGraphics(ctx.scene, ctx.layers.overlay);
    this.status = addLayerGraphics(ctx.scene, ctx.layers.overlay);
  }

  begin(): void {
    this.status.clear();
    this.ringsBack.clear();
    this.ringsFront.clear();
  }

  clear(): void {
    this.begin();
  }

  /**
   * Selection ring + health bar for a visible building. `c` is the footprint
   * centre, `topY` the screen y of the top of its art.
   */
  drawBuilding(eid: number, c: ScreenPos, topY: number): void {
    const def = BUILDING_TABLE[Building.defId[eid]];
    const w = def?.footprint.w ?? 1;
    const h = def?.footprint.h ?? 1;
    if (this.ctx.isSelected(eid)) this.footprintRing(c, w, h, SELECTION_COLOR, 1);
    if (!hasComponent(this.ctx.world.ecs, ConstructionSite, eid)) {
      this.drawHealthBar(eid, c.x, topY - 7, 24 + 12 * Math.max(w, h));
    }
  }

  /** Selection ring, carry dot, build marker and health bar for a unit. */
  drawUnit(eid: number, screen: ScreenPos, topY = screen.y - 30): void {
    const ecs = this.ctx.world.ecs;
    if (this.ctx.isSelected(eid)) {
      this.ellipseRing(screen, UNIT_SELECTION_ELLIPSE, SELECTION_COLOR, 1);
    }
    const hasCarry = hasComponent(ecs, ResourceCarry, eid);
    const carryAmt = hasCarry ? ResourceCarry.amount[eid] : 0;
    const carryKind = hasCarry ? ResourceCarry.kind[eid] : 0;
    if (carryAmt > 0) {
      this.status.fillStyle(RESOURCE_COLOR[carryKind] ?? 0xffffff, 1);
      this.status.fillCircle(screen.x + 8, topY + 6, 3.5);
      this.status.lineStyle(1, 0x000000, 0.7);
      this.status.strokeCircle(screen.x + 8, topY + 6, 3.5);
    }
    if (hasComponent(ecs, Gatherer, eid)) {
      const state = Gatherer.state[eid];
      if (state === GathererStateId.BUILDING || state === GathererStateId.WALKING_TO_BUILD) {
        this.status.fillStyle(SELECTION_COLOR, 1);
        this.status.fillRect(screen.x - 10, topY + 2, 3, 3);
      }
    }
    this.drawHealthBar(eid, screen.x, topY - 4, 22);
  }

  /** Red ring under the enemy the cursor hovers, when the selection can attack it. */
  drawAttackHover(tile: PickedTile): void {
    if (!this.hasSelectedAttacker()) return;
    const world = this.ctx.world;
    const hovered = findEntityNear(world, tile.tileX, tile.tileY, 0.7);
    if (hovered === null || !this.isAttackableEnemy(hovered)) return;
    if (hasComponent(world.ecs, Building, hovered)) {
      const def = BUILDING_TABLE[Building.defId[hovered]];
      this.footprintRing(
        this.ctx.buildingScreenPosition(hovered),
        def?.footprint.w ?? 1,
        def?.footprint.h ?? 1,
        ATTACK_HOVER_COLOR,
        0.9
      );
      return;
    }
    const target = this.ctx.tileToScreen(Position.x[hovered], Position.y[hovered]);
    this.ellipseRing(target, { yOffset: 2, width: 26, height: 10 }, ATTACK_HOVER_COLOR, 0.9);
  }

  /** Iso diamond around a footprint: back edges under the art, front edges above. */
  private footprintRing(c: ScreenPos, w: number, h: number, color: number, alpha: number): void {
    const hw = ISO.TILE_W / 2;
    const hh = ISO.TILE_H / 2;
    const ax = w / 2 + RING_PAD;
    const ay = h / 2 + RING_PAD;
    const at = (tx: number, ty: number): ScreenPos => ({ x: c.x + (tx - ty) * hw, y: c.y + (tx + ty) * hh });
    const top = at(-ax, -ay);
    const right = at(ax, -ay);
    const bottom = at(ax, ay);
    const left = at(-ax, ay);
    this.ringsBack.lineStyle(2, color, alpha);
    polyline(this.ringsBack, [left, top, right]);
    this.ringsFront.lineStyle(2, color, alpha);
    polyline(this.ringsFront, [left, bottom, right]);
  }

  private ellipseRing(c: ScreenPos, e: SelectionEllipse, color: number, alpha: number): void {
    const cx = c.x;
    const cy = c.y + e.yOffset;
    const rx = e.width / 2;
    const ry = e.height / 2;
    const half = (from: number): ScreenPos[] => {
      const points: ScreenPos[] = [];
      for (let i = 0; i <= ELLIPSE_SEGMENTS / 2; i++) {
        const a = from + (i / (ELLIPSE_SEGMENTS / 2)) * Math.PI;
        points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      return points;
    };
    this.ringsBack.lineStyle(2, color, alpha);
    polyline(this.ringsBack, half(Math.PI));
    this.ringsFront.lineStyle(2, color, alpha);
    polyline(this.ringsFront, half(0));
  }

  private drawHealthBar(eid: number, cx: number, topY: number, width: number): void {
    if (!hasComponent(this.ctx.world.ecs, Health, eid)) return;
    const hp = Health.hp[eid];
    const max = Health.hpMax[eid];
    if (hp >= max || max <= 0) return;
    const frac = Math.max(0, hp / max);
    const h = 3;
    const x = Math.round(cx - width / 2);
    const y = Math.round(topY);
    this.status.fillStyle(0x000000, 0.75);
    this.status.fillRect(x - 1, y - 1, width + 2, h + 2);
    const fillColor = frac > 0.6 ? 0x4caf50 : frac > 0.3 ? 0xffc107 : 0xff4757;
    this.status.fillStyle(fillColor, 1);
    this.status.fillRect(x, y, width * frac, h);
  }

  private hasSelectedAttacker(): boolean {
    for (const eid of selectedQuery(this.ctx.world.ecs)) {
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      if (this.canAttack(eid)) return true;
    }
    return false;
  }

  private canAttack(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    return hasComponent(ecs, Combat, eid) &&
      hasComponent(ecs, AttackTarget, eid) &&
      hasComponent(ecs, Health, eid) &&
      Health.hp[eid] > 0 &&
      Combat.atk[eid] > 0;
  }

  private isAttackableEnemy(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    return isEnemyOf(this.ctx.world, eid, this.ctx.perspectivePlayerId) &&
      this.ctx.isEntityVisible(eid) &&
      hasComponent(ecs, Health, eid) &&
      Health.hp[eid] > 0 &&
      (hasComponent(ecs, UnitKind, eid) || hasComponent(ecs, Building, eid));
  }
}

function polyline(g: Phaser.GameObjects.Graphics, points: readonly ScreenPos[]): void {
  if (points.length < 2) return;
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.strokePath();
}
