import { describe, expect, it } from 'vitest';
import { TraceRecorder, type PlayerTrace, type TraceFeature } from './player-trace';
import { dedupeTraces, formatClock, formatTraceSummary, summarizeTraces } from './trace-summary';

const CATALOG: TraceFeature[] = [
  { id: 'build:HOUSE', label: 'House' },
  { id: 'build:STABLE', label: 'Stable' },
  { id: 'train:VILLAGER', label: 'Villager' },
  { id: 'order:move', label: 'Move' },
  { id: 'group:assign', label: 'Assign control group' },
  { id: 'panel:tech-tree-panel', label: 'Technology panel' },
];

type Step = [tick: number, feature: string, via: 'hotkey' | 'click' | 'touch'];

function traceOf(player: string, steps: Step[], opts: { startTick?: number; failures?: Array<[string, string]> } = {}): PlayerTrace {
  const clock = { tick: opts.startTick ?? 0 };
  const recorder = new TraceRecorder(
    {
      build: '0.0.1-abc',
      mode: 'multiplayer',
      player,
      localPlayerId: player === 'Dominik' ? 1 : 2,
      players: [],
      startedAt: '2026-11-17T19:00:00.000Z',
      tickHz: 20,
      resumed: (opts.startTick ?? 0) > 0,
      catalog: CATALOG,
    },
    () => clock.tick,
    () => 0
  );
  for (const [tick, feature, via] of steps) {
    clock.tick = tick;
    recorder.record(feature, via);
  }
  for (const [reason, detail] of opts.failures ?? []) recorder.recordFailure(reason, detail, 'click');
  clock.tick = 20 * 60 * 12;
  return recorder.finish('victory', '2026-11-17T19:12:00.000Z', null);
}

describe('summarizeTraces', () => {
  const dominik = traceOf(
    'Dominik',
    [
      [100, 'build:HOUSE', 'hotkey'],
      [400, 'build:HOUSE', 'click'],
      [60, 'order:move', 'click'],
      [900, 'panel:tech-tree-panel', 'hotkey'],
    ],
    { failures: [['resources', 'Not enough wood for House'], ['resources', 'Not enough wood for House']] }
  );
  const michal = traceOf(
    'Michal',
    [
      [40, 'build:HOUSE', 'click'],
      [50, 'order:move', 'touch'],
      [70, 'order:move', 'click'],
      [300, 'panel:pause-menu', 'click'],
    ],
    { failures: [['resources', 'Not enough wood for House']] }
  );
  const s = summarizeTraces([dominik, michal]);
  const house = s.used.find((u) => u.id === 'build:HOUSE')!;

  it('counts uses per feature, per source and per player', () => {
    expect(house.uses).toBe(3);
    expect(house.via).toEqual({ hotkey: 1, click: 2, touch: 0 });
    expect(house.byPlayer).toEqual({ Dominik: 2, Michal: 1 });
    expect(house.traces).toBe(2);
    expect(s.via).toEqual({ hotkey: 2, click: 5, touch: 1 });
    expect(s.viaByPlayer.Michal).toEqual({ hotkey: 0, click: 3, touch: 1 });
  });

  it('dates the first use and says who made it', () => {
    expect(house.firstSeconds).toBe(2);
    expect(house.firstBy).toBe('Michal');
    expect(s.used.find((u) => u.id === 'panel:tech-tree-panel')!.firstSeconds).toBe(45);
  });

  it('lists catalog features nobody used, and keeps uses outside the catalog', () => {
    expect(s.unused.map((f) => f.id)).toEqual(['build:STABLE', 'train:VILLAGER', 'group:assign']);
    const pause = s.used.find((u) => u.id === 'panel:pause-menu')!;
    expect(pause.label).toBe('panel:pause-menu');
    expect(pause.group).toBe('panel');
  });

  it('adds up refusals over players', () => {
    expect(s.failures).toEqual([
      { reason: 'resources', detail: 'Not enough wood for House', count: 3, byPlayer: { Dominik: 2, Michal: 1 } },
    ]);
  });

  it('describes each trace', () => {
    expect(s.players).toEqual(['Dominik', 'Michal']);
    expect(s.traces[0]).toMatchObject({ player: 'Dominik', outcome: 'victory', minutes: 12, resumed: false, events: 4 });
  });

  it('reads as a report', () => {
    const text = formatTraceSummary(s);
    expect(text).toContain('Input: hotkey 25% · click 63% · touch 13%');
    expect(text).toMatch(/\[build\]\n {2}House +3 +1\/2\/0 +0:02 Michal +Dominik 2 · Michal 1/);
    expect(text).toContain('Never used (3)');
    expect(text).toContain('[build] Stable');
    expect(text).toContain('[group] Assign control group');
    expect(text).toMatch(/3 +resources +Not enough wood for House/);
  });

  it('counts a match found in several files once', () => {
    const again = summarizeTraces([dominik, michal, structuredClone(dominik), structuredClone(michal)]);
    expect(again.duplicates).toBe(2);
    expect(again.traces).toHaveLength(2);
    expect(again.used.find((u) => u.id === 'build:HOUSE')!.uses).toBe(3);
    expect(again.via).toEqual(s.via);
    expect(again.failures[0]!.count).toBe(3);
    expect(formatTraceSummary(again)).toContain('Traces: 2 (2 duplicate copies left out)');
  });

  it('keeps the most complete copy of a match', () => {
    const snapshot = { ...structuredClone(dominik), outcome: 'unfinished' as const, events: dominik.events.slice(0, 1) };
    expect(dedupeTraces([snapshot, dominik])).toEqual([dominik]);
    expect(dedupeTraces([dominik, snapshot])).toEqual([dominik]);
  });

  it('marks a resumed match', () => {
    const resumed = summarizeTraces([traceOf('Dominik', [[5000, 'order:move', 'click']], { startTick: 4000 })]);
    expect(resumed.traces[0]!.resumed).toBe(true);
  });
});

describe('formatClock', () => {
  it('formats match seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(605.4)).toBe('10:05');
    expect(formatClock(Infinity)).toBe('-');
  });
});
