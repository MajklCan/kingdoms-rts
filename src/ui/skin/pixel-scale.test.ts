import { describe, expect, it } from 'vitest';
import { texelDevicePixels } from './pixel-scale';

describe('ui/skin/pixel-scale', () => {
  it('maps the root font size to whole device pixels per texel', () => {
    expect(texelDevicePixels(16, 1)).toBe(2); // 1280x720
    expect(texelDevicePixels(24, 1)).toBe(3); // 1920x1080 and 2560x1080
    expect(texelDevicePixels(16, 2)).toBe(4); // 1280x720 on a 2x display
    expect(texelDevicePixels(14.4, 1)).toBe(2); // Compact interface size
  });

  it('never drops below one device pixel', () => {
    expect(texelDevicePixels(4, 1)).toBe(1);
    expect(texelDevicePixels(0, 1)).toBe(1);
  });
});
