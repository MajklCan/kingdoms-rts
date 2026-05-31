/**
 * MultiplayerSession — glue between the relay transport, the lockstep scheduler,
 * and the deterministic sim. It is the sole driver of tick advancement while a
 * networked match is in progress (the free-running render accumulator must NOT
 * step the sim in multiplayer; it only renders + interpolates).
 *
 * Lifecycle: lobby → (host) start → playing → (desync | peer-left | ended).
 */

import { SIM } from '../config';
import { checksumWorld } from '@sim/checksum';
import { createSimWorld, step, type SimInput, type SimWorld } from '@sim/world';
import { LOCAL_PLAYER_ID } from '@sim/world';
import { Lockstep } from './lockstep';
import {
  CHECKSUM_INTERVAL_TICKS,
  DEFAULT_INPUT_DELAY,
  PROTOCOL_VERSION,
  type PlayerSlot,
  type ServerMessage,
} from './protocol';
import type { Transport } from './transport';

export type SessionState =
  | 'connecting'
  | 'lobby'
  | 'playing'
  | 'desync'
  | 'peer-left'
  | 'disconnected';

export interface SessionCallbacks {
  onStateChange?: (state: SessionState) => void;
  onRoster?: (players: PlayerSlot[], localPlayerId: number, isHost: boolean) => void;
  /** Fired once the deterministic world is built and the match begins. */
  onMatchStart?: (world: SimWorld, localPlayerId: number) => void;
  onDesync?: (tick: number, localHash: number, peerHash: number, peerId: number) => void;
  /** Fired when the relay rejects us (protocol mismatch, room full, already started). */
  onError?: (message: string) => void;
}

/** Largest frame delta we honour, so a backgrounded tab can't request a huge
 *  burst of catch-up ticks on return. */
const MAX_FRAME_DELTA_MS = 250;

export class MultiplayerSession {
  state: SessionState = 'connecting';
  localPlayerId = LOCAL_PLAYER_ID;
  isHost = false;
  players: PlayerSlot[] = [];
  world: SimWorld | null = null;

  private lockstep: Lockstep | null = null;
  private sendAccumMs = 0;
  private readonly localChecksums = new Map<number, number>();
  private readonly pendingPeerChecksums = new Map<number, { peerId: number; hash: number }>();

  constructor(
    private readonly transport: Transport,
    private readonly room: string,
    private readonly name: string,
    private readonly cb: SessionCallbacks = {}
  ) {
    transport.onOpen(() => {
      transport.send({ t: 'join', v: PROTOCOL_VERSION, room: this.room, name: this.name });
    });
    transport.onMessage((msg) => this.handle(msg));
    transport.onClose(() => this.setState('disconnected'));
  }

  /** Host-only: start the match with a seed (defaults to a time-free random). */
  start(seed: number): void {
    if (!this.isHost) return;
    this.transport.send({ t: 'start', seed });
  }

  /** Issue a local, already self-describing command. It is scheduled for a
   *  future tick and applied identically on every client. */
  sendCommand(input: SimInput): void {
    this.lockstep?.enqueueLocal(input);
  }

  /** Drive from the render loop with the real frame delta (ms). Advances the
   *  lockstep send clock and steps the sim over every ready tick. */
  update(deltaMs: number): void {
    if (this.state !== 'playing' || !this.world || !this.lockstep) return;
    this.sendAccumMs += Math.min(deltaMs, MAX_FRAME_DELTA_MS);

    while (this.sendAccumMs >= SIM.TICK_MS) {
      this.sendAccumMs -= SIM.TICK_MS;
      const pkt = this.lockstep.nextSendPacket();
      this.transport.send({ t: 'turn', forTick: pkt.forTick, cmds: pkt.cmds });
    }

    for (const ready of this.lockstep.drainReadyTicks()) {
      for (const input of ready.inputs) this.world.inputs.push(input);
      step(this.world);
      this.maybeChecksum(ready.tick + 1); // tick just completed
    }
  }

  get stalled(): boolean {
    return this.lockstep?.isStalled() ?? false;
  }

  private maybeChecksum(tick: number): void {
    if (tick % CHECKSUM_INTERVAL_TICKS !== 0 || !this.world) return;
    const hash = checksumWorld(this.world);
    this.localChecksums.set(tick, hash);
    this.transport.send({ t: 'checksum', tick, hash });
    const pending = this.pendingPeerChecksums.get(tick);
    if (pending) {
      this.pendingPeerChecksums.delete(tick);
      this.compareChecksum(tick, hash, pending.hash, pending.peerId);
    }
  }

  private compareChecksum(tick: number, local: number, peer: number, peerId: number): void {
    if (local !== peer) {
      this.cb.onDesync?.(tick, local, peer, peerId);
      this.setState('desync');
    }
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'joined':
        this.localPlayerId = msg.playerId;
        this.isHost = msg.isHost;
        this.players = msg.players;
        this.setState('lobby');
        this.cb.onRoster?.(this.players, this.localPlayerId, this.isHost);
        return;
      case 'roster':
        this.players = msg.players;
        this.cb.onRoster?.(this.players, this.localPlayerId, this.isHost);
        return;
      case 'start':
        this.beginMatch(msg.seed, msg.players);
        return;
      case 'turn':
        this.lockstep?.receivePeerTurn(msg.playerId, msg.forTick, msg.cmds);
        return;
      case 'checksum':
        this.handlePeerChecksum(msg.playerId, msg.tick, msg.hash);
        return;
      case 'peer-left':
        this.setState('peer-left');
        return;
      case 'error':
        this.cb.onError?.(msg.message);
        this.setState('disconnected');
        return;
    }
  }

  private handlePeerChecksum(peerId: number, tick: number, hash: number): void {
    const local = this.localChecksums.get(tick);
    if (local !== undefined) {
      this.localChecksums.delete(tick);
      this.compareChecksum(tick, local, hash, peerId);
    } else {
      this.pendingPeerChecksums.set(tick, { peerId, hash });
    }
  }

  private beginMatch(seed: number, players: PlayerSlot[]): void {
    this.players = players;
    const world = createSimWorld(seed);
    // Every listed player is human → suppress the AI controller for all of them.
    world.humanPlayers = new Set(players.map((p) => p.playerId));
    world.paused = false;
    this.world = world;

    const peerIds = players.map((p) => p.playerId).filter((id) => id !== this.localPlayerId);
    this.lockstep = new Lockstep(this.localPlayerId, peerIds, DEFAULT_INPUT_DELAY);
    this.sendAccumMs = 0;
    this.localChecksums.clear();
    this.pendingPeerChecksums.clear();

    this.setState('playing');
    this.cb.onMatchStart?.(world, this.localPlayerId);
  }

  private setState(state: SessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.cb.onStateChange?.(state);
  }
}
