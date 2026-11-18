import { describe, expect, it } from 'vitest';
import { TraceRecorder, type PlayerTrace } from '../../render/trace/player-trace';
import {
  MAX_RECENT_CHARS,
  MAX_RECENT_TRACES,
  RECENT_TRACES_KEY,
  UNFINISHED_TRACE_KEY,
  applyTraceUrlFlag,
  keepRecentTrace,
  readRecentTraces,
  recoverUnfinishedTrace,
  setTraceAutoDownload,
  stashUnfinishedTrace,
  traceAutoDownload,
  type TraceStorage,
} from './trace-store';

function memoryStorage(limitChars = Infinity): TraceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      if (value.length > limitChars) return false;
      data.set(key, value);
      return true;
    },
    remove: (key) => void data.delete(key),
  };
}

function trace(player: string, minute: number, events = 1, outcome: 'victory' | 'unfinished' = 'victory'): PlayerTrace {
  const recorder = new TraceRecorder(
    {
      build: '0.0.1-abc',
      mode: 'skirmish',
      player,
      localPlayerId: 1,
      players: [],
      startedAt: `2026-11-18T10:${String(minute).padStart(2, '0')}:00.000Z`,
      tickHz: 20,
      resumed: false,
      catalog: [{ id: 'order:move', label: 'Move' }],
    },
    () => 100,
    () => 0
  );
  for (let i = 0; i < events; i++) recorder.record('order:move', 'click');
  return outcome === 'unfinished' ? recorder.snapshot() : recorder.finish(outcome, 'x', null);
}

describe('kept traces', () => {
  it('keeps the newest first and only the last few', () => {
    const store = memoryStorage();
    for (let m = 0; m < MAX_RECENT_TRACES + 2; m++) keepRecentTrace(store, trace('Dominik', m));
    const kept = readRecentTraces(store);
    expect(kept).toHaveLength(MAX_RECENT_TRACES);
    expect(kept.map((t) => t.startedAt.slice(14, 16))).toEqual(['04', '03', '02']);
  });

  it('keeps one copy of a match, the more complete one', () => {
    const store = memoryStorage();
    keepRecentTrace(store, trace('Dominik', 1, 5));
    keepRecentTrace(store, trace('Dominik', 1, 2, 'unfinished'));
    keepRecentTrace(store, trace('Michal', 1, 1));
    const kept = readRecentTraces(store);
    expect(kept.map((t) => [t.player, t.events.length, t.outcome])).toEqual([
      ['Michal', 1, 'victory'],
      ['Dominik', 5, 'victory'],
    ]);
  });

  it('drops the oldest when storage refuses the write or the budget runs out', () => {
    const one = JSON.stringify([trace('Dominik', 0, 40)]).length;
    const store = memoryStorage(one * 2 + 10);
    for (let m = 0; m < 3; m++) keepRecentTrace(store, trace('Dominik', m, 40));
    expect(readRecentTraces(store).map((t) => t.startedAt.slice(14, 16))).toEqual(['02', '01']);

    const huge = memoryStorage();
    keepRecentTrace(huge, trace('Dominik', 0, 1));
    keepRecentTrace(huge, trace('Dominik', 1, Math.ceil(MAX_RECENT_CHARS / 30)));
    expect(readRecentTraces(huge).map((t) => t.startedAt.slice(14, 16))).toEqual(['00']);
  });

  it('reads nothing from a corrupt entry', () => {
    const store = memoryStorage();
    store.write(RECENT_TRACES_KEY, '{nope');
    expect(readRecentTraces(store)).toEqual([]);
    store.write(RECENT_TRACES_KEY, JSON.stringify([{ hello: 1 }, trace('Dominik', 0)]));
    expect(readRecentTraces(store)).toHaveLength(1);
  });
});

describe('a closed tab', () => {
  it('moves the running match into the kept traces on the next visit', () => {
    const store = memoryStorage();
    stashUnfinishedTrace(store, trace('Dominik', 7, 3, 'unfinished'));
    const recovered = recoverUnfinishedTrace(store);
    expect(recovered?.outcome).toBe('unfinished');
    expect(store.data.has(UNFINISHED_TRACE_KEY)).toBe(false);
    expect(readRecentTraces(store).map((t) => t.outcome)).toEqual(['unfinished']);
    expect(recoverUnfinishedTrace(store)).toBeNull();
  });

  it('drops a corrupt leftover', () => {
    const store = memoryStorage();
    store.write(UNFINISHED_TRACE_KEY, 'garbage');
    expect(recoverUnfinishedTrace(store)).toBeNull();
    expect(store.data.size).toBe(0);
  });
});

describe('automatic download', () => {
  it('is off until the player turns it on', () => {
    const store = memoryStorage();
    expect(traceAutoDownload(store)).toBe(false);
    setTraceAutoDownload(store, true);
    expect(traceAutoDownload(store)).toBe(true);
    setTraceAutoDownload(store, false);
    expect(traceAutoDownload(store)).toBe(false);
  });

  it('follows ?trace in the address and remembers it', () => {
    const store = memoryStorage();
    applyTraceUrlFlag(store, '?room=abc');
    expect(traceAutoDownload(store)).toBe(false);
    applyTraceUrlFlag(store, '?trace');
    expect(traceAutoDownload(store)).toBe(true);
    applyTraceUrlFlag(store, '');
    expect(traceAutoDownload(store)).toBe(true);
    applyTraceUrlFlag(store, '?trace=0');
    expect(traceAutoDownload(store)).toBe(false);
  });
});
