import { describe, expect, it } from 'vitest';
import { activeTrace, currentVia, noteInput, setActiveTrace, trace } from './active-trace';
import {
  HOTKEY_ECHO_MS,
  MAX_TRACE_EVENTS,
  TraceRecorder,
  featureGroup,
  traceFileName,
  type TraceMeta,
} from './player-trace';

const META: TraceMeta = {
  build: '0.0.1-abc1234',
  mode: 'multiplayer',
  player: 'Dominik',
  localPlayerId: 1,
  players: [
    { playerId: 1, name: 'Dominik' },
    { playerId: 2, name: 'Michal' },
  ],
  startedAt: '2026-11-17T19:05:42.000Z',
  tickHz: 20,
  resumed: false,
  catalog: [{ id: 'order:move', label: 'Move' }],
};

function harness(startTick = 0) {
  const clock = { tick: startTick, ms: 0 };
  const recorder = new TraceRecorder(META, () => clock.tick, () => clock.ms);
  return { clock, recorder };
}

describe('TraceRecorder', () => {
  it('stamps each use with the sim tick and how it came in', () => {
    const { clock, recorder } = harness();
    clock.tick = 40;
    recorder.record('build-arm:HOUSE', 'hotkey');
    clock.tick = 55;
    recorder.record('build:HOUSE', 'click');
    recorder.record('train:VILLAGER', 'touch', { detail: 'x5' });
    const t = recorder.finish('victory', '2026-11-17T19:30:00.000Z', null);
    expect(t.events).toEqual([
      { t: 40, f: 'build-arm:HOUSE', via: 'hotkey' },
      { t: 55, f: 'build:HOUSE', via: 'click' },
      { t: 55, f: 'train:VILLAGER', via: 'touch', d: 'x5' },
    ]);
    expect(t.endTick).toBe(55);
    expect(t.outcome).toBe('victory');
    expect(t.player).toBe('Dominik');
    expect(t.catalog).toEqual(META.catalog);
  });

  it('counts a continuous gesture once and a new gesture again', () => {
    const { clock, recorder } = harness();
    for (let ms = 0; ms <= 2000; ms += 16) {
      clock.ms = ms;
      recorder.record('camera:pan-keys', 'hotkey', { throttleMs: 600 });
    }
    clock.ms = 3000;
    recorder.record('camera:pan-keys', 'hotkey', { throttleMs: 600 });
    expect(recorder.snapshot().events.map((e) => e.f)).toEqual(['camera:pan-keys', 'camera:pan-keys']);
  });

  it('drops the echo of a hotkey Phaser dispatched twice, not a second press', () => {
    const { clock, recorder } = harness();
    clock.ms = 1000;
    recorder.record('select:all-villagers', 'hotkey');
    clock.ms = 1010;
    recorder.record('select:all-villagers', 'hotkey');
    recorder.record('build-arm:HOUSE', 'hotkey');
    recorder.record('order:move', 'click');
    recorder.record('order:move', 'click');
    clock.ms = 1000 + HOTKEY_ECHO_MS + 90;
    recorder.record('select:all-villagers', 'hotkey');
    expect(recorder.snapshot().events.map((e) => e.f)).toEqual([
      'select:all-villagers',
      'build-arm:HOUSE',
      'order:move',
      'order:move',
      'select:all-villagers',
    ]);
  });

  it('keeps refusals apart from feature uses', () => {
    const { clock, recorder } = harness();
    clock.tick = 7;
    recorder.recordFailure('resources', 'Not enough wood for Barracks', 'click');
    recorder.recordFailure('locked', 'Needs the Barracks research', 'hotkey');
    recorder.recordFailure('locked', 'Needs the Barracks research', 'hotkey');
    const t = recorder.snapshot();
    expect(t.events).toEqual([]);
    expect(t.failures).toEqual([
      { t: 7, reason: 'resources', d: 'Not enough wood for Barracks', via: 'click' },
      { t: 7, reason: 'locked', d: 'Needs the Barracks research', via: 'hotkey' },
    ]);
  });

  it('finishes once: later records and outcomes are ignored', () => {
    const { clock, recorder } = harness(100);
    recorder.record('order:move', 'click');
    const first = recorder.finish('quit', '2026-11-17T19:30:00.000Z', null);
    clock.tick = 500;
    recorder.record('order:move', 'click');
    const again = recorder.finish('victory', '2026-11-17T19:40:00.000Z', null);
    expect(again).toBe(first);
    expect(first.events).toHaveLength(1);
    expect(first.startTick).toBe(100);
    expect(first.outcome).toBe('quit');
  });

  it('marks a running trace unfinished and copies it', () => {
    const { recorder } = harness();
    recorder.record('order:move', 'click');
    const snap = recorder.snapshot();
    recorder.record('order:stop', 'click');
    expect(snap.outcome).toBe('unfinished');
    expect(snap.endedAt).toBeNull();
    expect(snap.events).toHaveLength(1);
  });

  it('stops at the event cap and says so', () => {
    const { recorder } = harness();
    for (let i = 0; i <= MAX_TRACE_EVENTS; i++) recorder.record('order:move', 'click');
    const t = recorder.snapshot();
    expect(t.events).toHaveLength(MAX_TRACE_EVENTS);
    expect(t.truncated).toBe(true);
  });
});

describe('trace helpers', () => {
  it('groups features by the part before the colon', () => {
    expect(featureGroup('panel:tech-tree-panel')).toBe('panel');
    expect(featureGroup('build-arm:HOUSE')).toBe('build-arm');
    expect(featureGroup('loose')).toBe('loose');
  });

  it('names the file by local start time, player and mode', () => {
    const d = new Date(META.startedAt);
    const two = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}42`;
    const { recorder } = harness();
    expect(traceFileName(recorder.finish('victory', 'x', null))).toBe(`kingdoms-trace-${stamp}-dominik-multiplayer.json`);
    const { recorder: open } = harness();
    expect(traceFileName(open.snapshot())).toBe(`kingdoms-trace-${stamp}-dominik-multiplayer-unfinished.json`);
  });
});

describe('active trace hooks', () => {
  it('record nothing while no match is traced', () => {
    setActiveTrace(null);
    expect(() => trace('order:move')).not.toThrow();
    expect(activeTrace()).toBeNull();
  });

  it('take the source from the latest raw input unless told otherwise', () => {
    const { recorder } = harness();
    setActiveTrace(recorder);
    try {
      noteInput('key');
      trace('build-arm:HOUSE');
      noteInput('pointer', 'mouse');
      trace('select:click');
      noteInput('pointer', 'touch');
      trace('select:box');
      trace('camera:zoom-wheel', { via: 'click' });
      expect(currentVia()).toBe('touch');
      expect(recorder.snapshot().events.map((e) => [e.f, e.via])).toEqual([
        ['build-arm:HOUSE', 'hotkey'],
        ['select:click', 'click'],
        ['select:box', 'touch'],
        ['camera:zoom-wheel', 'click'],
      ]);
    } finally {
      setActiveTrace(null);
      noteInput('pointer');
    }
  });
});
