/**
 * Fog of war as two canvas textures aligned with the terrain bake: a 48%
 * black wash over explored-but-not-visible tiles and solid black over
 * unexplored ones. Repainted at most once per sim tick.
 */

import { ISO, MAP } from '../../config';
import { getPlayerVisibility } from '@sim/world';
import type { SceneContext } from '../scene-context';
import { elevationAt } from '../world-projection';

const FOG_EXPLORED_KEY = 'fog-of-war-explored';
const FOG_UNEXPLORED_KEY = 'fog-of-war-unexplored';
const EXPLORED_ALPHA = 0.48;

export class FogRenderer {
  private exploredTexture?: Phaser.Textures.CanvasTexture;
  private unexploredTexture?: Phaser.Textures.CanvasTexture;
  private exploredSprite?: Phaser.GameObjects.Sprite;
  private unexploredSprite?: Phaser.GameObjects.Sprite;
  private paintedTick = -1;

  constructor(
    private readonly ctx: SceneContext,
    private readonly terrain: () => Phaser.GameObjects.Sprite | undefined
  ) {}

  /** (Re)create the fog canvases to match the current terrain bake. */
  rebuild(): void {
    const terrain = this.terrain();
    if (!terrain) return;
    this.destroy();
    const scene = this.ctx.scene;
    const width = Math.ceil(terrain.width);
    const height = Math.ceil(terrain.height);
    this.exploredTexture = scene.textures.createCanvas(FOG_EXPLORED_KEY, width, height) ?? undefined;
    this.unexploredTexture = scene.textures.createCanvas(FOG_UNEXPLORED_KEY, width, height) ?? undefined;
    if (!this.exploredTexture || !this.unexploredTexture) return;

    this.exploredTexture.context.imageSmoothingEnabled = false;
    this.unexploredTexture.context.imageSmoothingEnabled = false;
    this.exploredSprite = scene.add
      .sprite(terrain.x, terrain.y, FOG_EXPLORED_KEY)
      .setOrigin(0, 0)
      .setAlpha(EXPLORED_ALPHA);
    this.unexploredSprite = scene.add
      .sprite(terrain.x, terrain.y, FOG_UNEXPLORED_KEY)
      .setOrigin(0, 0)
      .setAlpha(1);
    this.ctx.layers.fog.add([this.exploredSprite, this.unexploredSprite]);
    this.paintedTick = -1;
  }

  /** Force a repaint on the next draw (e.g. after a reveal-map cheat). */
  invalidate(): void {
    this.paintedTick = -1;
  }

  draw(): void {
    const world = this.ctx.world;
    const vis = getPlayerVisibility(world, this.ctx.perspectivePlayerId);
    if (!vis) return;
    if (!this.exploredTexture || !this.unexploredTexture || !this.terrain()) this.rebuild();
    const terrain = this.terrain();
    if (!this.exploredTexture || !this.unexploredTexture || !terrain) return;
    if (this.paintedTick === world.tick) return;

    const exploredCtx = this.exploredTexture.context;
    const unexploredCtx = this.unexploredTexture.context;
    exploredCtx.clearRect(0, 0, this.exploredTexture.width, this.exploredTexture.height);
    unexploredCtx.clearRect(0, 0, this.unexploredTexture.width, this.unexploredTexture.height);
    exploredCtx.fillStyle = '#000';
    unexploredCtx.fillStyle = '#000';

    // Back-to-front so raised tiles' side faces overlap correctly.
    for (let sum = 0; sum <= MAP.WIDTH + MAP.HEIGHT - 2; sum++) {
      for (let y = 0; y < MAP.HEIGHT; y++) {
        const x = sum - y;
        if (x < 0 || x >= MAP.WIDTH) continue;
        const idx = y * MAP.WIDTH + x;
        if (vis.visible[idx] === 1) continue;
        const target = vis.explored[idx] === 1 ? exploredCtx : unexploredCtx;
        this.paintTile(target, terrain, x, y);
      }
    }
    this.exploredTexture.refresh();
    this.unexploredTexture.refresh();
    this.paintedTick = world.tick;
  }

  destroy(): void {
    const textures = this.ctx.scene.textures;
    this.exploredSprite?.destroy();
    this.unexploredSprite?.destroy();
    this.exploredSprite = undefined;
    this.unexploredSprite = undefined;
    this.exploredTexture = undefined;
    this.unexploredTexture = undefined;
    if (textures.exists(FOG_EXPLORED_KEY)) textures.remove(FOG_EXPLORED_KEY);
    if (textures.exists(FOG_UNEXPLORED_KEY)) textures.remove(FOG_UNEXPLORED_KEY);
    this.paintedTick = -1;
  }

  private paintTile(
    canvas: CanvasRenderingContext2D,
    terrain: Phaser.GameObjects.Sprite,
    x: number,
    y: number
  ): void {
    const halfW = ISO.TILE_W / 2 + 1;
    const halfH = ISO.TILE_H / 2 + 1;
    const c = this.ctx.tileToScreen(x, y);
    const sx = c.x - terrain.x;
    const sy = c.y - terrain.y;
    const sideH = elevationAt(this.ctx.world, x, y) * ISO.VPER;
    if (sideH > 0) {
      canvas.beginPath();
      canvas.moveTo(sx + halfW, sy);
      canvas.lineTo(sx + halfW, sy + sideH);
      canvas.lineTo(sx, sy + halfH + sideH);
      canvas.lineTo(sx, sy + halfH);
      canvas.closePath();
      canvas.fill();

      canvas.beginPath();
      canvas.moveTo(sx - halfW, sy);
      canvas.lineTo(sx - halfW, sy + sideH);
      canvas.lineTo(sx, sy + halfH + sideH);
      canvas.lineTo(sx, sy + halfH);
      canvas.closePath();
      canvas.fill();
    }
    canvas.beginPath();
    canvas.moveTo(sx, sy - halfH);
    canvas.lineTo(sx + halfW, sy);
    canvas.lineTo(sx, sy + halfH);
    canvas.lineTo(sx - halfW, sy);
    canvas.closePath();
    canvas.fill();
  }
}
