import { describe, expect, it } from 'vitest';
import { formatAmount, formatClock, hpBucket, missingResources, parseCost, parseMeta } from './format';

describe('ui/format', () => {
  it('parses scene cost strings into a resource map', () => {
    expect(parseCost('50 food 100 wood')).toEqual({ food: 50, wood: 100 });
    expect(parseCost('750 Food, 500 gold')).toEqual({ food: 750, gold: 500 });
    expect(parseCost('')).toEqual({});
    expect(parseCost(undefined)).toEqual({});
  });

  it('lists the resources the bank cannot cover', () => {
    const bank = { food: 40, wood: 500, gold: 0, stone: 0 };
    expect(missingResources({ food: 50, wood: 100 }, bank)).toEqual(['food']);
    expect(missingResources({ wood: 100 }, bank)).toEqual([]);
  });

  it('splits action meta into seconds, population and leftovers', () => {
    expect(parseMeta('25s / Pop 1')).toEqual({ seconds: 25, pop: 1, extra: '' });
    expect(parseMeta('40s / Worksite')).toEqual({ seconds: 40, pop: null, extra: 'Worksite' });
    expect(parseMeta(null)).toEqual({ seconds: null, pop: null, extra: '' });
  });

  it('formats match clocks and compact amounts', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatAmount(9999)).toBe('9999');
    expect(formatAmount(12345)).toBe('12.3k');
    expect(formatAmount(2_500_000)).toBe('2.5M');
  });

  it('buckets health for colouring', () => {
    expect(hpBucket(1)).toBe('high');
    expect(hpBucket(0.5)).toBe('mid');
    expect(hpBucket(0.1)).toBe('low');
  });
});
