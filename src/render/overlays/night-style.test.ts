import { describe, expect, it } from 'vitest';
import { ISO } from '../../config';
import { DAY_SIGHT, NIGHT_SIGHT } from '@sim/world';
import { FACINGS } from '../sprites/facing';
import {
  FOREIGN_LIGHT_TILES,
  LIGHT_EDGE_TILES,
  TORCH_CORE_TILES,
  lightEllipse,
  torchFlicker,
  torchInFront,
  torchSide,
} from './night-style';

describe('night light', () => {
  it('lights a 2:1 ground ellipse that grows with the sight radius', () => {
    const unit = lightEllipse(NIGHT_SIGHT.unit);
    const tower = lightEllipse(NIGHT_SIGHT.tower);
    expect(unit.rx / unit.ry).toBeCloseTo(ISO.TILE_W / ISO.TILE_H, 5);
    expect(tower.rx).toBeGreaterThan(unit.rx);
    // One tile of ground along the screen x axis is half a tile diagonal.
    expect(lightEllipse(1, 0).rx).toBeCloseTo(ISO.TILE_W / Math.SQRT2, 5);
  });

  it('reaches just past the tiles the sim reveals, and never as far as daylight sight', () => {
    for (const key of Object.keys(NIGHT_SIGHT) as Array<keyof typeof NIGHT_SIGHT>) {
      const reachTiles = NIGHT_SIGHT[key] + LIGHT_EDGE_TILES;
      expect(reachTiles).toBeGreaterThan(NIGHT_SIGHT[key] + 1);
      expect(reachTiles).toBeLessThan(DAY_SIGHT[key] + 1);
    }
  });

  it('keeps a torch you merely see, and the bright pool by a flame, smaller than any own sight', () => {
    expect(FOREIGN_LIGHT_TILES).toBeLessThan(NIGHT_SIGHT.unit);
    expect(TORCH_CORE_TILES).toBeLessThan(NIGHT_SIGHT.unit + LIGHT_EDGE_TILES);
  });

  it('flickers gently around 1, differently per torch, and not at all with reduced motion', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 20000; t += 37) {
      const f = torchFlicker(t, 7);
      min = Math.min(min, f);
      max = Math.max(max, f);
    }
    expect(min).toBeGreaterThan(0.9);
    expect(max).toBeLessThan(1.1);
    expect(max - min).toBeGreaterThan(0.04);
    expect(torchFlicker(1234, 7)).not.toBeCloseTo(torchFlicker(1234, 8), 4);
    expect(torchFlicker(1234, 7, 0)).toBe(1);
  });

  it('puts the hand torch on the leading side and behind a unit that faces away', () => {
    expect(torchSide('E')).toBe(1);
    expect(torchSide('W')).toBe(-1);
    expect(FACINGS.filter((f) => !torchInFront(f))).toEqual(['NW', 'N', 'NE']);
  });
});
