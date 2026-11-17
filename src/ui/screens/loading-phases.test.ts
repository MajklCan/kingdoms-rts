import { describe, expect, it } from 'vitest';
import { LORE, LOADING_PHASES, PHASE_COUNT, eyebrowFor, minDisplayMs, phaseCreep, phaseFill, pickLore } from './loading-phases';

describe('loading phases', () => {
  it('has four notches ending on Ready', () => {
    expect(PHASE_COUNT).toBe(4);
    expect(LOADING_PHASES[PHASE_COUNT - 1]).toBe('Ready');
  });

  it('fills only to the notch of finished phases', () => {
    expect(phaseFill(0)).toBe(0);
    expect(phaseFill(2)).toBe(0.5);
    expect(phaseFill(4)).toBe(1);
    expect(phaseFill(9)).toBe(1);
  });

  it('creeps inside a running phase but never past its notch', () => {
    for (let done = 0; done < PHASE_COUNT; done++) {
      expect(phaseCreep(done)).toBeGreaterThan(phaseFill(done));
      expect(phaseCreep(done)).toBeLessThan(phaseFill(done + 1));
    }
  });

  it('holds multiplayer shortest and new matches longest', () => {
    expect(minDisplayMs('multiplayer')).toBeLessThan(minDisplayMs('loaded'));
    expect(minDisplayMs('loaded')).toBeLessThan(minDisplayMs('skirmish'));
    expect(minDisplayMs('campaign')).toBe(minDisplayMs('skirmish'));
    expect(eyebrowFor('loaded')).toBe('Saved game');
  });
});

describe('pickLore', () => {
  it('never repeats the previous line', () => {
    for (let prev = 0; prev < LORE.length; prev++) {
      for (const r of [0, 0.25, 0.5, 0.999]) {
        const next = pickLore(prev, () => r);
        expect(next).not.toBe(prev);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(LORE.length);
      }
    }
  });

  it('reaches every line from a fresh start', () => {
    const seen = new Set<number>();
    for (let i = 0; i < LORE.length; i++) seen.add(pickLore(-1, () => (i + 0.5) / LORE.length));
    expect(seen.size).toBe(LORE.length);
  });

  it('keeps lines short and free of typographic dashes', () => {
    for (const line of LORE) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
