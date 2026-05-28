// Sound mapping tables — translate sim events / cues / UI actions into concrete
// SFX keys plus their throttle + volume. Pure data + pure functions; no Phaser.
//
// Keys MUST match the filenames produced by scripts/gen-sfx-elevenlabs.mjs
// (public/assets/audio/sfx/<key>.ogg|.mp3).

import type { SoundCueKind } from '@sim/world';
import { UnitDefId } from '@sim/defs';

/** Every SFX asset key the game can play. */
export const SFX_KEYS = [
  'sword_clash',
  'bow_shot',
  'gun_shot',
  'cannon_fire',
  'explosion',
  'unit_death',
  'chop_wood',
  'mine_stone',
  'build_complete',
  'unit_ready',
  'place_building',
  'age_up',
  'ui_click',
  'ui_hover',
  'unit_select',
  'command_move',
  'error',
  'alert',
] as const;

export type SfxKey = (typeof SFX_KEYS)[number];

// --- Music (public/assets/audio/music/<key>.ogg|.mp3) ---

/** Single non-looping theme played on the title/menu screen. */
export const MENU_MUSIC = 'menu_theme';

/** Looping track while the player lingers peacefully at their base (no danger). */
export const VILLAGE_MUSIC = 'village_theme';

/** Looping track that takes over while the local player is in combat. */
export const BATTLE_MUSIC = 'battle_theme';

/** In-game filler playlist: tracks played one after another (shuffled, gaps). */
export const INGAME_TRACKS = ['ingame_1', 'ingame_2', 'ingame_3'] as const;

/** Every music asset key the game can load. Missing files load to nothing and
 *  every playback path no-ops on them — so partial sets are fine. */
export const MUSIC_KEYS = [
  MENU_MUSIC,
  VILLAGE_MUSIC,
  BATTLE_MUSIC,
  ...INGAME_TRACKS,
] as const;
export type MusicKey = (typeof MUSIC_KEYS)[number];

export interface SfxConfig {
  key: SfxKey;
  /** Minimum ms between repeats of this key (collapses simultaneous triggers). */
  minIntervalMs: number;
  /** Base volume 0..1 before master volume + spatial falloff. */
  volume: number;
}

// --- Sim sound cues (world.soundCues) ---

const CUE_MAP: Record<SoundCueKind, SfxConfig> = {
  // Economy — heavily throttled + quieter: dozens of villagers gather at once.
  gather_wood: { key: 'chop_wood', minIntervalMs: 220, volume: 0.45 },
  gather_stone: { key: 'mine_stone', minIntervalMs: 220, volume: 0.45 },
  gather_gold: { key: 'mine_stone', minIntervalMs: 220, volume: 0.45 },
  gather_food: { key: 'chop_wood', minIntervalMs: 260, volume: 0.35 },
  // Death — throttled so a wiped squad doesn't machine-gun the grunt.
  unit_death: { key: 'unit_death', minIntervalMs: 140, volume: 0.55 },
  building_destroyed: { key: 'explosion', minIntervalMs: 120, volume: 0.85 },
  cannon_impact: { key: 'explosion', minIntervalMs: 90, volume: 0.8 },
  // Lifecycle — infrequent, can play at full presence.
  build_complete: { key: 'build_complete', minIntervalMs: 60, volume: 0.8 },
  unit_ready: { key: 'unit_ready', minIntervalMs: 120, volume: 0.6 },
  age_up: { key: 'age_up', minIntervalMs: 0, volume: 1 },
};

export function cueSound(kind: SoundCueKind): SfxConfig {
  return CUE_MAP[kind];
}

/** Non-spatial cues play at fixed volume regardless of camera position. */
export function isNonSpatialCue(kind: SoundCueKind): boolean {
  return kind === 'age_up';
}

// --- Combat fire events (world.combatEvents) ---

/**
 * Pick the fire-sound for a combat event. Returns null for events that should
 * stay silent (e.g. cannon windup — only the fire phase booms).
 */
export function combatSound(
  attackerKind: number,
  range: number,
  phase: 'windup' | 'fire' | undefined,
  isBuildingAttacker: boolean
): SfxConfig | null {
  if (phase === 'windup') return null;

  // Melee.
  if (range <= 1 && (attackerKind === UnitDefId.SPEARMAN || attackerKind === UnitDefId.SCOUT_CAVALRY)) {
    return { key: 'sword_clash', minIntervalMs: 70, volume: 0.55 };
  }
  // Ranged.
  if (attackerKind === UnitDefId.GUNMAN || attackerKind === UnitDefId.MACHINE_GUN) {
    return { key: 'gun_shot', minIntervalMs: 60, volume: 0.6 };
  }
  if (attackerKind === UnitDefId.CANNON) {
    return { key: 'cannon_fire', minIntervalMs: 80, volume: 0.95 };
  }
  if (attackerKind === UnitDefId.ARCHER || isBuildingAttacker) {
    return { key: 'bow_shot', minIntervalMs: 60, volume: 0.5 };
  }
  return null;
}

// --- UI / input action sounds (fired directly from the render/input layer) ---

export const UI_CLICK: SfxConfig = { key: 'ui_click', minIntervalMs: 40, volume: 0.6 };
export const UI_HOVER: SfxConfig = { key: 'ui_hover', minIntervalMs: 50, volume: 0.3 };
export const UNIT_SELECT: SfxConfig = { key: 'unit_select', minIntervalMs: 60, volume: 0.5 };
export const COMMAND_MOVE: SfxConfig = { key: 'command_move', minIntervalMs: 60, volume: 0.5 };
export const ERROR: SfxConfig = { key: 'error', minIntervalMs: 120, volume: 0.6 };
export const PLACE_BUILDING: SfxConfig = { key: 'place_building', minIntervalMs: 60, volume: 0.6 };
/** "Base under attack" warning — throttled hard by the caller, plays loud. */
export const ALERT: SfxConfig = { key: 'alert', minIntervalMs: 0, volume: 0.9 };
