/**
 * Report over one or more player traces: how often each feature was used,
 * hotkey vs click vs touch, when it first came up, who used it, which
 * features nobody touched and which actions the game refused. Pure: the
 * report script runs it in node.
 */

import { TRACE_VIAS, featureGroup, type PlayerTrace, type TraceVia } from './player-trace';

export type ViaCounts = Record<TraceVia, number>;

export interface FeatureUsage {
  id: string;
  label: string;
  group: string;
  uses: number;
  via: ViaCounts;
  /** Earliest use over all traces, in match seconds. */
  firstSeconds: number;
  /** Who made that first use. */
  firstBy: string;
  /** Traces (matches x players) that used it at least once. */
  traces: number;
  byPlayer: Record<string, number>;
}

export interface TraceHeader {
  player: string;
  mode: string;
  outcome: string;
  build: string;
  startedAt: string;
  minutes: number;
  events: number;
  truncated: boolean;
  resumed: boolean;
}

export interface FailureCount {
  reason: string;
  detail: string;
  count: number;
  byPlayer: Record<string, number>;
}

export interface TraceSummary {
  traces: TraceHeader[];
  players: string[];
  via: ViaCounts;
  viaByPlayer: Record<string, ViaCounts>;
  /** Used features, by group, most used first. */
  used: FeatureUsage[];
  /** Catalog features (union over the traces) nobody used. */
  unused: Array<{ id: string; label: string; group: string }>;
  failures: FailureCount[];
}

const emptyVia = (): ViaCounts => ({ hotkey: 0, click: 0, touch: 0 });

