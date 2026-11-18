/**
 * Player trace: what one player did in one match, for the post-match review
 * of which features get used, how (hotkey, click or touch) and when. Pure
 * data: no Phaser, no DOM, no world. The recorder only reads a tick getter,
 * so it never touches the sim and never reaches the checksum.
 *
 * Feature ids are "<group>:<name>" (e.g. `build:HOUSE`, `order:move`,
 * `panel:tech-tree-panel`); the group is the part before the first colon.
 * The trace carries the catalog of every feature this build offers, so the
 * report can name the ones nobody touched without importing the game.
 */

import type { PlayerMatchStats } from '@sim/world';

export const PLAYER_TRACE_VERSION = 1;

/** More than a long match ever produces; past it the trace says `truncated`. */
export const MAX_TRACE_EVENTS = 50_000;
export const MAX_TRACE_FAILURES = 5_000;

/**
 * Phaser re-dispatches a queued keydown when another key event arrives in
 * the same frame, so one press can run its hotkey twice. The same hotkey
 * feature again within this many ms is that echo, not a second press.
 */
export const HOTKEY_ECHO_MS = 60;

export type TraceVia = 'click' | 'hotkey' | 'touch';
export const TRACE_VIAS: readonly TraceVia[] = ['hotkey', 'click', 'touch'];

export type TraceMode = 'skirmish' | 'multiplayer';

export type TraceOutcome =
  | 'victory'
  | 'defeat'
  /** Left for the menu before the match was decided. */
  | 'quit'
  /** Restarted from the pause menu (a new trace starts). */
  | 'restart'
  | 'desync'
  | 'peer-left'
  | 'disconnected'
  /** The tab closed mid-match; recovered from storage on the next visit. */
  | 'unfinished';

export interface TraceEvent {
  /** Sim tick the action happened on. */
  t: number;
  /** Feature id. */
  f: string;
  via: TraceVia;
  /** Optional detail (train count, failure text). */
  d?: string;
}

export interface TraceFailure {
  t: number;
  reason: string;
  /** Player-facing text of the refusal. */
  d: string;
  via: TraceVia;
}

export interface TraceFeature {
  id: string;
  label: string;
}

export interface PlayerTrace {
  version: number;
  /** `<package version>-<git commit>`, as the title menu shows it. */
  build: string;
  mode: TraceMode;
  /** Display name of the player who recorded it. */
  player: string;
  localPlayerId: number;
  players: Array<{ playerId: number; name: string }>;
  /** Wall clock, ISO 8601. */
  startedAt: string;
  endedAt: string | null;
  /** Tick the trace started on (a few ticks in: the loading screen fades out). */
  startTick: number;
  /** Picked up mid-match from an autosave: first-use times are not from the start. */
  resumed: boolean;
  endTick: number;
  tickHz: number;
  outcome: TraceOutcome;
  events: TraceEvent[];
  failures: TraceFailure[];
  /** Events or failures past the caps were dropped. */
  truncated: boolean;
  catalog: TraceFeature[];
  /** The local player's match counters at the end (null while running). */
  stats: PlayerMatchStats | null;
}

export interface TraceMeta {
  build: string;
  mode: TraceMode;
  player: string;
  localPlayerId: number;
  players: Array<{ playerId: number; name: string }>;
  startedAt: string;
  tickHz: number;
  resumed: boolean;
  catalog: TraceFeature[];
}

export interface RecordOptions {
  detail?: string;
  /**
   * Count a continuous gesture once: a call within this many ms of the
   * previous call for the same feature extends the gesture instead of
   * recording a new event (camera pans, wheel zoom).
   */
  throttleMs?: number;
}

export function featureGroup(featureId: string): string {
  const i = featureId.indexOf(':');
  return i < 0 ? featureId : featureId.slice(0, i);
}

/** Collects one player's match. Cheap: appends small objects, no copies. */
export class TraceRecorder {
  private readonly events: TraceEvent[] = [];
  private readonly failures: TraceFailure[] = [];
  private readonly lastCallMs = new Map<string, number>();
  private readonly lastHotkeyMs = new Map<string, number>();
  private truncated = false;
  private finished: PlayerTrace | null = null;
  readonly startTick: number;

  constructor(
    private readonly meta: TraceMeta,
    private readonly getTick: () => number,
    private readonly nowMs: () => number
  ) {
    this.startTick = getTick();
  }

