/**
 * Test-only network: a virtual clock, links with latency, jitter, reordering
 * and duplicates, and an in-memory relay that follows relay/server.mjs (slot
 * assignment, host-only start, turn and checksum fan-out, peer-left).
 *
 * Every frame is JSON round-tripped like the real WebSocket path, and server
 * frames go through decodeServer, so a payload the wire would mangle is
 * mangled here too. All randomness comes from a seeded Rng owned by the net,
 * never from world.rng, so a run is reproducible and the sim is untouched.
 */

import { Rng } from '@sim/rng';
import {
  PROTOCOL_VERSION,
  decodeServer,
  encode,
  type ClientMessage,
  type PlayerSlot,
  type ServerMessage,
} from '../protocol';
import type { Transport, TransportCloseInfo } from '../transport';

export interface LinkConditions {
  /** One-way latency of each leg (client to relay, relay to client), ms. */
  latencyMs: number;
  /** Extra uniform delay in [0, jitterMs) per frame. */
  jitterMs: number;
  /** Chance a turn or checksum frame skips FIFO and may overtake earlier ones
   *  (never a control frame such as start). */
  reorderChance: number;
  /** Chance a turn or checksum frame is delivered twice. */
  duplicateChance: number;
}

export const PERFECT_LINK: LinkConditions = { latencyMs: 0, jitterMs: 0, reorderChance: 0, duplicateChance: 0 };

interface Scheduled {
  at: number;
  seq: number;
  run: () => void;
}

/** Discrete-event clock. Events run in (time, schedule order). */
export class VirtualNet {
  now = 0;
  readonly rng: Rng;
  private seq = 0;
  private readonly events: Scheduled[] = [];

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x5bd1e995) | 0);
  }

  schedule(at: number, run: () => void): void {
    this.events.push({ at: Math.max(at, this.now), seq: this.seq++, run });
  }

  /** Time of the earliest pending event, or Infinity. */
  nextEventAt(): number {
    let best = Infinity;
    for (const e of this.events) if (e.at < best) best = e.at;
    return best;
  }

  /** Run every event due at or before `until`, advancing the clock to each. */
  runUntil(until: number): void {
    for (;;) {
      let idx = -1;
      for (let i = 0; i < this.events.length; i++) {
        const e = this.events[i];
        if (e.at > until) continue;
        if (idx < 0 || e.at < this.events[idx].at || (e.at === this.events[idx].at && e.seq < this.events[idx].seq)) idx = i;
      }
      if (idx < 0) break;
      const [event] = this.events.splice(idx, 1);
      this.now = Math.max(this.now, event.at);
      event.run();
    }
    this.now = Math.max(this.now, until);
  }

  get pendingEvents(): number {
    return this.events.length;
  }
}

/** One direction of one client's connection, FIFO unless a frame reorders. */
class Leg {
  private lastAt = 0;
  private lastControlAt = 0;

  constructor(
    private readonly net: VirtualNet,
    private readonly link: () => LinkConditions
  ) {}

  send(frame: string, kind: string, deliver: (frame: string) => void): void {
    const link = this.link();
    const reorderable = kind === 'turn' || kind === 'checksum';
    const delay = (): number => link.latencyMs + (link.jitterMs > 0 ? this.net.rng.next() * link.jitterMs : 0);
    let at = this.net.now + delay();
    if (reorderable && this.net.rng.next() < link.reorderChance) {
      at = Math.max(at, this.lastControlAt);
    } else {
      at = Math.max(at, this.lastAt);
      this.lastAt = at;
      if (!reorderable) this.lastControlAt = at;
    }
    this.net.schedule(at, () => deliver(frame));
    if (reorderable && this.net.rng.next() < link.duplicateChance) {
      this.net.schedule(Math.max(at, this.net.now + delay()), () => deliver(frame));
    }
  }
}

export class MemoryTransport implements Transport {
  playerId: number | null = null;
  name: string | null = null;
  open = false;
  closed = false;
  /** Frames this client sent, for harness taps (e.g. which tick a command runs). */
  onSent: ((msg: ClientMessage) => void) | null = null;
  readonly up: Leg;
  readonly down: Leg;
  private msgCb: ((msg: ServerMessage) => void) | null = null;
  private openCb: (() => void) | null = null;
  private closeCb: ((info?: TransportCloseInfo) => void) | null = null;

  constructor(
    readonly id: number,
    private readonly relay: MemoryRelay,
    net: VirtualNet,
    public link: LinkConditions
  ) {
    this.up = new Leg(net, () => this.link);
    this.down = new Leg(net, () => this.link);
  }

