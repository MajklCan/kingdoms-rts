import { describe, expect, it } from 'vitest';
import { BUILDING_ICON_BY_DEF, eraIcon } from './catalog';
import { RASTER_ICONS, RASTER_SHEET } from './raster-icons';

describe('eraIcon', () => {
  it('keeps the base picture in the Dark Age', () => {
    expect(eraIcon('b-house', 0)).toBe('b-house');
  });

  it('uses the newest era variant at or below the age', () => {
    expect(eraIcon('b-house', 1)).toBe('b-house.castle');
    expect(eraIcon('b-house', 2)).toBe('b-house.gunpowder');
    expect(eraIcon('b-house', 3)).toBe('b-house.gunpowder');
  });

  it('falls back when a building has no later variant', () => {
    expect(eraIcon('b-stable', 2)).toBe('b-stable.castle');
    expect(eraIcon('b-farm', 2)).toBe('b-farm');
  });

  it('passes non-building icons through', () => {
    expect(eraIcon('u-archer', 2)).toBe('u-archer');
    expect(eraIcon('c-rally', 2)).toBe('c-rally');
  });

  it('resolves every building def to a sheet icon in every age', () => {
    for (const name of Object.values(BUILDING_ICON_BY_DEF)) {
      for (let age = 0; age <= 3; age++) expect(eraIcon(name, age) in RASTER_ICONS).toBe(true);
    }
  });
});

describe('icon sheet frames', () => {
  it('lie inside the sheet and never overlap', () => {
    const frames = Object.values(RASTER_ICONS);
    for (const [x, y, w, h] of frames) {
      expect(x + w).toBeLessThanOrEqual(RASTER_SHEET.w);
      expect(y + h).toBeLessThanOrEqual(RASTER_SHEET.h);
    }
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const [ax, ay, aw, ah] = frames[i]!;
        const [bx, by, bw, bh] = frames[j]!;
        const overlap = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
        expect(overlap).toBe(false);
      }
    }
  });
});