  get isFinished(): boolean {
    return this.finished !== null;
  }

  record(feature: string, via: TraceVia, opts: RecordOptions = {}): void {
    if (this.finished) return;
    if (opts.throttleMs !== undefined) {
      const now = this.nowMs();
      const last = this.lastCallMs.get(feature);
      this.lastCallMs.set(feature, now);
      if (last !== undefined && now - last < opts.throttleMs) return;
    } else if (this.isHotkeyEcho(feature, via)) {
      return;
    }
    if (this.events.length >= MAX_TRACE_EVENTS) {
      this.truncated = true;
      return;
    }
    const event: TraceEvent = { t: this.getTick(), f: feature, via };
    if (opts.detail) event.d = opts.detail;
    this.events.push(event);
  }

  recordFailure(reason: string, detail: string, via: TraceVia): void {
    if (this.finished || this.isHotkeyEcho(`fail:${reason}:${detail}`, via)) return;
    if (this.failures.length >= MAX_TRACE_FAILURES) {
      this.truncated = true;
      return;
    }
    this.failures.push({ t: this.getTick(), reason, d: detail, via });
  }

  private isHotkeyEcho(key: string, via: TraceVia): boolean {
    if (via !== 'hotkey') return false;
    const now = this.nowMs();
    const last = this.lastHotkeyMs.get(key);
    if (last !== undefined && now - last < HOTKEY_ECHO_MS) return true;
    this.lastHotkeyMs.set(key, now);
    return false;
  }

  /** The trace so far, marked unfinished (for storage and the debug handle). */
  snapshot(stats: PlayerMatchStats | null = null): PlayerTrace {
    return this.finished ?? this.build('unfinished', null, stats);
  }

  /** Close the trace. Idempotent: later calls return the first result. */
  finish(outcome: TraceOutcome, endedAt: string, stats: PlayerMatchStats | null): PlayerTrace {
    if (!this.finished) this.finished = this.build(outcome, endedAt, stats);
    return this.finished;
  }

  private build(outcome: TraceOutcome, endedAt: string | null, stats: PlayerMatchStats | null): PlayerTrace {
    const m = this.meta;
    return {
      version: PLAYER_TRACE_VERSION,
      build: m.build,
      mode: m.mode,
      player: m.player,
      localPlayerId: m.localPlayerId,
      players: m.players.map((p) => ({ ...p })),
      startedAt: m.startedAt,
      endedAt,
      startTick: this.startTick,
      resumed: m.resumed,
      endTick: this.getTick(),
      tickHz: m.tickHz,
      outcome,
      events: this.events.slice(),
      failures: this.failures.slice(),
      truncated: this.truncated,
      catalog: m.catalog.map((f) => ({ ...f })),
      stats: stats ? structuredCloneStats(stats) : null,
    };
  }
}

function structuredCloneStats(stats: PlayerMatchStats): PlayerMatchStats {
  return JSON.parse(JSON.stringify(stats)) as PlayerMatchStats;
}

/**
 * One match of one player: the same trace downloaded twice (or saved, then
 * downloaded again in a bundle) has the same key.
 */
export function traceKey(trace: Pick<PlayerTrace, 'player' | 'startedAt'>): string {
  return `${trace.player}\u0000${trace.startedAt}`;
}

/**
 * Of two copies of one match's trace, the more complete: a finished one over
 * an unfinished snapshot, then the one with more events, then the later end.
 */
export function moreCompleteTrace(a: PlayerTrace, b: PlayerTrace): PlayerTrace {
  const done = (t: PlayerTrace) => (t.outcome === 'unfinished' ? 0 : 1);
  const order = done(b) - done(a) || b.events.length - a.events.length || b.endTick - a.endTick;
  return order > 0 ? b : a;
}

function fileStamp(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** Download file name: local start time, player and mode, safe on every filesystem. */
export function traceFileName(trace: PlayerTrace): string {
  const who = trace.player.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
  const suffix = trace.outcome === 'unfinished' ? '-unfinished' : '';
  return `kingdoms-trace-${fileStamp(new Date(trace.startedAt))}-${who}-${trace.mode}${suffix}.json`;
}

/** File name of the saved traces downloaded together (a JSON array of traces). */
export function traceBundleFileName(now: Date): string {
  return `kingdoms-trace-saved-${fileStamp(now)}.json`;
}
