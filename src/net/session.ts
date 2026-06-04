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
import {
  createSimWorld,
  entityForNetId,
  netIdForEntity,
  step,
  type SimInput,
  type SimWorld,
} from '@sim/world';
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

interface TurnDebug {
  playerId: number;
  forTick: number;
  cmdCount: number;
}

interface ChecksumDebug {
  playerId: number;
  tick: number;
  hash: number;
}

interface ChecksumCompareDebug {
  tick: number;
  peerId: number;
  localHash: number;
  peerHash: number;
  match: boolean;
}

export interface MultiplayerSessionDebugSnapshot {
  state: SessionState;
  localPlayerId: number;
  isHost: boolean;
  room: string;
  playerCount: number;
  worldTick: number | null;
  sendAccumMs: number;
  updates: number;
  sentTurns: number;
  receivedTurns: number;
  sentChecksums: number;
  receivedChecksums: number;
  lastUpdateAtMs: number;
  lastStepAtMs: number;
  lastDeltaMs: number;
  lastBoundedDeltaMs: number;
  lastSentTurn: TurnDebug | null;
  lastReceivedTurn: TurnDebug | null;
  lastSentChecksum: ChecksumDebug | null;
  lastReceivedChecksum: ChecksumDebug | null;
  lastChecksumCompare: ChecksumCompareDebug | null;
  pendingPeerChecksums: Array<{ tick: number; peerId: number; hash: number }>;
  lockstep: ReturnType<Lockstep['debugSnapshot']> | null;
}

/** Largest timer delta we honour, so a throttled tab can catch up without
 *  requesting an unbounded burst of lockstep packets on return. */
