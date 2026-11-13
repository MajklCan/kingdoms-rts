/**
 * Main camera: zoom (wheel, +/- keys, anchored on the cursor), WASD panning
 * and "look at" helpers (tile, local town centre).
 */

import { hasComponent } from 'bitecs';
import { Health, Owner, Position, TownCenterTag } from '@sim/components';
import { buildingQuery, unitQuery } from '@sim/world';
import { isTextEntryActive } from '../input/text-entry';
import type { SceneContext } from '../scene-context';

/**
 * The art is pixel art at 1x (style A voxels), so the camera only uses zoom
 * levels that scale every texel by a fixed pattern: integer and half steps.
 * `grid` is the world-pixel scroll granularity that keeps that pattern still
 * while panning (zoom p/q needs scroll in multiples of q), so nothing shimmers.
 */
const ZOOM_STEPS: ReadonlyArray<{ zoom: number; grid: number }> = [
  { zoom: 0.5, grid: 2 },
  { zoom: 0.75, grid: 4 },
  { zoom: 1, grid: 1 },
  { zoom: 1.5, grid: 2 },
  { zoom: 2, grid: 1 },
  { zoom: 2.5, grid: 2 },
];
export const INITIAL_ZOOM = 1.5;
/** Step for keyboard +/- (any delta this big moves one zoom level). */
export const ZOOM_KEY_STEP = 0.1;
/** Wheel-pixel to zoom-delta multiplier. Smaller = gentler. */
const ZOOM_WHEEL_SCALE = 0.0012;
/** Cap on one wheel event's zoom delta, so Mac trackpad swipes (many large
 *  deltaY events) cannot jump the camera. */
const ZOOM_WHEEL_CLAMP = 0.05;
/** Accumulated wheel delta that moves one zoom level. */
const ZOOM_WHEEL_NOTCH = 0.12;
/** Minimum time between two wheel-driven level changes (trackpads fire in bursts). */
const ZOOM_WHEEL_COOLDOWN_MS = 140;
/** WASD pan speed in px per frame. */
const PAN_SPEED = 6;

type PanKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

export class CameraController {
  zoom = INITIAL_ZOOM;
  /** Wheel delta not yet spent on a level change. */
  private wheelAcc = 0;
  private lastWheelStep = -Infinity;
  /** Sub-grid scroll left over by the snap, so slow pans still move. */
  private restX = 0;
  private restY = 0;

  constructor(private readonly ctx: SceneContext) {}

  private get camera(): Phaser.Cameras.Scene2D.Camera {
    return this.ctx.scene.cameras.main;
  }

