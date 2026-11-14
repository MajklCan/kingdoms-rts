import { describe, expect, it } from 'vitest';
import { SPATIAL_CULL_GAIN, isInView, spatialMix } from './spatial';

const VIEW = { centerX: 0, centerY: 0, width: 1280, height: 720 };

describe('spatialMix', () => {
  it('full level anywhere on screen, panned by horizontal offset', () => {
    expect(spatialMix(0, 0, VIEW)).toEqual({ pan: 0, gain: 1 });
    const right = spatialMix(640, 300, VIEW);
    expect(right.gain).toBe(1);
    expect(right.pan).toBeCloseTo(0.7, 6);
    expect(spatialMix(-320, 0, VIEW).pan).toBeCloseTo(-0.35, 6);
  });

  it('never hard-pans, even far off screen', () => {
    expect(spatialMix(99999, 0, VIEW).pan).toBe(0.7);
    expect(spatialMix(-99999, 0, VIEW).pan).toBe(-0.7);
  });

  it('fades out off screen and is culled a little over half a screen away', () => {
    const near = spatialMix(640 + 100, 0, VIEW).gain;
    const far = spatialMix(640 + 300, 0, VIEW).gain;
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(spatialMix(640 + 400, 0, VIEW).gain).toBeLessThan(SPATIAL_CULL_GAIN);
    expect(spatialMix(0, 360 + 500, VIEW).gain).toBe(0);
  });

  it('a floor keeps notifications audible anywhere', () => {
    expect(spatialMix(99999, 99999, VIEW, { floor: 0.45 }).gain).toBe(0.45);
  });

  it('isInView honours the margin', () => {
    expect(isInView(650, 0, VIEW)).toBe(false);
    expect(isInView(650, 0, VIEW, 20)).toBe(true);
  });
});
