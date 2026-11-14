/**
 * Buildings that look lived in and fought over, all derived from sim state
 * the renderer already reads each frame:
 *
 *   chimneys      houses, town centres and the foundry smoke (per-art offsets)
 *   fire          damaged buildings smoke at 75 % HP, burn at 50 %, blaze
 *                 with embers and thick smoke under 25 %
 *   construction  dust and hammer sparks while builders work (progress rises),
 *                 with a soft knock through the audio manager
 *   placement     a dust ring thuds out when a new foundation appears
 *   completion    a lighter dust ring and a few glints when it is finished
 *
 * Fire spots are stable per building (hashed from the eid), so flames do not
 * hop around. Only buildings drawn on screen this frame are considered.
 */

import { hasComponent } from 'bitecs';
import { ISO } from '../../config';
import { Building, ConstructionSite, Health, Position } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId } from '@sim/defs';
import { buildingQuery } from '@sim/world';
import type { SfxConfig } from '../audio/sound-map';
import type { BuildingRenderer } from '../entities/building-renderer';
import type { GameAudio } from '../game-audio';
import { hash01, type FxHost } from './fx-host';
import { rand } from './fx-particles';
import { dustPuff, dustRing, flame, FX_COLORS, glint, smoke, sparks } from './fx-recipes';
import type { VoxelSmoke } from './village-life';

/**
 * Chimney mouths in 1x px from the sprite anchor, per atlas frame. `a` = smoke
 * alpha. From the Blender models: dx = (X + Y) * 32, dy = (X - Y) * 16 - (w + h)
 * * 8 - Z * 39.19 for a mouth at Blender (X, Y, Z) on a w x h footprint.
 */
const CHIMNEYS: Readonly<Record<string, ReadonlyArray<{ x: number; y: number; a: number; dark?: boolean }>>> = {
  house_dark: [{ x: -5, y: -57, a: 0.3 }],
  house_castle: [{ x: 7.5, y: -71.5, a: 0.38 }],
  house_gunpowder: [{ x: 10, y: -72.5, a: 0.4 }],
  town_center_dark: [{ x: 47, y: -108, a: 0.38 }],
  town_center_castle: [{ x: 62, y: -114.5, a: 0.4 }],
  town_center_gunpowder: [{ x: 41, y: -92, a: 0.42 }],
  foundry_gunpowder: [{ x: -1, y: -140.5, a: 0.48, dark: true }],
};
/** Voxel fallback: a puff over the roof ridge. */
const VOXEL_CHIMNEY_DEFS: ReadonlySet<number> = new Set([BuildingDefId.HOUSE, BuildingDefId.TOWN_CENTER, BuildingDefId.FOUNDRY]);
/** Foundry furnace mouth (embers now and then). */
const FURNACE = { x: 42, y: -38 };
/** Chimney puffs per second. */
const CHIMNEY_RATE = 2.4;

/** Fire stage by HP fraction: [below, flames/s per spot, smoke/s per spot, spots]. */
const FIRE_STAGES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.25, 15, 4.5, 3],
  [0.5, 8, 3, 2],
  [0.75, 0, 2.2, 1],
];

/** Minimum ms between construction bursts on one site. */
const BUILD_FX_GAP = 340;
const KNOCK: SfxConfig = { key: 'chop_wood', minIntervalMs: 420, volume: 0.2 };

export class BuildingFx {
  private readonly progress = new Map<number, number>();
  private readonly lastBuildFx = new Map<number, number>();
  private readonly foundations = new Set<number>();
  private readonly known = new Set<number>();
  private readonly seenNow = new Set<number>();
  private primed = false;

  constructor(
    private readonly host: FxHost,
    private readonly buildings: BuildingRenderer,
    private readonly audio: GameAudio,
    private readonly puffs: VoxelSmoke
  ) {}

