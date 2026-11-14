/**
 * Touch on the battlefield: the Phaser wiring around gesture-recognizer.ts.
 * Finger (and pen) pointer events on the canvas go through the recognizer;
 * mouse pointers are left to pointer-controller.ts. Every order goes through
 * the same WorldOrders / BuildPlacement calls a mouse click makes, so the sim
 * receives identical inputs (lockstep safe).
 *
 *   tap                select own unit, else context command (as right click)
 *   double tap unit    every unit of that kind on screen
 *   long press         select whatever is there (as left click), ring shows when armed
 *   long press + drag  selection box
 *   drag               pan the camera, with a little inertia
 *   two fingers        pinch zoom around the fingers + two finger pan
 *   placement armed    a finger drags the ghost; Confirm / Cancel live in the HUD
 *
 * preventDefault on pointerdown stops the browser's emulated mouse events,
 * so a tap never fires twice.
 */

import { setLastEvent } from '../../debug/overlay';
import type { CameraController } from '../camera/camera-controller';
import type { CommandFeedback } from '../commands/feedback';
import type { PlayerCommands } from '../commands/player-commands';
import type { BuildPlacement } from '../placement/build-placement';
import type { SceneContext } from '../scene-context';
import { isInsideMap } from '../world-projection';
import { GestureRecognizer, type GestureEvent } from './gesture-recognizer';
import { isTouchUi } from './input-mode';
import { DRAG_BOX_DEPTH } from './pointer-controller';
import { drawSelectionBox, type WorldOrders } from './world-orders';

/** Glide decay time constant after a flick (ms). */
const INERTIA_TAU_MS = 220;
/** Glide stops below this speed (game px per ms). */
const INERTIA_MIN_SPEED = 0.02;
/** Fastest glide start (game px per ms), so a wild flick cannot fling the map away. */
const INERTIA_MAX_SPEED = 4;
/** The long-press ring only appears after this, so quick taps never flash it. */
const RING_DELAY_MS = 110;
const RING_RADIUS = 30;

interface Point {
  x: number;
  y: number;
}

export interface TouchControllerDeps {
  camera: CameraController;
  orders: WorldOrders;
  placement: BuildPlacement;
  commands: PlayerCommands;
}

