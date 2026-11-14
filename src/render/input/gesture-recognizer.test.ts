import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURE_CONFIG, GestureRecognizer, type GestureEvent } from './gesture-recognizer';

const types = (events: GestureEvent[]): string[] => events.map((e) => e.type);

describe('GestureRecognizer: taps', () => {
  it('a quick release in place is a tap at the down point', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.move(1, 104, 103, 40);
    const out = g.up(1, 104, 103, 80);
    expect(out).toEqual([{ type: 'tap', x: 100, y: 100, count: 1 }]);
    expect(g.activeState).toBe('idle');
  });

  it('movement up to the slop still taps, past it pans', () => {
    const slop = DEFAULT_GESTURE_CONFIG.tapSlop;
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(types(g.move(1, slop, 0, 20))).toEqual([]);
    expect(types(g.up(1, slop, 0, 40))).toEqual(['tap']);

    g.down(2, 0, 0, 1000);
    expect(types(g.move(2, slop + 1, 0, 1020))).toEqual(['panStart', 'pan']);
    expect(types(g.up(2, slop + 1, 0, 1040))).toContain('panEnd');
  });

  it('a second tap close in time and space is a double tap', () => {
    const g = new GestureRecognizer();
    g.down(1, 50, 50, 0);
    g.up(1, 50, 50, 60);
    g.down(2, 60, 55, 200);
    expect(g.up(2, 60, 55, 250)).toEqual([{ type: 'tap', x: 60, y: 55, count: 2 }]);
    // A third tap starts a new pair.
    g.down(3, 60, 55, 400);
    expect(g.up(3, 60, 55, 430)).toEqual([{ type: 'tap', x: 60, y: 55, count: 1 }]);
  });

  it('no double tap when too late or too far', () => {
    const { doubleTapMs, doubleTapSlop } = DEFAULT_GESTURE_CONFIG;
    const late = new GestureRecognizer();
    late.down(1, 0, 0, 0);
    late.up(1, 0, 0, 50);
    late.down(2, 0, 0, 50 + doubleTapMs + 1);
    expect(late.up(2, 0, 0, 60 + doubleTapMs + 1)[0]).toMatchObject({ count: 1 });

    const far = new GestureRecognizer();
    far.down(1, 0, 0, 0);
    far.up(1, 0, 0, 50);
    far.down(2, doubleTapSlop + 1, 0, 100);
    expect(far.up(2, doubleTapSlop + 1, 0, 150)[0]).toMatchObject({ count: 1 });
  });
});

describe('GestureRecognizer: long press', () => {
  it('arms after the long press time and releases as a press', () => {
    const { longPressMs } = DEFAULT_GESTURE_CONFIG;
    const g = new GestureRecognizer();
    g.down(1, 10, 20, 0);
    expect(g.longPressDueAt).toBe(longPressMs);
    expect(g.poll(longPressMs - 1)).toEqual([]);
    expect(g.poll(longPressMs)).toEqual([{ type: 'pressArmed', x: 10, y: 20 }]);
    expect(g.up(1, 12, 21, longPressMs + 100)).toEqual([{ type: 'press', x: 10, y: 20 }]);
  });

  it('a release after the long press time is a press even without a poll', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(types(g.up(1, 0, 0, DEFAULT_GESTURE_CONFIG.longPressMs + 5))).toEqual(['press']);
  });

  it('moving before it arms pans and never arms', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.move(1, 30, 0, 100);
    expect(g.poll(1000)).toEqual([]);
    expect(g.activeState).toBe('panning');
  });

  it('armed then dragged draws a selection box', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.poll(400);
    expect(g.move(1, 150, 160, 450)).toEqual([
      { type: 'boxStart', x: 100, y: 100 },
      { type: 'box', x0: 100, y0: 100, x1: 150, y1: 160 },
    ]);
    expect(g.up(1, 170, 180, 500)).toEqual([
      { type: 'box', x0: 100, y0: 100, x1: 170, y1: 180 },
      { type: 'boxEnd', x0: 100, y0: 100, x1: 170, y1: 180 },
    ]);
  });
});

describe('GestureRecognizer: pan inertia', () => {
  it('a flick releases with its velocity', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    for (let i = 1; i <= 10; i++) g.move(1, i * 20, 0, i * 10);
    const end = g.up(1, 200, 0, 105).find((e) => e.type === 'panEnd');
    expect(end).toBeDefined();
    if (end?.type !== 'panEnd') return;
    expect(end.vx).toBeGreaterThan(1.5);
    expect(end.vx).toBeLessThan(2.5);
    expect(end.vy).toBe(0);
  });

  it('a finger that rests before lifting releases with no velocity', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    for (let i = 1; i <= 5; i++) g.move(1, i * 20, 0, i * 10);
    const end = g.up(1, 100, 0, 50 + DEFAULT_GESTURE_CONFIG.restBeforeReleaseMs + 40).find((e) => e.type === 'panEnd');
    expect(end).toMatchObject({ vx: 0, vy: 0 });
  });
});

describe('GestureRecognizer: pinch', () => {
  it('a second finger starts a pinch with scale relative to the start spread', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    expect(g.down(2, 200, 100, 20)).toEqual([{ type: 'pinchStart', cx: 150, cy: 100 }]);
    expect(g.move(2, 300, 100, 40)).toEqual([{ type: 'pinch', cx: 200, cy: 100, scale: 2 }]);
    expect(g.move(1, 200, 100, 60)).toEqual([{ type: 'pinch', cx: 250, cy: 100, scale: 1 }]);
  });

  it('a second finger ends a pan dead and drops an armed press or a box', () => {
    const pan = new GestureRecognizer();
    pan.down(1, 0, 0, 0);
    pan.move(1, 50, 0, 20);
    expect(pan.down(2, 100, 100, 30)).toEqual([
      { type: 'panEnd', x: 50, y: 0, vx: 0, vy: 0 },
      { type: 'pinchStart', cx: 75, cy: 50 },
    ]);

    const armed = new GestureRecognizer();
    armed.down(1, 0, 0, 0);
    armed.poll(400);
    expect(types(armed.down(2, 10, 10, 410))).toEqual(['pressCancel', 'pinchStart']);

    const box = new GestureRecognizer();
    box.down(1, 0, 0, 0);
    box.poll(400);
    box.move(1, 80, 80, 420);
    expect(types(box.down(2, 10, 10, 430))).toEqual(['boxCancel', 'pinchStart']);
  });

  it('the finger left after a pinch pans and never taps', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 10);
    expect(types(g.up(2, 100, 0, 50))).toEqual(['pinchEnd', 'panStart']);
    expect(types(g.move(1, 5, 0, 60))).toEqual(['pan']);
    expect(types(g.up(1, 5, 0, 70))).toEqual(['pan', 'panEnd']);
    expect(g.activeState).toBe('idle');
  });

  it('a third finger is ignored', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 10);
    expect(g.down(3, 50, 50, 20)).toEqual([]);
    expect(g.up(3, 50, 50, 30)).toEqual([]);
    expect(g.fingerCount).toBe(2);
  });
});

describe('GestureRecognizer: cancel', () => {
  it('a cancelled pan stops dead and resets', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.move(1, 40, 0, 20);
    expect(g.cancel(1, 30)).toEqual([{ type: 'panEnd', x: 40, y: 0, vx: 0, vy: 0 }]);
    expect(g.activeState).toBe('idle');
  });

  it('a cancelled pending touch emits nothing', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(g.cancel(1, 30)).toEqual([]);
    expect(g.activeState).toBe('idle');
  });
});