  update(dtMs: number): void {
    const ctx = this.host.ctx;
    const ecs = ctx.world.ecs;
    const fx = this.host.fx;
    this.seenNow.clear();
    for (const eid of buildingQuery(ecs)) {
      this.seenNow.add(eid);
      const foundation = hasComponent(ecs, ConstructionSite, eid);
      const isNew = !this.known.has(eid);
      const wasFoundation = this.foundations.has(eid);
      if (isNew) this.known.add(eid);
      if (foundation) this.foundations.add(eid);
      else if (wasFoundation) this.foundations.delete(eid);

      const view = this.buildings.viewOf(eid);
      if (!view || !view.sprite.visible) continue;
      const defId = Building.defId[eid];
      const def = BUILDING_TABLE[defId];
      if (!def) continue;
      const c = ctx.buildingScreenPosition(eid);
      if (!fx.onScreen(c.x, c.y - view.ref.top * 0.5, 120)) {
        if (foundation) this.progress.set(eid, ConstructionSite.progress[eid]);
        continue;
      }
      const hw = ((def.footprint.w + def.footprint.h) * ISO.TILE_W) / 4;
      const hh = ((def.footprint.w + def.footprint.h) * ISO.TILE_H) / 4;

      if (foundation) {
        const p = ConstructionSite.progress[eid];
        const prev = this.progress.get(eid);
        this.progress.set(eid, p);
        if (isNew && this.primed && p <= Math.max(1, ConstructionSite.totalTicks[eid] * 0.05)) {
          dustRing(fx, c.x, c.y, hw * 0.85, hh * 0.85, 14, FX_COLORS.dust, 1.1);
        } else if (prev !== undefined && p > prev) {
          this.building(eid, c.x, c.y, hw, view.ref.top);
        }
        continue;
      }
      if (wasFoundation && this.primed) this.completed(c.x, c.y, hw, hh, view.y - view.ref.top);

      const frame = String(view.sprite.frame.name);
      let burning = 0;
      if (hasComponent(ecs, Health, eid) && Health.hpMax[eid] > 0) {
        burning = this.fire(eid, defId, Health.hp[eid] / Health.hpMax[eid], c.x, view.y, view.ref.top, hw, dtMs);
      }
      if (burning < 2) this.chimneys(eid, defId, frame, view.ref.source === 'voxel', view.x, view.y, view.ref.top, dtMs);
    }
    // Forget buildings that are gone.
    for (const eid of this.known) {
      if (this.seenNow.has(eid)) continue;
      this.known.delete(eid);
      this.foundations.delete(eid);
      this.progress.delete(eid);
      this.lastBuildFx.delete(eid);
    }
    this.primed = true;
  }

  clear(): void {
    this.progress.clear();
    this.lastBuildFx.clear();
    this.foundations.clear();
    this.known.clear();
    this.primed = false;
  }

  private chimneys(
    eid: number,
    defId: number,
    frame: string,
    voxel: boolean,
    x: number,
    y: number,
    top: number,
    dtMs: number
  ): void {
    const fx = this.host.fx;
    if (fx.headroom('normal') < 120) return;
    if (voxel) {
      if (!VOXEL_CHIMNEY_DEFS.has(defId) || !chance(CHIMNEY_RATE * 0.8, dtMs)) return;
      smoke(fx, x + 6, y - top * 0.95, FX_COLORS.smokeLight, 0.8, 0.28);
      return;
    }
    const mouths = CHIMNEYS[frame];
    if (!mouths) return;
    for (let i = 0; i < mouths.length; i++) {
      if (!chance(CHIMNEY_RATE, dtMs)) continue;
      const m = mouths[i];
      // Style A art: blocky voxel puffs that match the sprites.
      this.puffs.puff(x + m.x, y + m.y, m.a, m.dark ?? false, eid * 8 + i);
    }
    if (frame === 'foundry_gunpowder') {
      if (chance(3, dtMs)) {
        fx.emit('add', {
          frame: 'glow',
          x: x + FURNACE.x + rand(-2, 2),
          y: y + FURNACE.y + rand(-2, 2),
          life: rand(260, 420),
          scale: rand(0.35, 0.5),
          alpha: rand(0.25, 0.45),
          fadeIn: 0.3,
          tint: FX_COLORS.fire,
        });
      }
      if (chance(1.2, dtMs)) {
        fx.emit('add', {
          frame: 'spark',
          x: x + FURNACE.x + rand(-3, 3),
          y: y + FURNACE.y,
          vx: rand(-10, 18),
          vy: rand(-55, -30),
          drag: 0.6,
          life: rand(600, 1000),
          scale: rand(0.35, 0.5),
          scaleEnd: 0.1,
          tint: FX_COLORS.ember,
        });
      }
    }
  }

