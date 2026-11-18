/**
 * Where player traces wait on this device: the last few finished matches
 * (newest first, under a size budget so they never crowd out the manual
 * save slots in localStorage), the running match's snapshot a closed tab
 * leaves behind, and the opt-in to download every trace as a file when its
 * match ends. Pure over a small storage interface so it runs in tests.
 */

import { moreCompleteTrace, traceKey, type PlayerTrace } from '../../render/trace/player-trace';

export interface TraceStorage {
  read(key: string): string | null;
  /** False when the write did not happen (quota, private mode). */
  write(key: string, value: string): boolean;
  remove(key: string): void;
}

export const RECENT_TRACES_KEY = 'kingdoms.trace.recent';
export const UNFINISHED_TRACE_KEY = 'kingdoms.trace.unfinished';
export const TRACE_AUTO_DOWNLOAD_KEY = 'kingdoms.trace.autoDownload';

/** Finished matches kept on the device. */
export const MAX_RECENT_TRACES = 3;
/** Size budget of the kept traces, in characters of JSON. */
export const MAX_RECENT_CHARS = 1_000_000;

export function isPlayerTrace(value: unknown): value is PlayerTrace {
  const t = value as PlayerTrace | null;
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof t.version === 'number' &&
    typeof t.player === 'string' &&
    typeof t.startedAt === 'string' &&
    Array.isArray(t.events) &&
    Array.isArray(t.catalog)
  );
}

/** The kept traces, newest first. */
export function readRecentTraces(store: TraceStorage): PlayerTrace[] {
  const raw = store.read(RECENT_TRACES_KEY);
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isPlayerTrace) : [];
  } catch {
    return [];
  }
}

/**
 * Keep `trace` as the newest. Another copy of the same match is replaced by
 * the more complete of the two. A trace over the whole size budget is not
 * kept; otherwise the oldest go first when the count or the budget runs
 * out, or when storage refuses the write.
 */
export function keepRecentTrace(store: TraceStorage, trace: PlayerTrace): void {
  const key = traceKey(trace);
  const earlier = readRecentTraces(store);
  const same = earlier.find((t) => traceKey(t) === key);
  const list = [same ? moreCompleteTrace(same, trace) : trace, ...earlier.filter((t) => traceKey(t) !== key)]
    .filter((t) => JSON.stringify(t).length <= MAX_RECENT_CHARS)
    .slice(0, MAX_RECENT_TRACES);
  while (list.length > 0) {
    const json = JSON.stringify(list);
    if (json.length <= MAX_RECENT_CHARS && store.write(RECENT_TRACES_KEY, json)) return;
    list.pop();
  }
  store.remove(RECENT_TRACES_KEY);
}

/** The running match as it stands, for the next visit if this tab closes. */
export function stashUnfinishedTrace(store: TraceStorage, snapshot: PlayerTrace): void {
  store.write(UNFINISHED_TRACE_KEY, JSON.stringify(snapshot));
}

export function clearUnfinishedTrace(store: TraceStorage): void {
  store.remove(UNFINISHED_TRACE_KEY);
}

/**
 * A closed tab's match: moved into the kept traces (so a blocked download
 * loses nothing) and returned. Null when there is none or it is corrupt.
 */
export function recoverUnfinishedTrace(store: TraceStorage): PlayerTrace | null {
  const raw = store.read(UNFINISHED_TRACE_KEY);
  if (!raw) return null;
  let trace: unknown = null;
  try {
    trace = JSON.parse(raw);
  } catch {
    // Corrupt leftover: dropped below.
  }
  if (isPlayerTrace(trace)) keepRecentTrace(store, trace);
  store.remove(UNFINISHED_TRACE_KEY);
  return isPlayerTrace(trace) ? trace : null;
}

export function traceAutoDownload(store: TraceStorage): boolean {
  return store.read(TRACE_AUTO_DOWNLOAD_KEY) === '1';
}

export function setTraceAutoDownload(store: TraceStorage, on: boolean): void {
  if (on) store.write(TRACE_AUTO_DOWNLOAD_KEY, '1');
  else store.remove(TRACE_AUTO_DOWNLOAD_KEY);
}

/**
 * `?trace` in the address turns the automatic download on and keeps it on
 * (a lobby link without the flag still downloads); `?trace=0` turns it off.
 */
export function applyTraceUrlFlag(store: TraceStorage, search: string): void {
  const params = new URLSearchParams(search);
  if (!params.has('trace')) return;
  const value = (params.get('trace') ?? '').toLowerCase();
  setTraceAutoDownload(store, !['0', 'off', 'false', 'no'].includes(value));
}
