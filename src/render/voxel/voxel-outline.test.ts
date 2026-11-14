import { describe, expect, it } from 'vitest';
import { outlinePixels } from './voxel-outline';

function rgba(w: number, h: number, opaque: Array<[number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) {
    const o = (y * w + x) * 4;
    data[o] = 200;
    data[o + 1] = 100;
    data[o + 2] = 50;
    data[o + 3] = 255;
  }
  return data;
}

describe('outlinePixels', () => {
  it('rings an opaque texel with the outline colour and leaves the rest alone', () => {
    const data = rgba(5, 5, [[2, 2]]);
    outlinePixels(data, 5, 5, 0x102030, 0.5);
    const at = (x: number, y: number): number[] => Array.from(data.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4));
    expect(at(2, 2)).toEqual([200, 100, 50, 255]);
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]]) {
      expect(at(x, y)).toEqual([0x10, 0x20, 0x30, 128]);
    }
    expect(at(0, 0)[3]).toBe(0);
    expect(at(4, 4)[3]).toBe(0);
  });

  it('never paints over semi-transparent art', () => {
    const data = rgba(3, 1, [[0, 0]]);
    data[1 * 4 + 3] = 40;
    outlinePixels(data, 3, 1, 0x000000, 1);
    expect(data[1 * 4 + 3]).toBe(40);
  });
});
