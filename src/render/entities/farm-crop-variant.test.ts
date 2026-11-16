import { describe, expect, it } from 'vitest';
import { farmCrop, HEMP_ONE_IN } from './farm-crop-variant';

describe('farmCrop', () => {
  it('is deterministic for the same inputs', () => {
    for (let i = 0; i < 50; i++) {
      expect(farmCrop(i * 3, i * 7, 1234)).toBe(farmCrop(i * 3, i * 7, 1234));
    }
  });

  it('turns about one farm in ten into hemp', () => {
    let hemp = 0;
    for (let i = 0; i < 1000; i++) {
      if (farmCrop(i % 40, Math.floor(i / 40) * 2, 42) === 'hemp') hemp++;
    }
    expect(hemp / 1000).toBeGreaterThan(0.07);
    expect(hemp / 1000).toBeLessThan(0.13);
    expect(HEMP_ONE_IN).toBe(10);
  });

  it('depends on the map seed', () => {
    let diff = 0;
    for (let i = 0; i < 500; i++) {
      if (farmCrop(i, i * 5, 1) !== farmCrop(i, i * 5, 2)) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });
});
