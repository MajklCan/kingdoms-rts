/**
 * Night matches (`world.night`): the world goes moonlight dark and every unit
 * and building carries its own torchlight, reaching exactly as far as it
 * sees (the sim's night sight radius, visibility.ts).
 *
 *   darkness  a low-resolution canvas the size of the camera view, filled
 *             with the moonlight colour and lit in two passes: a dim warm
 *             ellipse over each light's whole reach, then a bright pool
 *             around each flame. Lights are combined by "lighten" (the
 *             brightest wins), so an army never adds up to daylight. The
 *             canvas is multiplied over everything below the HUD overlay and
 *             repainted every frame (it is tiny), so lights follow units and
 *             flicker
 *   torches   a hand torch beside every unit, two standing torches in front
 *             of every finished building and one on every third wall piece:
 *             a pixel pole with a two-layer additive flame, depth-sorted with
 *             the entities, plus a halo above the darkness and a few sparks
 *
 * Your own things light their whole sight; a torch you merely see (the
 * enemy's) lights only its bearer, so light never promises sight you lack.
 * Render-only; by day the layer is empty.
 */

import { hasComponent } from 'bitecs';
import { ISO } from '../../config';
import { Building, ConstructionSite, Health, Owner, Position } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId } from '@sim/defs';
import { buildingQuery, lineOfSightRadius } from '@sim/world';
import { BLEND_ADD, BLEND_MULTIPLY } from '../effects/fx-constants';
import { rand, type FxParticles } from '../effects/fx-particles';
import { FX_SHEET } from '../effects/fx-textures';
import { reducedMotion } from '../effects/motion-prefs';
import { performanceMode } from '../effects/perf-mode';
import type { BuildingRenderer } from '../entities/building-renderer';
import type { UnitRenderer } from '../entities/unit-renderer';
import type { SceneContext } from '../scene-context';
import { LINEAR_FILTER } from '../sprites/sprite-registry';
import {
  FOREIGN_LIGHT_TILES,
  NIGHT_AMBIENT,
  TORCH_CORE,
  TORCH_CORE_TILES,
  TORCH_REACH,
  lightEllipse,
  torchFlicker,
  torchInFront,
  torchSide,
} from './night-style';

const PLANE_KEY = 'night-darkness';
const TORCH_KEY = 'night-torch';
/** Screen px per darkness-canvas px. */
const DOWNSCALE = 4;
/** World px the darkness reaches past the camera view (camera shake, rounding). */
const VIEW_MARGIN = 64;
const LIGHT_SPRITE_PX = 128;
/** Frames a torch may sit unused (off screen) before its sprites are freed. */
const TORCH_IDLE_FRAMES = 240;
/** Every n-th wall piece along the tile diagonals carries a torch. */
const WALL_TORCH_EVERY = 3;

const FLAME_OUTER = 0xff8a2b;
const FLAME_CORE = 0xffe9a8;
const HALO_TINT = 0xff9d45;
const SPARK_TINT = 0xffb35c;

type TorchKind = 'hand' | 'post';

/** Pole length to the flame's foot, flame size and halo size per torch kind. */
const TORCH: Readonly<Record<TorchKind, { reach: number; flame: number; halo: number; haloAlpha: number }>> = {
  hand: { reach: 13, flame: 0.4, halo: 1.3, haloAlpha: 0.1 },
  post: { reach: 25, flame: 0.6, halo: 2.4, haloAlpha: 0.2 },
};

interface Torch {
  kind: TorchKind;
  pole: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  halo: Phaser.GameObjects.Image;
  seenFrame: number;
}

interface Light {
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
}

export interface NightDeps {
  units: UnitRenderer;
  buildings: BuildingRenderer;
  /** Shared particle pools (sparks off the standing torches). */
  fx: FxParticles;
}

