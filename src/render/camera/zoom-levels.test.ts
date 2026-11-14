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
  wheelLevels,
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

  it('the first notch is one level whatever its size', () => {
    expect(wheelLevels(0, -100)).toEqual({ levels: 1, rest: 0, notch: 100 });
    expect(wheelLevels(0, 120)).toEqual({ levels: -1, rest: 0, notch: 120 });
    expect(wheelLevels(0, 48)).toEqual({ levels: -1, rest: 0, notch: 48 });
    // A 2x screen reports 200 px per notch.
    expect(wheelLevels(0, -200)).toEqual({ levels: 1, rest: 0, notch: 200 });
  });

  it('merged notches move several levels, up to three', () => {
    expect(wheelLevels(0, -300, 100)).toEqual({ levels: 3, rest: 0, notch: 100 });
    expect(wheelLevels(0, 400, 200)).toEqual({ levels: -2, rest: 0, notch: 200 });
    expect(wheelLevels(0, -900, 100).levels).toBe(3);
    // 200 px notches stay one level each once learned.
    expect(wheelLevels(0, -200, 200).levels).toBe(1);
  });

  it('the notch size learns the smallest discrete event', () => {
    let notch = Infinity;
    const levels: number[] = [];
    for (const d of [-300, -100, -100, -200]) {
      const r = wheelLevels(0, d, notch);
      notch = r.notch;
      levels.push(r.levels);
    }
    expect(levels).toEqual([1, 1, 1, 2]);
    expect(notch).toBe(100);
  });

  it('small trackpad deltas accumulate to a level', () => {
    let acc = 0;
    let levels = 0;
    for (let i = 0; i < 11; i++) {
      const r = wheelLevels(acc, -10);
      acc = r.rest;
      levels += r.levels;
    }
    expect(levels).toBe(1);
    expect(acc).toBeCloseTo(-10, 9);
    // Reversing drops the carry.
    expect(wheelLevels(-90, 5)).toEqual({ levels: 0, rest: 5, notch: Infinity });
  });
});
