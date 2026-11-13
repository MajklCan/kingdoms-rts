// Mix tables: bus levels, per-file trims, per-sound voice policy and ducking.
// Pure data + pure math, no WebAudio. Tune by ear here; every number is dB or
// a linear gain with its dB in the comment.
//
// Trims come from ffmpeg measurements (2026-11-13, see the audio skill):
// - SFX: "mid" level = average of active RMS and loudest 50 ms RMS; every file
//   is trimmed to mid -14 dB so the cue volumes in sound-map.ts alone decide
//   the hierarchy (before this, ui_click and error were louder than cannons).
// - Music / ambience / voices: integrated LUFS, songs to -16 LUFS, beds to the
//   level they should sit at under music.

import type { AudioChannel } from './audio-settings';
import type { SfxKey } from './sound-map';

export type BusId = 'music' | 'ambience' | 'sfx' | 'ui' | 'voice';

export const BUS_IDS: readonly BusId[] = ['music', 'ambience', 'sfx', 'ui', 'voice'];

/** Settings channel that scales each bus. */
export const CHANNEL_OF_BUS: Record<BusId, AudioChannel> = {
  music: 'music',
  ambience: 'ambience',
  sfx: 'sfx',
  ui: 'ui',
  voice: 'voices',
};

/** Mix level of each bus before the player's channel slider. */
export const BUS_GAIN: Record<BusId, number> = {
  music: 0.56, // -5 dB: a bed under the action
  ambience: 0.5, // -6 dB
  sfx: 1,
  ui: 0.7, // -3 dB: interface ticks never compete with the world
  voice: 0.8, // -2 dB: barks are the clearest thing in the mix
};

/** Make-up gain into the master compressor + limiter (+3 dB). */
export const MASTER_MAKEUP = 1.41;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (gain: number): number => (gain <= 0 ? -Infinity : 20 * Math.log10(gain));

export const SFX_TRIM_DB: Record<SfxKey, number> = {
  sword_clash: 4.4,
  bow_shot: -1,
  gun_shot: -1.8,
  cannon_fire: -3.5,
  explosion: -3.5,
  unit_death: -0.7,
  chop_wood: 4,
  forage: -3.5,
  mine_stone: 4,
  build_complete: 2.2,
  unit_ready: 1.9,
  place_building: 2.5,
  age_up: 5,
  ui_click: -4.6,
  ui_hover: 3.9,
  unit_select: 3.3,
  command_move: -1.5,
  error: -5,
  alert: 6.2,
};

/** Songs to -16 LUFS; battle bed to sit ~8 dB under battle music (it was
 *  only 2 dB under); the nature bed was at -43 LUFS, i.e. inaudible. */
export const MUSIC_TRIM_DB: Record<string, number> = {
  menu_theme: 0,
  village_theme: -3,
  ingame_1: -3.3,
  ingame_2: 3.3,
  battle_theme: -1.2,
  battle_2: 0,
  battle_ambience: -9,
  nature_ambience: 17,
};

/** Voice lines are already ~-16 LUFS; only the outliers (>= 2 dB off) move. */
export const VOICE_TRIM_DB: Record<string, number> = {
  villager_female_select_1: 5,
  villager_male_select_1: 5,
  villager_male_move_3: 4,
  soldier_3_attack_3: 3.5,
  villager_male_attack_1: 3.5,
  villager_female_attack_0: 2.9,
  soldier_2_move_0: 2.7,
  soldier_3_move_2: 2.6,
  soldier_2_select_0: 2.4,
  soldier_2_select_3: 2.3,
  villager_male_attack_0: 2.3,
  soldier_3_attack_0: 2,
};

export interface SfxPolicy {
  bus: 'sfx' | 'ui';
  /** Max simultaneous instances of this key; more steal the weakest or drop. */
  maxVoices: number;
  /** Higher wins when a bus is full. */
  priority: number;
  /** Random pitch spread, +- cents. */
  detuneCents: number;
  /** Random level spread, +- dB. */
  volJitterDb: number;
  /** Random start offset 0..N ms, so same-frame triggers do not phase. */
  startJitterMs: number;
}

const COMBAT = (maxVoices: number, detuneCents: number): SfxPolicy => ({
  bus: 'sfx', maxVoices, priority: 2, detuneCents, volJitterDb: 2, startJitterMs: 35,
});
const UI = (maxVoices: number, priority: number, detuneCents: number): SfxPolicy => ({
  bus: 'ui', maxVoices, priority, detuneCents, volJitterDb: 1, startJitterMs: 0,
});

