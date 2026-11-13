/**
 * Main camera: zoom (wheel, +/- keys, anchored on the cursor), WASD panning
 * and "look at" helpers (tile, local town centre).
 */

import { hasComponent } from 'bitecs';
import { Health, Owner, Position, TownCenterTag } from '@sim/components';
import { buildingQuery, unitQuery } from '@sim/world';
import { tileToScreen } from '../iso';
import { isTextEntryActive } from '../input/text-entry';
import type { SceneContext } from '../scene-context';

export const INITIAL_ZOOM = 1.3;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
/** Step for keyboard +/-. */
export const ZOOM_KEY_STEP = 0.1;
/** Wheel-pixel to zoom-delta multiplier. Smaller = gentler. */
const ZOOM_WHEEL_SCALE = 0.0012;
/** Cap on one wheel event's zoom delta, so Mac trackpad swipes (many large
 *  deltaY events) cannot jump the camera. */
const ZOOM_WHEEL_CLAMP = 0.05;
/** WASD pan speed in px per frame. */
const PAN_SPEED = 6;

type PanKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

export class CameraController {
  zoom = INITIAL_ZOOM;

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
   * (anchorWorldX, anchorWorldY) at the same screen position. Clamped.
   */
  applyZoom(delta: number, anchorWorldX?: number, anchorWorldY?: number): void {
    const cam = this.camera;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom + delta));
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
  }

  /** WASD panning; skipped while a text field has focus. */
  update(): void {
    if (isTextEntryActive()) return;
    const keys = this.ctx.scene.input.keyboard?.addKeys('W,A,S,D', false) as PanKeys | undefined;
    if (!keys) return;
    const cam = this.camera;
    if (keys.W.isDown) cam.scrollY -= PAN_SPEED;
    if (keys.S.isDown) cam.scrollY += PAN_SPEED;
    if (keys.A.isDown) cam.scrollX -= PAN_SPEED;
    if (keys.D.isDown) cam.scrollX += PAN_SPEED;
  }

  /** Centre the viewport on tile (tx, ty) (flat projection, no elevation). */
  panToTile(tx: number, ty: number): void {
    const c = tileToScreen(tx, ty);
    const root = this.ctx.layers.root;
    this.camera.centerOn(root.x + c.x, root.y + c.y);
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
