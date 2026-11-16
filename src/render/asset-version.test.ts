import { describe, expect, it } from 'vitest';
import { versioned } from './asset-version';

describe('versioned', () => {
  it('appends the build key as a query parameter', () => {
    expect(versioned('assets/sprites/units-0.png', '0.0.93-abc')).toBe('assets/sprites/units-0.png?v=0.0.93-abc');
  });

  it('extends an existing query', () => {
    expect(versioned('/a.json?x=1', 'k')).toBe('/a.json?x=1&v=k');
  });

  it('keeps the file extension readable for type sniffing', () => {
    expect(versioned('assets/audio/sfx/alert.mp3', 'k')).toMatch(/\.mp3\?/);
  });

  it('uses the build version by default', () => {
    expect(versioned('x.png')).toContain(`v=${encodeURIComponent(`${__APP_VERSION__}-${__GIT_COMMIT__}`)}`);
  });
});
