import { describe, expect, it } from 'vitest';
import { HIT_FLASH_MS, HitFlash, scaleColor } from './hit-flash';

describe('HitFlash', () => {
  it('flashes when HP drops and fades out over the flash window', () => {
    let now = 1000;
    const flash = new HitFlash(0x808080, () => now);
    expect(flash.colorFor(7, 100)).toBe(0);
    expect(flash.colorFor(7, 100)).toBe(0);
    expect(flash.colorFor(7, 90)).toBe(0x808080);
    now += HIT_FLASH_MS / 2;
    const mid = flash.colorFor(7, 90);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0x808080);
    now += HIT_FLASH_MS;
    expect(flash.colorFor(7, 90)).toBe(0);
  });

  it('ignores healing and the first sighting', () => {
    const flash = new HitFlash(0xffffff, () => 0);
    expect(flash.colorFor(3, 50)).toBe(0);
    expect(flash.colorFor(3, 60)).toBe(0);
  });
});

describe('scaleColor', () => {
  it('scales each channel', () => {
    expect(scaleColor(0xff8040, 1)).toBe(0xff8040);
    expect(scaleColor(0xff8040, 0)).toBe(0);
    expect(scaleColor(0xff8040, 0.5)).toBe(0x804020);
  });
});