export class NightRenderer {
  private plane?: Phaser.GameObjects.Image;
  private canvas?: CanvasRenderingContext2D;
  private readonly reachSprite: HTMLCanvasElement;
  private readonly coreSprite: HTMLCanvasElement;
  private readonly torches = new Map<number, Torch>();
  private readonly lights: Light[] = [];
  private lightCount = 0;
  /** Bright pools around the flames (same pooled shape as `lights`). */
  private readonly cores: Light[] = [];
  private coreCount = 0;
  private readonly coreReach = lightEllipse(TORCH_CORE_TILES, 0);
  private frame = 0;
  private shown = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly deps: NightDeps
  ) {
    this.reachSprite = buildLightSprite(TORCH_REACH, [
      [0, 0],
      [0.34, 0.06],
      [0.6, 0.36],
      [0.82, 0.76],
      [1, 1],
    ]);
    this.coreSprite = buildLightSprite(TORCH_CORE, [
      [0, 0],
      [0.12, 0.05],
      [0.4, 0.42],
      [0.7, 0.8],
      [1, 1],
    ]);
    ensureTorchTexture(ctx.scene);
  }

  /** Once per frame, after the units and buildings drew (their sprites give the torch spots). */
  draw(deltaMs: number): void {
    const world = this.ctx.world;
    if (!world.night) {
      if (this.shown) this.hide();
      return;
    }
    this.shown = true;
    this.frame++;
    this.lightCount = 0;
    this.coreCount = 0;
    const time = this.ctx.scene.time.now;
    const flickerDepth = reducedMotion() ? 0 : 1;
    this.collectUnits(time, flickerDepth);
    this.collectBuildings(time, flickerDepth, world.paused ? 0 : deltaMs);
    this.retireTorches();
    this.paintDarkness(time, flickerDepth);
  }

  /** New / loaded world: drop every torch (eids are reused between matches). */
  clear(): void {
    for (const torch of this.torches.values()) destroyTorch(torch);
    this.torches.clear();
    this.lightCount = 0;
    this.coreCount = 0;
  }

  /** Debug / perf counters. */
  get stats(): { night: boolean; lights: number; torches: number } {
    return { night: this.shown, lights: this.lightCount, torches: this.torches.size };
  }

  // ── lights and torches ──────────────────────────────────────────────────

  private collectUnits(time: number, flickerDepth: number): void {
    const world = this.ctx.world;
    const me = this.ctx.perspectivePlayerId;
    this.deps.units.forEachDrawn((eid, body, owner, facing) => {
      const reach = owner === me ? lightEllipse(lineOfSightRadius(world, eid)) : lightEllipse(FOREIGN_LIGHT_TILES, 0);
      this.addLight(body.x, body.feet - 3, reach.rx, reach.ry, 1, eid, time, flickerDepth);
      if (!this.onScreen(body.x, body.feet, 48)) return;
      const lift = body.feet - body.top;
      const side = torchSide(facing);
      this.showTorch(
        eid * 4,
        'hand',
        body.x + side * Math.min(11, body.halfW * 0.72),
        body.feet - lift * 0.46,
        body.feet + 1 + (torchInFront(facing) ? 0.4 : -0.4),
        side * 0.24,
        body.feet,
        time,
        flickerDepth
      );
    });
  }

  private collectBuildings(time: number, flickerDepth: number, sparkMs: number): void {
    const world = this.ctx.world;
    const ecs = world.ecs;
    const me = this.ctx.perspectivePlayerId;
    for (const eid of buildingQuery(ecs)) {
      if (Health.hp[eid] <= 0) continue;
      if (!this.deps.buildings.viewOf(eid)) continue;
      const defId = Building.defId[eid];
      const def = BUILDING_TABLE[defId];
      if (!def) continue;
      const wall = defId === BuildingDefId.WALL;
      // A wall is a chain of lights: only its torch-bearing pieces shine.
      if (wall && !wallCarriesTorch(Position.x[eid], Position.y[eid])) continue;
      const c = this.ctx.buildingScreenPosition(eid);
      const own = Owner.player[eid] === me;
      const reach = own ? lightEllipse(lineOfSightRadius(world, eid)) : lightEllipse(FOREIGN_LIGHT_TILES + 1, 0);
      const foundation = hasComponent(ecs, ConstructionSite, eid);
      this.addLight(c.x, c.y, reach.rx, reach.ry, foundation ? 0.82 : 1, eid, time, flickerDepth);
      if (foundation) continue;

      const hw = ((def.footprint.w + def.footprint.h) * ISO.TILE_W) / 4;
      const hh = ((def.footprint.w + def.footprint.h) * ISO.TILE_H) / 4;
      if (!this.onScreen(c.x, c.y, hw + 64)) continue;
      if (wall) {
        const top = this.deps.buildings.topOf(eid) ?? c.y - 34;
        this.showTorch(eid * 4 + 1, 'hand', c.x, top + 9, c.y + 0.5, 0, c.y, time, flickerDepth);
        continue;
      }
      // Two standing torches just outside the middle of the two front edges.
      for (const side of [-1, 1] as const) {
        const x = c.x + side * (hw / 2 + 11);
        const y = c.y + hh / 2 + 8;
        const top = this.showTorch(eid * 4 + (side < 0 ? 1 : 2), 'post', x, y, Math.max(y + 1, c.y + 0.5), 0, y, time, flickerDepth);
        if (sparkMs > 0 && !performanceMode() && Math.random() < sparkMs * 0.0006) this.spark(top.x, top.y);
      }
    }
  }

  /** A light over a whole sight reach, centred at layer-local (x, y). */
  private addLight(
    x: number,
    y: number,
    rx: number,
    ry: number,
    alpha: number,
    seed: number,
    time: number,
    flickerDepth: number
  ): void {
    const f = 1 + (torchFlicker(time, seed, flickerDepth) - 1) * 0.4;
    const light = slot(this.lights, this.lightCount++);
    light.x = x;
    light.y = y;
    light.rx = rx * f;
    light.ry = ry * f;
    light.alpha = alpha;
  }

  /** The bright pool around one flame, on the ground under it. */
  private addCore(x: number, groundY: number, flicker: number): void {
    const light = slot(this.cores, this.coreCount++);
    const f = 1 + (flicker - 1) * 1.6;
    light.x = x;
    light.y = groundY;
    light.rx = this.coreReach.rx * f;
    light.ry = this.coreReach.ry * f;
    light.alpha = 1;
  }

  /** Place (or create) a torch with its pole foot at layer-local (x, y); returns the flame's foot. */
  private showTorch(
    key: number,
    kind: TorchKind,
    x: number,
    y: number,
    depth: number,
    tilt: number,
    /** Screen y of the ground under the flame (centre of its pool of light). */
    groundY: number,
    time: number,
    flickerDepth: number
  ): { x: number; y: number } {
    let torch = this.torches.get(key);
    if (!torch) {
      torch = this.createTorch(kind);
      this.torches.set(key, torch);
    } else if (torch.kind !== kind) {
      torch.kind = kind;
      torch.pole.setFrame(kind);
    }
    torch.seenFrame = this.frame;
    const spec = TORCH[kind];
    const entities = this.ctx.layers.entities;
    const topX = x + Math.sin(tilt) * spec.reach;
    const topY = y - Math.cos(tilt) * spec.reach;
    const f = torchFlicker(time, key + 0.5, flickerDepth);
    const sway = flickerDepth > 0 ? Math.sin(time * 0.012 + key) * 0.09 : 0;
    const wide = spec.flame * (1 - (f - 1) * 1.6);
    const tall = spec.flame * (1 + (f - 1) * 4);

    torch.pole.setVisible(true).setPosition(x, y).setRotation(tilt);
    entities.setDepth(torch.pole, depth);
    torch.flame.setVisible(true).setPosition(topX, topY).setScale(wide, tall).setRotation(tilt * 0.4 + sway);
    entities.setDepth(torch.flame, depth + 0.01);
    torch.core.setVisible(true).setPosition(topX, topY).setScale(wide * 0.52, tall * 0.6).setRotation(tilt * 0.4 + sway * 0.6);
    entities.setDepth(torch.core, depth + 0.02);
    torch.halo
      .setVisible(true)
      .setPosition(topX, topY - 4)
      .setScale(spec.halo * f)
      .setAlpha(spec.haloAlpha * (0.9 + (f - 1) * 3));
    this.addCore(topX, groundY, f);
    return { x: topX, y: topY };
  }

  private createTorch(kind: TorchKind): Torch {
    const scene = this.ctx.scene;
    const layers = this.ctx.layers;
    const pole = scene.add.image(0, 0, TORCH_KEY, kind).setOrigin(0.5, 1);
    const flame = scene.add.image(0, 0, FX_SHEET, 'flame').setOrigin(0.5, 0.94).setTint(FLAME_OUTER).setBlendMode(BLEND_ADD);
    const core = scene.add.image(0, 0, FX_SHEET, 'flame').setOrigin(0.5, 0.94).setTint(FLAME_CORE).setBlendMode(BLEND_ADD);
    const halo = scene.add.image(0, 0, FX_SHEET, 'glow').setTint(HALO_TINT).setBlendMode(BLEND_ADD);
    layers.entities.add(pole);
    layers.entities.add(flame);
    layers.entities.add(core);
    layers.night.add(halo);
    return { kind, pole, flame, core, halo, seenFrame: this.frame };
  }

  /** Hide torches not shown this frame; free the ones gone for a while. */
  private retireTorches(): void {
    for (const [key, torch] of this.torches) {
      if (torch.seenFrame === this.frame) continue;
      if (this.frame - torch.seenFrame > TORCH_IDLE_FRAMES) {
        destroyTorch(torch);
        this.torches.delete(key);
      } else if (torch.pole.visible) {
        setTorchVisible(torch, false);
      }
    }
  }

  private spark(x: number, y: number): void {
    this.deps.fx.emit('add', {
      frame: 'spark',
      x: x + rand(-2, 2),
      y: y - 6,
      vx: rand(-10, 14),
      vy: rand(-46, -24),
      drag: 0.9,
      life: rand(500, 950),
      scale: rand(0.25, 0.4),
      scaleEnd: 0.08,
      alpha: 1,
      tint: SPARK_TINT,
    });
  }

  private onScreen(x: number, y: number, margin: number): boolean {
    return this.deps.fx.onScreen(x, y, margin);
  }

  // ── darkness ─────────────────────────────────────────────────────────────

  private paintDarkness(time: number, flickerDepth: number): void {
    const cam = this.ctx.scene.cameras.main;
    const plane = this.ensurePlane(Math.ceil(cam.width / DOWNSCALE), Math.ceil(cam.height / DOWNSCALE));
    const g = this.canvas;
    if (!plane || !g) return;
    const view = cam.worldView;
    const root = this.ctx.layers.root;
    // The covered rectangle, in layer-local px.
    const left = view.x - root.x - VIEW_MARGIN;
    const top = view.y - root.y - VIEW_MARGIN;
    const width = view.width + VIEW_MARGIN * 2;
    const height = view.height + VIEW_MARGIN * 2;
    const w = g.canvas.width;
    const h = g.canvas.height;
    const kx = w / width;
    const ky = h / height;

    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = NIGHT_AMBIENT;
    g.fillRect(0, 0, w, h);
    // Brightest wins: the sprites are opaque (light colour falling to the
    // ambient colour), so overlapping lights merge instead of adding up.
    g.globalCompositeOperation = 'lighten';
    const blit = (sprite: HTMLCanvasElement, list: readonly Light[], count: number): void => {
      for (let i = 0; i < count; i++) {
        const light = list[i]!;
        const cx = (light.x - left) * kx;
        const cy = (light.y - top) * ky;
        const rx = light.rx * kx;
        const ry = light.ry * ky;
        if (cx + rx < 0 || cx - rx > w || cy + ry < 0 || cy - ry > h) continue;
        g.globalAlpha = light.alpha;
        g.drawImage(sprite, cx - rx, cy - ry, rx * 2, ry * 2);
      }
    };
    blit(this.reachSprite, this.lights, this.lightCount);
    blit(this.coreSprite, this.cores, this.coreCount);
    g.globalCompositeOperation = 'source-over';
    // A breath of moonlight so the dark is never a flat colour.
    if (flickerDepth > 0) {
      g.globalAlpha = 0.03 + Math.sin(time * 0.0004) * 0.015;
      g.fillStyle = '#9fb4ff';
      g.fillRect(0, 0, w, h);
    }
    g.globalAlpha = 1;

    const texture = this.ctx.scene.textures.get(PLANE_KEY);
    texture.source[0]?.update();
    // A canvas re-upload resets the filter to the game default (NEAREST).
    texture.setFilter(LINEAR_FILTER);
    plane.setVisible(true).setPosition(left, top).setDisplaySize(width, height);
  }

  private ensurePlane(width: number, height: number): Phaser.GameObjects.Image | undefined {
    if (this.plane && this.canvas && this.canvas.canvas.width === width && this.canvas.canvas.height === height) {
      return this.plane;
    }
    this.destroyPlane();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const g = canvas.getContext('2d');
    if (!g) return undefined;
    const textures = this.ctx.scene.textures;
    const texture = textures.addImage(PLANE_KEY, canvas as unknown as HTMLImageElement);
    texture?.setFilter(LINEAR_FILTER);
    this.canvas = g;
    this.plane = this.ctx.scene.add.image(0, 0, PLANE_KEY).setOrigin(0, 0).setBlendMode(BLEND_MULTIPLY);
    // Under the halos, which were (or will be) added to the same layer.
    this.ctx.layers.night.addAt(this.plane, 0);
    return this.plane;
  }

  private destroyPlane(): void {
    this.plane?.destroy();
    this.plane = undefined;
    this.canvas = undefined;
    const textures = this.ctx.scene.textures;
    if (textures.exists(PLANE_KEY)) textures.remove(PLANE_KEY);
  }

  private hide(): void {
    this.shown = false;
    this.plane?.setVisible(false);
    this.clear();
  }
}

