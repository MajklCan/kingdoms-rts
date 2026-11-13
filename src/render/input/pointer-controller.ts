/**
 * Mouse input on the battlefield: click / double-click / drag-box selection,
 * right-click context command (attack > army rally > resource hint > move),
 * A+click attack-move, and hand-off to placement modes while one is armed.
 *
 * Orders leave a ground marker and refusals are reported through the
 * command feedback, so the player always sees what a click did.
 *
 * Drag boxes are also tracked through window-level pointer events so a drag
 * released outside the canvas (or over DOM HUD) still completes.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  DeadTag,
  Health,
  Owner,
  Position,
  Resource,
  ResourceKindId,
  UnitKind,
  WorksiteWorker,
} from '@sim/components';
import {
  clearSelection,
  findEntityNear,
  findResourceAt,
  isEnemyOf,
  selectedQuery,
  setSelected,
  unitQuery,
} from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import { isArmyProducerDefId } from '../commands/economy';
import type { CommandFeedback } from '../commands/feedback';
import type { PlayerCommands } from '../commands/player-commands';
import type { GameAudio } from '../game-audio';
import { entityKindName, resourceKindName } from '../hud/selection-info';
import { BUILD_MODE_TO_DEF, type BuildPlacement } from '../placement/build-placement';
import type { SceneContext } from '../scene-context';
import { isInsideMap } from '../world-projection';

const DRAG_THRESHOLD_PX = 6;
const DOUBLE_CLICK_MS = 300;
/** Drag box draws above the world (camera space, not in a world layer). */
const DRAG_BOX_DEPTH = 20000;

interface Point {
  x: number;
  y: number;
}

export type MapOrderKind = 'move' | 'attackMove';