const MAX_UPDATE_DELTA_MS = SIM.TICK_MS * 40;

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

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
  private updates = 0;
  private sentTurns = 0;
  private receivedTurns = 0;
  private sentChecksums = 0;
  private receivedChecksums = 0;
  private lastUpdateAtMs = 0;
  private lastStepAtMs = 0;
  private lastDeltaMs = 0;
  private lastBoundedDeltaMs = 0;
  private lastSentTurn: TurnDebug | null = null;
  private lastReceivedTurn: TurnDebug | null = null;
  private lastSentChecksum: ChecksumDebug | null = null;
  private lastReceivedChecksum: ChecksumDebug | null = null;
  private lastChecksumCompare: ChecksumCompareDebug | null = null;

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
    if (!this.world) return;
    this.lockstep?.enqueueLocal(this.encodeInputForWire(input));
  }

  /** Drive from the multiplayer pump with the real elapsed delta (ms). Advances the
   *  lockstep send clock and steps the sim over every ready tick. */
  update(deltaMs: number): void {
    if (this.state !== 'playing' || !this.world || !this.lockstep) return;
    const boundedDelta = Number.isFinite(deltaMs)
      ? Math.max(0, Math.min(deltaMs, MAX_UPDATE_DELTA_MS))
      : 0;
    this.updates++;
    this.lastUpdateAtMs = nowMs();
    this.lastDeltaMs = deltaMs;
    this.lastBoundedDeltaMs = boundedDelta;
    this.sendAccumMs += boundedDelta;

    while (this.sendAccumMs >= SIM.TICK_MS) {
      this.sendAccumMs -= SIM.TICK_MS;
      const pkt = this.lockstep.nextSendPacket();
      this.sentTurns++;
      this.lastSentTurn = { playerId: this.localPlayerId, forTick: pkt.forTick, cmdCount: pkt.cmds.length };
      this.transport.send({ t: 'turn', forTick: pkt.forTick, cmds: pkt.cmds });
    }

    for (const ready of this.lockstep.drainReadyTicks()) {
      for (const input of ready.inputs) this.world.inputs.push(this.decodeInputFromWire(input));
      step(this.world);
      this.lastStepAtMs = nowMs();
      this.maybeChecksum(ready.tick + 1); // tick just completed
    }
  }

  interpolationMs(now = nowMs()): number {
    if (this.state !== 'playing' || this.lastStepAtMs <= 0) return 0;
    return Math.max(0, Math.min(SIM.TICK_MS, now - this.lastStepAtMs));
  }

  get stalled(): boolean {
    return this.lockstep?.isStalled() ?? false;
  }

  debugSnapshot(): MultiplayerSessionDebugSnapshot {
    return {
      state: this.state,
      localPlayerId: this.localPlayerId,
      isHost: this.isHost,
      room: this.room,
      playerCount: this.players.length,
      worldTick: this.world?.tick ?? null,
      sendAccumMs: Math.round(this.sendAccumMs * 100) / 100,
      updates: this.updates,
      sentTurns: this.sentTurns,
      receivedTurns: this.receivedTurns,
      sentChecksums: this.sentChecksums,
      receivedChecksums: this.receivedChecksums,
      lastUpdateAtMs: Math.round(this.lastUpdateAtMs),
      lastStepAtMs: Math.round(this.lastStepAtMs),
      lastDeltaMs: Math.round(this.lastDeltaMs * 100) / 100,
      lastBoundedDeltaMs: Math.round(this.lastBoundedDeltaMs * 100) / 100,
      lastSentTurn: this.lastSentTurn ? { ...this.lastSentTurn } : null,
      lastReceivedTurn: this.lastReceivedTurn ? { ...this.lastReceivedTurn } : null,
      lastSentChecksum: this.lastSentChecksum ? { ...this.lastSentChecksum } : null,
      lastReceivedChecksum: this.lastReceivedChecksum ? { ...this.lastReceivedChecksum } : null,
      lastChecksumCompare: this.lastChecksumCompare ? { ...this.lastChecksumCompare } : null,
      pendingPeerChecksums: [...this.pendingPeerChecksums.entries()].map(([tick, pending]) => ({
        tick,
        peerId: pending.peerId,
        hash: pending.hash,
      })),
      lockstep: this.lockstep?.debugSnapshot() ?? null,
    };
  }

  private maybeChecksum(tick: number): void {
    if (tick % CHECKSUM_INTERVAL_TICKS !== 0 || !this.world) return;
    const hash = checksumWorld(this.world);
    this.localChecksums.set(tick, hash);
    this.sentChecksums++;
    this.lastSentChecksum = { playerId: this.localPlayerId, tick, hash };
    this.transport.send({ t: 'checksum', tick, hash });
    const pending = this.pendingPeerChecksums.get(tick);
    if (pending) {
      this.pendingPeerChecksums.delete(tick);
      this.compareChecksum(tick, hash, pending.hash, pending.peerId);
    }
  }

  private compareChecksum(tick: number, local: number, peer: number, peerId: number): void {
    this.lastChecksumCompare = { tick, localHash: local, peerHash: peer, peerId, match: local === peer };
    if (local !== peer) {
      // eslint-disable-next-line no-console
      console.warn('[Kingdoms MP] desync', this.debugSnapshot());
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
        this.receivedTurns++;
        this.lastReceivedTurn = { playerId: msg.playerId, forTick: msg.forTick, cmdCount: msg.cmds.length };
        this.lockstep?.receivePeerTurn(msg.playerId, msg.forTick, msg.cmds);
        return;
      case 'checksum':
        this.receivedChecksums++;
        this.lastReceivedChecksum = { playerId: msg.playerId, tick: msg.tick, hash: msg.hash };
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
    this.updates = 0;
    this.sentTurns = 0;
    this.receivedTurns = 0;
    this.sentChecksums = 0;
    this.receivedChecksums = 0;
    this.lastUpdateAtMs = 0;
    this.lastStepAtMs = nowMs();
    this.lastDeltaMs = 0;
    this.lastBoundedDeltaMs = 0;
    this.lastSentTurn = null;
    this.lastReceivedTurn = null;
    this.lastSentChecksum = null;
    this.lastReceivedChecksum = null;
    this.lastChecksumCompare = null;

    this.setState('playing');
    this.cb.onMatchStart?.(world, this.localPlayerId);
  }

  private encodeInputForWire(input: SimInput): SimInput {
    if (!this.world) return input;
    const eidsToNetIds = (eids: number[]) =>
      eids
        .map((eid) => netIdForEntity(this.world!, eid))
        .filter((netId): netId is number => netId !== null);
    const eidToNetId = (eid: number) => netIdForEntity(this.world!, eid) ?? -1;
    switch (input.type) {
      case 'cmdMove':
        return { ...input, eids: eidsToNetIds(input.eids) };
      case 'cmdGather':
        return { ...input, eids: eidsToNetIds(input.eids), targetEid: eidToNetId(input.targetEid) };
      case 'cmdStop':
      case 'cmdToggleStance':
      case 'cmdAttackMove':
      case 'cmdRemoveBuildings':
      case 'cmdSetStance':
      case 'cmdSetFormationMode':
      case 'cmdAdjustFormationMode':
      case 'cmdRotateFormation':
      case 'cmdReformFormation':
        return { ...input, eids: eidsToNetIds(input.eids) };
      case 'cmdAttack':
        return { ...input, eids: eidsToNetIds(input.eids), targetEid: eidToNetId(input.targetEid) };
      case 'trainUnit':
        return { ...input, atEid: eidToNetId(input.atEid) };
      case 'cancelProduction':
        return { ...input, atEid: eidToNetId(input.atEid) };
      default:
        return input;
    }
  }

  private decodeInputFromWire(input: SimInput): SimInput {
    if (!this.world) return input;
    const netIdsToEids = (netIds: number[]) =>
      netIds
        .map((netId) => entityForNetId(this.world!, netId))
        .filter((eid): eid is number => eid !== null);
    const netIdToEid = (netId: number) => entityForNetId(this.world!, netId) ?? -1;
    switch (input.type) {
      case 'cmdMove':
        return { ...input, eids: netIdsToEids(input.eids) };
      case 'cmdGather':
        return { ...input, eids: netIdsToEids(input.eids), targetEid: netIdToEid(input.targetEid) };
      case 'cmdStop':
      case 'cmdToggleStance':
      case 'cmdAttackMove':
      case 'cmdRemoveBuildings':
      case 'cmdSetStance':
      case 'cmdSetFormationMode':
      case 'cmdAdjustFormationMode':
      case 'cmdRotateFormation':
      case 'cmdReformFormation':
        return { ...input, eids: netIdsToEids(input.eids) };
      case 'cmdAttack':
        return { ...input, eids: netIdsToEids(input.eids), targetEid: netIdToEid(input.targetEid) };
      case 'trainUnit':
        return { ...input, atEid: netIdToEid(input.atEid) };
      case 'cancelProduction':
        return { ...input, atEid: netIdToEid(input.atEid) };
      default:
        return input;
    }
  }

  private setState(state: SessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.cb.onStateChange?.(state);
  }
}