  /** Fire and smoke by HP; returns the stage (0 = intact). */
  private fire(
    eid: number,
    defId: number,
    frac: number,
    cx: number,
    baseY: number,
    top: number,
    hw: number,
    dtMs: number
  ): number {
    let stage = 0;
    let flames = 0;
    let smokes = 0;
    let spots = 0;
    for (let i = 0; i < FIRE_STAGES.length; i++) {
      const s = FIRE_STAGES[i];
      if (frac < s[0]) {
        stage = FIRE_STAGES.length - i;
        flames = s[1];
        smokes = s[2];
        spots = s[3];
        break;
      }
    }
    if (stage === 0 || frac <= 0) return 0;
    if (defId === BuildingDefId.WALL) spots = 1;
    const fx = this.host.fx;
    const lowOnFlames = fx.headroom('add') < 80;
    const lowOnSmoke = fx.headroom('normal') < 160;
    const topY = baseY - top;
    for (let k = 0; k < spots; k++) {
      const sx = cx + (hash01(eid, k * 3 + 1) * 2 - 1) * hw * 0.5;
      const sy = topY + (baseY - topY) * (0.3 + hash01(eid, k * 3 + 2) * 0.35);
      if (flames > 0 && !lowOnFlames) {
        const n = count(flames, dtMs);
        for (let f = 0; f < n; f++) flame(fx, sx, sy, stage);
      }
      if (!lowOnSmoke && chance(smokes, dtMs)) {
        const tint = stage >= 2 ? FX_COLORS.smokeDark : FX_COLORS.smokeGrey;
        smoke(fx, sx, sy - (stage >= 2 ? 10 : 2), tint, 0.85 + stage * 0.25, stage >= 2 ? 0.48 : 0.34, 12);
      }
    }
    return stage;
  }

  /** Builders at work: hammer sparks on the frame, dust at the base, a knock. */
  private building(eid: number, cx: number, cy: number, hw: number, top: number): void {
    const now = this.host.time;
    const last = this.lastBuildFx.get(eid);
    if (last !== undefined && now - last < BUILD_FX_GAP) return;
    this.lastBuildFx.set(eid, now);
    const fx = this.host.fx;
    const x = cx + rand(-hw, hw) * 0.55;
    const y = cy - rand(4, Math.max(8, top * 0.6));
    sparks(fx, x, y, 2, 0xffe2a0, 55);
    if (Math.random() < 0.6) dustPuff(fx, cx + rand(-hw, hw) * 0.6, cy + rand(-4, 4), 0.55, FX_COLORS.dust, 2);
    this.audio.playWorld(KNOCK, Math.round(Position.x[eid]), Math.round(Position.y[eid]));
  }

  private completed(cx: number, cy: number, hw: number, hh: number, topY: number): void {
    const fx = this.host.fx;
    dustRing(fx, cx, cy, hw * 0.8, hh * 0.8, 10, FX_COLORS.dust, 0.8);
    for (let i = 0; i < 5; i++) {
      glint(fx, cx + rand(-hw, hw) * 0.6, topY + rand(0, (cy - topY) * 0.6), 0xfff2c4, rand(0.7, 1.1));
    }
  }
}

/** One event at `ratePerSec`, sampled over a frame of `dtMs`. */
function chance(ratePerSec: number, dtMs: number): boolean {
  return Math.random() < (ratePerSec * dtMs) / 1000;
}

/** How many events at `ratePerSec` happen in a frame of `dtMs`. */
function count(ratePerSec: number, dtMs: number): number {
  const expected = (ratePerSec * dtMs) / 1000;
  const whole = Math.floor(expected);
  return whole + (Math.random() < expected - whole ? 1 : 0);
}
