/**
 * Mouse input on the battlefield: click / double-click / drag-box selection,
 * right-click context command, A+click attack-move, and hand-off to
 * placement modes while one is armed. What a click means lives in
 * world-orders.ts, shared with touch (touch-controller.ts).
 *
 * Orders leave a ground marker and refusals are reported through the
 * command feedback, so the player always sees what a click did.
 *
 * Drag boxes are also tracked through window-level pointer events so a drag
 * released outside the canvas (or over DOM HUD) still completes. Touch
 * pointers never reach this class: Phaser's touch input is off and
 * touch-controller.ts owns them.
 */

import { clearSelection } from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import type { CommandFeedback } from '../commands/feedback';
import type { PlayerCommands } from '../commands/player-commands';
import type { GameAudio } from '../game-audio';
import { entityKindName } from '../hud/selection-info';
import { BUILD_MODE_TO_DEF, type BuildPlacement } from '../placement/build-placement';
import type { SceneContext } from '../scene-context';
import { isInsideMap } from '../world-projection';
import { drawSelectionBox, WorldOrders, type MapOrderKind } from './world-orders';

export type { MapOrderKind } from './world-orders';

const DRAG_THRESHOLD_PX = 6;
const DOUBLE_CLICK_MS = 300;
/** Drag box draws above the world (camera space, not in a world layer). */
export const DRAG_BOX_DEPTH = 20000;

interface Point {
  x: number;
  y: number;
}

export class PointerController {
  readonly orders: WorldOrders;
  private dragStart: Point | null = null;
  private dragCurrent: Point | null = null;
  private isDragging = false;
  private dragGfx!: Phaser.GameObjects.Graphics;
  private lastLeftUnitClick: { eid: number; atMs: number } | null = null;
  private feedback: CommandFeedback | null = null;

  constructor(
    private readonly ctx: SceneContext,
    private readonly deps: {
      commands: PlayerCommands;
      placement: BuildPlacement;
      audio: GameAudio;
      /** Building whose sprite pixels cover a layer-local point (tall art). */
      pickBuilding?: (localX: number, localY: number) => number | null;
    }
  ) {
    this.orders = new WorldOrders(ctx, deps);
  }