function wallCarriesTorch(x: number, y: number): boolean {
  const n = Math.round(x) + Math.round(y) * 2;
  return ((n % WALL_TORCH_EVERY) + WALL_TORCH_EVERY) % WALL_TORCH_EVERY === 0;
}

function setTorchVisible(torch: Torch, visible: boolean): void {
  torch.pole.setVisible(visible);
  torch.flame.setVisible(visible);
  torch.core.setVisible(visible);
  torch.halo.setVisible(visible);
}

function destroyTorch(torch: Torch): void {
  torch.pole.destroy();
  torch.flame.destroy();
  torch.core.destroy();
  torch.halo.destroy();
}

function slot(list: Light[], index: number): Light {
  let light = list[index];
  if (!light) {
    light = { x: 0, y: 0, rx: 0, ry: 0, alpha: 0 };
    list[index] = light;
  }
  return light;
}

/**
 * An opaque round light: `color` at the centre falling to the night ambient
 * colour at the rim (and beyond, so the square's corners stay dark). `stops`
 * are [radius 0..1, share of ambient 0..1].
 */
function buildLightSprite(color: string, stops: ReadonlyArray<readonly [number, number]>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = LIGHT_SPRITE_PX;
  canvas.height = LIGHT_SPRITE_PX;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const r = LIGHT_SPRITE_PX / 2;
  const lit = hexRgb(color);
  const dark = hexRgb(NIGHT_AMBIENT);
  const gradient = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, toDark] of stops) {
    const mix = lit.map((c, i) => Math.round(c + (dark[i]! - c) * toDark));
    gradient.addColorStop(at, `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`);
  }
  g.fillStyle = gradient;
  g.fillRect(0, 0, LIGHT_SPRITE_PX, LIGHT_SPRITE_PX);
  return canvas;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pixel poles: `hand` (5 x 14, a rag-wrapped stick) and `post` (9 x 28, a standing iron basket). */
function ensureTorchTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TORCH_KEY)) return;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 28;
  const g = canvas.getContext('2d');
  if (!g) return;
  const px = (color: string, x: number, y: number, w = 1, h = 1): void => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  // hand: charred, glowing head over a two-tone shaft.
  px('#2a1b12', 1, 0, 3, 5);
  px('#c8501e', 2, 0, 1, 2);
  px('#7c3a17', 1, 2, 1, 2);
  px('#7a5230', 1, 5, 1, 9);
  px('#553720', 2, 5, 1, 9);
  // post: iron basket with embers, three-tone shaft, a foot.
  const ox = 6;
  px('#3a3b40', ox + 1, 0, 7, 1);
  px('#b5451a', ox + 2, 1, 5, 4);
  px('#e07a2a', ox + 3, 1, 3, 2);
  for (const bar of [1, 3, 5, 7]) px('#26272b', ox + bar, 1, 1, 4);
  px('#26272b', ox + 1, 5, 7, 1);
  px('#55565c', ox + 1, 0, 2, 1);
  px('#7a5230', ox + 3, 6, 1, 20);
  px('#684526', ox + 4, 6, 1, 20);
  px('#4a301c', ox + 5, 6, 1, 20);
  px('#4a301c', ox + 2, 26, 5, 1);
  px('#35220f', ox + 1, 27, 7, 1);
  const texture = scene.textures.addCanvas(TORCH_KEY, canvas);
  if (!texture) return;
  texture.add('hand', 0, 0, 0, 5, 14);
  texture.add('post', 0, ox, 0, 9, 28);
}
