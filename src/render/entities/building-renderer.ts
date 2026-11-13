/**
 * Building sprites (live, fog-of-war memory and ruins) and their overlay
 * status bars: construction progress, production progress and worksite
 * worker dots.
 *
 * Render-only looks derived from sim state (never written back):
 *  - construction scaffold stage from ConstructionSite progress
 *  - farm crop stage cycling while the farm is worked (fallow when idle)
 *  - wall shape from the 4 neighbours the perspective player knows about
 *  - ruins left where a building the player saw was destroyed
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
import { AgeId, BUILDING_TABLE, BuildingDefId, getUnitDef, type BuildingDef } from '@sim/defs';
import {
  buildingQuery,
  getPlayerVisibility,
  getWorksiteWorkerSlots,
  isBuildingFootprintVisibleTo,
} from '@sim/world';
import { MAP, SIM } from '../../config';
import type { ScreenPos } from '../iso';
import { FOG_DIM_TINT } from '../overlays/fog-style';
import type { StatusOverlay } from '../overlays/status-overlay';
import type { SceneContext } from '../scene-context';
import type { FarmStage, SpriteSource } from '../sprites/sprite-source';
import { tileHash } from '../tile-hash';
import { addLayerGraphics } from '../world-layers';
import { buildingAnchorTileForDef, spriteAnchorPoint } from '../world-projection';
import { SpriteSync } from './sprite-sync';

/** How long a ruin stays, and the fade at its end. */
/** Minimum texel alpha (0-255) that counts as a hit for click picking. */
const PICK_ALPHA = 40;
const RUIN_TICKS = SIM.TICK_HZ * 75;
const RUIN_FADE_TICKS = SIM.TICK_HZ * 6;
/** One crop cycle of a worked farm: sown -> growing -> ripe -> harvested. */
const FARM_CYCLE_TICKS = SIM.TICK_HZ * 90;
const FARM_STAGE_ENDS: ReadonlyArray<readonly [number, FarmStage]> = [
  [0.16, 'sown'],
  [0.42, 'growing'],
  [0.94, 'ripe'],
  [1, 'depleted'],
];

interface TrackedBuilding {
  defId: number;
  x: number;
  y: number;
  foundation: boolean;
  visible: boolean;
}

interface Ruin {
  defId: number;
  /** Footprint centre on screen. */
  center: ScreenPos;
  x0: number;
  y0: number;
  w: number;
  h: number;
  expiresTick: number;
}

