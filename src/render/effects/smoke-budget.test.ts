import { describe, expect, it } from 'vitest';
import { SmokeBudget } from './smoke-budget';

describe('SmokeBudget', () => {
  it('lets a lone chimney use the whole pool', () => {
    const b = new SmokeBudget(6, 1000);
    let took = 0;
    for (let i = 0; i < 10; i++) if (b.tryTake(1, i)) took++;
    expect(took).toBe(6);
  });

  it('splits the pool so chimneys visited later still smoke', () => {
    const b = new SmokeBudget(12, 4000);
    // Four chimneys ask in the same order every frame, as the renderer does.
    const got = new Map<number, number>();
    for (let frame = 0; frame < 60; frame++) {
      for (const source of [1, 2, 3, 4]) {
        if (b.tryTake(source, frame * 16)) got.set(source, (got.get(source) ?? 0) + 1);
      }
    }
    expect([1, 2, 3, 4].map((s) => b.held(s))).toEqual([3, 3, 3, 3]);
    expect([...got.values()].every((n) => n >= 3)).toBe(true);
  });

  it('frees a slot when a puff ends and forgets quiet chimneys', () => {
    const b = new SmokeBudget(2, 100);
    expect(b.tryTake(1, 0)).toBe(true);
    expect(b.tryTake(2, 0)).toBe(true);
    expect(b.tryTake(1, 1)).toBe(false);
    b.release(1);
    expect(b.tryTake(1, 2)).toBe(true);
    b.release(1);
    b.release(2);
    b.prune(500);
    expect(b.activeCount(500)).toBe(1);
    expect(b.tryTake(3, 500)).toBe(true);
    expect(b.tryTake(3, 501)).toBe(true);
  });
});