  /** Apply the initial zoom and hook the mouse wheel. */
  install(): void {
    this.camera.setZoom(this.zoom);
    this.ctx.scene.input.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        // Scale then clamp so trackpad pinches feel smooth rather than jumpy.
        let delta = -dy * ZOOM_WHEEL_SCALE;
        if (delta > ZOOM_WHEEL_CLAMP) delta = ZOOM_WHEEL_CLAMP;
        if (delta < -ZOOM_WHEEL_CLAMP) delta = -ZOOM_WHEEL_CLAMP;
        if (Math.abs(delta) < 0.001) return; // ignore micro-events
        this.applyZoom(delta, pointer.worldX, pointer.worldY);
      }
    );
  }

  /**
   * Change zoom by `delta`, optionally keeping the world point under
   * (anchorWorldX, anchorWorldY) at the same screen position. The result
   * snaps to {@link ZOOM_STEPS}: a key-sized delta moves at least one level
   * (toward the nearest level to `zoom + delta`), small wheel deltas
   * accumulate until they add up to a notch.
   */
  applyZoom(delta: number, anchorWorldX?: number, anchorWorldY?: number): void {
    const cam = this.camera;
    const index = nearestStep(this.zoom);
    let target = index;
    if (Math.abs(delta) >= ZOOM_KEY_STEP - 1e-9) {
      this.wheelAcc = 0;
      target = nearestStep(this.zoom + delta);
      if (target === index) target = index + Math.sign(delta);
    } else {
      this.wheelAcc += delta;
      const now = this.ctx.scene.time.now;
      if (Math.abs(this.wheelAcc) < ZOOM_WHEEL_NOTCH || now - this.lastWheelStep < ZOOM_WHEEL_COOLDOWN_MS) return;
      target = index + Math.sign(this.wheelAcc);
      this.wheelAcc = 0;
      this.lastWheelStep = now;
    }
    target = Math.max(0, Math.min(ZOOM_STEPS.length - 1, target));
    const newZoom = ZOOM_STEPS[target].zoom;
    if (newZoom === this.zoom) return;
    if (anchorWorldX !== undefined && anchorWorldY !== undefined) {
      const oldZoom = this.zoom;
      const sxBefore = (anchorWorldX - cam.scrollX) * oldZoom;
      const syBefore = (anchorWorldY - cam.scrollY) * oldZoom;
      cam.setZoom(newZoom);
      this.zoom = newZoom;
      cam.scrollX = anchorWorldX - sxBefore / newZoom;
      cam.scrollY = anchorWorldY - syBefore / newZoom;
    } else {
      cam.setZoom(newZoom);
      this.zoom = newZoom;
    }
    this.snapScroll();
  }

  /** WASD panning (skipped while a text field has focus), then the pixel snap. */
  update(): void {
    const keys = isTextEntryActive()
      ? undefined
      : (this.ctx.scene.input.keyboard?.addKeys('W,A,S,D', false) as PanKeys | undefined);
    const cam = this.camera;
    if (keys) {
      if (keys.W.isDown) cam.scrollY -= PAN_SPEED;
      if (keys.S.isDown) cam.scrollY += PAN_SPEED;
      if (keys.A.isDown) cam.scrollX -= PAN_SPEED;
      if (keys.D.isDown) cam.scrollX += PAN_SPEED;
    }
    this.snapScroll();
  }

  /**
   * Keep the scroll on the zoom level's pixel grid, so every texel keeps its
   * screen size pattern while panning (no shimmer). Sub-grid moves made by
   * other code (drag, edge scroll, centerOn) are kept in a remainder.
   */
  private snapScroll(): void {
    const cam = this.camera;
    const grid = ZOOM_STEPS[nearestStep(this.zoom)].grid;
    const tx = cam.scrollX + this.restX;
    const ty = cam.scrollY + this.restY;
    const sx = Math.round(tx / grid) * grid;
    const sy = Math.round(ty / grid) * grid;
    this.restX = tx - sx;
    this.restY = ty - sy;
    if (cam.scrollX !== sx) cam.scrollX = sx;
    if (cam.scrollY !== sy) cam.scrollY = sy;
  }

  /** Centre the viewport on tile (tx, ty), on top of the terrain there. */
  panToTile(tx: number, ty: number): void {
    const c = this.ctx.localToWorld(this.ctx.tileToScreen(tx, ty));
    this.camera.centerOn(c.x, c.y);
  }

  /**
   * The four tiles under the viewport corners (top-left, top-right,
   * bottom-right, bottom-left), elevation corrected like pointer picking, so
   * the minimap frame matches what is actually on screen.
   */
  viewTileQuad(): Array<{ x: number; y: number }> {
    const view = this.camera.worldView;
    const corners: Array<[number, number]> = [
      [view.x, view.y],
      [view.x + view.width, view.y],
      [view.x + view.width, view.y + view.height],
      [view.x, view.y + view.height],
    ];
    return corners.map(([wx, wy]) => {
      const t = this.ctx.pickTile(wx, wy);
      return { x: t.tileX, y: t.tileY };
    });
  }

  /** Is the camera-world point inside the current viewport? */
  isWorldPointInView(wx: number, wy: number): boolean {
    return this.camera.worldView.contains(wx, wy);
  }

  /** Town centre, else the centroid of own units, else the spawn point. */
  panToLocalTownCenter(): void {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    for (const eid of buildingQuery(world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      if (!hasComponent(world.ecs, TownCenterTag, eid)) continue;
      this.panToTile(Position.x[eid], Position.y[eid]);
      return;
    }
    let unitCount = 0;
    let sumX = 0;
    let sumY = 0;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
      sumX += Position.x[eid];
      sumY += Position.y[eid];
      unitCount++;
    }
    if (unitCount > 0) {
      this.panToTile(sumX / unitCount, sumY / unitCount);
      return;
    }
    const spawn = world.map.spawns[playerId];
    if (spawn) this.panToTile(spawn.x, spawn.y);
  }
}

/** Index of the zoom level closest to `zoom`. */
function nearestStep(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    if (Math.abs(ZOOM_STEPS[i].zoom - zoom) < Math.abs(ZOOM_STEPS[best].zoom - zoom)) best = i;
  }
  return best;
}