export class PointerController {
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
  ) {}

  /**
   * Entity under the pointer: the sim's tile pick, except that a building
   * drawn over that point (a roof or tower top over a tile further back) wins
   * against another building, and fills in when the tile pick finds nothing.
   */
  private pickEntity(pointer: Phaser.Input.Pointer, tileX: number, tileY: number): number | null {
    const world = this.ctx.world;
    const picked = findEntityNear(world, tileX, tileY, 0.7);
    const root = this.ctx.layers.root;
    const drawn = this.deps.pickBuilding?.(pointer.worldX - root.x, pointer.worldY - root.y) ?? null;
    if (drawn === null) return picked;
    if (picked === null || (picked !== drawn && hasComponent(world.ecs, Building, picked))) return drawn;
    return picked;
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
  }

  selectAllVillagers(): void {
    const n = this.selectOwnUnits(true);
    setLastEvent(`F1: selected ${n} worker${n === 1 ? '' : 's'}`);
  }

  selectAllMilitary(): void {
    const n = this.selectOwnUnits(false);
    setLastEvent(`F2: selected ${n} unit${n === 1 ? '' : 's'}`);
  }

  /**
   * Move or attack-move the selection to a tile (minimap right-click and the
   * battlefield share this). Returns false when nothing commandable is selected.
   */
  issueMapOrder(kind: MapOrderKind, tx: number, ty: number): boolean {
    const { commands, audio } = this.deps;
    if (!isInsideMap(tx, ty)) return false;
    if (commands.selectedCommandableCount() === 0) return false;
    if (kind === 'attackMove') {
      commands.dispatch({ type: 'attackMoveSelected', to: { x: tx, y: ty } });
      audio.barkAttack();
      this.feedback?.orderMarker('attack-move', tx, ty);
    } else {
      commands.dispatch({ type: 'moveSelected', to: { x: tx, y: ty } });
      audio.barkMove();
      this.feedback?.orderMarker('move', tx, ty);
    }
    setLastEvent(`${kind} -> (${tx},${ty})`);
    return true;
  }

  private selectOwnUnits(villagers: boolean): number {
    const world = this.ctx.world;
    clearSelection(world);
    let n = 0;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      if (this.ctx.isVillager(eid) !== villagers) continue;
      setSelected(world, eid, true);
      n++;
    }
    return n;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const { tx, ty, tileX, tileY } = this.ctx.pointerTile(pointer);
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
      this.onRightClick(pointer, tx, ty, tileX, tileY);
    } else if (pointer.leftButtonDown()) {
      this.onLeftClick(pointer, tx, ty, tileX, tileY);
    }
  }

  /** Priority: visible enemy -> attack; only army buildings selected -> rally;
   *  explored resource -> hint; else move. */
  private onRightClick(pointer: Phaser.Input.Pointer, tx: number, ty: number, tileX: number, tileY: number): void {
    const world = this.ctx.world;
    const { commands, audio } = this.deps;
    if (!isInsideMap(tx, ty)) return;
    const hasUnits = commands.selectedCommandableCount() > 0;
    const targetEid = this.pickEntity(pointer, tileX, tileY);
    if (
      hasUnits &&
      targetEid !== null &&
      this.ctx.isEntityVisible(targetEid) &&
      isEnemyOf(world, targetEid, this.ctx.perspectivePlayerId)
    ) {
      commands.dispatch({ type: 'attackSelected', targetEid });
      audio.barkAttack();
      this.feedback?.orderMarker('attack', Position.x[targetEid], Position.y[targetEid]);
      setLastEvent(`attack eid=${targetEid}`);
      return;
    }
    if (!hasUnits) {
      if (this.selectionIsOwnArmyProducers()) {
        commands.dispatch({ type: 'setArmyRallyPoint', playerId: this.ctx.perspectivePlayerId, x: tx, y: ty });
        this.feedback?.orderMarker('rally', tx, ty);
        commands.confirm('Army rally point set');
      }
      return;
    }
    const resourceEid = findResourceAt(world, tileX, tileY, 0.7);
    if (resourceEid !== null && this.ctx.isResourceExplored(resourceEid)) {
      const kind = Resource.kind[resourceEid];
      commands.fail({
        reason: 'unavailable',
        text:
          kind === ResourceKindId.FOOD
            ? 'Food comes from farms'
            : `${capitalize(resourceKindName(kind))} is harvested by a nearby worksite`,
      });
      return;
    }
    this.issueMapOrder('move', tx, ty);
  }

  private onLeftClick(
    pointer: Phaser.Input.Pointer,
    tx: number,
    ty: number,
    tileX: number,
    tileY: number
  ): void {
    const world = this.ctx.world;
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

    const picked = this.pickEntity(pointer, tileX, tileY);
    const eid = picked !== null && this.ctx.isEntityVisible(picked) ? picked : null;
    if (eid !== null && this.ctx.isOwnUnit(eid) && this.isDoubleClickOnSameUnit(eid)) {
      const n = this.selectSameKindOnScreen(eid);
      setLastEvent(`double-click: selected ${n} ${entityKindName(world, eid)} unit${n === 1 ? '' : 's'}`);
      return;
    }

    if (eid === null || !this.ctx.isOwnUnit(eid)) this.lastLeftUnitClick = null;
    clearSelection(world);
    if (eid !== null) {
      setSelected(world, eid, true);
      if (this.ctx.isOwnUnit(eid)) this.deps.audio.barkSelect(eid);
      setLastEvent(`selected ${entityKindName(world, eid)} eid=${eid}`);
    } else {
      setLastEvent(`cleared selection`);
    }
  }

  /** Double-click: every own unit of the clicked unit's type that is on screen. */
  private selectSameKindOnScreen(sourceEid: number): number {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    const kind = UnitKind.kind[sourceEid];
    const view = this.ctx.scene.cameras.main.worldView;
    clearSelection(world);
    let n = 0;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      if (UnitKind.kind[eid] !== kind) continue;
      if (!isAliveUnit(world.ecs, eid)) continue;
      const s = this.ctx.localToWorld(this.ctx.tileToScreen(Position.x[eid], Position.y[eid]));
      if (eid !== sourceEid && !view.contains(s.x, s.y)) continue;
      setSelected(world, eid, true);
      n++;
    }
    this.deps.audio.barkSelect(sourceEid);
    return n;
  }

  /** Selection is non-empty and only our own barracks / stables / foundries. */
  private selectionIsOwnArmyProducers(): boolean {
    const world = this.ctx.world;
    const selected = selectedQuery(world.ecs);
    if (selected.length === 0) return false;
    for (const eid of selected) {
      if (!hasComponent(world.ecs, Building, eid)) return false;
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) return false;
      if (!isArmyProducerDefId(Building.defId[eid])) return false;
    }
    return true;
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
    this.finishDragAt({ x: pointer.worldX, y: pointer.worldY });
  }

  private onWindowPointerMove = (ev: PointerEvent): void => {
    if (!this.dragStart) return;
    const point = this.clientPointerToWorld(ev.clientX, ev.clientY);
    if ((ev.buttons & 1) === 0) {
      this.finishDragAt(point);
      return;
    }
    this.updateDragBox(point);
  };

  private onWindowPointerUp = (ev: PointerEvent): void => {
    if (!this.dragStart) return;
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
    const x = Math.min(this.dragStart.x, point.x);
    const y = Math.min(this.dragStart.y, point.y);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    const g = this.dragGfx;
    g.clear();
    g.lineStyle(2, 0xfeca57, 1);
    g.strokeRect(x, y, w, h);
    g.fillStyle(0xfeca57, 0.12);
    g.fillRect(x, y, w, h);
  }

  private finishDragAt(point: Point): void {
    if (!this.dragStart) return;
    this.dragCurrent = point;
    if (this.isDragging) {
      this.selectUnitsInWorldBox(
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

  /** Select own units whose sprite anchor lies inside the camera-world box. */
  private selectUnitsInWorldBox(x0: number, y0: number, x1: number, y1: number): void {
    const world = this.ctx.world;
    clearSelection(world);
    let n = 0;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      const s = this.ctx.localToWorld(this.ctx.tileToScreen(Position.x[eid], Position.y[eid]));
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) {
        setSelected(world, eid, true);
        n++;
      }
    }
    const rep = this.deps.audio.representativeSelectedUnit();
    if (rep !== null) this.deps.audio.barkSelect(rep);
    setLastEvent(`box-selected ${n} unit${n === 1 ? '' : 's'}`);
  }

  private isDoubleClickOnSameUnit(eid: number): boolean {
    const now = this.ctx.scene.time.now;
    const last = this.lastLeftUnitClick;
    this.lastLeftUnitClick = { eid, atMs: now };
    return last !== null && last.eid === eid && now - last.atMs <= DOUBLE_CLICK_MS;
  }
}

function isAliveUnit(ecs: Parameters<typeof hasComponent>[0], eid: number): boolean {
  if (hasComponent(ecs, DeadTag, eid)) return false;
  if (hasComponent(ecs, WorksiteWorker, eid)) return false;
  return !hasComponent(ecs, Health, eid) || Health.hp[eid] > 0;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
