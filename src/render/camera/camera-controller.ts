/**
 * Main camera: zoom (wheel, trackpad pinch, touch pinch, +/- keys), WASD and
 * finger panning, the map clamp, and "look at" helpers (tile, town centre).
 *
 * Zoom rests on the quarter-step levels of zoom-levels.ts and eases between
 * them (time based, so the same at 30 and 144 fps), always around the cursor
 * or pinch centre: the world point under it stays put. Pinches follow the
 * fingers continuously and settle on the nearest level when released. At
 * rest the scroll sits on the level's pixel grid so nothing shimmers.
 */

import { hasComponent } from 'bitecs';
import { Health, Owner, Position, TownCenterTag } from '@sim/components';
import { buildingQuery, unitQuery } from '@sim/world';
import { isTextEntryActive } from '../input/text-entry';
import type { SceneContext } from '../scene-context';
import {
  anchoredScroll,
  clampContinuousZoom,
  easeOutCubic,
  nearestLevel,
  screenToWorld,
  scrollGridFor,
  stepLevel,
  wheelDeltaPx,
  wheelLevels,
} from './zoom-levels';

export const INITIAL_ZOOM = 1.5;
/** Ease between resting levels. */
const ZOOM_ANIM_MS = 160;
/** A trackpad pinch (ctrl + wheel) settles this long after its last event. */
const PINCH_SETTLE_MS = 180;
/** Trackpad pinch: zoom factor per wheel px. */
const PINCH_WHEEL_RATE = 0.01;
/** WASD pan speed in px per frame. */
const PAN_SPEED = 6;

type PanKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

interface Anchor {
  /** Screen point (game canvas px). */
  sx: number;
  sy: number;
  /** World point that stays under it. */
  wx: number;
  wy: number;
}

interface ZoomAnim {
  from: number;
  to: number;
  startMs: number;
  anchor: Anchor;
  /** Screen px the anchor drifts by over the ease, so it ends on the level's grid (no snap jump). */
  shiftX: number;
  shiftY: number;
}

export interface CameraBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CameraController {
  /** Resting level the camera is at or easing toward. */
  targetZoom = INITIAL_ZOOM;
  private current = INITIAL_ZOOM;
  private anim: ZoomAnim | null = null;
  /** A pinch (touch or trackpad) owns the zoom; settles on release. */
  private pinching = false;
  private trackpadPinchAt = -Infinity;
  private lastPinchAnchor: Anchor | null = null;
  private wheelRest = 0;
  /** Smallest discrete wheel event seen (px): this mouse's notch. */
  private wheelNotch = Infinity;
  /** Finger pan or glide in progress: skip the grid snap until it stops. */
  private moving = false;
  /** Sub-grid scroll left over by the snap, so slow pans still move. */
  private restX = 0;
  private restY = 0;

  constructor(
    private readonly ctx: SceneContext,
    /** Layer-local area the view centre must stay inside (the map's ground). */
    private readonly bounds: () => CameraBounds | null = () => null
  ) {}

  private get camera(): Phaser.Cameras.Scene2D.Camera {
    return this.ctx.scene.cameras.main;
  }

  /** Zoom on screen right now (between levels while easing or pinching). */
  get zoom(): number {
    return this.current;
  }

  /** True while the zoom is easing or a pinch is live. */
  get isZooming(): boolean {
    return this.anim !== null || this.pinching;
  }

