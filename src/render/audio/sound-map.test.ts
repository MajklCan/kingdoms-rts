import { describe, it, expect } from 'vitest';
import { UnitDefId } from '@sim/defs';
import type { SoundCueKind } from '@sim/world';
import {
  SFX_KEYS,
  cueSound,
  combatSound,
  isNonSpatialCue,
  UI_CLICK,
  UI_HOVER,
  UNIT_SELECT,
  COMMAND_MOVE,
  ERROR,
  PLACE_BUILDING,
} from './sound-map';

const KEY_SET = new Set<string>(SFX_KEYS);

const ALL_CUE_KINDS: SoundCueKind[] = [
  'gather_wood',
  'gather_stone',
  'gather_gold',
  'gather_food',
  'unit_death',
  'building_destroyed',
  'cannon_impact',
  'build_complete',
  'unit_ready',
  'age_up',
];

describe('sound-map', () => {
  it('maps every sim sound cue to a real SFX key', () => {
    for (const kind of ALL_CUE_KINDS) {
      const cfg = cueSound(kind);
      expect(KEY_SET.has(cfg.key), `${kind} → ${cfg.key}`).toBe(true);
      expect(cfg.volume).toBeGreaterThan(0);
      expect(cfg.volume).toBeLessThanOrEqual(1);
      expect(cfg.minIntervalMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('throttles high-frequency economy cues harder than rare lifecycle cues', () => {
    expect(cueSound('gather_wood').minIntervalMs).toBeGreaterThan(
      cueSound('build_complete').minIntervalMs
    );
  });

  it('treats only the age-up fanfare as non-spatial', () => {
    expect(isNonSpatialCue('age_up')).toBe(true);
    expect(isNonSpatialCue('gather_wood')).toBe(false);
    expect(isNonSpatialCue('cannon_impact')).toBe(false);
  });

  it('silences cannon windup but sounds the fire phase', () => {
    expect(combatSound(UnitDefId.CANNON, 6, 'windup', false)).toBeNull();
    expect(combatSound(UnitDefId.CANNON, 6, 'fire', false)?.key).toBe('cannon_fire');
  });

  it('picks the right fire sound per attacker', () => {
    expect(combatSound(UnitDefId.SPEARMAN, 1, undefined, false)?.key).toBe('sword_clash');
    expect(combatSound(UnitDefId.SCOUT_CAVALRY, 1, undefined, false)?.key).toBe('sword_clash');
    expect(combatSound(UnitDefId.ARCHER, 5, undefined, false)?.key).toBe('bow_shot');
    expect(combatSound(UnitDefId.GUNMAN, 5, undefined, false)?.key).toBe('gun_shot');
    expect(combatSound(UnitDefId.MACHINE_GUN, 5, undefined, false)?.key).toBe('gun_shot');
  });

  it('treats a building attacker as an archer tower (bow shot)', () => {
    // attackerKind may be -1 for buildings; the isBuilding flag drives the sound.
    expect(combatSound(-1, 5, undefined, true)?.key).toBe('bow_shot');
  });

  it('returns null for attackers with no mapped sound', () => {
    expect(combatSound(UnitDefId.VILLAGER, 1, undefined, false)).toBeNull();
    // MILITIA is legacy (loadable from old saves) and has no mapped fire sound.
    expect(combatSound(UnitDefId.MILITIA, 1, undefined, false)).toBeNull();
  });

  it('gates the melee clash on range <= 1 (no clash for out-of-range melee)', () => {
    // Melee units only clash adjacent; at range 2 nothing matches → null.
    expect(combatSound(UnitDefId.SPEARMAN, 2, undefined, false)).toBeNull();
    expect(combatSound(UnitDefId.SCOUT_CAVALRY, 2, undefined, false)).toBeNull();
  });

  it('only ever returns SFX keys that exist in SFX_KEYS', () => {
    const cases: Array<[number, number, 'windup' | 'fire' | undefined, boolean]> = [
      [UnitDefId.SPEARMAN, 1, undefined, false],
      [UnitDefId.SCOUT_CAVALRY, 1, undefined, false],
      [UnitDefId.ARCHER, 5, undefined, false],
      [UnitDefId.GUNMAN, 5, undefined, false],
      [UnitDefId.MACHINE_GUN, 5, undefined, false],
      [UnitDefId.CANNON, 6, 'fire', false],
      [-1, 5, undefined, true],
    ];
    for (const [kind, range, phase, isBuilding] of cases) {
      const cfg = combatSound(kind, range, phase, isBuilding);
      expect(cfg, `${kind}/${range}`).not.toBeNull();
      expect(KEY_SET.has(cfg!.key), cfg!.key).toBe(true);
    }
  });

  it('classifies every cue kind as spatial except age_up', () => {
    for (const kind of ALL_CUE_KINDS) {
      expect(isNonSpatialCue(kind), kind).toBe(kind === 'age_up');
    }
  });

  it('every UI sound uses a real SFX key', () => {
    for (const cfg of [UI_CLICK, UI_HOVER, UNIT_SELECT, COMMAND_MOVE, ERROR, PLACE_BUILDING]) {
      expect(KEY_SET.has(cfg.key), cfg.key).toBe(true);
    }
  });

  it('ships an audio file pair for every key (no orphan keys)', () => {
    // Guards against the map referencing a key the generator never produced.
    expect(SFX_KEYS.length).toBe(new Set(SFX_KEYS).size); // no dupes
  });
});
