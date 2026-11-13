/**
 * Fog of war over the ground: a black wash of FOG_EXPLORED_ALPHA over
 * explored-but-not-visible tiles and solid black over unexplored ones, both
 * soft-edged. Each is a quarter-resolution canvas aligned with the terrain
 * (tile diamonds incl. their raised side faces), blurred, and drawn scaled up
 * with linear filtering. Repainted only when the perspective player's
 * visibility actually changed.
 *
 * The fog layer sits under the entities; sprites standing in fog are tinted
 * by their renderers (see fog-style.ts), so tall art is never cut by a tile.
 */

import { ISO, MAP } from '../../config';
import { getPlayerVisibility } from '@sim/world';
import type { SceneContext } from '../scene-context';
import { LINEAR_FILTER } from '../sprites/sprite-registry';
import type { TerrainBounds } from '../terrain/terrain-layer';
import { elevationAt } from '../world-projection';
import { FOG_EXPLORED_ALPHA } from './fog-style';

const FOG_EXPLORED_KEY = 'fog-of-war-explored';
const FOG_UNEXPLORED_KEY = 'fog-of-war-unexplored';
/** Fog canvas pixels per world pixel. */
const FOG_RES = 0.25;
/** Blur radius in fog canvas pixels (the soft edge is about 4x this in world px). */
const FOG_BLUR_PX = 2.5;
const PAD = 24;

interface FogPlane {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  key: string;
  image: Phaser.GameObjects.Image;
}

export class FogRenderer {
  private explored?: FogPlane;
  private unexplored?: FogPlane;
  private scratch?: CanvasRenderingContext2D;
  private origin = { x: 0, y: 0 };
  private paintedTick = -1;
  private paintedHash = -1;
  private paintedWorld: unknown = null;
  private readonly blurSupported: boolean;
  /** Repaints so far (debug / perf). */
  repaints = 0;

  constructor(
    private readonly ctx: SceneContext,
    private readonly bounds: () => TerrainBounds
  ) {
    const probe = document.createElement('canvas').getContext('2d');
    this.blurSupported = !!probe && typeof probe.filter === 'string';
  }

  /** (Re)create the fog canvases to match the current terrain. */
  rebuild(): void {
    this.destroy();
    const b = this.bounds();
    this.origin = { x: b.x - PAD, y: b.y - PAD };
    const width = Math.ceil((b.width + PAD * 2) * FOG_RES);
    const height = Math.ceil((b.height + PAD * 2) * FOG_RES);
    this.scratch = canvas2d(width, height);
    this.explored = this.createPlane(FOG_EXPLORED_KEY, width, height, FOG_EXPLORED_ALPHA);
    this.unexplored = this.createPlane(FOG_UNEXPLORED_KEY, width, height, 1);
    this.paintedTick = -1;
    this.paintedHash = -1;
  }

  /** Force a repaint on the next draw (e.g. after a reveal-map cheat). */
  invalidate(): void {
    this.paintedTick = -1;
    this.paintedHash = -1;
  }

  draw(): void {
    const world = this.ctx.world;
    const vis = getPlayerVisibility(world, this.ctx.perspectivePlayerId);
    if (!vis) return;
    if (!this.explored || !this.unexplored || !this.scratch) this.rebuild();
    const explored = this.explored;
    const unexplored = this.unexplored;
    const scratch = this.scratch;
    if (!explored || !unexplored || !scratch) return;
    if (this.paintedTick === world.tick && this.paintedWorld === world) return;
    this.paintedTick = world.tick;
    const hash = visibilityHash(vis.visible, vis.explored) ^ this.ctx.perspectivePlayerId;
    if (hash === this.paintedHash && this.paintedWorld === world) return;
    this.paintedHash = hash;
    this.paintedWorld = world;

    // Unexplored: black where never seen. Explored wash: every tile not in sight.
    this.paintPlane(unexplored, scratch, (idx) => vis.explored[idx] !== 1);
    this.paintPlane(explored, scratch, (idx) => vis.visible[idx] !== 1);
    this.repaints++;
  }

  destroy(): void {
    const textures = this.ctx.scene.textures;
    for (const plane of [this.explored, this.unexplored]) {
      if (!plane) continue;
      plane.image.destroy();
      if (textures.exists(plane.key)) textures.remove(plane.key);
    }
    this.explored = undefined;
    this.unexplored = undefined;
    this.scratch = undefined;
    this.paintedTick = -1;
    this.paintedHash = -1;
  }

  private createPlane(key: string, width: number, height: number, alpha: number): FogPlane {
    const textures = this.ctx.scene.textures;
    if (textures.exists(key)) textures.remove(key);
    const ctx = canvas2d(width, height);
    const texture = textures.addImage(key, ctx.canvas as unknown as HTMLImageElement);
    texture?.setFilter(LINEAR_FILTER);
    const image = this.ctx.scene.add
      .image(this.origin.x, this.origin.y, key)
      .setOrigin(0, 0)
      .setScale(1 / FOG_RES)
      .setAlpha(alpha);
    this.ctx.layers.fog.add(image);
    return { canvas: ctx.canvas, ctx, key, image };
  }

  /** Diamonds of the covered tiles into the scratch, then blurred into the plane. */
  private paintPlane(
    plane: FogPlane,
    scratch: CanvasRenderingContext2D,
    covered: (idx: number) => boolean
  ): void {
    const w = scratch.canvas.width;
    const h = scratch.canvas.height;
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.clearRect(0, 0, w, h);
    scratch.setTransform(FOG_RES, 0, 0, FOG_RES, -this.origin.x * FOG_RES, -this.origin.y * FOG_RES);
    scratch.fillStyle = '#000';
    scratch.beginPath();
    for (let y = 0; y < MAP.HEIGHT; y++) {
      for (let x = 0; x < MAP.WIDTH; x++) {
        if (covered(y * MAP.WIDTH + x)) this.tilePath(scratch, x, y);
      }
    }
    scratch.fill();

    const out = plane.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.clearRect(0, 0, w, h);
    if (this.blurSupported) out.filter = `blur(${FOG_BLUR_PX}px)`;
    out.drawImage(scratch.canvas, 0, 0);
    if (this.blurSupported) out.filter = 'none';
    const texture = this.ctx.scene.textures.get(plane.key);
    texture.source[0]?.update();
    // A canvas re-upload resets the filter to the game default (NEAREST).
    texture.setFilter(LINEAR_FILTER);
  }

  /** One tile's top diamond plus its raised side faces, slightly oversized. */
  private tilePath(c2d: CanvasRenderingContext2D, x: number, y: number): void {
    const halfW = ISO.TILE_W / 2 + 1.5;
    const halfH = ISO.TILE_H / 2 + 1;
    const c = this.ctx.tileToScreen(x, y);
    const side = elevationAt(this.ctx.world, x, y) * ISO.VPER;
    c2d.moveTo(c.x, c.y - halfH);
    c2d.lineTo(c.x + halfW, c.y);
    c2d.lineTo(c.x + halfW, c.y + side);
    c2d.lineTo(c.x, c.y + halfH + side);
    c2d.lineTo(c.x - halfW, c.y + side);
    c2d.lineTo(c.x - halfW, c.y);
    c2d.closePath();
  }
}

function canvas2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

function visibilityHash(visible: Uint8Array, explored: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < visible.length; i++) {
    h = Math.imul(h ^ (visible[i] | (explored[i] << 1)), 0x01000193);
  }
  return h >>> 0;
}