export class BuildingRenderer {
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly live: SpriteSync<number>;
  private readonly remembered: SpriteSync<number>;
  private readonly ruinViews: SpriteSync<number>;
  private readonly tracked = new Map<number, TrackedBuilding>();
  private readonly ruins = new Map<number, Ruin>();
  private nextRuinId = 1;
  /** eid -> tick its current crop cycle started. */
  private readonly farmCycleStart = new Map<number, number>();
  private readonly farmFoundations = new Set<number>();
  /** Tiles holding a wall / tower the perspective player knows about. */
  private readonly wallTiles = new Set<number>();
  /** eid -> screen y of the top of the art, for the status bars. */
  private readonly tops = new Map<number, number>();
  private readonly seen = new Set<number>();

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource
  ) {
    this.bars = addLayerGraphics(ctx.scene, ctx.layers.overlay);
    this.live = new SpriteSync(ctx.scene, ctx.layers);
    this.remembered = new SpriteSync(ctx.scene, ctx.layers);
    this.ruinViews = new SpriteSync(ctx.scene, ctx.layers);
  }

  /** Visible buildings: sprites + construction / production / worker bars. */
  draw(): void {
    const world = this.ctx.world;
    const g = this.bars;
    g.clear();
    this.collectWallTiles();
    this.trackRemovals();
    this.tops.clear();
    this.live.begin();
    for (const eid of buildingQuery(world.ecs)) {
      const defId = Building.defId[eid];
      const def = BUILDING_TABLE[defId];
      if (!def) continue;
      if (Health.hp[eid] <= 0) continue;
      if (!this.ctx.isEntityVisible(eid)) continue;
      const isFoundation = hasComponent(world.ecs, ConstructionSite, eid);
      const playerId = Owner.player[eid];
      const progress = isFoundation
        ? Math.min(1, ConstructionSite.progress[eid] / (ConstructionSite.totalTicks[eid] || 1))
        : undefined;
      const ref = this.sprites.building({
        defId,
        age: world.ages[playerId]?.current ?? AgeId.DARK,
        playerId,
        wallMask: defId === BuildingDefId.WALL ? this.wallMask(eid) : undefined,
        farmStage: defId === BuildingDefId.FARM && !isFoundation ? this.farmStage(eid) : undefined,
        construction: progress,
      });
      if (!ref) continue;

      const c = this.ctx.buildingScreenPosition(eid);
      const p = spriteAnchorPoint(ref.anchor, c, def.footprint.w, def.footprint.h);
      const view = this.live.show(eid, ref, p.x, p.y);
      view.clearTint();
      view.setAlpha(isFoundation && ref.source === 'voxel' ? 0.5 : 1.0);
      view.setDepth(buildingDepth(def, c));
      const topY = p.y - ref.top;
      this.tops.set(eid, topY);

      if (isFoundation) {
        const frac = progress ?? 0;
        const barW = 40, barH = 5;
        const barX = Math.round(c.x - barW / 2), barY = Math.round(topY - 12);
        g.fillStyle(0x000000, 0.65);
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
          const barX = Math.round(c.x - barW / 2), barY = Math.round(topY - 15);
          g.fillStyle(0x000000, 0.65);
          g.fillRect(barX, barY, barW, barH);
          g.fillStyle(0x4ecdc4, 0.95);
          g.fillRect(barX, barY, barW * frac, barH);
        }
      }

      if (hasComponent(world.ecs, ResourceWorksite, eid) && !isFoundation) {
        const workers = ResourceWorksite.assignedWorkers[eid];
        const slots = getWorksiteWorkerSlots(world, eid);
        const dotY = Math.round(topY - 14);
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
    this.drawRuins();
  }

  /** Selection rings + health bars for every visible building. */
  drawStatus(overlay: StatusOverlay): void {
    for (const eid of buildingQuery(this.ctx.world.ecs)) {
      if (Health.hp[eid] <= 0) continue;
      if (!this.ctx.isEntityVisible(eid)) continue;
      const c = this.ctx.buildingScreenPosition(eid);
      overlay.drawBuilding(eid, c, this.tops.get(eid) ?? c.y - 50);
    }
  }

  /** Dimmed snapshots of enemy buildings last seen in now-fogged tiles. */
  drawRemembered(): void {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    this.remembered.begin();
    const vis = getPlayerVisibility(world, playerId);
    for (const snap of vis?.lastSeenBuildings.values() ?? []) {
      if (!this.isRememberedShown(snap.defId, snap.x, snap.y)) continue;
      const def = BUILDING_TABLE[snap.defId];
      if (!def) continue;
      const ref = this.sprites.building({
        defId: snap.defId,
        age: snap.age,
        playerId: snap.owner,
        wallMask: snap.defId === BuildingDefId.WALL
          ? this.maskAt(Math.round(snap.x), Math.round(snap.y))
          : undefined,
        farmStage: snap.defId === BuildingDefId.FARM ? 'growing' : undefined,
        construction: snap.isFoundation ? 0 : undefined,
      });
      if (!ref) continue;
      const anchor = buildingAnchorTileForDef(def, snap.x, snap.y);
      const c = this.ctx.tileToScreen(anchor.x, anchor.y);
      const p = spriteAnchorPoint(ref.anchor, c, def.footprint.w, def.footprint.h);
      const view = this.remembered.show(snap.eid, ref, p.x, p.y);
      view.setDepth(buildingDepth(def, c) - 0.5);
      view.setAlpha(snap.isFoundation && ref.source === 'voxel' ? 0.4 : 1);
      view.setTint(FOG_DIM_TINT);
    }
    this.remembered.end();
  }

  /** Current on-screen anchor of a live building sprite (effects attach here). */
  /**
   * Live building whose drawn pixels cover a layer-local point, front-most
   * first. Lets a click on a tall roof select the building even though the
   * sim picks by tile.
   */
  pickAt(x: number, y: number): number | null {
    const textures = this.ctx.scene.textures;
    let best: number | null = null;
    let bestDepth = -Infinity;
    for (const [eid, view] of this.live.entries()) {
      const s = view.sprite;
      if (!s.visible || s.depth <= bestDepth) continue;
      const fx = (x - s.x) / s.scaleX + s.displayOriginX;
      const fy = (y - s.y) / s.scaleY + s.displayOriginY;
      if (fx < 0 || fy < 0 || fx >= s.width || fy >= s.height) continue;
      const alpha = textures.getPixelAlpha(Math.floor(fx), Math.floor(fy), s.texture.key, s.frame.name);
      if ((alpha ?? 0) < PICK_ALPHA) continue;
      best = eid;
      bestDepth = s.depth;
    }
    return best;
  }

  anchorOf(eid: number): ScreenPos | null {
    if (!this.live.get(eid)) return null;
    return this.ctx.buildingScreenPosition(eid);
  }

  get counts(): { live: number; remembered: number; ruins: number; atlas: number } {
    return {
      live: this.live.size,
      remembered: this.remembered.size,
      ruins: this.ruinViews.size,
      atlas: this.live.countBySource('atlas') + this.remembered.countBySource('atlas'),
    };
  }

  clear(): void {
    this.bars.clear();
    this.live.clear();
    this.remembered.clear();
    this.ruinViews.clear();
    this.tracked.clear();
    this.ruins.clear();
    this.farmCycleStart.clear();
    this.farmFoundations.clear();
    this.wallTiles.clear();
    this.tops.clear();
  }

  // ── Ruins ───────────────────────────────────────────────────────────────

  /**
   * Notice buildings that died or vanished since last frame. A building the
   * perspective player could see when it went down leaves a ruin.
   */
  private trackRemovals(): void {
    const world = this.ctx.world;
    this.seen.clear();
    for (const eid of buildingQuery(world.ecs)) {
      const defId = Building.defId[eid];
      const x = Position.x[eid];
      const y = Position.y[eid];
      const prev = this.tracked.get(eid);
      if (prev && (prev.defId !== defId || prev.x !== x || prev.y !== y)) {
        this.removed(prev); // eid recycled for a different building
      }
      if (Health.hp[eid] <= 0) {
        if (prev) this.removed(prev);
        this.tracked.delete(eid);
        continue;
      }
      this.seen.add(eid);
      const foundation = hasComponent(world.ecs, ConstructionSite, eid);
      this.tracked.set(eid, { defId, x, y, foundation, visible: this.ctx.isEntityVisible(eid) });
      if (defId === BuildingDefId.FARM && foundation) this.farmFoundations.add(eid);
    }
    for (const [eid, prev] of this.tracked) {
      if (this.seen.has(eid)) continue;
      this.tracked.delete(eid);
      this.farmCycleStart.delete(eid);
      this.farmFoundations.delete(eid);
      this.removed(prev);
    }
  }

  private removed(prev: TrackedBuilding): void {
    if (prev.foundation || !prev.visible) return;
    const def = BUILDING_TABLE[prev.defId];
    if (!def) return;
    const anchor = buildingAnchorTileForDef(def, prev.x, prev.y);
    this.ruins.set(this.nextRuinId++, {
      defId: prev.defId,
      center: this.ctx.tileToScreen(anchor.x, anchor.y),
      x0: Math.round(prev.x) - Math.floor(def.footprint.w / 2),
      y0: Math.round(prev.y) - Math.floor(def.footprint.h / 2),
      w: def.footprint.w,
      h: def.footprint.h,
      expiresTick: this.ctx.world.tick + RUIN_TICKS,
    });
  }

  private drawRuins(): void {
    const tick = this.ctx.world.tick;
    this.ruinViews.begin();
    for (const [id, ruin] of this.ruins) {
      if (tick >= ruin.expiresTick || this.ruinCovered(ruin)) {
        this.ruins.delete(id);
        continue;
      }
      const cx = ruin.x0 + Math.floor(ruin.w / 2);
      const cy = ruin.y0 + Math.floor(ruin.h / 2);
      if (!this.ctx.isTileExplored(cx, cy)) continue;
      const ref = this.sprites.rubble(ruin.defId);
      if (!ref) continue;
      const p = spriteAnchorPoint(ref.anchor, ruin.center, ruin.w, ruin.h);
      const view = this.ruinViews.show(id, ref, p.x, p.y);
      view.setDepth(ruin.center.y - (ruin.w + ruin.h) * 8 - 1);
      view.setAlpha(Math.min(1, (ruin.expiresTick - tick) / RUIN_FADE_TICKS));
      view.setTintOrClear(this.ctx.isTileVisible(cx, cy) ? null : FOG_DIM_TINT);
    }
    this.ruinViews.end();
  }

  /** A new building on the ruin's footprint clears it. */
  private ruinCovered(ruin: Ruin): boolean {
    for (const eid of this.seen) {
      const def = BUILDING_TABLE[Building.defId[eid]];
      if (!def) continue;
      const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
      const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
      if (x0 < ruin.x0 + ruin.w && ruin.x0 < x0 + def.footprint.w &&
        y0 < ruin.y0 + ruin.h && ruin.y0 < y0 + def.footprint.h) {
        return true;
      }
    }
    return false;
  }

  // ── Farms ───────────────────────────────────────────────────────────────

  /** Worked farms cycle through their crop; a farm without a worker lies fallow. */
  private farmStage(eid: number): FarmStage {
    const tick = this.ctx.world.tick;
    if (ResourceWorksite.assignedWorkers[eid] === 0) return 'depleted';
    let start = this.farmCycleStart.get(eid);
    if (start === undefined) {
      // Freshly completed farms start sown; farms that already stood when we
      // first saw them get a stable per-tile phase so fields do not ripen in sync.
      start = this.farmFoundations.delete(eid)
        ? tick
        : tick - (tileHash(Math.round(Position.x[eid]), Math.round(Position.y[eid]), 0xfa) % FARM_CYCLE_TICKS);
      this.farmCycleStart.set(eid, start);
    }
    const phase = (((tick - start) % FARM_CYCLE_TICKS) + FARM_CYCLE_TICKS) % FARM_CYCLE_TICKS;
    const t = phase / FARM_CYCLE_TICKS;
    for (const [end, stage] of FARM_STAGE_ENDS) if (t < end) return stage;
    return 'depleted';
  }

  // ── Walls ───────────────────────────────────────────────────────────────

  private isRememberedShown(defId: number, x: number, y: number): boolean {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    if (!this.ctx.isTileExplored(x, y)) return false;
    return !isBuildingFootprintVisibleTo(world, playerId, defId, x, y);
  }

  /** Walls and towers the perspective player can see or remembers. */
  private collectWallTiles(): void {
    const world = this.ctx.world;
    this.wallTiles.clear();
    for (const eid of buildingQuery(world.ecs)) {
      const defId = Building.defId[eid];
      if (defId !== BuildingDefId.WALL && defId !== BuildingDefId.DEFENSIVE_TOWER) continue;
      if (Health.hp[eid] <= 0 || !this.ctx.isEntityVisible(eid)) continue;
      this.wallTiles.add(tileIndex(Position.x[eid], Position.y[eid]));
    }
    const vis = getPlayerVisibility(world, this.ctx.perspectivePlayerId);
    for (const snap of vis?.lastSeenBuildings.values() ?? []) {
      if (snap.defId !== BuildingDefId.WALL && snap.defId !== BuildingDefId.DEFENSIVE_TOWER) continue;
      if (!this.isRememberedShown(snap.defId, snap.x, snap.y)) continue;
      this.wallTiles.add(tileIndex(snap.x, snap.y));
    }
  }

  private wallMask(eid: number): number {
    return this.maskAt(Math.round(Position.x[eid]), Math.round(Position.y[eid]));
  }

  /** 1 = +x, 2 = +y, 4 = -x, 8 = -y neighbour is a wall or tower. */
  private maskAt(x: number, y: number): number {
    const has = (tx: number, ty: number): boolean =>
      tx >= 0 && ty >= 0 && tx < MAP.WIDTH && ty < MAP.HEIGHT && this.wallTiles.has(tileIndex(tx, ty));
    return (has(x + 1, y) ? 1 : 0) | (has(x, y + 1) ? 2 : 0) | (has(x - 1, y) ? 4 : 0) |
      (has(x, y - 1) ? 8 : 0);
  }
}

function tileIndex(x: number, y: number): number {
  return Math.round(y) * MAP.WIDTH + Math.round(x);
}

/**
 * Painter depth of a building: its footprint centre, except flat fields
 * (farms), which sort by their back corner so workers always draw on top.
 */
function buildingDepth(def: BuildingDef, c: ScreenPos): number {
  if (def.id === 'FARM') return c.y - (def.footprint.w + def.footprint.h) * 8;
  return c.y;
}

