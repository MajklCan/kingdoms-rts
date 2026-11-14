/**
 * The typed surface the DOM UI (src/ui/game-bridge.ts) talks to. Everything
 * the HUD needs from the running game lives here, so the UI never feature
 * detects scene methods or reads debug text:
 *
 *   selection     selectEntities / getSelectedEids / getIdleVillagers
 *   production    getProductionQueue / cancelProduction (per slot, refunded)
 *   camera        getCameraTileQuad (elevation corrected) / panToTile
 *   orders        issueMapOrder (minimap right-click), reportFailure
 *   alerts        drainUiAlerts / onGameMessage (typed event subscription)
 *   match         getMatchStats (exact, from sim counters) / endMatch
 *   input         setKeyboardEnabled, pointerHoverKind (HUD cursor)
 *   touch HUD     deselect, select all villagers / army, attack-move,
 *                 zoomStep, placement Confirm / Cancel
 *
 * Built once by GameScene.create(); it pumps the alert feed after every
 * scene update, so the UI only has to drain.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../config';
import {
  Building,
  ConstructionSite,
  DeadTag,
  Health,
  Owner,
  Position,
  Producer,
  Resource,
  ResourceKindId,
  UnitKind,
  UnitKindId,
} from '@sim/components';
import { UNIT_TABLE, getAgeDef, type CostTuple } from '@sim/defs';
import {
  clearSelection,
  clonePlayerStats,
  emptyPlayerStats,
  findEntityNear,
  findIdleVillagers,
  findResourceAt,
  isEnemyOf,
  selectedQuery,
  setSelected,
  type PlayerMatchStats,
} from '@sim/world';
import type { CameraController } from './camera/camera-controller';
import { isArmyProducerDefId } from './commands/economy';
import { CommandFeedback, type CommandFailure } from './commands/feedback';
import type { PlayerCommands } from './commands/player-commands';
import type { EffectsLayer } from './effects/effects-layer';
import { ORDER_MARKER_EFFECT, orderMarkerEffect } from './effects/order-marker';
import { RALLY_FLAG_EFFECT, rallyFlagEffect } from './effects/rally-flag';
import type { GameAudio } from './game-audio';
import type { MinimapAlerts } from './hud/minimap-data';
import { RallyDisplay } from './hud/rally-display';
import {
  UiAlertFeed,
  type GameMessageListener,
  type TilePoint,
  type UiAlert,
} from './hud/ui-alerts';
import type { GameScene } from './game-scene';
import type { MapOrderKind, PointerController } from './input/pointer-controller';
import type { TouchController } from './input/touch-controller';
import { BUILD_MODE_TO_DEF, type BuildPlacement, type TouchPlacementState } from './placement/build-placement';
import type { SceneContext } from './scene-context';

export type { GameMessage, GameMessageListener, GameMessageTone, TilePoint, UiAlert, UiAlertKind } from './hud/ui-alerts';
export type { CommandFailure, ResourceName } from './commands/feedback';
export type { MapOrderKind } from './input/pointer-controller';
export type { TouchPlacementState } from './placement/build-placement';

/** Cursor intent for the battlefield tile under the pointer (see pointerHoverKind). */
export type PointerHoverKind =
  | 'default'
  | 'attack'
  | 'gather-wood'
  | 'gather-mine'
  | 'gather-food'
  | 'build'
  | 'rally'
  | 'forbidden';

export interface ProductionSlotInfo {
  /** Queue index; 0 is the unit in training. */
  slot: number;
  unitDefId: number;
  name: string;
  /** 0..1 for slot 0, 0 for the rest. */
  progressFrac: number;
  /** Refunded in full when the slot is cancelled. */
  cost: CostTuple;
}

export interface CameraTileQuad {
  /** Tile-space corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [TilePoint, TilePoint, TilePoint, TilePoint];
}

export interface MatchStatsView extends PlayerMatchStats {
  playerId: number;
  /** Sim time played (ticks / tick rate); freezes when the match is decided. */
  seconds: number;
  ageName: string;
}

