/**
 * Test-only "player" that runs the sim's AI brain but acts only through
 * SimInput commands, the way a human client does. Used to drive both seats of
 * a lockstep match through the real multiplayer path.
 *
 * The brain expects its decisions to land immediately (it spends, then checks
 * the bank again in the same think). A command lands a few ticks later on
 * every client, so for the length of one think the bot applies the effect of
 * every command it has issued but that has not run yet (spend, queue entry,
 * claimed building spot, researched tech, started age) and puts the world
 * back afterwards. The world a think leaves behind is bit-identical to the
 * one it found, so the bot never desyncs its own client.
 */

import { hasComponent } from 'bitecs';
import { Position } from '@sim/components';
import { AGE_TABLE, canAfford, getAgeDef, getBuildingDef, getUnitDef, spend } from '@sim/defs';
import { techDef, type TechIdValue } from '@sim/tech-tree';
import type { GridPos } from '@sim/pathfinding';
import { isMovableEntity } from '@sim/input/formation';
import {
  aiSettingsFor,
  aiThink,
  createAiPlayerState,
  type AiActuator,
  type AiDifficulty,
  type AiPlayerState,
  type SimInput,
  type SimWorld,
} from '@sim/world';

type Effect =
  | { kind: 'train'; atEid: number; defId: number }
  | { kind: 'place'; defId: number; x: number; y: number }
  | { kind: 'research'; techId: TechIdValue }
  | { kind: 'advance' };

interface Issued {
  input: SimInput;
  effect: Effect | null;
  /** Lockstep tick the command runs on, once its turn packet went out. */
  forTick: number | null;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Restores exactly what a think's virtual effects touched. */
class Undo {
  private bank: Int32Array | null = null;
  private bankCopy: Int32Array | null = null;
  private age: { current: number; progress: number; totalTicks: number } | null = null;
  private readonly queues = new Map<number, number[] | undefined>();
  private readonly techs: TechIdValue[] = [];

  constructor(
    private readonly world: SimWorld,
    private readonly playerId: number
  ) {
    const bank = world.resources[playerId];
    if (bank) {
      this.bank = bank;
      this.bankCopy = Int32Array.from(bank);
    }
    const age = world.ages[playerId];
    if (age) this.age = { current: age.current, progress: age.progress, totalTicks: age.totalTicks };
  }

  touchQueue(eid: number): number[] {
    const queues = this.world.productionQueues;
    if (!this.queues.has(eid)) this.queues.set(eid, queues.get(eid)?.slice());
    let queue = queues.get(eid);
    if (!queue) {
      queue = [];
      queues.set(eid, queue);
    }
    return queue;
  }

  addTech(techId: TechIdValue): void {
    const set = this.world.researchedTechs[this.playerId];
    if (!set || set.has(techId)) return;
    set.add(techId);
    this.techs.push(techId);
  }

  restore(): void {
    if (this.bank && this.bankCopy) this.bank.set(this.bankCopy);
    const age = this.world.ages[this.playerId];
    if (age && this.age) Object.assign(age, this.age);
    for (const [eid, original] of this.queues) {
      const live = this.world.productionQueues.get(eid);
      if (original === undefined) this.world.productionQueues.delete(eid);
      else if (live) live.splice(0, live.length, ...original);
    }
    const set = this.world.researchedTechs[this.playerId];
    for (const techId of this.techs) set?.delete(techId);
  }
}

export interface CommandBotStats {
  thinks: number;
  commands: number;
  byType: Record<string, number>;
}

export class CommandBot {
  readonly state: AiPlayerState;
  readonly stats: CommandBotStats = { thinks: 0, commands: 0, byType: {} };
  private readonly issued: Issued[] = [];
  private undo: Undo | null = null;
  private claims: Rect[] = [];
  private batch: SimInput[] = [];

  constructor(
    readonly playerId: number,
    readonly difficulty: AiDifficulty,
    /** Hands a command to the client (MultiplayerSession.sendCommand). */
    private readonly send: (input: SimInput) => void
  ) {
    this.state = createAiPlayerState(0, difficulty);
  }

  /** Think after `world.tick` was just reached, on the AI's own cadence. */
  maybeThink(world: SimWorld): void {
    if (world.outcome.state !== 'playing') return;
    if (world.tick % aiSettingsFor(this.difficulty).thinkIntervalTicks !== 0) return;
    this.think(world);
  }

  think(world: SimWorld): void {
    this.stats.thinks++;
    this.dropLanded(world.tick);
    const undo = new Undo(world, this.playerId);
    this.undo = undo;
    this.claims = [];
    this.batch = [];
    try {
      for (const issued of this.issued) if (issued.effect) this.applyEffect(world, issued.effect);
      aiThink(world, this.playerId, this.state, this.difficulty, this.actuator);
    } finally {
      undo.restore();
      this.undo = null;
    }
    for (const input of mergeOrders(this.batch)) this.emit(input, null);
  }

  /** The client sent a turn packet with `count` local commands for `forTick`. */
  onTurnSent(forTick: number, count: number): void {
    let left = count;
    for (const issued of this.issued) {
      if (left === 0) break;
      if (issued.forTick !== null) continue;
      issued.forTick = forTick;
      left--;
    }
  }

  /** Someone else queued a command on this client (a test injecting one):
   *  keep the turn bookkeeping aligned without treating it as ours. */
  noteExternalCommand(input: SimInput): void {
    this.issued.push({ input, effect: null, forTick: null });
  }

  /** The client's world was swapped for a reload: rewrite held raw eids. */
  remapEids(map: (eid: number) => number): void {
    this.state.waveUnitEids = this.state.waveUnitEids.map(map).filter((eid) => eid >= 0);
    for (const issued of this.issued) {
      if (issued.effect?.kind === 'train') issued.effect = { ...issued.effect, atEid: map(issued.effect.atEid) };
    }
  }

