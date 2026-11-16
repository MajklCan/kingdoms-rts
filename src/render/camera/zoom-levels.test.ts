import { describe, expect, it } from 'vitest';
import {
  ZOOM_LEVELS,
  anchoredScroll,
  easeOutCubic,
  nearestLevel,
  screenToWorld,
  scrollGridFor,
  stepLevel,
  wheelDeltaPx,
} from './zoom-levels';

describe('zoom levels', () => {
  it('rest on quarter steps from 0.5 to 3', () => {
    expect(ZOOM_LEVELS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]);
  });

  it('scroll grid is the reduced denominator of each level', () => {
    expect(ZOOM_LEVELS.map(scrollGridFor)).toEqual([2, 4, 1, 4, 2, 4, 1, 4, 2, 4, 1]);
    // Every level times its grid is a whole number of screen px (a still pattern).
    for (const z of ZOOM_LEVELS) expect(Number.isInteger(z * scrollGridFor(z))).toBe(true);
    // Chunk origins sit on a 4 px grid: whole screen px at every level.
    for (const z of ZOOM_LEVELS) expect(Number.isInteger(z * 4)).toBe(true);
  });

  it('steps and snaps within the range', () => {
    expect(nearestLevel(1.6)).toBe(1.5);
    expect(nearestLevel(1.7)).toBe(1.75);
    expect(stepLevel(1.5, 1)).toBe(1.75);
    expect(stepLevel(1.5, -2)).toBe(1);
    expect(stepLevel(3, 1)).toBe(3);
    expect(stepLevel(0.5, -1)).toBe(0.5);
  });

  it('eases out and ends exactly on the target', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('anchored zoom', () => {
  it('keeps the world point under the anchor at any zoom', () => {
    const w = 1152;
    const h = 720;
    const before = screenToWorld(300, 200, 40, -60, 1.5, w, h);
    for (const z of [0.5, 0.9, 1.25, 2.2, 3]) {
      const s = anchoredScroll(before.x, before.y, 300, 200, z, w, h);
      const after = screenToWorld(300, 200, s.x, s.y, z, w, h);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it('a centre anchor leaves the scroll alone', () => {
    const before = screenToWorld(576, 360, 10, 20, 1, 1152, 720);
    const s = anchoredScroll(before.x, before.y, 576, 360, 2, 1152, 720);
    expect(s).toEqual({ x: 10, y: 20 });
  });
});

describe('wheel', () => {
  it('normalises line and page deltas to px', () => {
    expect(wheelDeltaPx(3, 1, 800)).toBe(48);
    expect(wheelDeltaPx(1, 2, 800)).toBe(800);
    expect(wheelDeltaPx(100, 0, 800)).toBe(100);
  });
});