  send(msg: ClientMessage): void {
    if (this.closed) return;
    this.onSent?.(msg);
    if (msg.t === 'join') this.name = msg.name;
    this.up.send(encode(msg), msg.t, (frame) => this.relay.receive(this, frame));
  }
  onMessage(cb: (msg: ServerMessage) => void): void {
    this.msgCb = cb;
  }
  onOpen(cb: () => void): void {
    this.openCb = cb;
  }
  onClose(cb: (info?: TransportCloseInfo) => void): void {
    this.closeCb = cb;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.relay.disconnect(this);
    this.closeCb?.({ type: 'manual' });
  }

  /** The network dies under this client (no close handshake from our side). */
  sever(): void {
    if (this.closed) return;
    this.closed = true;
    this.relay.disconnect(this);
    this.closeCb?.({ type: 'close', code: 1006, reason: 'severed', wasClean: false });
  }

  /** Relay to client. */
  deliver(msg: ServerMessage): void {
    if (this.closed) return;
    this.down.send(JSON.stringify(msg), msg.t, (frame) => {
      if (this.closed) return;
      const decoded = decodeServer(frame);
      if (decoded) this.msgCb?.(decoded);
    });
  }

  fireOpen(): void {
    this.open = true;
    this.openCb?.();
  }
}

const MAX_SLOTS = 2;

/** One room of relay/server.mjs, in memory. */
export class MemoryRelay {
  started = false;
  readonly clients = new Map<number, MemoryTransport>();
  /** Every turn frame forwarded, per sender (for assertions). */
  readonly turnsForwarded = new Map<number, number>();
  private nextTransportId = 1;

  constructor(readonly net: VirtualNet) {}

  connect(link: LinkConditions = PERFECT_LINK): MemoryTransport {
    const transport = new MemoryTransport(this.nextTransportId++, this, this.net, link);
    this.net.schedule(this.net.now + link.latencyMs, () => transport.fireOpen());
    return transport;
  }

  receive(from: MemoryTransport, frame: string): void {
    if (from.closed) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(frame) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'join': {
        if (from.playerId !== null) return;
        if (msg.v !== PROTOCOL_VERSION) {
          from.deliver({ t: 'error', message: `protocol mismatch (server v${PROTOCOL_VERSION})` });
          return;
        }
        if (this.started) {
          from.deliver({ t: 'error', message: 'match already started' });
          return;
        }
        const slot = this.nextSlot();
        if (slot === null) {
          from.deliver({ t: 'error', message: 'room full' });
          return;
        }
        from.playerId = slot;
        this.clients.set(slot, from);
        from.deliver({ t: 'joined', v: PROTOCOL_VERSION, room: 'room', playerId: slot, isHost: slot === 1, players: this.roster() });
        this.broadcast({ t: 'roster', players: this.roster() });
        return;
      }
      case 'start':
        if (from.playerId !== 1 || this.started) return;
        this.started = true;
        this.broadcast({ t: 'start', seed: msg.seed | 0, players: this.roster() });
        return;
      case 'turn': {
        if (from.playerId === null) return;
        const cmds = Array.isArray(msg.cmds) ? msg.cmds : [];
        this.turnsForwarded.set(from.playerId, (this.turnsForwarded.get(from.playerId) ?? 0) + 1);
        this.broadcast({ t: 'turn', playerId: from.playerId, forTick: Number(msg.forTick), cmds }, from.playerId);
        return;
      }
      case 'checksum':
        if (from.playerId === null) return;
        this.broadcast({ t: 'checksum', playerId: from.playerId, tick: Number(msg.tick), hash: Number(msg.hash) >>> 0 }, from.playerId);
        return;
    }
  }

  disconnect(transport: MemoryTransport): void {
    const playerId = transport.playerId;
    if (playerId === null || this.clients.get(playerId) !== transport) return;
    this.clients.delete(playerId);
    if (this.started) this.broadcast({ t: 'peer-left', playerId });
    else this.broadcast({ t: 'roster', players: this.roster() });
  }

  private nextSlot(): number | null {
    for (let id = 1; id <= MAX_SLOTS; id++) if (!this.clients.has(id)) return id;
    return null;
  }

  private roster(): PlayerSlot[] {
    return [...this.clients.entries()]
      .map(([playerId, t]) => ({ playerId, name: t.name ?? `Player ${playerId}` }))
      .sort((a, b) => a.playerId - b.playerId);
  }

  private broadcast(msg: ServerMessage, except: number | null = null): void {
    for (const [pid, t] of this.clients) {
      if (pid === except) continue;
      t.deliver(msg);
    }
  }
}