  /** Commands issued but not yet run (for leak checks). */
  get pendingCount(): number {
    return this.issued.length;
  }

  private dropLanded(tick: number): void {
    // A command for tick T has run once the world reached T + 1.
    for (let i = this.issued.length - 1; i >= 0; i--) {
      const forTick = this.issued[i].forTick;
      if (forTick !== null && forTick < tick) this.issued.splice(i, 1);
    }
  }

  private emit(input: SimInput, effect: Effect | null): void {
    this.issued.push({ input, effect, forTick: null });
    this.stats.commands++;
    this.stats.byType[input.type] = (this.stats.byType[input.type] ?? 0) + 1;
    this.send(input);
  }

  private applyEffect(world: SimWorld, effect: Effect): void {
    const undo = this.undo;
    const bank = world.resources[this.playerId];
    if (!undo || !bank) return;
    switch (effect.kind) {
      case 'train': {
        const unit = getUnitDef(effect.defId);
        if (effect.atEid < 0 || !unit || !canAfford(bank, unit.cost)) return;
        spend(bank, unit.cost);
        undo.touchQueue(effect.atEid).push(effect.defId);
        return;
      }
      case 'place': {
        const def = getBuildingDef(effect.defId);
        if (!def || !canAfford(bank, def.cost)) return;
        spend(bank, def.cost);
        this.claims.push(footprint(effect.defId, effect.x, effect.y));
        return;
      }
      case 'research': {
        const tech = techDef(effect.techId);
        if (!tech || !canAfford(bank, tech.cost)) return;
        spend(bank, tech.cost);
        undo.addTech(effect.techId);
        return;
      }
      case 'advance': {
        const age = world.ages[this.playerId];
        if (!age || age.progress >= 0 || age.current >= AGE_TABLE.length - 1) return;
        const next = getAgeDef(age.current + 1);
        if (!next || !canAfford(bank, next.advanceCost)) return;
        spend(bank, next.advanceCost);
        age.progress = 0;
        age.totalTicks = next.advanceTicks;
        return;
      }
    }
  }

  /** Issue a command whose effect the rest of this think should already see. */
  private commit(world: SimWorld, input: SimInput, effect: Effect): void {
    this.applyEffect(world, effect);
    this.emit(input, effect);
  }

  private readonly actuator: AiActuator = {
    commitQueueUnit: (world, atEid, defId) => {
      this.commit(world, { type: 'trainUnit', atEid, defId, playerId: this.playerId }, { kind: 'train', atEid, defId });
    },
    commitPlaceBuilding: (world, defId, x, y, playerId) => {
      this.commit(world, { type: 'placeBuilding', defId, x, y, playerId }, { kind: 'place', defId, x, y });
    },
    isSpotClaimed: (defId, x, y) => {
      const rect = footprint(defId, x, y);
      return this.claims.some((c) => rect.x0 <= c.x1 + 1 && c.x0 <= rect.x1 + 1 && rect.y0 <= c.y1 + 1 && c.y0 <= rect.y1 + 1);
    },
    researchTech: (world, playerId, techId) => {
      this.commit(world, { type: 'researchTech', playerId, techId }, { kind: 'research', techId });
      return true;
    },
    advanceAge: (world, playerId) => {
      this.commit(world, { type: 'advanceAge', playerId }, { kind: 'advance' });
      return true;
    },
    move: (world, eid, to) => {
      if (!isMovableEntity(world, eid)) return;
      this.batch.push({ type: 'cmdMove', playerId: this.playerId, eids: [eid], to: roundPoint(to) });
    },
    attackMove: (world, eid, to) => {
      if (!isMovableEntity(world, eid) || !canReach(world, eid, to)) return false;
      this.batch.push({ type: 'cmdAttackMove', playerId: this.playerId, eids: [eid], to: roundPoint(to) });
      return true;
    },
    attack: (world, eid, target) => {
      if (!hasComponent(world.ecs, Position, eid)) return;
      this.batch.push({ type: 'cmdAttack', playerId: this.playerId, eids: [eid], targetEid: target });
    },
    event: () => {},
  };
}

function roundPoint(p: GridPos): GridPos {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function canReach(world: SimWorld, eid: number, to: GridPos): boolean {
  const from = { x: Math.round(Position.x[eid]), y: Math.round(Position.y[eid]) };
  return world.pathfinder.findPath(from, roundPoint(to)) !== null;
}

function footprint(defId: number, x: number, y: number): Rect {
  const def = getBuildingDef(defId);
  const w = def?.footprint.w ?? 1;
  const h = def?.footprint.h ?? 1;
  const x0 = Math.round(x) - Math.floor(w / 2);
  const y0 = Math.round(y) - Math.floor(h / 2);
  return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
}

/** One command per (order, destination or target): a wave goes out as one
 *  order like a player's box-select, in first-seen order. */
function mergeOrders(orders: SimInput[]): SimInput[] {
  const out: SimInput[] = [];
  const index = new Map<string, number>();
  for (const order of orders) {
    let key: string;
    if (order.type === 'cmdMove' || order.type === 'cmdAttackMove') key = `${order.type}:${order.to.x},${order.to.y}`;
    else if (order.type === 'cmdAttack') key = `${order.type}:${order.targetEid}`;
    else {
      out.push(order);
      continue;
    }
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push({ ...order, eids: [...order.eids] } as SimInput);
    } else {
      const merged = out[at] as Extract<SimInput, { eids: number[] }>;
      for (const eid of (order as Extract<SimInput, { eids: number[] }>).eids) {
        if (!merged.eids.includes(eid)) merged.eids.push(eid);
      }
    }
  }
  return out;
}