  install(): void {
    const scene = this.ctx.scene;
    scene.input.mouse?.disableContextMenu();
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    scene.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    window.addEventListener('pointermove', this.onWindowPointerMove, true);
    window.addEventListener('pointerup', this.onWindowPointerUp, true);
    window.addEventListener('pointercancel', this.onWindowPointerUp, true);
    window.addEventListener('blur', this.onWindowBlur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('pointermove', this.onWindowPointerMove, true);
      window.removeEventListener('pointerup', this.onWindowPointerUp, true);
      window.removeEventListener('pointercancel', this.onWindowPointerUp, true);
      window.removeEventListener('blur', this.onWindowBlur);
    });
    this.dragGfx = scene.add.graphics();
    this.dragGfx.setDepth(DRAG_BOX_DEPTH);
  }

  /** Where order markers go (wired by the UI API). */
  setFeedback(feedback: CommandFeedback): void {
    this.feedback = feedback;
    this.orders.setFeedback(feedback);
  }

  selectAllVillagers(): void {
    const n = this.orders.selectOwnUnits(true);
    setLastEvent(`F1: selected ${n} worker${n === 1 ? '' : 's'}`);
  }

  selectAllMilitary(): void {
    const n = this.orders.selectOwnUnits(false);
    setLastEvent(`F2: selected ${n} unit${n === 1 ? '' : 's'}`);
  }

  /**
   * Move or attack-move the selection to a tile (minimap right-click and the
   * battlefield share this). Returns false when nothing commandable is selected.
   */
  issueMapOrder(kind: MapOrderKind, tx: number, ty: number): boolean {
    return this.orders.issueMapOrder(kind, tx, ty);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const { tx, ty } = this.ctx.pointerTile(pointer);
    const { placement, commands } = this.deps;

    // Refuse an invalid placement up front and keep the build mode armed, so
    // the player sees why and can click somewhere else.
    if (placement.mode !== 'none' && pointer.leftButtonDown()) {
      const failure = commands.placementFailure(BUILD_MODE_TO_DEF[placement.mode], tx, ty);
      if (failure) {
        commands.fail(failure);
        return;
      }
    }
    const wasRallyMode = placement.armyRallyMode;
    if (placement.handlePointerDown(pointer, tx, ty)) {
      if (wasRallyMode && pointer.leftButtonDown() && isInsideMap(tx, ty)) {
        this.feedback?.orderMarker('rally', tx, ty);
        commands.confirm('Army rally point set');
      }
      return;
    }

    if (pointer.rightButtonDown()) {
      this.orders.command(pointer.worldX, pointer.worldY);
    } else if (pointer.leftButtonDown()) {
      this.onLeftClick(pointer, tx, ty);
    }
  }

  private onLeftClick(pointer: Phaser.Input.Pointer, tx: number, ty: number): void {
    // Remember the drag origin in case this becomes a box-select; the single
    // pick below still happens immediately for snappy feedback.
    this.dragStart = { x: pointer.worldX, y: pointer.worldY };
    this.dragCurrent = this.dragStart;
    this.isDragging = false;

    // A held: attack-move to the clicked tile.
    const aKey = this.ctx.scene.input.keyboard?.addKey('A', false);
    if (aKey?.isDown) {
      this.lastLeftUnitClick = null;
      this.cancelDragBox();
      this.issueMapOrder('attackMove', tx, ty);
      return;
    }

    const eid = this.orders.visibleEntityAt(pointer.worldX, pointer.worldY);
    if (eid !== null && this.ctx.isOwnUnit(eid) && this.isDoubleClickOnSameUnit(eid)) {
      const n = this.orders.selectSameKindOnScreen(eid);
      setLastEvent(`double-click: selected ${n} ${entityKindName(this.ctx.world, eid)} unit${n === 1 ? '' : 's'}`);
      return;
    }
    if (eid === null || !this.ctx.isOwnUnit(eid)) this.lastLeftUnitClick = null;
    this.orders.select(pointer.worldX, pointer.worldY);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragStart) return;
    if (!pointer.isDown) {
      this.finishDragAt(this.dragCurrent ?? this.dragStart);
      return;
    }
    this.updateDragBox({ x: pointer.worldX, y: pointer.worldY });
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const { tx, ty } = this.ctx.pointerTile(pointer);
    if (this.deps.placement.handlePointerUp(tx, ty)) return;
    this.finishDragAt({ x: pointer.worldX, y: pointer.worldY });
  }

  private onWindowPointerMove = (ev: PointerEvent): void => {
    if (!this.dragStart || ev.pointerType === 'touch') return;
    const point = this.clientPointerToWorld(ev.clientX, ev.clientY);
    if ((ev.buttons & 1) === 0) {
      this.finishDragAt(point);
      return;
    }
    this.updateDragBox(point);
  };

  private onWindowPointerUp = (ev: PointerEvent): void => {
    if (!this.dragStart || ev.pointerType === 'touch') return;
    this.finishDragAt(this.clientPointerToWorld(ev.clientX, ev.clientY));
  };

  private onWindowBlur = (): void => {
    this.cancelDragBox();
  };

  private clientPointerToWorld(clientX: number, clientY: number): Point {
    const scene = this.ctx.scene;
    const canvas = scene.scale.canvas;
    const rect = canvas.getBoundingClientRect();
    const canvasX = Phaser.Math.Clamp(
      (clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
      0,
      canvas.width
    );
    const canvasY = Phaser.Math.Clamp(
      (clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
      0,
      canvas.height
    );
    const worldPoint = scene.cameras.main.getWorldPoint(canvasX, canvasY);
    return { x: worldPoint.x, y: worldPoint.y };
  }

  private updateDragBox(point: Point): void {
    if (!this.dragStart) return;
    this.dragCurrent = point;
    const dx = point.x - this.dragStart.x;
    const dy = point.y - this.dragStart.y;
    if (!this.isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      this.isDragging = true;
      this.lastLeftUnitClick = null;
      // Past the threshold: box-selecting, so drop the pointer-down pick.
      clearSelection(this.ctx.world);
    }
    if (!this.isDragging) return;
    drawSelectionBox(this.dragGfx, this.dragStart.x, this.dragStart.y, point.x, point.y);
  }

  private finishDragAt(point: Point): void {
    if (!this.dragStart) return;
    this.dragCurrent = point;
    if (this.isDragging) {
      this.orders.selectInWorldBox(
        Math.min(this.dragStart.x, point.x),
        Math.min(this.dragStart.y, point.y),
        Math.max(this.dragStart.x, point.x),
        Math.max(this.dragStart.y, point.y)
      );
    }
    this.cancelDragBox();
  }

  private cancelDragBox(): void {
    this.dragGfx?.clear();
    this.dragStart = null;
    this.dragCurrent = null;
    this.isDragging = false;
  }

  private isDoubleClickOnSameUnit(eid: number): boolean {
    const now = this.ctx.scene.time.now;
    const last = this.lastLeftUnitClick;
    this.lastLeftUnitClick = { eid, atMs: now };
    return last !== null && last.eid === eid && now - last.atMs <= DOUBLE_CLICK_MS;
  }
}
