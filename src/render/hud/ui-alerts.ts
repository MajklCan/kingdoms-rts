/**
 * Player-facing alerts and event-log messages for the DOM HUD.
 *
 * Sources, all typed (nothing is scraped from debug text):
 *   - sim GameEvents (world.gameEvents): trained, built, researched, age,
 *     destroyed. Output-only buffer, drained here every frame.
 *   - attack notices from MinimapAlerts (combat events where the perspective
 *     player is the target), rate-limited per fight area.
 *   - command notices from CommandFeedback (refusals and confirmations).
 *   - a population-cap edge trigger.
 *
 * Copy is written for players: no entity ids, coordinates or debug wording.
 */

import { BUILDING_TABLE, UNIT_TABLE, getAgeDef } from '@sim/defs';
import { techDef } from '@sim/tech-tree';
import { POP_CAP_HARD_LIMIT, type GameEvent } from '@sim/world';
import { SIM } from '../../config';
import type { CommandFeedback, CommandNotice, ResourceName } from '../commands/feedback';
import type { SceneContext } from '../scene-context';
import type { AttackNotice, MinimapAlerts } from './minimap-data';

export type UiAlertKind =
  | 'attack'
  | 'building-lost'
  | 'building-complete'
  | 'unit-trained'
  | 'research-complete'
  | 'age-up'
  | 'resources'
  | 'population'
  | 'denied'
  | 'info';

export interface TilePoint {
  x: number;
  y: number;
}

export interface UiAlert {
  /** Increases by one per alert for the whole scene lifetime. */
  id: number;
  kind: UiAlertKind;
  text: string;
  /** Sim tick the alert was raised on. */
  tick: number;
  /** Where a click on the alert should jump the camera (tile coordinates). */
  at?: TilePoint;
  /** Attack alerts: who hit whom. `target` is ours, `attacker` is theirs. */
  attack?: {
    target: TilePoint & { isBuilding: boolean };
    attacker: TilePoint & { playerId: number };
  };
  /** Resource alerts: which resources were short. */
  missing?: ResourceName[];
}

export type GameMessageTone = 'info' | 'good' | 'warn' | 'bad';

export interface GameMessage {
  id: number;
  tick: number;
  text: string;
  tone: GameMessageTone;
  at?: TilePoint;
}

export type GameMessageListener = (message: GameMessage) => void;

/** A new attack alert needs this long since the last one in the same area. */
const ATTACK_COOLDOWN_TICKS = SIM.TICK_HZ * 20;
/** Attacks farther apart than this (tiles) count as different fights. */
const ATTACK_AREA_TILES = 12;
/** Population-cap warning repeats at most this often. */
const POP_CAP_COOLDOWN_TICKS = SIM.TICK_HZ * 30;
const MAX_PENDING_ALERTS = 32;

interface FightArea {
  x: number;
  y: number;
  lastAlertTick: number;
}

export class UiAlertFeed {
  private pending: UiAlert[] = [];
  private readonly listeners = new Set<GameMessageListener>();
  private fights: FightArea[] = [];
  private nextId = 1;
  private popWasCapped = false;
  private lastPopAlertTick = -Infinity;
  /** Latest live position of the most recent fight (jump target). */
  private lastFight: TilePoint | null = null;

  constructor(
    private readonly ctx: SceneContext,
    private readonly sources: { alerts: MinimapAlerts; feedback: CommandFeedback }
  ) {}

  /** Collect everything that happened since the last frame. */
  pump(): void {
    const world = this.ctx.world;
    if (world.gameEvents.length > 0) {
      for (const event of world.gameEvents.splice(0)) this.onGameEvent(event);
    }
    for (const notice of this.sources.alerts.drainAttackNotices()) this.onAttack(notice);
    for (const notice of this.sources.feedback.drain()) this.onCommandNotice(notice);
    this.checkPopulation();
  }

  drain(): UiAlert[] {
    if (this.pending.length === 0) return [];
    return this.pending.splice(0);
  }

