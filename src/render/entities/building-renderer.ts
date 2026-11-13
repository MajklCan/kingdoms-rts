/**
 * Building sprites (live + fog-of-war memory) and their ground-plane status
 * bars: construction progress, production progress and worksite worker dots.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  ConstructionSite,
  Health,
  Owner,
  Position,
  Producer,
  ResourceWorksite,
} from '@sim/components';
import { AgeId, BUILDING_TABLE, BuildingDefId, getUnitDef } from '@sim/defs';
import {
  buildingQuery,
  getPlayerVisibility,
  getWorksiteWorkerSlots,
  isBuildingFootprintVisibleTo,
} from '@sim/world';
import type { ScreenPos } from '../iso';
import type { StatusOverlay } from '../overlays/status-overlay';
import type { SceneContext } from '../scene-context';
import type { SpriteSource } from '../sprites/sprite-source';
import { addLayerGraphics } from '../world-layers';
import { buildingAnchorTileForDef } from '../world-projection';
import { SpriteSync } from './sprite-sync';

/** Grey-blue wash on buildings remembered from fog of war. */
const REMEMBERED_TINT = 0x8d93a0;

export class BuildingRenderer {
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly live: SpriteSync<number>;
  private readonly remembered: SpriteSync<number>;

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource
  ) {
    this.bars = addLayerGraphics(ctx.scene, ctx.layers.ground);
    this.live = new SpriteSync(ctx.scene, ctx.layers.entities);
    this.remembered = new SpriteSync(ctx.scene, ctx.layers.entities);
  }

  /** Visible buildings: sprites + construction / production / worker bars. */
  draw(): void {
    const world = this.ctx.world;
    const g = this.bars;
    g.clear();
    this.live.begin();
    for (const eid of buildingQuery(world.ecs)) {
      const defId = Building.defId[eid];
      if (!BUILDING_TABLE[defId]) continue;
      if (!this.ctx.isEntityVisible(eid)) continue;
      const c = this.ctx.buildingScreenPosition(eid);
      const playerId = Owner.player[eid];
      const ref = this.sprites.building({
        defId,
        age: world.ages[playerId]?.current ?? AgeId.DARK,
        playerId,
        variant: defId === BuildingDefId.WALL ? this.wallVariant(eid) : undefined,
      });
      if (!ref) continue;

      const isFoundation = hasComponent(world.ecs, ConstructionSite, eid);
      const view = this.live.show(eid, ref, c.x, c.y);
      view.clearTint();
      view.setAlpha(isFoundation ? 0.5 : 1.0);
      view.setDepth(c.y);

      if (isFoundation) {
        const total = ConstructionSite.totalTicks[eid] || 1;
        const frac = Math.min(1, ConstructionSite.progress[eid] / total);
        const barW = 40, barH = 5;
        const barX = c.x - barW / 2, barY = c.y - 50;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(barX, barY, barW, barH);
        g.fillStyle(0xfeca57, 0.95);
        g.fillRect(barX, barY, barW * frac, barH);
        g.lineStyle(1, 0xffffff, 0.6);
        g.strokeRect(barX, barY, barW, barH);
      }

      if (hasComponent(world.ecs, Producer, eid) && !isFoundation) {
        const queue = world.productionQueues.get(eid);
        const trainDef = queue && queue.length > 0 ? getUnitDef(queue[0]) : undefined;
        if (trainDef) {
          const frac = Producer.currentProgress[eid] / trainDef.trainTimeTicks;
          const barW = 30, barH = 4;
          const barX = c.x - barW / 2, barY = c.y - 44;
          g.fillStyle(0x000000, 0.6);
          g.fillRect(barX, barY, barW, barH);
          g.fillStyle(0x4ecdc4, 0.95);
          g.fillRect(barX, barY, barW * frac, barH);
        }
      }

      if (hasComponent(world.ecs, ResourceWorksite, eid) && !isFoundation) {
        const workers = ResourceWorksite.assignedWorkers[eid];
        const slots = getWorksiteWorkerSlots(world, eid);
        const dotY = c.y - 42;
        for (let i = 0; i < slots; i++) {
          const x = c.x - (slots - 1) * 4 + i * 8;
          g.fillStyle(i < workers ? 0x4ecdc4 : 0x2c3e50, i < workers ? 1 : 0.65);
          g.fillCircle(x, dotY, 2.5);
          g.lineStyle(1, 0x000000, 0.65);
          g.strokeCircle(x, dotY, 2.5);
        }
      }
    }
    this.live.end();
  }

  /** Selection rings + health bars for every visible building. */
  drawStatus(overlay: StatusOverlay): void {
    for (const eid of buildingQuery(this.ctx.world.ecs)) {
      if (!this.ctx.isEntityVisible(eid)) continue;
      overlay.drawBuilding(eid, this.ctx.buildingScreenPosition(eid));
    }
  }

  /** Greyed snapshots of enemy buildings last seen in now-fogged tiles. */
  drawRemembered(): void {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    this.remembered.begin();
    const vis = getPlayerVisibility(world, playerId);
    for (const snap of vis?.lastSeenBuildings.values() ?? []) {
      if (!this.ctx.isTileExplored(snap.x, snap.y)) continue;
      if (isBuildingFootprintVisibleTo(world, playerId, snap.defId, snap.x, snap.y)) continue;
      const ref = this.sprites.building({ defId: snap.defId, age: snap.age, playerId: snap.owner });
      if (!ref) continue;
      const def = BUILDING_TABLE[snap.defId];
      const anchor = def ? buildingAnchorTileForDef(def, snap.x, snap.y) : { x: snap.x, y: snap.y };
      const screen = this.ctx.tileToScreen(anchor.x, anchor.y);
      const view = this.remembered.show(snap.eid, ref, screen.x, screen.y);
      view.setDepth(screen.y - 1);
      view.setAlpha(snap.isFoundation ? 0.28 : 0.5);
      view.setTint(REMEMBERED_TINT);
    }
    this.remembered.end();
  }

  /** Current on-screen anchor of a live building sprite (effects attach here). */
  anchorOf(eid: number): ScreenPos | null {
    const view = this.live.get(eid);
    return view ? { x: view.x, y: view.y } : null;
  }

  get counts(): { live: number; remembered: number; atlas: number } {
    return {
      live: this.live.size,
      remembered: this.remembered.size,
      atlas: this.live.countBySource('atlas'),
    };
  }

  clear(): void {
    this.bars.clear();
    this.live.clear();
    this.remembered.clear();
  }

  /** Walls bend toward the axis with more wall / tower neighbours. */
  private wallVariant(eid: number): 'x' | 'y' {
    const x = Math.round(Position.x[eid]);
    const y = Math.round(Position.y[eid]);
    const xConnections =
      Number(this.hasWallConnectionAt(x - 1, y)) + Number(this.hasWallConnectionAt(x + 1, y));
    const yConnections =
      Number(this.hasWallConnectionAt(x, y - 1)) + Number(this.hasWallConnectionAt(x, y + 1));
    return xConnections >= yConnections ? 'x' : 'y';
  }

  private hasWallConnectionAt(x: number, y: number): boolean {
    for (const eid of buildingQuery(this.ctx.world.ecs)) {
      if (Health.hp[eid] <= 0) continue;
      if (Math.round(Position.x[eid]) !== x || Math.round(Position.y[eid]) !== y) continue;
      const defId = Building.defId[eid];
      return defId === BuildingDefId.WALL || defId === BuildingDefId.DEFENSIVE_TOWER;
    }
    return false;
  }
}
