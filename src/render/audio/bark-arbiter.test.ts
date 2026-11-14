import { describe, expect, it } from 'vitest';
import { BarkArbiter } from './bark-arbiter';

const LINES = [0, 1, 2, 3];
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('BarkArbiter', () => {
  it('plays one line at a time: a select while talking is skipped', () => {
    const a = new BarkArbiter();
    const d = a.request(0, 'soldier_1', 'select', LINES, () => 0);
    expect(d.action).toBe('play');
    a.started(0, 'soldier_1', 'select', d.line!, 700);
    expect(a.request(300, 'soldier_1', 'select', LINES, () => 0)).toMatchObject({ action: 'skip', reason: 'busy' });
    expect(a.isSpeaking(300)).toBe(true);
    expect(a.isSpeaking(701)).toBe(false);
  });

  it('a command replaces a select line, but not a fresh command', () => {
    const a = new BarkArbiter();
    a.started(0, 'soldier_1', 'select', 0, 800);
    expect(a.request(300, 'soldier_1', 'move', LINES, () => 0).action).toBe('replace');
    a.started(300, 'soldier_1', 'move', 0, 800);
    expect(a.request(500, 'soldier_1', 'attack', LINES, () => 0)).toMatchObject({ action: 'skip', reason: 'busy' });
    expect(a.request(800, 'soldier_1', 'attack', LINES, () => 0).action).toBe('replace');
  });

  it('spam-clicking starts at most one line per gap', () => {
    const a = new BarkArbiter();
    let started = 0;
    for (let t = 0; t < 1400; t += 120) {
      const d = a.request(t, 'soldier_2', 'select', LINES, Math.random);
      if (d.action !== 'skip') {
        a.started(t, 'soldier_2', 'select', d.line!, 700);
        started++;
      }
    }
    // 1.4 s of clicks, 0.7 s lines, one at a time: two lines, none cut.
    expect(started).toBe(2);
  });

  it('never repeats the same line twice in a row for a persona + type', () => {
    const a = new BarkArbiter({ minStartGapMs: 0, selectGapAfterEndMs: 0 });
    // A rand that would always pick the first element of whatever pool it gets.
    let last = -1;
    for (let i = 0; i < 50; i++) {
      const d = a.request(i * 1000, 'villager_male', 'select', LINES, seq(0, 0.99, 0.5));
      expect(d.line).not.toBe(last);
      a.started(i * 1000, 'villager_male', 'select', d.line!, 500);
      last = d.line!;
    }
  });

  it('a single available line may repeat; no lines means skip', () => {
    const a = new BarkArbiter({ minStartGapMs: 0, selectGapAfterEndMs: 0 });
    a.started(0, 'soldier_3', 'move', 2, 100);
    expect(a.request(1000, 'soldier_3', 'move', [2], () => 0).line).toBe(2);
    expect(a.request(1000, 'soldier_3', 'move', [], () => 0)).toMatchObject({ action: 'skip', reason: 'no-lines' });
  });

  it('silence() frees the floor immediately', () => {
    const a = new BarkArbiter({ minStartGapMs: 0, selectGapAfterEndMs: 0 });
    a.started(0, 'soldier_1', 'select', 0, 900);
    a.silence(100);
    expect(a.request(150, 'soldier_1', 'select', LINES, () => 0).action).toBe('play');
  });
});
