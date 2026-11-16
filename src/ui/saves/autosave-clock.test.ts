import { describe, expect, it } from 'vitest';
import { AUTOSAVE_INTERVAL_MS, AutosaveClock } from './autosave-clock';

/** Run frames of `frameMs` from `from` to `to`; returns the triggers that fired. */
function run(clock: AutosaveClock, from: number, to: number, paused: boolean, frameMs = 16): string[] {
  const fired: string[] = [];
  for (let now = from; now <= to; now += frameMs) {
    const trigger = clock.advance(now, paused);
    if (trigger !== 'none') fired.push(trigger);
  }
  return fired;
}

describe('ui/saves/autosave-clock', () => {
  it('fires once per interval of unpaused play', () => {
    const clock = new AutosaveClock();
    expect(run(clock, 0, AUTOSAVE_INTERVAL_MS - 100, false)).toEqual([]);
    expect(run(clock, AUTOSAVE_INTERVAL_MS - 100, AUTOSAVE_INTERVAL_MS + 100, false)).toEqual(['interval']);
    expect(run(clock, AUTOSAVE_INTERVAL_MS + 100, 2 * AUTOSAVE_INTERVAL_MS + 200, false)).toEqual(['interval']);
  });

  it('fires on the frame the match becomes paused, then stays quiet', () => {
    const clock = new AutosaveClock();
    run(clock, 0, 5_000, false);
    expect(clock.advance(5_016, true)).toBe('paused');
    expect(run(clock, 5_032, 120_000, true)).toEqual([]);
  });

  it('does not count paused time and restarts the interval after a pause', () => {
    const clock = new AutosaveClock(1_000);
    run(clock, 0, 900, false, 100);
    expect(clock.advance(1_000, true)).toBe('paused');
    run(clock, 1_100, 9_000, true, 100);
    expect(run(clock, 9_100, 9_900, false, 100)).toEqual([]);
    expect(run(clock, 10_000, 10_100, false, 100)).toEqual(['interval']);
  });

  it('does not fire for a match that starts paused', () => {
    const clock = new AutosaveClock(1_000, true);
    expect(run(clock, 0, 5_000, true, 100)).toEqual([]);
    expect(run(clock, 5_100, 5_900, false, 100)).toEqual([]);
    expect(clock.advance(6_000, false)).toBe('interval');
  });

  it('ignores the time a hidden tab spent without frames', () => {
    const clock = new AutosaveClock(10_000);
    clock.advance(0, false);
    // One frame after ten minutes in the background counts as one second.
    expect(clock.advance(600_000, false)).toBe('none');
    expect(run(clock, 600_100, 608_900, false, 100)).toEqual([]);
    expect(run(clock, 609_000, 609_200, false, 100)).toEqual(['interval']);
  });

  it('restart() postpones the next interval save', () => {
    const clock = new AutosaveClock(1_000);
    run(clock, 0, 900, false, 100);
    clock.restart();
    expect(run(clock, 1_000, 1_800, false, 100)).toEqual([]);
    expect(run(clock, 1_900, 2_000, false, 100)).toEqual(['interval']);
  });
});
