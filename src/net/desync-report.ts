/**
 * Desync forensics. A session records what it needs to replay its match
 * offline: the seed and players, every command in the order it ran (wire form,
 * NetIds) and its own checksum at every checkpoint. On a desync both players
 * download a report; `replayDesyncReport` re-runs it from the seed and names
 * the first checkpoint where that client left the canonical run, so the two
 * reports say which client drifted and in which second.
 */

import { checksumWorld } from '@sim/checksum';
import { createSimWorld, step, type SimInput, type SimWorld } from '@sim/world';
import { decodeInputFromWire } from './commands';
import { CHECKSUM_INTERVAL_TICKS, type PlayerSlot } from './protocol';

export const DESYNC_REPORT_VERSION = 1;

export interface DesyncMismatch {
  tick: number;
  localHash: number;
  peerHash: number;
  peerId: number;
}

export interface DesyncReport {
  version: number;
  build: string;
  room: string;
  localPlayerId: number;
  seed: number;
  players: PlayerSlot[];
  /** Ticks that carried commands, in the order they ran (wire form). */
  commands: Array<{ tick: number; inputs: SimInput[] }>;
  /** Our checksum per checkpoint as [tick, hash], ascending. */
  checksums: Array<[number, number]>;
  mismatch: DesyncMismatch | null;
  /** Tail of the session's event log. */
  events: unknown[];
}

/** Collects one match's commands and checkpoints. Cheap: no world copies. */
export class MatchRecorder {
  private readonly commands: Array<{ tick: number; inputs: SimInput[] }> = [];
  private readonly checksums: Array<[number, number]> = [];
  mismatch: DesyncMismatch | null = null;

  constructor(
    readonly seed: number,
    readonly players: PlayerSlot[]
  ) {}

  recordTick(tick: number, inputs: SimInput[]): void {
    if (inputs.length > 0) this.commands.push({ tick, inputs });
  }

  recordChecksum(tick: number, hash: number): void {
    this.checksums.push([tick, hash]);
  }

  report(meta: { room: string; localPlayerId: number; events: unknown[] }): DesyncReport {
    return {
      version: DESYNC_REPORT_VERSION,
      build: `${__APP_VERSION__}-${__GIT_COMMIT__}`,
      room: meta.room,
      localPlayerId: meta.localPlayerId,
      seed: this.seed,
      players: this.players.map((p) => ({ ...p })),
      commands: this.commands.map((c) => ({ tick: c.tick, inputs: c.inputs })),
      checksums: this.checksums.slice(),
      mismatch: this.mismatch ? { ...this.mismatch } : null,
      events: meta.events,
    };
  }
}

export interface ReplayResult {
  /** Checkpoints compared before stopping. */
  checked: number;
  /** First checkpoint whose replayed hash differs from the report, or null. */
  firstMismatch: { tick: number; reportHash: number; replayHash: number } | null;
  /** The replayed world, stopped at the first mismatch or the last checkpoint. */
  world: SimWorld;
}

/**
 * Re-run a report exactly as MultiplayerSession runs a match: same world
 * setup, the recorded commands decoded per tick, one step per tick, a
 * checksum after every checkpoint tick.
 */
export function replayDesyncReport(
  report: DesyncReport,
  createWorld: (seed: number) => SimWorld = (seed) => createSimWorld(seed)
): ReplayResult {
  const world = createWorld(report.seed);
  world.humanPlayers = new Set(report.players.map((p) => p.playerId));
  world.paused = false;
  const byTick = new Map(report.commands.map((c) => [c.tick, c.inputs]));
  const expected = new Map(report.checksums);
  const lastTick = report.checksums.length > 0 ? report.checksums[report.checksums.length - 1][0] : 0;
  let checked = 0;
  for (let tick = 0; tick < lastTick; tick++) {
    for (const input of byTick.get(tick) ?? []) world.inputs.push(decodeInputFromWire(world, input));
    step(world);
    const done = tick + 1;
    if (done % CHECKSUM_INTERVAL_TICKS !== 0) continue;
    const reportHash = expected.get(done);
    if (reportHash === undefined) continue;
    const replayHash = checksumWorld(world);
    if (replayHash !== reportHash) return { checked, firstMismatch: { tick: done, reportHash, replayHash }, world };
    checked++;
  }
  return { checked, firstMismatch: null, world };
}