export class TouchController {
  private readonly gestures = new GestureRecognizer();
  private gfx!: Phaser.GameObjects.Graphics;
  private feedback: CommandFeedback | null = null;
  private pressTimer = 0;
  /** Long press ring: where and since when (client time), and whether it armed. */
  private ring: { at: Point; since: number; armed: boolean } | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private pinch: { zoom0: number; world: Point } | null = null;
  /** A finger drag moves the build ghost instead of the camera. */
  private ghostDrag: { wallStart: { x: number; y: number } | null } | null = null;
  private velocity: Point | null = null;
  private panning = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly deps: TouchControllerDeps
  ) {}

  install(): void {
    const scene = this.ctx.scene;
    const canvas = scene.scale.canvas;
    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('lostpointercapture', this.onCancel);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      canvas.removeEventListener('pointerdown', this.onDown);
      canvas.removeEventListener('pointermove', this.onMove);
      canvas.removeEventListener('pointerup', this.onUp);
      canvas.removeEventListener('pointercancel', this.onCancel);
      canvas.removeEventListener('lostpointercapture', this.onCancel);
    });
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(DRAG_BOX_DEPTH + 1);
  }

  setFeedback(feedback: CommandFeedback): void {
    this.feedback = feedback;
  }

  /** Finger state for the HUD and tests. */
  get state(): { gesture: string; fingers: number; gliding: boolean } {
    return { gesture: this.gestures.activeState, fingers: this.gestures.fingerCount, gliding: this.velocity !== null };
  }

  /** Per frame: placement flow, inertia glide, long-press ring and box. */
  update(deltaMs: number): void {
    this.deps.placement.confirmFlow = isTouchUi();
    this.glide(deltaMs);
    this.drawOverlay();
  }

  // ── DOM pointer events ───────────────────────────────────────────────────

  private isFinger(ev: PointerEvent): boolean {
    return ev.pointerType === 'touch' || ev.pointerType === 'pen';
  }

  private onDown = (ev: PointerEvent): void => {
    if (!this.isFinger(ev)) return;
    ev.preventDefault();
    try {
      this.ctx.scene.scale.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // Capture is best effort (the pointer may already be gone).
    }
    this.stopGlide();
    this.handle(this.gestures.down(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp));
    const due = this.gestures.longPressDueAt;
    if (due !== null) {
      this.ring = { at: { x: ev.clientX, y: ev.clientY }, since: ev.timeStamp, armed: false };
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => this.handle(this.gestures.poll(performance.now())), Math.max(0, due - ev.timeStamp) + 5);
    } else {
      this.ring = null;
    }
  };

  private onMove = (ev: PointerEvent): void => {
    if (!this.isFinger(ev)) return;
    ev.preventDefault();
    this.handle(this.gestures.move(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp));
  };

  private onUp = (ev: PointerEvent): void => {
    if (!this.isFinger(ev)) return;
    this.handle(this.gestures.up(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp));
    if (this.gestures.fingerCount === 0) this.endPress();
  };

  private onCancel = (ev: PointerEvent): void => {
    if (!this.isFinger(ev)) return;
    this.handle(this.gestures.cancel(ev.pointerId, ev.timeStamp));
    if (this.gestures.fingerCount === 0) this.endPress();
  };

  private endPress(): void {
    window.clearTimeout(this.pressTimer);
    this.ring = null;
  }

  // ── Gestures ─────────────────────────────────────────────────────────────

  private handle(events: GestureEvent[]): void {
    for (const e of events) this.apply(e);
  }

  private apply(e: GestureEvent): void {
    const placing = this.placementActive();
    switch (e.type) {
      case 'tap':
        this.ring = null;
        if (placing) {
          this.placeAt(e.x, e.y, false);
          return;
        }
        {
          const w = this.toWorld(e.x, e.y);
          this.deps.orders.tap(w.x, w.y, e.count);
        }
        return;
      case 'pressArmed':
        if (this.ring) this.ring.armed = true;
        navigator.vibrate?.(12);
        return;
      case 'press': {
        this.ring = null;
        if (placing) {
          this.placeAt(e.x, e.y, false);
          return;
        }
        const w = this.toWorld(e.x, e.y);
        this.deps.orders.select(w.x, w.y);
        return;
      }
      case 'pressCancel':
        this.ring = null;
        return;
      case 'panStart':
      case 'boxStart':
        this.ring = null;
        if (this.ghostFlow()) {
          const t = this.tileAt(e.x, e.y);
          this.ghostDrag = { wallStart: t };
          this.placeAt(e.x, e.y, true);
          return;
        }
        if (e.type === 'boxStart') {
          this.box = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
          return;
        }
        this.panning = true;
        this.deps.camera.setMoving(true);
        return;
      case 'pan':
        if (this.ghostDrag) this.placeAt(e.x, e.y, true);
        else if (this.panning) this.panBy(e.dx, e.dy);
        return;
      case 'box':
        if (this.ghostDrag) this.placeAt(e.x1, e.y1, true);
        else if (this.box) this.box = { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 };
        return;
      case 'panEnd':
        if (this.ghostDrag) {
          this.ghostDrag = null;
          return;
        }
        this.panning = false;
        this.startGlide(e.vx, e.vy);
        return;
      case 'boxEnd':
        if (this.ghostDrag) {
          this.ghostDrag = null;
          return;
        }
        this.finishBox(e.x0, e.y0, e.x1, e.y1);
        return;
      case 'boxCancel':
        this.box = null;
        this.ghostDrag = null;
        return;
      case 'pinchStart': {
        this.ring = null;
        this.ghostDrag = null;
        this.stopGlide();
        const c = this.toGame(e.cx, e.cy);
        this.pinch = { zoom0: this.deps.camera.zoom, world: this.deps.camera.screenToWorld(c.x, c.y) };
        this.deps.camera.beginPinch();
        return;
      }
      case 'pinch': {
        if (!this.pinch) return;
        const c = this.toGame(e.cx, e.cy);
        this.deps.camera.pinchTo(this.pinch.zoom0 * e.scale, c.x, c.y, this.pinch.world.x, this.pinch.world.y);
        return;
      }
      case 'pinchEnd':
        this.pinch = null;
        this.deps.camera.endPinch();
        return;
    }
  }

  private placementActive(): boolean {
    const p = this.deps.placement;
    return p.mode !== 'none' || p.armyRallyMode;
  }

  /** Dragging moves the ghost only for buildings and walls in the confirm flow. */
  private ghostFlow(): boolean {
    const p = this.deps.placement;
    return p.confirmFlow && p.mode !== 'none';
  }

  /** A tap or drag in a placement mode. `drag`: the finger is moving the ghost. */
  private placeAt(clientX: number, clientY: number, drag: boolean): void {
    const { placement, commands } = this.deps;
    const tile = this.tileAt(clientX, clientY);
    if (!tile) return;
    if (placement.armyRallyMode) {
      if (drag) return;
      const wasRally = placement.armyRallyMode;
      placement.rallyAt(tile.x, tile.y);
      if (wasRally && isInsideMap(tile.x, tile.y)) {
        this.feedback?.orderMarker('rally', tile.x, tile.y);
        commands.confirm('Army rally point set');
      }
      return;
    }
    if (!placement.confirmFlow) {
      if (!drag) placement.clickPlace(tile.x, tile.y);
      return;
    }
    const wallStart = drag ? this.ghostDrag?.wallStart ?? undefined : undefined;
    placement.setTouchGhost(tile.x, tile.y, wallStart);
    if (!drag) setLastEvent(`ghost at (${tile.x},${tile.y})`);
  }

  private finishBox(x0: number, y0: number, x1: number, y1: number): void {
    this.box = null;
    const a = this.toWorld(x0, y0);
    const b = this.toWorld(x1, y1);
    this.deps.orders.selectInWorldBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  }

  // ── Camera glide ─────────────────────────────────────────────────────────

  private panBy(dxClient: number, dyClient: number): void {
    const k = this.clientToGameScale();
    this.deps.camera.panByScreen(dxClient * k, dyClient * k);
  }

  private startGlide(vxClient: number, vyClient: number): void {
    const k = this.clientToGameScale();
    let vx = vxClient * k;
    let vy = vyClient * k;
    const speed = Math.hypot(vx, vy);
    if (speed < INERTIA_MIN_SPEED * 3) {
      this.stopGlide();
      return;
    }
    if (speed > INERTIA_MAX_SPEED) {
      vx *= INERTIA_MAX_SPEED / speed;
      vy *= INERTIA_MAX_SPEED / speed;
    }
    this.velocity = { x: vx, y: vy };
  }

  private glide(deltaMs: number): void {
    const v = this.velocity;
    if (!v) return;
    const dt = Math.min(50, Math.max(0, deltaMs));
    this.deps.camera.panByScreen(v.x * dt, v.y * dt);
    const decay = Math.exp(-dt / INERTIA_TAU_MS);
    v.x *= decay;
    v.y *= decay;
    if (Math.hypot(v.x, v.y) < INERTIA_MIN_SPEED) this.stopGlide();
  }

  private stopGlide(): void {
    this.velocity = null;
    if (!this.panning) this.deps.camera.setMoving(false);
  }

  // ── Overlay (long-press ring, box) ───────────────────────────────────────

  private drawOverlay(): void {
    const g = this.gfx;
    if (!g) return;
    g.clear();
    if (this.box) {
      const a = this.toWorld(this.box.x0, this.box.y0);
      const b = this.toWorld(this.box.x1, this.box.y1);
      drawSelectionBox(g, a.x, a.y, b.x, b.y);
    }
    const ring = this.ring;
    if (!ring || this.gestures.fingerCount !== 1) return;
    const age = performance.now() - ring.since;
    if (!ring.armed && age < RING_DELAY_MS) return;
    const c = this.toWorld(ring.at.x, ring.at.y);
    const r = RING_RADIUS / this.deps.camera.zoom;
    const lw = 3 / this.deps.camera.zoom;
    if (ring.armed) {
      // Armed: a solid gold ring with a soft fill, the box can be dragged now.
      g.fillStyle(0xfeca57, 0.18);
      g.fillCircle(c.x, c.y, r);
      g.lineStyle(lw * 1.4, 0xfeca57, 1);
      g.strokeCircle(c.x, c.y, r);
      return;
    }
    // Charging: the ring sweeps clockwise from the top while the finger holds still.
    const total = 350 - RING_DELAY_MS;
    const p = Math.min(1, (age - RING_DELAY_MS) / total);
    g.lineStyle(lw, 0x000000, 0.35);
    g.strokeCircle(c.x, c.y, r);
    g.lineStyle(lw, 0xfbefc4, 0.95);
    g.beginPath();
    g.arc(c.x, c.y, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, false);
    g.strokePath();
  }

  // ── Coordinates ──────────────────────────────────────────────────────────

  /** Game canvas px per CSS px (the canvas is scaled to fit the window). */
  private clientToGameScale(): number {
    const scale = this.ctx.scene.scale;
    const rect = scale.canvas.getBoundingClientRect();
    return scale.width / Math.max(1, rect.width);
  }

  private toGame(clientX: number, clientY: number): Point {
    const rect = this.ctx.scene.scale.canvas.getBoundingClientRect();
    const k = this.clientToGameScale();
    return { x: (clientX - rect.left) * k, y: (clientY - rect.top) * k };
  }

  private toWorld(clientX: number, clientY: number): Point {
    const p = this.toGame(clientX, clientY);
    return this.deps.camera.screenToWorld(p.x, p.y);
  }

  private tileAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const w = this.toWorld(clientX, clientY);
    const { tx, ty } = this.ctx.pickTile(w.x, w.y);
    return isInsideMap(tx, ty) ? { x: tx, y: ty } : null;
  }
}