  /** Apply the initial zoom and hook the mouse wheel. */
  install(): void {
    this.camera.setZoom(this.current);
    this.ctx.scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      const ev = pointer.event as WheelEvent | undefined;
      this.onWheel(pointer.x, pointer.y, dy, ev?.deltaMode ?? 0, ev?.ctrlKey ?? false);
    });
  }

  private onWheel(sx: number, sy: number, deltaY: number, deltaMode: number, ctrlKey: boolean): void {
    const px = wheelDeltaPx(deltaY, deltaMode, window.innerHeight || 800);
    if (ctrlKey) {
      // Trackpad pinch: follow the fingers, settle when the events stop.
      if (!this.pinching) this.beginPinch();
      this.trackpadPinchAt = this.now();
      const a = this.anchorAt(sx, sy);
      this.pinchTo(this.current * Math.exp(-px * PINCH_WHEEL_RATE), a.sx, a.sy, a.wx, a.wy);
      return;
    }
    const { levels, rest, notch } = wheelLevels(this.wheelRest, px, this.wheelNotch);
    this.wheelRest = rest;
    this.wheelNotch = notch;
    if (levels !== 0) this.zoomStep(levels, sx, sy);
  }

  /** Move `steps` resting levels (+ = in), around a screen point (default: the centre). */
  zoomStep(steps: number, sx?: number, sy?: number): void {
    this.zoomTo(stepLevel(this.targetZoom, steps), sx, sy);
  }

  /** Ease to a resting level (snapped to the nearest one). */
  zoomTo(level: number, sx?: number, sy?: number, immediate = false): void {
    const to = nearestLevel(level);
    this.pinching = false;
    this.targetZoom = to;
    const anchor = this.anchorAt(sx ?? this.camera.width / 2, sy ?? this.camera.height / 2);
    // A zoom re-places the view: drop the pan remainder of the old grid.
    this.restX = 0;
    this.restY = 0;
    if (immediate || to === this.current) {
      this.anim = null;
      this.applyZoomValue(to, anchor);
      this.settleScroll();
      return;
    }
    const shift = this.gridShift(to, anchor);
    this.anim = { from: this.current, to, startMs: this.now(), anchor, shiftX: shift.x, shiftY: shift.y };
  }

  /** Screen offset of the anchor once the scroll at `zoom` is rounded onto that level's grid. */
  private gridShift(zoom: number, anchor: Anchor): { x: number; y: number } {
    const cam = this.camera;
    const s = anchoredScroll(anchor.wx, anchor.wy, anchor.sx, anchor.sy, zoom, cam.width, cam.height);
    const grid = scrollGridFor(zoom);
    return { x: (s.x - Math.round(s.x / grid) * grid) * zoom, y: (s.y - Math.round(s.y / grid) * grid) * zoom };
  }

  /**
   * Keyboard / legacy delta API: any delta moves at least one level in its
   * direction (0.25 per level), around the optional world anchor.
   */
  applyZoom(delta: number, anchorWorldX?: number, anchorWorldY?: number): void {
    if (delta === 0) return;
    const steps = Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 0.25));
    if (anchorWorldX === undefined || anchorWorldY === undefined) {
      this.zoomStep(steps);
      return;
    }
    const s = this.worldToScreen(anchorWorldX, anchorWorldY);
    this.zoomStep(steps, s.x, s.y);
  }

  // ── Pinch (touch two-finger, trackpad ctrl + wheel) ───────────────────────

  beginPinch(): void {
    this.anim = null;
    this.restX = 0;
    this.restY = 0;
    this.pinching = true;
    this.trackpadPinchAt = -Infinity;
  }

  /** Continuous zoom with world point (wx, wy) held under screen point (sx, sy). */
  pinchTo(zoom: number, sx: number, sy: number, wx: number, wy: number): void {
    if (!this.pinching) this.beginPinch();
    const anchor = { sx, sy, wx, wy };
    this.lastPinchAnchor = anchor;
    this.applyZoomValue(clampContinuousZoom(zoom), anchor);
  }

  /** Release: ease to the nearest resting level around the last pinch centre. */
  endPinch(): void {
    if (!this.pinching) return;
    this.pinching = false;
    this.trackpadPinchAt = -Infinity;
    const a = this.lastPinchAnchor;
    this.zoomTo(this.current, a?.sx, a?.sy);
  }

  // ── Panning ───────────────────────────────────────────────────────────────

  /** Drag the world by a screen delta (game canvas px), like a finger on a map. */
  panByScreen(dx: number, dy: number): void {
    // While a zoom eases, move its anchor with the finger instead (the ease owns the scroll).
    if (this.anim) {
      this.anim.anchor.sx += dx;
      this.anim.anchor.sy += dy;
      return;
    }
    const cam = this.camera;
    cam.scrollX -= dx / this.current;
    cam.scrollY -= dy / this.current;
    this.clampToBounds();
  }

  /** A finger pan or inertia glide is running (no grid snap until it ends). */
  setMoving(moving: boolean): void {
    if (this.moving === moving) return;
    this.moving = moving;
    if (!moving) this.settleScroll();
  }

  /** World point under a screen point (game canvas px), with the live zoom. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.camera;
    return screenToWorld(sx, sy, cam.scrollX, cam.scrollY, this.current, cam.width, cam.height);
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const cam = this.camera;
    const hx = cam.width / 2;
    const hy = cam.height / 2;
    return { x: (wx - cam.scrollX - hx) * this.current + hx, y: (wy - cam.scrollY - hy) * this.current + hy };
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /** WASD panning (skipped while a text field has focus), zoom easing, clamp, snap. */
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
    const now = this.now();
    if (this.pinching && this.trackpadPinchAt > -Infinity && now - this.trackpadPinchAt > PINCH_SETTLE_MS) {
      this.trackpadPinchAt = -Infinity;
      this.endPinch();
    }
    const anim = this.anim;
    if (anim) {
      const t = (now - anim.startMs) / ZOOM_ANIM_MS;
      const e = t >= 1 ? 1 : easeOutCubic(t);
      const a = anim.anchor;
      const anchor = { sx: a.sx + anim.shiftX * e, sy: a.sy + anim.shiftY * e, wx: a.wx, wy: a.wy };
      if (t >= 1) this.anim = null;
      this.applyZoomValue(t >= 1 ? anim.to : anim.from + (anim.to - anim.from) * e, anchor);
    }
    this.clampToBounds();
    if (!this.isZooming && !this.moving) this.snapScroll();
  }

  private applyZoomValue(zoom: number, anchor: Anchor): void {
    const cam = this.camera;
    this.current = zoom;
    cam.setZoom(zoom);
    const s = anchoredScroll(anchor.wx, anchor.wy, anchor.sx, anchor.sy, zoom, cam.width, cam.height);
    cam.scrollX = s.x;
    cam.scrollY = s.y;
    this.clampToBounds();
  }

  private anchorAt(sx: number, sy: number): Anchor {
    const w = this.screenToWorld(sx, sy);
    return { sx, sy, wx: w.x, wy: w.y };
  }

  private settleScroll(): void {
    this.clampToBounds();
    if (!this.isZooming && !this.moving) this.snapScroll();
  }

  /** Keep the view centre over the map's ground (never more void than the map edge). */
  private clampToBounds(): void {
    const b = this.bounds();
    if (!b || b.width <= 1) return;
    const cam = this.camera;
    const root = this.ctx.layers.root;
    const hx = cam.width / 2;
    const hy = cam.height / 2;
    const minX = b.x + root.x - hx;
    const maxX = b.x + root.x + b.width - hx;
    const minY = b.y + root.y - hy;
    const maxY = b.y + root.y + b.height - hy;
    if (cam.scrollX < minX) cam.scrollX = minX;
    else if (cam.scrollX > maxX) cam.scrollX = maxX;
    if (cam.scrollY < minY) cam.scrollY = minY;
    else if (cam.scrollY > maxY) cam.scrollY = maxY;
  }

  /**
   * Keep the scroll on the level's pixel grid, so every texel keeps its
   * screen size pattern while panning (no shimmer). Sub-grid moves made by
   * other code (drag, centerOn) are kept in a remainder.
   */
  private snapScroll(): void {
    const cam = this.camera;
    const grid = scrollGridFor(this.current);
    const tx = cam.scrollX + this.restX;
    const ty = cam.scrollY + this.restY;
    const sx = Math.round(tx / grid) * grid;
    const sy = Math.round(ty / grid) * grid;
    this.restX = tx - sx;
    this.restY = ty - sy;
    if (cam.scrollX !== sx) cam.scrollX = sx;
    if (cam.scrollY !== sy) cam.scrollY = sy;
  }

  private now(): number {
    return this.ctx.scene.time.now;
  }

  /** Centre the viewport on tile (tx, ty), on top of the terrain there. */
  panToTile(tx: number, ty: number): void {
    const c = this.ctx.localToWorld(this.ctx.tileToScreen(tx, ty));
    this.camera.centerOn(c.x, c.y);
    this.settleScroll();
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
