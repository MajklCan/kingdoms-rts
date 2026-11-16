import { describe, expect, it } from 'vitest';
import {
  IDLE_GAG_DELAY_MS,
  IdleGagTracker,
  commanderIdleAnim,
  idleGagFrame,
} from './commander-idle';

describe('commanderIdleAnim', () => {
  it('stays on plain idle until the delay has passed', () => {
    expect(commanderIdleAnim(0).anim).toBe('idle');
    expect(commanderIdleAnim(IDLE_GAG_DELAY_MS).anim).toBe('idle');
  });

  it('smokes first, then rests, sits, rests and smokes again', () => {
    const at = (ms: number) => commanderIdleAnim(IDLE_GAG_DELAY_MS + ms).anim;
    expect(at(1)).toBe('idle-smoke');
    expect(at(11999)).toBe('idle-smoke');
    expect(at(12500)).toBe('idle');
    expect(at(14500)).toBe('idle-sit');
    expect(at(20500)).toBe('idle');
    expect(at(22001)).toBe('idle-smoke');
  });

  it('is a pure function of the idle time', () => {
    expect(commanderIdleAnim(31337)).toEqual(commanderIdleAnim(31337));
  });
});

describe('idleGagFrame', () => {
  it('loops the smoke and holds the last frame of the sit', () => {
    expect(idleGagFrame({ anim: 'idle-smoke', localMs: 6250 }, 24, 250)).toBe(1);
    expect(idleGagFrame({ anim: 'idle-sit', localMs: 5999 }, 12, 500)).toBe(11);
    expect(idleGagFrame({ anim: 'idle-sit', localMs: 99999 }, 12, 500)).toBe(11);
  });
});

describe('IdleGagTracker', () => {
  it('starts the clock when a unit goes idle and resets it on any order', () => {
    const tracker = new IdleGagTracker();
    expect(tracker.pick(7, true, 1000)?.anim).toBe('idle');
    expect(tracker.pick(7, true, 1000 + IDLE_GAG_DELAY_MS + 100)?.anim).toBe('idle-smoke');
    expect(tracker.pick(7, false, 9000)).toBeNull();
    expect(tracker.pick(7, true, 9100)?.anim).toBe('idle');
  });

  it('keeps units apart', () => {
    const tracker = new IdleGagTracker();
    tracker.pick(1, true, 0);
    expect(tracker.pick(2, true, IDLE_GAG_DELAY_MS + 100)?.anim).toBe('idle');
    expect(tracker.pick(1, true, IDLE_GAG_DELAY_MS + 100)?.anim).toBe('idle-smoke');
  });
});
