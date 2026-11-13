import { describe, expect, it } from 'vitest';
import { combinedDuck, DUCK, equalPowerCurve, variation, SFX_POLICY } from './mix';
import { chainHandoverAt, pickNext, rampActive, rampValue, randomGap, songTimes, trackWindow, type Ramp } from './music-plan';

describe('equal-power crossfade', () => {
  it('in + out curves keep total power constant (no dip, no bump)', () => {
    const fadeIn = equalPowerCurve(65, 'in', 0, 1);
    const fadeOut = equalPowerCurve(65, 'out', 1, 0);
    expect(fadeIn[0]).toBe(0);
    expect(fadeIn[64]).toBeCloseTo(1, 6);
    expect(fadeOut[0]).toBeCloseTo(1, 6);
    expect(fadeOut[64]).toBeCloseTo(0, 6);
    for (let i = 0; i < 65; i++) expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1, 5);
  });

  it('rampValue reads the same curve back mid-flight', () => {
    const r: Ramp = { t0: 10, dur: 2, from: 0, to: 0.8, shape: 'equal-power' };
    const curve = equalPowerCurve(65, 'in', 0, 0.8);
    expect(rampValue(r, 9)).toBe(0);
    expect(rampValue(r, 11)).toBeCloseTo(curve[32], 5);
    expect(rampValue(r, 13)).toBe(0.8);
    expect(rampActive(r, 11)).toBe(true);
    expect(rampActive(r, 12.5)).toBe(false);
    const down: Ramp = { t0: 0, dur: 4, from: 0.6, to: 0, shape: 'equal-power' };
    expect(rampValue(down, 2)).toBeCloseTo(equalPowerCurve(65, 'out', 0.6, 0)[32], 5);
  });
});

describe('track windows', () => {
  it('battle_theme loops before its 5 s decaying ending', () => {
    const w = trackWindow('battle_theme', 30.04);
    expect(w.outSec).toBe(25.5);
    // With a 3 s crossfade the next segment starts 22.5 s in, so the
    // decaying tail (25 s+) is never heard alone.
    expect(chainHandoverAt(100, w, 3)).toBeCloseTo(122.5, 5);
  });

  it('skips lead-in silence and clamps to the file', () => {
    expect(trackWindow('village_theme', 30.04).inSec).toBe(0.45);
    expect(trackWindow('unknown', 12)).toEqual({ inSec: 0, outSec: 12 });
    expect(trackWindow('battle_theme', 10).outSec).toBe(10);
  });

  it('a gapped song fades out over its last seconds', () => {
    const t = songTimes(50, { inSec: 0, outSec: 29.95 }, 3);
    expect(t.endAt).toBeCloseTo(79.95, 5);
    expect(t.fadeOutAt).toBeCloseTo(76.95, 5);
  });
});

describe('song picking + gaps', () => {
  it('never picks the previous song when there is another', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickNext(['battle_theme', 'battle_2'], 'battle_theme', Math.random)).toBe('battle_2');
    }
    expect(pickNext(['ingame_1'], 'ingame_1', Math.random)).toBe('ingame_1');
    expect(pickNext([], null, Math.random)).toBeNull();
  });

  it('gaps fall inside their range', () => {
    expect(randomGap([8, 20], () => 0)).toBe(8);
    expect(randomGap([8, 20], () => 0.999)).toBeCloseTo(19.988, 3);
  });
});

describe('ducking + variation', () => {
  it('ducks multiply and pause silences the world but not the music', () => {
    expect(combinedDuck('music', [])).toBe(1);
    expect(combinedDuck('music', [DUCK.voice, DUCK.impact])).toBeCloseTo(DUCK.voice.music! * DUCK.impact.music!, 6);
    expect(combinedDuck('sfx', [DUCK.pause])).toBe(0);
    expect(combinedDuck('ui', [DUCK.pause])).toBe(1);
    expect(combinedDuck('music', [DUCK.pause])).toBeGreaterThan(0.3);
  });

  it('variation stays inside the policy spread', () => {
    const p = SFX_POLICY.sword_clash;
    for (const r of [0, 0.5, 0.999]) {
      const v = variation(p, () => r);
      expect(Math.abs(1200 * Math.log2(v.rate))).toBeLessThanOrEqual(p.detuneCents + 1e-6);
      expect(Math.abs(20 * Math.log10(v.gain))).toBeLessThanOrEqual(p.volJitterDb + 1e-6);
      expect(v.delayMs).toBeLessThanOrEqual(p.startJitterMs);
    }
    expect(variation(SFX_POLICY.alert, Math.random)).toEqual({ rate: 1, gain: 1, delayMs: 0 });
  });
});
