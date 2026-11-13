/**
 * Ground-plane status drawing for entities: selection rings, health bars,
 * villager carry dots and build markers, plus the red hover ring under an
 * attackable enemy. Immediate mode: cleared and redrawn every frame.
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
import { findEntityNear, isEnemyOf, selectedQuery } from '@sim/world';
import type { ScreenPos } from '../iso';
import type { SceneContext } from '../scene-context';
import { addLayerGraphics } from '../world-layers';
import {
  UNIT_SELECTION_ELLIPSE,
  buildingSelectionEllipse,
  type PickedTile,
} from '../world-projection';

const SELECTION_COLOR = 0xfeca57;
const ATTACK_HOVER_COLOR = 0xff4757;

const RESOURCE_COLOR: Record<number, number> = {
  [ResourceKindId.FOOD]: 0xc0392b,
  [ResourceKindId.WOOD]: 0x2e7d32,
  [ResourceKindId.GOLD]: 0xe8b923,
  [ResourceKindId.STONE]: 0x9aa0a6,
};

export class StatusOverlay {
  /** Selection + attack-hover rings. */
  private readonly rings: Phaser.GameObjects.Graphics;
  /** Health bars, carry dots, build markers. Drawn above the rings. */
  private readonly status: Phaser.GameObjects.Graphics;

  constructor(private readonly ctx: SceneContext) {
    this.rings = addLayerGraphics(ctx.scene, ctx.layers.ground);
    this.status = addLayerGraphics(ctx.scene, ctx.layers.ground);
  }

  begin(): void {
    this.status.clear();
    this.rings.clear();
  }

  clear(): void {
    this.begin();
  }

  /** Selection ring + health bar for a visible building at screen pos `c`. */
  drawBuilding(eid: number, c: ScreenPos): void {
    if (this.ctx.isSelected(eid)) {
      const ellipse = buildingSelectionEllipse(Building.defId[eid]);
      this.rings.lineStyle(2, SELECTION_COLOR, 1);
      this.rings.strokeEllipse(c.x, c.y + ellipse.yOffset, ellipse.width, ellipse.height);
    }
    if (!hasComponent(this.ctx.world.ecs, ConstructionSite, eid)) {
      this.drawHealthBar(eid, c.x, c.y - 60, 40);
    }
  }

  /** Selection ring, carry dot, build marker and health bar for a unit. */
  drawUnit(eid: number, screen: ScreenPos): void {
    const ecs = this.ctx.world.ecs;
    if (this.ctx.isSelected(eid)) {
      const ring = UNIT_SELECTION_ELLIPSE;
      this.rings.lineStyle(2, SELECTION_COLOR, 1);
      this.rings.strokeEllipse(screen.x, screen.y + ring.yOffset, ring.width, ring.height);
    }
    const hasCarry = hasComponent(ecs, ResourceCarry, eid);
    const carryAmt = hasCarry ? ResourceCarry.amount[eid] : 0;
    const carryKind = hasCarry ? ResourceCarry.kind[eid] : 0;
    if (carryAmt > 0) {
      this.status.fillStyle(RESOURCE_COLOR[carryKind] ?? 0xffffff, 1);
      this.status.fillCircle(screen.x + 8, screen.y - 26, 3.5);
      this.status.lineStyle(1, 0x000000, 0.7);
      this.status.strokeCircle(screen.x + 8, screen.y - 26, 3.5);
    }
    if (hasComponent(ecs, Gatherer, eid)) {
      const state = Gatherer.state[eid];
      if (state === GathererStateId.BUILDING || state === GathererStateId.WALKING_TO_BUILD) {
        this.status.fillStyle(SELECTION_COLOR, 1);
        this.status.fillRect(screen.x - 10, screen.y - 30, 3, 3);
      }
    }
    this.drawHealthBar(eid, screen.x, screen.y - 34, 22);
  }

  /** Red ring under the enemy the cursor hovers, when the selection can attack it. */
  drawAttackHover(tile: PickedTile): void {
    if (!this.hasSelectedAttacker()) return;
    const world = this.ctx.world;
    const hovered = findEntityNear(world, tile.tileX, tile.tileY, 0.7);
    if (hovered === null || !this.isAttackableEnemy(hovered)) return;
    const isBuilding = hasComponent(world.ecs, Building, hovered);
    const target = isBuilding
      ? this.ctx.buildingScreenPosition(hovered)
      : this.ctx.tileToScreen(Position.x[hovered], Position.y[hovered]);
    const ellipse = isBuilding
      ? buildingSelectionEllipse(Building.defId[hovered])
      : { yOffset: 2, width: 26, height: 10 };
    this.rings.lineStyle(2, ATTACK_HOVER_COLOR, 0.9);
    this.rings.strokeEllipse(target.x, target.y + ellipse.yOffset, ellipse.width, ellipse.height);
  }

  private drawHealthBar(eid: number, cx: number, topY: number, width: number): void {
    if (!hasComponent(this.ctx.world.ecs, Health, eid)) return;
    const hp = Health.hp[eid];
    const max = Health.hpMax[eid];
    if (hp >= max || max <= 0) return;
    const frac = Math.max(0, hp / max);
    const h = 3;
    const x = cx - width / 2;
    this.status.fillStyle(0x000000, 0.7);
    this.status.fillRect(x, topY, width, h);
    const fillColor = frac > 0.6 ? 0x4caf50 : frac > 0.3 ? 0xffc107 : 0xff4757;
    this.status.fillStyle(fillColor, 1);
    this.status.fillRect(x, topY, width * frac, h);
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
