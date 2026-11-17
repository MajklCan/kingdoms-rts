/**
 * What a click or a tap on the battlefield means, shared by the mouse
 * (pointer-controller.ts) and touch (touch-controller.ts) so both produce
 * exactly the same sim inputs through PlayerCommands:
 *
 *   select      pick the entity under a point (left click, long press)
 *   command     context order (right click, tap with a selection):
 *               visible enemy -> attack; own foundation + villagers ->
 *               build; own worksite + villagers -> help there; only army
 *               buildings -> rally; explored resource or game -> gather /
 *               hunt / hint; else move.
 *               With Shift held (mouse only) the order is queued behind
 *               what the units are doing instead of replacing it (helping
 *               at a worksite never ends, so it is always a plain order)
 *   box         own units inside a camera-world rectangle
 *   same kind   every own unit of a type on screen (double click / tap)
 *
 * Points are camera-world coordinates (pointer.worldX / worldY).
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  DeadTag,
  FoundationTag,
  Health,
  Owner,
  Position,
  Resource,
  ResourceKindId,
  UnitKind,
  WorksiteWorker,
} from '@sim/components';
import { BUILDING_TABLE } from '@sim/defs';
import {
  clearSelection,
  countWorksiteHelpers,
  findEntityNear,
  findResourceAt,
  helpRefusal,
  isEnemyOf,
  isGameAnimal,
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
import type { SceneContext } from '../scene-context';
import { isInsideMap } from '../world-projection';

export type MapOrderKind = 'move' | 'attackMove';

export interface WorldOrdersDeps {
  commands: PlayerCommands;
  audio: GameAudio;
  /** Building whose sprite pixels cover a layer-local point (tall art). */
  pickBuilding?: (localX: number, localY: number) => number | null;
  /** Unit whose drawn figure covers a layer-local point (head to feet). */
  pickUnit?: (localX: number, localY: number) => number | null;
  /** A drawn unit's click box in layer-local px (null when not drawn). */
  unitBody?: (eid: number) => { x0: number; y0: number; x1: number; y1: number } | null;
}