export function summarizeTraces(traces: readonly PlayerTrace[]): TraceSummary {
  const labels = new Map<string, string>();
  for (const trace of traces) for (const f of trace.catalog) if (!labels.has(f.id)) labels.set(f.id, f.label);

  const usage = new Map<string, FeatureUsage>();
  const via = emptyVia();
  const viaByPlayer: Record<string, ViaCounts> = {};
  const failures = new Map<string, FailureCount>();
  const players: string[] = [];

  for (const trace of traces) {
    const who = trace.player;
    if (!players.includes(who)) players.push(who);
    const playerVia = (viaByPlayer[who] ??= emptyVia());
    const usedHere = new Set<string>();
    for (const e of trace.events) {
      let u = usage.get(e.f);
      if (!u) {
        u = {
          id: e.f,
          label: labels.get(e.f) ?? e.f,
          group: featureGroup(e.f),
          uses: 0,
          via: emptyVia(),
          firstSeconds: Infinity,
          firstBy: who,
          traces: 0,
          byPlayer: {},
        };
        usage.set(e.f, u);
      }
      u.uses++;
      u.via[e.via]++;
      via[e.via]++;
      playerVia[e.via]++;
      u.byPlayer[who] = (u.byPlayer[who] ?? 0) + 1;
      const seconds = e.t / trace.tickHz;
      if (seconds < u.firstSeconds) {
        u.firstSeconds = seconds;
        u.firstBy = who;
      }
      if (!usedHere.has(e.f)) {
        usedHere.add(e.f);
        u.traces++;
      }
    }
    for (const fail of trace.failures) {
      const key = `${fail.reason}\u0000${fail.d}`;
      let c = failures.get(key);
      if (!c) {
        c = { reason: fail.reason, detail: fail.d, count: 0, byPlayer: {} };
        failures.set(key, c);
      }
      c.count++;
      c.byPlayer[who] = (c.byPlayer[who] ?? 0) + 1;
    }
  }

  const groupOrder = new Map<string, number>();
  for (const id of labels.keys()) {
    const g = featureGroup(id);
    if (!groupOrder.has(g)) groupOrder.set(g, groupOrder.size);
  }
  const byGroup = (a: { group: string }, b: { group: string }) =>
    (groupOrder.get(a.group) ?? Infinity) - (groupOrder.get(b.group) ?? Infinity) || a.group.localeCompare(b.group);

  const used = [...usage.values()].sort((a, b) => byGroup(a, b) || b.uses - a.uses || a.id.localeCompare(b.id));
  const unused = [...labels.entries()]
    .filter(([id]) => !usage.has(id))
    .map(([id, label]) => ({ id, label, group: featureGroup(id) }))
    .sort((a, b) => byGroup(a, b));

  return {
    traces: traces.map((t) => ({
      player: t.player,
      mode: t.mode,
      outcome: t.outcome,
      build: t.build,
      startedAt: t.startedAt,
      minutes: (t.endTick - t.startTick) / t.tickHz / 60,
      events: t.events.length,
      truncated: t.truncated,
      resumed: t.resumed === true,
    })),
    players,
    via,
    viaByPlayer,
    used,
    unused,
    failures: [...failures.values()].sort((a, b) => b.count - a.count),
  };
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function percentages(v: ViaCounts): string {
  const total = v.hotkey + v.click + v.touch;
  if (total === 0) return 'no input';
  return TRACE_VIAS.map((k) => `${k} ${Math.round((v[k] / total) * 100)}%`).join(' · ');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function formatTraceSummary(s: TraceSummary, opts: { maxFailures?: number } = {}): string {
  const lines: string[] = [];
  lines.push(`Traces: ${s.traces.length}`);
  for (const t of s.traces) {
    const notes = [t.resumed ? 'resumed' : '', t.truncated ? 'TRUNCATED' : ''].filter(Boolean).join(', ');
    lines.push(
      `  ${pad(t.player, 14)} ${pad(t.mode, 11)} ${pad(t.outcome, 12)} ${pad(formatClock(t.minutes * 60), 6)} ` +
        `${pad(`${t.events} events`, 12)} ${t.startedAt.slice(0, 16).replace('T', ' ')}  build ${t.build}${notes ? `  (${notes})` : ''}`
    );
  }
  lines.push('');
  lines.push(`Input: ${percentages(s.via)}`);
  for (const p of s.players) lines.push(`  ${pad(p, 14)} ${percentages(s.viaByPlayer[p] ?? emptyVia())}`);

  lines.push('');
  lines.push('Used features   (uses | hotkey/click/touch | first at, by | per player)');
  let group = '';
  for (const u of s.used) {
    if (u.group !== group) {
      group = u.group;
      lines.push(`[${group}]`);
    }
    const perPlayer = s.players.map((p) => `${p} ${u.byPlayer[p] ?? 0}`).join(' · ');
    lines.push(
      `  ${pad(u.label, 34)} ${pad(String(u.uses), 6)} ${pad(`${u.via.hotkey}/${u.via.click}/${u.via.touch}`, 13)} ` +
        `${pad(`${formatClock(u.firstSeconds)} ${u.firstBy}`, 22)} ${perPlayer}`
    );
  }

  lines.push('');
  lines.push(`Never used (${s.unused.length})`);
  group = '';
  let row: string[] = [];
  const flush = () => {
    if (row.length > 0) lines.push(`  [${group}] ${row.join(', ')}`);
    row = [];
  };
  for (const f of s.unused) {
    if (f.group !== group) {
      flush();
      group = f.group;
    }
    row.push(f.label);
  }
  flush();

  const maxFailures = opts.maxFailures ?? 20;
  lines.push('');
  lines.push(`Refused actions (${s.failures.reduce((n, f) => n + f.count, 0)} total, top ${Math.min(maxFailures, s.failures.length)})`);
  for (const f of s.failures.slice(0, maxFailures)) {
    const perPlayer = s.players.map((p) => `${p} ${f.byPlayer[p] ?? 0}`).join(' · ');
    lines.push(`  ${pad(String(f.count), 5)} ${pad(f.reason, 11)} ${pad(f.detail, 48)} ${perPlayer}`);
  }
  return lines.join('\n');
}
