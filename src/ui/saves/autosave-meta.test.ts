import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_FORMAT,
  autosaveTitle,
  buildAutosaveMeta,
  describeAutosave,
  formatSavedAgo,
  parseAutosaveMeta,
  type AutosaveMetaInput,
} from './autosave-meta';

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

function input(over: Partial<AutosaveMetaInput> = {}): AutosaveMetaInput {
  return {
    setup: { mapName: 'Bohemian Riverlands' },
    mission: null,
    difficulty: 'hard',
    tick: 20 * 754,
    saveVersion: 3,
    gameSpeed: 1,
    savedAt: NOW,
    appVersion: '0.0.64',
    ...over,
  };
}

describe('ui/saves/autosave-meta', () => {
  it('builds skirmish metadata from the match setup', () => {
    expect(buildAutosaveMeta(input())).toEqual({
      format: AUTOSAVE_FORMAT,
      mode: 'skirmish',
      missionId: null,
      missionName: null,
      mapName: 'Bohemian Riverlands',
      difficulty: 'hard',
      tick: 15080,
      savedAt: NOW,
      appVersion: '0.0.64',
      saveVersion: 3,
      gameSpeed: 1,
    });
  });

  it('builds campaign metadata from the mission and clamps game speed', () => {
    const meta = buildAutosaveMeta(input({ mission: { id: 'siege_of_brno', name: 'Siege of Brno' }, gameSpeed: 5, tick: 12.9 }));
    expect(meta.mode).toBe('campaign');
    expect(meta.missionId).toBe('siege_of_brno');
    expect(meta.missionName).toBe('Siege of Brno');
    expect(meta.mapName).toBeNull();
    expect(meta.gameSpeed).toBe(2);
    expect(meta.tick).toBe(12);
  });

  it('round-trips through storage (structured clone or JSON)', () => {
    const meta = buildAutosaveMeta(input());
    expect(parseAutosaveMeta(JSON.parse(JSON.stringify(meta)), 3)).toEqual(meta);
  });

  it('rejects records this build cannot resume', () => {
    const meta = buildAutosaveMeta(input());
    expect(parseAutosaveMeta(null, 3)).toBeNull();
    expect(parseAutosaveMeta('autosave', 3)).toBeNull();
    expect(parseAutosaveMeta({}, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, format: AUTOSAVE_FORMAT + 1 }, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, mode: 'multiplayer' }, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, tick: -1 }, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, tick: '15080' }, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, savedAt: Number.NaN }, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, mapName: 7 }, 3)).toBeNull();
    expect(parseAutosaveMeta({ ...meta, mode: 'campaign' }, 3)).toBeNull();
  });

  it('rejects a save written by a newer build and keeps older ones', () => {
    const meta = buildAutosaveMeta(input({ saveVersion: 4 }));
    expect(parseAutosaveMeta(meta, 3)).toBeNull();
    expect(parseAutosaveMeta(meta, 4)).toEqual(meta);
    expect(parseAutosaveMeta({ ...meta, saveVersion: 1 }, 4)?.saveVersion).toBe(1);
    expect(parseAutosaveMeta({ ...meta, saveVersion: 0 }, 4)).toBeNull();
  });

  it('formats how long ago the save was written', () => {
    expect(formatSavedAgo(NOW, NOW + 20_000)).toBe('just now');
    expect(formatSavedAgo(NOW, NOW - 5_000)).toBe('just now');
    expect(formatSavedAgo(NOW, NOW + 5 * 60_000)).toBe('5 min ago');
    expect(formatSavedAgo(NOW, NOW + 3 * 3_600_000)).toBe('3 h ago');
    expect(formatSavedAgo(NOW, NOW + 30 * 3_600_000)).toBe('yesterday');
    expect(formatSavedAgo(NOW, NOW + 4 * 86_400_000)).toBe('4 days ago');
  });

  it('describes the save in one line for the menu', () => {
    const skirmish = buildAutosaveMeta(input());
    expect(describeAutosave(skirmish, NOW + 5 * 60_000, 20)).toBe('Skirmish · Bohemian Riverlands · 12:34 · saved 5 min ago');
    expect(autosaveTitle(skirmish)).toBe('Bohemian Riverlands');

    const campaign = buildAutosaveMeta(input({ mission: { id: 'siege_of_brno', name: 'Siege of Brno' } }));
    expect(describeAutosave(campaign, NOW, 20)).toBe('Campaign · Siege of Brno · 12:34 · saved just now');
    expect(autosaveTitle(campaign)).toBe('Siege of Brno');

    const unknownMap = buildAutosaveMeta(input({ setup: { mapName: null } }));
    expect(describeAutosave(unknownMap, NOW, 20)).toBe('Skirmish · 12:34 · saved just now');
    expect(autosaveTitle(unknownMap)).toBe('Skirmish');
  });
});