export class WorldOrders {
  private feedback: CommandFeedback | null = null;
  /** Touch: the next tap on the map attack-moves the selection there. */
  attackMoveArmed = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly deps: WorldOrdersDeps
  ) {}

  setFeedback(feedback: CommandFeedback): void {
    this.feedback = feedback;
  }

  /**
   * Entity under a point: a unit whose drawn figure covers it first, then
   * the sim's tile pick, except that a building drawn
   * over that point (a roof or tower top over a tile further back) wins
   * against another building, and fills in when the tile pick finds nothing.
   */
  pickEntity(wx: number, wy: number, tileX: number, tileY: number): number | null {
    const world = this.ctx.world;
    const root = this.ctx.layers.root;
    // A unit's whole figure is clickable, not just the tile under its feet,
    // and a figure standing in front of a building wins over the building.
    const unit = this.deps.pickUnit?.(wx - root.x, wy - root.y) ?? null;
    if (unit !== null) return unit;
    const picked = findEntityNear(world, tileX, tileY, 0.7);
    const drawn = this.deps.pickBuilding?.(wx - root.x, wy - root.y) ?? null;
    if (drawn === null) return picked;
    if (picked === null || (picked !== drawn && hasComponent(world.ecs, Building, picked))) return drawn;
    return picked;
  }

  /** The visible entity under a point, or null. */
  visibleEntityAt(wx: number, wy: number): number | null {
    const { tileX, tileY } = this.ctx.pickTile(wx, wy);
    const picked = this.pickEntity(wx, wy, tileX, tileY);
    return picked !== null && this.ctx.isEntityVisible(picked) ? picked : null;
  }

  /**
   * Move or attack-move the selection to a tile; `queue` (Shift held) puts
   * the order behind what the units are doing. False when nothing
   * commandable is selected.
   */
  issueMapOrder(kind: MapOrderKind, tx: number, ty: number, queue = false): boolean {
    const { commands, audio } = this.deps;
    if (!isInsideMap(this.ctx.world, tx, ty)) return false;
    if (commands.selectedCommandableCount() === 0) return false;
    if (queue && this.refuseQueued()) return true;
    if (kind === 'attackMove') {
      commands.dispatch({ type: 'attackMoveSelected', to: { x: tx, y: ty }, ...queueFlag(queue) });
      audio.barkAttack();
      this.feedback?.orderMarker('attack-move', tx, ty);
    } else {
      commands.dispatch({ type: 'moveSelected', to: { x: tx, y: ty }, ...queueFlag(queue) });
      audio.barkMove();
      this.feedback?.orderMarker('move', tx, ty);
    }
    setLastEvent(`${queue ? 'queue ' : ''}${kind} -> (${tx},${ty})`);
    return true;
  }

  /** A Shift-queued order none of the selected units would take: say why. True when refused. */
  private refuseQueued(gatherersOnly = false): boolean {
    const failure = this.deps.commands.queuedOrderFailure(gatherersOnly);
    if (failure) this.deps.commands.fail(failure);
    return failure !== null;
  }

  /**
   * Right-click semantics at a camera-world point. `queue` (Shift held):
   * unit orders are queued behind the current one instead of replacing it.
   */
  command(wx: number, wy: number, queue = false): void {
    const world = this.ctx.world;
    const { commands, audio } = this.deps;
    const { tx, ty, tileX, tileY } = this.ctx.pickTile(wx, wy);
    if (!isInsideMap(this.ctx.world, tx, ty)) return;
    const hasUnits = commands.selectedCommandableCount() > 0;
    const targetEid = this.pickEntity(wx, wy, tileX, tileY);
    if (
      hasUnits &&
      targetEid !== null &&
      this.ctx.isEntityVisible(targetEid) &&
      isEnemyOf(world, targetEid, this.ctx.perspectivePlayerId)
    ) {
      if (queue && this.refuseQueued()) return;
      commands.dispatch({ type: 'attackSelected', targetEid, ...queueFlag(queue) });
      audio.barkAttack();
      this.feedback?.orderMarker('attack', Position.x[targetEid], Position.y[targetEid]);
      setLastEvent(`${queue ? 'queue ' : ''}attack eid=${targetEid}`);
      return;
    }
    if (hasUnits && targetEid !== null && this.tryBuildOrder(targetEid, queue)) return;
    if (hasUnits && targetEid !== null && this.tryWorksiteOrder(targetEid)) return;
    if (!hasUnits) {
      // Right click with the town center selected: where its new villagers go.
      if (commands.selectedTownCenters().length > 0) {
        const resourceEid = findResourceAt(world, tileX, tileY, 0.7);
        const explored = resourceEid !== null && Resource.amount[resourceEid] > 0 && this.ctx.isResourceExplored(resourceEid);
        if (commands.setVillagerRallyAt(tx, ty, explored ? resourceEid : null)) {
          this.feedback?.orderMarker('rally', tx, ty);
          return;
        }
      }
      if (this.selectionIsOwnArmyProducers()) {
        commands.dispatch({ type: 'setArmyRallyPoint', playerId: this.ctx.perspectivePlayerId, x: tx, y: ty });
        this.feedback?.orderMarker('rally', tx, ty);
        commands.confirm('Army rally point set');
      }
      return;
    }
    const resourceEid = findResourceAt(world, tileX, tileY, 0.7);
    if (resourceEid !== null && this.ctx.isResourceExplored(resourceEid)) {
      const game = isGameAnimal(world, resourceEid);
      if (commands.selectedGathererCount() > 0 && Resource.amount[resourceEid] > 0) {
        // Free villagers (town center trained) gather by hand and carry to a
        // drop-off; on game they hunt it first.
        if (queue && this.refuseQueued(true)) return;
        commands.dispatch({ type: 'gatherSelected', targetEid: resourceEid, ...queueFlag(queue) });
        if (game) audio.barkAttack();
        else audio.barkMove();
        this.feedback?.orderMarker(game ? 'attack' : 'move', Position.x[resourceEid], Position.y[resourceEid]);
        setLastEvent(`${queue ? 'queue ' : ''}${game ? 'hunt' : 'gather'} eid=${resourceEid}`);
        return;
      }
      if (game) {
        commands.fail({ reason: 'unavailable', text: 'Only villagers can hunt. Select a villager' });
        return;
      }
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
    this.issueMapOrder('move', tx, ty, queue);
  }

  /**
   * Own unfinished foundation with free villagers selected: send them to
   * build it (`queue`: after what they are doing). False (nothing sent) for
   * anything else.
   */
  private tryBuildOrder(targetEid: number, queue = false): boolean {
    if (!this.isOwnFoundation(targetEid)) return false;
    if (this.deps.commands.selectedBuilderEids().length === 0) return false;
    if (queue && this.refuseQueued(true)) return true;
    this.deps.commands.dispatch({ type: 'buildSelected', targetEid, ...queueFlag(queue) });
    this.deps.audio.barkMove();
    this.feedback?.orderMarker('move', Position.x[targetEid], Position.y[targetEid]);
    setLastEvent(`${queue ? 'queue ' : ''}build eid=${targetEid}`);
    return true;
  }

  /**
   * Own worksite (farm, lumber hut, quarry, gold mine) with free villagers
   * selected: send them to help there. A full or unfinished one says why.
   * False (nothing sent, nothing said) for anything else.
   */
  private tryWorksiteOrder(targetEid: number): boolean {
    const world = this.ctx.world;
    if (!hasComponent(world.ecs, Building, targetEid)) return false;
    if (this.deps.commands.selectedBuilderEids().length === 0) return false;
    const refusal = helpRefusal(world, targetEid, this.ctx.perspectivePlayerId);
    if (refusal === 'not-worksite' || refusal === 'foreign' || refusal === 'unfinished') return false;
    const name = BUILDING_TABLE[Building.defId[targetEid]]?.name ?? 'This worksite';
    if (refusal === 'full') {
      this.deps.commands.fail({
        reason: 'unavailable',
        text: `${name} has no room for more helpers (${countWorksiteHelpers(world, targetEid)} already help)`,
      });
      return true;
    }
    this.deps.commands.dispatch({ type: 'assignWorksiteSelected', targetEid });
    this.deps.audio.barkMove();
    this.feedback?.orderMarker('move', Position.x[targetEid], Position.y[targetEid]);
    this.deps.commands.confirm(`Villagers help at the ${name}`);
    setLastEvent(`help worksite eid=${targetEid}`);
    return true;
  }

  /** Left-click semantics: select what is under the point (or clear). Returns the eid. */
  select(wx: number, wy: number): number | null {
    const world = this.ctx.world;
    const eid = this.visibleEntityAt(wx, wy);
    clearSelection(world);
    if (eid !== null) {
      setSelected(world, eid, true);
      if (this.ctx.isOwnUnit(eid)) this.deps.audio.barkSelect(eid);
      setLastEvent(`selected ${entityKindName(world, eid)} eid=${eid}`);
    } else {
      setLastEvent(`cleared selection`);
    }
    return eid;
  }

  /**
   * Touch tap: an own unit or building replaces the selection (a double tap
   * on a unit takes every one of its kind on screen), so a tap on your own
   * town center selects it instead of walking the army there; with
   * commandable units (or only army buildings) selected anything else is a
   * context command, as a right click; with nothing to command it selects
   * like a left click.
   */
  tap(wx: number, wy: number, count: 1 | 2): void {
    const eid = this.visibleEntityAt(wx, wy);
    if (this.attackMoveArmed) {
      this.attackMoveArmed = false;
      const { tx, ty } = this.ctx.pickTile(wx, wy);
      if (this.issueMapOrder('attackMove', tx, ty)) return;
    }
    // A tap on an own foundation with villagers selected builds it rather
    // than selecting it, like a right click.
    if (eid !== null && this.tryBuildOrder(eid)) return;
    // Likewise a tap on an own worksite sends them to help there.
    if (eid !== null && this.tryWorksiteOrder(eid)) return;
    if (eid !== null && this.isOwnEntity(eid)) {
      if (count === 2 && this.ctx.isOwnUnit(eid)) {
        const n = this.selectSameKindOnScreen(eid);
        setLastEvent(`double-tap: selected ${n} ${entityKindName(this.ctx.world, eid)} unit${n === 1 ? '' : 's'}`);
      } else {
        this.select(wx, wy);
      }
      return;
    }
    const canCommand = this.deps.commands.selectedCommandableCount() > 0;
    if (canCommand || (eid === null && this.selectionIsOwnArmyProducers())) {
      this.command(wx, wy);
      return;
    }
    this.select(wx, wy);
  }

  /** Double click / tap: every own unit of the source unit's type that is on screen. */
  selectSameKindOnScreen(sourceEid: number): number {
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

  /**
   * Select own units the camera-world box touches: any part of a drawn
   * figure counts (the same body box a click uses), else the feet anchor.
   */
  selectInWorldBox(x0: number, y0: number, x1: number, y1: number): number {
    const world = this.ctx.world;
    const root = this.ctx.layers.root;
    clearSelection(world);
    let n = 0;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      const body = this.deps.unitBody?.(eid) ?? null;
      const s = this.ctx.localToWorld(this.ctx.tileToScreen(Position.x[eid], Position.y[eid]));
      const touched = body
        ? body.x1 + root.x >= x0 && body.x0 + root.x <= x1 && body.y1 + root.y >= y0 && body.y0 + root.y <= y1
        : s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
      if (touched) {
        setSelected(world, eid, true);
        n++;
      }
    }
    const rep = this.deps.audio.representativeSelectedUnit();
    if (rep !== null) this.deps.audio.barkSelect(rep);
    setLastEvent(`box-selected ${n} unit${n === 1 ? '' : 's'}`);
    return n;
  }

  /** Own villagers (true) or own military (false); returns the count. */
  selectOwnUnits(villagers: boolean): number {
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

  deselect(): void {
    clearSelection(this.ctx.world);
    this.attackMoveArmed = false;
    setLastEvent('cleared selection');
  }

  /** A unit or a building (finished or under construction) of the perspective player. */
  private isOwnEntity(eid: number): boolean {
    if (this.ctx.isOwnUnit(eid)) return true;
    return hasComponent(this.ctx.world.ecs, Building, eid) &&
      Owner.player[eid] === this.ctx.perspectivePlayerId;
  }

  /** A living foundation of the perspective player. */
  private isOwnFoundation(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    return hasComponent(ecs, FoundationTag, eid) &&
      !hasComponent(ecs, DeadTag, eid) &&
      Owner.player[eid] === this.ctx.perspectivePlayerId;
  }

  /** Selection is non-empty and only our own barracks / stables / foundries. */
  selectionIsOwnArmyProducers(): boolean {
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
}

/** Gold selection rectangle, shared by the mouse drag and the touch box. */
export function drawSelectionBox(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number): void {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  g.clear();
  g.lineStyle(2, 0xfeca57, 1);
  g.strokeRect(x, y, w, h);
  g.fillStyle(0xfeca57, 0.12);
  g.fillRect(x, y, w, h);
}

function isAliveUnit(ecs: Parameters<typeof hasComponent>[0], eid: number): boolean {
  if (hasComponent(ecs, DeadTag, eid)) return false;
  if (hasComponent(ecs, WorksiteWorker, eid)) return false;
  return !hasComponent(ecs, Health, eid) || Health.hp[eid] > 0;
}

/** The Shift-queue flag of an order input: present only when set. */
function queueFlag(queue: boolean): { queue?: true } {
  return queue ? { queue: true } : {};
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