  subscribe(listener: GameMessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Where the latest fight involving us is (for "jump to alert"). */
  lastFightPosition(): TilePoint | null {
    return this.lastFight ? { ...this.lastFight } : null;
  }

  /** New / loaded / ended match: forget everything queued and rate-limited. */
  reset(): void {
    this.pending = [];
    this.fights = [];
    this.popWasCapped = false;
    this.lastPopAlertTick = -Infinity;
    this.lastFight = null;
    this.ctx.world.gameEvents.length = 0;
    this.sources.alerts.drainAttackNotices();
    this.sources.feedback.clear();
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  private onGameEvent(event: GameEvent): void {
    const me = this.ctx.perspectivePlayerId;
    switch (event.kind) {
      case 'unitTrained': {
        if (event.playerId !== me) return;
        const name = UNIT_TABLE[event.unitDefId]?.name ?? 'Unit';
        this.alert('unit-trained', `${name} trained`, event.tick, { at: { x: event.x, y: event.y } });
        this.message(`${name} ready`, 'good', event.tick, { x: event.x, y: event.y });
        return;
      }
      case 'buildingCompleted': {
        if (event.playerId !== me) return;
        const name = BUILDING_TABLE[event.buildingDefId]?.name ?? 'Building';
        this.alert('building-complete', `${name} complete`, event.tick, { at: { x: event.x, y: event.y } });
        this.message(`${name} complete`, 'good', event.tick, { x: event.x, y: event.y });
        return;
      }
      case 'researchCompleted': {
        if (event.playerId !== me) return;
        const name = techDef(event.techId)?.name ?? 'Technology';
        this.alert('research-complete', `Research complete: ${name}`, event.tick);
        this.message(`${name} researched`, 'good', event.tick);
        return;
      }
      case 'ageAdvanced': {
        if (event.playerId !== me) return;
        const name = getAgeDef(event.ageId)?.name ?? 'a new age';
        this.alert('age-up', `Your realm enters the ${name}`, event.tick);
        this.message(`Advanced to the ${name}`, 'good', event.tick);
        return;
      }
      case 'entityDestroyed': {
        if (!event.isBuilding) return;
        const name = BUILDING_TABLE[event.defId]?.name ?? 'Building';
        const at = { x: event.x, y: event.y };
        if (event.ownerId === me) {
          this.alert('building-lost', `${name} destroyed`, event.tick, { at });
          this.message(`Your ${name} was destroyed`, 'bad', event.tick, at);
        } else if (this.ctx.isTileVisible(Math.round(event.x), Math.round(event.y))) {
          this.message(`Enemy ${name} destroyed`, 'good', event.tick, at);
        }
        return;
      }
    }
  }

  private onAttack(notice: AttackNotice): void {
    const target = { x: notice.targetX, y: notice.targetY };
    this.lastFight = target;
    const area = this.fights.find(
      (f) => Math.hypot(f.x - target.x, f.y - target.y) <= ATTACK_AREA_TILES
    );
    if (area) {
      // Same fight: follow it, but stay quiet until the cooldown runs out.
      area.x = target.x;
      area.y = target.y;
      if (notice.tick - area.lastAlertTick < ATTACK_COOLDOWN_TICKS) return;
      area.lastAlertTick = notice.tick;
    } else {
      this.fights.push({ ...target, lastAlertTick: notice.tick });
      this.fights = this.fights.filter((f) => notice.tick - f.lastAlertTick < ATTACK_COOLDOWN_TICKS * 3);
    }
    const text = notice.targetIsBuilding
      ? `${BUILDING_TABLE[notice.targetDefId]?.name ?? 'A building'} is under attack`
      : notice.targetIsVillager
        ? 'Your villagers are under attack'
        : 'Your army is under attack';
    this.alert('attack', text, notice.tick, {
      at: target,
      attack: {
        target: { ...target, isBuilding: notice.targetIsBuilding },
        attacker: { x: notice.attackerX, y: notice.attackerY, playerId: notice.attackerPlayerId },
      },
    });
    this.message(text, 'bad', notice.tick, target);
  }

  private onCommandNotice(notice: CommandNotice): void {
    const tick = this.ctx.world.tick;
    if (notice.kind === 'info') {
      this.message(notice.text, 'info', tick);
      return;
    }
    const failure = notice.failure;
    if (failure.reason === 'resources') {
      this.alert('resources', notice.text, tick, { missing: [...failure.missing] });
    } else if (failure.reason === 'population') {
      this.alert('population', notice.text, tick);
    } else {
      this.alert('denied', notice.text, tick);
    }
    this.message(notice.text, 'warn', tick);
  }

  private checkPopulation(): void {
    const world = this.ctx.world;
    const pop = world.population[this.ctx.perspectivePlayerId];
    if (!pop) return;
    const capped = pop.cap > 0 && pop.current >= pop.cap && pop.cap < POP_CAP_HARD_LIMIT;
    if (capped && !this.popWasCapped && world.tick - this.lastPopAlertTick >= POP_CAP_COOLDOWN_TICKS) {
      this.lastPopAlertTick = world.tick;
      const text = 'Population limit reached. Build more houses';
      this.alert('population', text, world.tick);
      this.message(text, 'warn', world.tick);
    }
    this.popWasCapped = capped;
  }

  // ── Output ────────────────────────────────────────────────────────────────

  private alert(
    kind: UiAlertKind,
    text: string,
    tick: number,
    extra: Pick<UiAlert, 'at' | 'attack' | 'missing'> = {}
  ): void {
    this.pending.push({ id: this.nextId++, kind, text, tick, ...extra });
    if (this.pending.length > MAX_PENDING_ALERTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_ALERTS);
    }
  }

  private message(text: string, tone: GameMessageTone, tick: number, at?: TilePoint): void {
    if (this.listeners.size === 0) return;
    const message: GameMessage = at
      ? { id: this.nextId++, tick, text, tone, at }
      : { id: this.nextId++, tick, text, tone };
    for (const listener of this.listeners) listener(message);
  }
}
