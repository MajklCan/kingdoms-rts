import { describe, expect, it } from 'vitest';
import {
  NOTCH_FACTOR,
  ZOOM_TAU_MS,
  clampZoom,
  easeZoom,
  settleLevel,
  targetAfterNotches,
  wheelNotches,
} from './smooth-zoom';
import { ZOOM_MAX, ZOOM_MIN, anchoredScroll, screenToWorld } from './zoom-levels';

describe('wheelNotches', () => {
  it('the first discrete event is one notch whatever its size', () => {
    expect(wheelNotches(-100)).toEqual({ notches: 1, notch: 100 });
    expect(wheelNotches(120)).toEqual({ notches: -1, notch: 120 });
    expect(wheelNotches(-200)).toEqual({ notches: 1, notch: 200 });
  });

  it('merged notches move several, up to three, once the size is learned', () => {
    expect(wheelNotches(-300, 100).notches).toBe(3);
    expect(wheelNotches(400, 200).notches).toBe(-2);
    expect(wheelNotches(-900, 100).notches).toBe(3);
    expect(wheelNotches(-200, 200).notches).toBe(1);
  });

  it('learns the smallest discrete event', () => {
    let notch = Infinity;
    const out: number[] = [];
    for (const d of [-300, -100, -100, -200]) {
      const r = wheelNotches(d, notch);
      notch = r.notch;
      out.push(r.notches);
    }
    expect(out).toEqual([1, 1, 1, 2]);
    expect(notch).toBe(100);
  });

  it('small deltas add up to the same zoom as one notch', () => {
    let target = 1.5;
    for (let i = 0; i < 10; i++) target = targetAfterNotches(target, wheelNotches(-10).notches);
    expect(target).toBeCloseTo(1.5 * NOTCH_FACTOR, 9);
  });

  it('a notch is about 11 percent', () => {
    expect(targetAfterNotches(1, 1)).toBeCloseTo(1.11, 9);
    expect(targetAfterNotches(1, -1)).toBeCloseTo(1 / 1.11, 9);
  });

  it('clamps to the existing range', () => {
    expect(targetAfterNotches(ZOOM_MAX, 3)).toBe(ZOOM_MAX);
    expect(targetAfterNotches(ZOOM_MIN, -3)).toBe(ZOOM_MIN);
    expect(clampZoom(10)).toBe(ZOOM_MAX);
  });
});

describe('easeZoom', () => {
  it('covers 1 - 1/e of the log gap in one time constant', () => {
    const z = easeZoom(1, Math.E, ZOOM_TAU_MS);
    expect(Math.log(z)).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('is frame rate independent', () => {
    let a = 1;
    for (let i = 0; i < 6; i++) a = easeZoom(a, 2, 1000 / 60);
    let b = 1;
    for (let i = 0; i < 3; i++) b = easeZoom(b, 2, 1000 / 30);
    expect(a).toBeCloseTo(b, 9);
  });

  it('never overshoots, even on a huge frame, and lands exactly', () => {
    expect(easeZoom(1, 2, 10_000)).toBeLessThanOrEqual(2);
    expect(easeZoom(2, 1, 10_000)).toBeGreaterThanOrEqual(1);
    expect(easeZoom(1.99999, 2, 16)).toBe(2);
    expect(easeZoom(1, 2, 0)).toBe(1);
  });

  it('reversing the target reverses at once (no queue)', () => {
    const up = easeZoom(1, 2, 16);
    expect(up).toBeGreaterThan(1);
    expect(easeZoom(up, 0.5, 16)).toBeLessThan(up);
  });
});

describe('settleLevel', () => {
  it('settles near a level and leaves a far target alone', () => {
    expect(settleLevel(1.52)).toBe(1.5);
    expect(settleLevel(1.6)).toBe(1.5);
    expect(settleLevel(0.5)).toBe(0.5);
    expect(settleLevel(0.88)).toBeNull();
    expect(settleLevel(0.88, 0.2)).toBe(1);
  });
});

describe('anchor through a smooth zoom', () => {
  it('keeps the world point under the cursor at every fractional zoom', () => {
    const w = 1280;
    const h = 720;
    const sx = 900;
    const sy = 200;
    const world = screenToWorld(sx, sy, 40, -30, 1.5, w, h);
    let z = 1.5;
    for (let i = 0; i < 30; i++) {
      z = easeZoom(z, 2.4, 16);
      const s = anchoredScroll(world.x, world.y, sx, sy, z, w, h);
      const back = screenToWorld(sx, sy, s.x, s.y, z, w, h);
      expect(back.x).toBeCloseTo(world.x, 9);
      expect(back.y).toBeCloseTo(world.y, 9);
    }
  });
});
