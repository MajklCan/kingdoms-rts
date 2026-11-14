import { describe, expect, it } from 'vitest';
import { gustPose } from '../terrain/decor-layer';
import { frameAt } from './part-animator';
import { LifeRng, mapLifeSeed } from './life-kit';

describe('LifeRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = new LifeRng(1234);
    const b = new LifeRng(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('reseeds back to the start of a sequence', () => {
    const rng = new LifeRng(7);
    const first = rng.next();
    rng.next();
    rng.reseed(7);
    expect(rng.next()).toBe(first);
  });

  it('keeps range and int inside their bounds', () => {
    const rng = new LifeRng(99);
    for (let i = 0; i < 200; i++) {
      const r = rng.range(-3, 5);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(5);
      const n = rng.int(4);
      expect(Number.isInteger(n) && n >= 0 && n < 4).toBe(true);
    }
  });
});

describe('mapLifeSeed', () => {
  it('is stable for a map seed, differs between seeds and from the seed itself', () => {
    expect(mapLifeSeed(1234)).toBe(mapLifeSeed(1234));
    expect(mapLifeSeed(1234)).not.toBe(mapLifeSeed(1235));
    expect(mapLifeSeed(1234)).not.toBe(1234);
    expect(Number.isInteger(mapLifeSeed(0xffffffff)) && mapLifeSeed(0xffffffff) >= 0).toBe(true);
  });
});

describe('gustPose', () => {
  it('is a pure function of place and time and uses all three poses', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 20000; t += 37) {
      const p = gustPose(120, 80, t);
      expect(p).toBe(gustPose(120, 80, t));
      seen.add(p);
    }
    expect([...seen].sort()).toEqual([-1, 0, 1]);
  });

  it('rolls across the map: neighbours far apart are out of phase', () => {
    let differ = 0;
    for (let t = 0; t < 4000; t += 50) if (gustPose(0, 0, t) !== gustPose(0, 120, t)) differ++;
    expect(differ).toBeGreaterThan(0);
  });
});

describe('frameAt (animated building parts)', () => {
  it('stays inside the frame range and loops', () => {
    for (let t = 0; t < 6000; t += 13) {
      const f = frameAt(t, 'sails', 0.3, 200, 8);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(8);
    }
    expect(frameAt(0, 'sails', 0, 0, 8)).toBe(frameAt(2600, 'sails', 0, 0, 8));
  });

  it('holds frame 0 for single-frame parts', () => {
    expect(frameAt(12345, 'flag', 0.5, 10, 1)).toBe(0);
  });
});