export const SFX_POLICY: Record<SfxKey, SfxPolicy> = {
  sword_clash: COMBAT(4, 120),
  bow_shot: COMBAT(4, 150),
  gun_shot: COMBAT(4, 100),
  unit_death: COMBAT(3, 150),
  cannon_fire: { bus: 'sfx', maxVoices: 3, priority: 3, detuneCents: 80, volJitterDb: 1, startJitterMs: 15 },
  explosion: { bus: 'sfx', maxVoices: 3, priority: 3, detuneCents: 100, volJitterDb: 1, startJitterMs: 15 },
  chop_wood: { bus: 'sfx', maxVoices: 2, priority: 1, detuneCents: 200, volJitterDb: 3, startJitterMs: 0 },
  forage: { bus: 'sfx', maxVoices: 2, priority: 1, detuneCents: 150, volJitterDb: 3, startJitterMs: 0 },
  mine_stone: { bus: 'sfx', maxVoices: 2, priority: 1, detuneCents: 200, volJitterDb: 3, startJitterMs: 0 },
  build_complete: { bus: 'sfx', maxVoices: 2, priority: 2, detuneCents: 30, volJitterDb: 1, startJitterMs: 0 },
  unit_ready: { bus: 'sfx', maxVoices: 2, priority: 2, detuneCents: 0, volJitterDb: 0.5, startJitterMs: 0 },
  age_up: { bus: 'sfx', maxVoices: 1, priority: 4, detuneCents: 0, volJitterDb: 0, startJitterMs: 0 },
  alert: { bus: 'sfx', maxVoices: 1, priority: 4, detuneCents: 0, volJitterDb: 0, startJitterMs: 0 },
  ui_click: UI(2, 3, 40),
  ui_hover: UI(1, 1, 60),
  unit_select: UI(2, 2, 50),
  command_move: UI(2, 2, 50),
  place_building: UI(2, 2, 60),
  error: UI(1, 3, 0),
};

/** Most voices a bus may hold before new sounds steal or drop. */
export const BUS_VOICE_CAP: Partial<Record<BusId, number>> = { sfx: 20, ui: 4, voice: 2 };

/** Sounds that briefly push music + ambience down when they fire. */
export const IMPACT_KEYS: ReadonlySet<SfxKey> = new Set<SfxKey>(['explosion', 'cannon_fire', 'age_up', 'alert']);

export type DuckTargets = Partial<Record<BusId, number>>;

export const DUCK: Record<'voice' | 'impact' | 'pause', DuckTargets> = {
  /** A unit bark: music -6 dB, ambience -3 dB, world SFX -2 dB. */
  voice: { music: dbToGain(-6), ambience: dbToGain(-3), sfx: dbToGain(-2) },
  /** Explosion, cannon, fanfare, alarm: music -3 dB, ambience -2 dB. */
  impact: { music: dbToGain(-3), ambience: dbToGain(-2) },
  /** Pause menu: the world goes silent, music steps back to -9 dB. */
  pause: { music: dbToGain(-9), ambience: 0, sfx: 0, voice: 0 },
};

/** setTargetAtTime time constants: duck fast, recover slowly. */
export const DUCK_ATTACK_TC = 0.04;
export const DUCK_RELEASE_TC = 0.35;
/** How long an impact duck holds before releasing. */
export const IMPACT_HOLD_S = 0.5;

/** Product of every active duck's target for one bus (1 = no duck). */
export function combinedDuck(bus: BusId, active: Iterable<DuckTargets>): number {
  let g = 1;
  for (const d of active) g *= d[bus] ?? 1;
  return g;
}

/**
 * Equal-power fade curve for AudioParam.setValueCurveAtTime: sin rise from
 * `from` to `to` ('in') or cos fall ('out'). Two decks crossing with these
 * keep constant perceived loudness (no mid-fade dip or bump).
 */
export function equalPowerCurve(steps: number, direction: 'in' | 'out', from: number, to: number): Float32Array {
  const n = Math.max(2, Math.floor(steps));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
    curve[i] = direction === 'in' ? from + (to - from) * w : to + (from - to) * w;
  }
  return curve;
}

/** Random variation for one play: playback rate + linear gain multiplier. */
export function variation(policy: SfxPolicy, rand: () => number): { rate: number; gain: number; delayMs: number } {
  const cents = (rand() * 2 - 1) * policy.detuneCents;
  const db = (rand() * 2 - 1) * policy.volJitterDb;
  return {
    rate: Math.pow(2, cents / 1200),
    gain: dbToGain(db),
    delayMs: rand() * policy.startJitterMs,
  };
}
