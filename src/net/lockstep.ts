/**
 * Lockstep turn scheduler — pure, transport-agnostic, deterministic.
 *
 * Model: a command issued locally is broadcast on a steady wall-clock cadence
 * tagged with a future target tick (`sendTick`, which advances every loop
 * iteration so the outgoing stream is always contiguous — no deadlock). A tick
 * may only be EXECUTED once every player's packet for that tick has arrived.
 * Ticks below the input delay execute immediately with no commands (warm-up).
 *
 * The send clock is decoupled from the exec clock: we keep emitting (even empty)
 * packets while stalled, so a slow peer can never deadlock the room. The sim
 * advances only through {@link drainReadyTicks}.
 *
 * Determinism: commands for a tick are replayed in ascending playerId order,
 * and within a player in the order they were enqueued. Every client sees the
 * same packet set, so every client computes the same command sequence.
 */

import type { SimInput } from '@sim/world';

export interface OutgoingTurn {
  forTick: number;
  cmds: SimInput[];
}

export interface ReadyTick {
  tick: number;
  inputs: SimInput[];
}

export interface LockstepDebugSnapshot {
  localPlayerId: number;
  playerIds: number[];
  inputDelay: number;
  sendTick: number;
  execTick: number;
  stalled: boolean;
  pendingLocalCmds: number;
  bufferedTicks: number;
  blockedTick: number;
  missingPlayers: number[];
  window: Array<{
    tick: number;
    receivedPlayers: number[];
    missingPlayers: number[];
    cmdCount: number;
  }>;
}

/** Cap how many ticks we execute per drain so catch-up after a stall can't
 *  spiral the sim and freeze the render thread. */
const MAX_CATCHUP_TICKS = 8;

export class Lockstep {
  private readonly playerIds: number[];
  private readonly inputDelay: number;

  /** Next tick our outgoing packet targets. Advances once per `nextSendPacket`. */
  private sendTick: number;
  /** Next tick to execute. Advances only when a tick is fully received. */
  private execTick = 0;

  /** Commands queued locally since the last `nextSendPacket`. */
  private localPending: SimInput[] = [];
  /** received[tick] -> (playerId -> commands). */
  private readonly received = new Map<number, Map<number, SimInput[]>>();

  constructor(
    private readonly localPlayerId: number,
    peerIds: number[],
    inputDelay: number
  ) {
    this.playerIds = [localPlayerId, ...peerIds].sort((a, b) => a - b);
    this.inputDelay = Math.max(1, inputDelay);
    this.sendTick = this.inputDelay;
  }

  get currentExecTick(): number {
    return this.execTick;
  }

  /** Queue a local command. It rides out on the next outgoing packet and
   *  executes `inputDelay` ticks after that packet's target tick is reached. */
  enqueueLocal(input: SimInput): void {
    this.localPending.push(input);
  }

  /**
   * Produce the next outgoing packet (called once per wall-clock loop tick).
   * Also records our own packet locally so execution includes our commands.
   * Returns the packet to hand to the transport.
   */
  nextSendPacket(): OutgoingTurn {
    const forTick = this.sendTick;
    const cmds = this.localPending;
    this.localPending = [];
    this.sendTick += 1;
    this.recordReceived(forTick, this.localPlayerId, cmds);
    return { forTick, cmds };
  }

  /** Ingest a peer's packet. Idempotent per (tick, playerId). */
  receivePeerTurn(playerId: number, forTick: number, cmds: SimInput[]): void {
    if (playerId === this.localPlayerId) return; // our own comes from nextSendPacket
    this.recordReceived(forTick, playerId, cmds);
  }

  private recordReceived(tick: number, playerId: number, cmds: SimInput[]): void {
    if (tick < this.execTick) return; // too late to matter; drop
    let m = this.received.get(tick);
    if (!m) {
      m = new Map();
      this.received.set(tick, m);
    }
    if (!m.has(playerId)) m.set(playerId, cmds);
  }

  /** Is `tick` ready to execute (warm-up tick, or all players' packets in)? */
  private isReady(tick: number): boolean {
    if (tick < this.inputDelay) return true;
    const m = this.received.get(tick);
    if (!m) return false;
    for (const p of this.playerIds) {
      if (!m.has(p)) return false;
    }
    return true;
  }

  /**
   * Advance the exec clock over every contiguous ready tick (bounded by
   * {@link MAX_CATCHUP_TICKS}). Returns the inputs to apply for each tick, in
   * order. The caller steps the sim once per returned entry.
   */
  drainReadyTicks(): ReadyTick[] {
    const out: ReadyTick[] = [];
    while (out.length < MAX_CATCHUP_TICKS && this.isReady(this.execTick)) {
      const tick = this.execTick;
      const inputs: SimInput[] = [];
      const m = this.received.get(tick);
      if (m) {
        for (const p of this.playerIds) {
          const cs = m.get(p);
          if (cs) for (const c of cs) inputs.push(c);
        }
      }
      this.received.delete(tick);
      out.push({ tick, inputs });
      this.execTick += 1;
    }
    return out;
  }

  /** True when we're waiting on a peer's packet to proceed (UI "waiting" hint). */
  isStalled(): boolean {
    return !this.isReady(this.execTick);
  }

  debugSnapshot(windowTicks = 8): LockstepDebugSnapshot {
    const tickWindow: LockstepDebugSnapshot['window'] = [];
    for (let tick = this.execTick; tick < this.execTick + Math.max(1, windowTicks); tick++) {
      const m = this.received.get(tick);
      const receivedPlayers = m ? [...m.keys()].sort((a, b) => a - b) : [];
      const missingPlayers = this.missingPlayersForTick(tick);
      let cmdCount = 0;
      if (m) for (const cmds of m.values()) cmdCount += cmds.length;
      tickWindow.push({ tick, receivedPlayers, missingPlayers, cmdCount });
    }
    return {
      localPlayerId: this.localPlayerId,
      playerIds: this.playerIds.slice(),
      inputDelay: this.inputDelay,
      sendTick: this.sendTick,
      execTick: this.execTick,
      stalled: this.isStalled(),
      pendingLocalCmds: this.localPending.length,
      bufferedTicks: this.received.size,
      blockedTick: this.execTick,
      missingPlayers: this.missingPlayersForTick(this.execTick),
      window: tickWindow,
    };
  }

  private missingPlayersForTick(tick: number): number[] {
    if (tick < this.inputDelay) return [];
    const m = this.received.get(tick);
    if (!m) return this.playerIds.slice();
    return this.playerIds.filter((playerId) => !m.has(playerId));
  }
}
