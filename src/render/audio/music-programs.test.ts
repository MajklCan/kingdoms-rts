import { describe, expect, it } from 'vitest';
import { buildPrograms } from './music-programs';

describe('menu program', () => {
  const all = buildPrograms(() => true, () => 'playlist', () => 0.5);

  it('opens on the main theme, then alternates the title tracks', () => {
    const pick = all.menu.pick;
    expect(pick(null)).toBe('menu_theme');
    expect(pick('menu_theme')).toBe('menu_theme_2');
    expect(pick('menu_theme_2')).toBe('menu_theme');
  });

  it('comes back from a match on the main theme', () => {
    expect(all.menu.pick('battle_theme')).toBe('menu_theme');
  });

  it('falls back to whichever title track loaded', () => {
    const onlySecond = buildPrograms((k) => k === 'menu_theme_2', () => 'playlist', () => 0.5);
    expect(onlySecond.menu.pick(null)).toBe('menu_theme_2');
    const none = buildPrograms(() => false, () => 'playlist', () => 0.5);
    expect(none.menu.pick(null)).toBeNull();
  });
});