export interface UiApiDeps {
  camera: CameraController;
  commands: PlayerCommands;
  pointer: PointerController;
  touch: TouchController;
  placement: BuildPlacement;
  alerts: MinimapAlerts;
  effects: EffectsLayer;
  audio: GameAudio;
  /** Tear the match down and leave the scene idle behind the menu. */
  endMatch: () => void;
}

export class UiApi {
  private readonly feed: UiAlertFeed;
  private readonly feedback: CommandFeedback;
  private readonly rally: RallyDisplay;

  constructor(
    private readonly ctx: SceneContext,
    private readonly deps: UiApiDeps
  ) {
    deps.effects.register(ORDER_MARKER_EFFECT, orderMarkerEffect);
    deps.effects.register(RALLY_FLAG_EFFECT, rallyFlagEffect);
    this.feedback = new CommandFeedback(deps.effects, deps.audio);
    deps.commands.setFeedback(this.feedback);
    deps.pointer.setFeedback(this.feedback);
    deps.touch.setFeedback(this.feedback);
    this.feed = new UiAlertFeed(ctx, { alerts: deps.alerts, feedback: this.feedback });
    this.rally = new RallyDisplay(ctx, deps.effects);
    ctx.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.feed.pump();
      this.rally.update();
    });
  }

  /** The scene is running and owns a world. */
  isReady(): boolean {
    return this.ctx.scene.sys.isActive();
  }

  get perspectivePlayerId(): number {
    return this.ctx.perspectivePlayerId;
  }

  /** New, loaded or ended match: drop queued alerts and notices. */
  reset(): void {
    this.feed.reset();
    this.feedback.clear();
    this.rally.reset();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  /** Select living, visible entities (replacing the selection unless additive). */
  selectEntities(eids: readonly number[], additive = false): void {
    const world = this.ctx.world;
    if (!additive) clearSelection(world);
    for (const eid of eids) {
      if (!this.isAlive(eid)) continue;
      if (!this.ctx.isEntityVisible(eid)) continue;
      setSelected(world, eid, true);
    }
  }

  getSelectedEids(): number[] {
    return Array.from(selectedQuery(this.ctx.world.ecs));
  }

  getIdleVillagers(playerId = this.ctx.perspectivePlayerId): number[] {
    return findIdleVillagers(this.ctx.world, playerId);
  }

  // ── Production ────────────────────────────────────────────────────────────

  getProductionQueue(producerEid: number): ProductionSlotInfo[] {
    const world = this.ctx.world;
    if (!hasComponent(world.ecs, Producer, producerEid)) return [];
    const queue = world.productionQueues.get(producerEid) ?? [];
    return queue.map((unitDefId, slot) => {
      const def = UNIT_TABLE[unitDefId];
      const total = def?.trainTimeTicks ?? 0;
      const progressFrac =
        slot === 0 && total > 0 ? Math.max(0, Math.min(1, Producer.currentProgress[producerEid] / total)) : 0;
      return {
        slot,
        unitDefId,
        name: def?.name ?? 'Unit',
        progressFrac,
        cost: def ? { ...def.cost } : { food: 0, wood: 0, gold: 0, stone: 0 },
      };
    });
  }

  /** Cancel one queue slot (default: the last one); the cost is refunded. */
  cancelProduction(producerEid: number, slot?: number): boolean {
    return this.deps.commands.cancelProduction(producerEid, slot);
  }

  // ── Camera and orders ─────────────────────────────────────────────────────

  getCameraTileQuad(): CameraTileQuad {
    const [a, b, c, d] = this.deps.camera.viewTileQuad();
    const zero = { x: 0, y: 0 };
    return { corners: [a ?? zero, b ?? zero, c ?? zero, d ?? zero] };
  }

  panToTile(x: number, y: number): void {
    this.deps.camera.panToTile(x, y);
  }

  /** Move / attack-move the selection to a tile, with an order marker. */
  issueMapOrder(kind: MapOrderKind, x: number, y: number): boolean {
    return this.deps.pointer.issueMapOrder(kind, Math.round(x), Math.round(y));
  }

  /** A UI control refused an action (disabled button): sound + typed alert. */
  reportFailure(failure: CommandFailure): void {
    this.deps.commands.fail(failure);
  }

  // ── Alerts and messages ───────────────────────────────────────────────────

  drainUiAlerts(): UiAlert[] {
    return this.feed.drain();
  }

  /** Player-facing event log lines. Returns an unsubscribe function. */
  onGameMessage(listener: GameMessageListener): () => void {
    return this.feed.subscribe(listener);
  }

  /** Where the latest fight against us is, following it as it moves. */
  lastFightPosition(): TilePoint | null {
    return this.feed.lastFightPosition();
  }

  // ── Match ─────────────────────────────────────────────────────────────────

  getMatchStats(playerId = this.ctx.perspectivePlayerId): MatchStatsView {
    const world = this.ctx.world;
    const stats = world.matchStats[playerId];
    const age = world.ages[playerId];
    return {
      ...(stats ? clonePlayerStats(stats) : emptyPlayerStats()),
      playerId,
      seconds: world.tick / SIM.TICK_HZ,
      ageName: getAgeDef(age?.current ?? 0)?.name ?? 'Dark Age',
    };
  }

  /** Leave the match (multiplayer: leave the session) and idle behind the menu. */
  endMatch(): void {
    this.deps.endMatch();
    this.reset();
  }

  // ── Touch HUD (buttons for what only has a hotkey) ────────────────────────

  deselect(): void {
    this.deps.pointer.orders.deselect();
  }

  selectAllVillagers(): void {
    this.deps.pointer.selectAllVillagers();
  }

  selectAllMilitary(): void {
    this.deps.pointer.selectAllMilitary();
  }

  /** Arm (or disarm) attack-move: the next tap on the map attack-moves there. */
  toggleAttackMove(): boolean {
    const orders = this.deps.pointer.orders;
    if (orders.attackMoveArmed) {
      orders.attackMoveArmed = false;
      return false;
    }
    if (this.deps.commands.selectedCommandableCount() === 0) {
      this.deps.commands.fail({ reason: 'unavailable', text: 'Select units to attack-move' });
      return false;
    }
    orders.attackMoveArmed = true;
    this.deps.commands.confirm('Tap the map to attack-move');
    return true;
  }

  isAttackMoveArmed(): boolean {
    return this.deps.pointer.orders.attackMoveArmed;
  }

  canCommandSelection(): boolean {
    return this.deps.commands.selectedCommandableCount() > 0;
  }

  /** One zoom level in (+) or out (-) around the view centre. */
  zoomStep(steps: number): void {
    this.deps.camera.zoomStep(steps);
  }

  placementState(): TouchPlacementState {
    return this.deps.placement.touchState();
  }

  confirmPlacement(): boolean {
    return this.deps.placement.confirmTouch();
  }

  cancelPlacement(): void {
    this.deps.placement.cancel();
  }

  setKeyboardEnabled(enabled: boolean): void {
    const kb = this.ctx.scene.input.keyboard;
    if (!kb) return;
    kb.enabled = enabled;
    if (!enabled) kb.resetKeys();
  }

  // ── Entity reads (HUD helpers) ────────────────────────────────────────────

  isAlive(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    if (!hasComponent(ecs, Position, eid)) return false;
    if (hasComponent(ecs, DeadTag, eid)) return false;
    return !hasComponent(ecs, Health, eid) || Health.hp[eid] > 0;
  }

  ownerOf(eid: number): number {
    return this.ctx.ownerOf(eid);
  }

  entityTile(eid: number): TilePoint | null {
    if (!hasComponent(this.ctx.world.ecs, Position, eid)) return null;
    return { x: Position.x[eid], y: Position.y[eid] };
  }

  /** Living entities from `eids` owned by `playerId`, order kept. */
  filterOwnedAlive(eids: readonly number[], playerId = this.ctx.perspectivePlayerId): number[] {
    const ecs = this.ctx.world.ecs;
    return eids.filter((eid) => hasComponent(ecs, Owner, eid) && Owner.player[eid] === playerId && this.isAlive(eid));
  }

  centroid(eids: readonly number[]): TilePoint | null {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const eid of eids) {
      const t = this.entityTile(eid);
      if (!t) continue;
      sx += t.x;
      sy += t.y;
      n++;
    }
    return n > 0 ? { x: sx / n, y: sy / n } : null;
  }

  /** Grouping key: `u<unit def>` for units, `b<building def>`, or 'foundation'. */
  entityKindKey(eid: number): string {
    const ecs = this.ctx.world.ecs;
    if (hasComponent(ecs, UnitKind, eid)) return `u${UnitKind.kind[eid]}`;
    if (hasComponent(ecs, ConstructionSite, eid)) return 'foundation';
    if (hasComponent(ecs, Building, eid)) return `b${Building.defId[eid]}`;
    return 'unknown';
  }

  isProducer(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    return hasComponent(ecs, Producer, eid) && hasComponent(ecs, Building, eid);
  }

  /** Health as 0..1 for the HUD, or null when the entity has no health. */
  healthFrac(eid: number): number | null {
    const ecs = this.ctx.world.ecs;
    if (!hasComponent(ecs, Health, eid) || Health.hpMax[eid] <= 0) return null;
    return Math.max(0, Math.min(1, Health.hp[eid] / Health.hpMax[eid]));
  }

  // ── Pointer hover (HUD cursor) ────────────────────────────────────────────

  /**
   * What a click on the battlefield tile under the pointer would mean, so the
   * UI can pick a cursor: an armed placement (accepted or refused), the army
   * rally pick, a visible enemy, an explored resource (villagers selected) or one of our
   * unfinished buildings. Read-only; mirrors PointerController's priorities.
   */
  pointerHoverKind(): PointerHoverKind {
    const scene = this.ctx.scene as GameScene;
    const world = this.ctx.world;
    const me = this.ctx.perspectivePlayerId;
    const pointer = scene.input.activePointer;
    const wp = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const { tx, ty, tileX, tileY } = this.ctx.pickTile(wp.x, wp.y);

    const mode = scene.getBuildMode();
    if (mode === 'army rally') return 'rally';
    if (mode !== '-') {
      const defId = BUILD_MODE_TO_DEF[mode.toUpperCase() as keyof typeof BUILD_MODE_TO_DEF];
      if (defId === undefined) return 'build';
      return this.deps.commands.placementFailure(defId, tx, ty) ? 'forbidden' : 'build';
    }

    const eid = findEntityNear(world, tileX, tileY, 0.7);
    if (eid !== null && this.ctx.isEntityVisible(eid)) {
      if (isEnemyOf(world, eid, me)) return this.deps.commands.selectedCommandableCount() > 0 ? 'attack' : 'default';
      if (this.ownerOf(eid) === me && hasComponent(world.ecs, ConstructionSite, eid)) return 'build';
    }
    const resourceEid = this.selectionHasOwnVillager() ? findResourceAt(world, tileX, tileY, 0.7) : null;
    if (resourceEid !== null && this.ctx.isResourceExplored(resourceEid)) {
      const kind = Resource.kind[resourceEid];
      if (kind === ResourceKindId.WOOD) return 'gather-wood';
      if (kind === ResourceKindId.FOOD) return 'gather-food';
      return 'gather-mine';
    }
    return this.selectionIsOwnArmyProducers() ? 'rally' : 'default';
  }

  private selectionHasOwnVillager(): boolean {
    const ecs = this.ctx.world.ecs;
    for (const eid of selectedQuery(ecs)) {
      if (!hasComponent(ecs, UnitKind, eid) || UnitKind.kind[eid] !== UnitKindId.VILLAGER) continue;
      if (this.ownerOf(eid) === this.ctx.perspectivePlayerId) return true;
    }
    return false;
  }

  private selectionIsOwnArmyProducers(): boolean {
    const ecs = this.ctx.world.ecs;
    const selected = selectedQuery(ecs);
    if (selected.length === 0) return false;
    for (const eid of selected) {
      if (!hasComponent(ecs, Building, eid) || hasComponent(ecs, ConstructionSite, eid)) return false;
      if (this.ownerOf(eid) !== this.ctx.perspectivePlayerId) return false;
      if (!isArmyProducerDefId(Building.defId[eid])) return false;
    }
    return true;
  }
}
