// Persisted audio settings: master volume, mute, and one 0..1 multiplier per
// player-facing channel. Pure parse/serialise helpers plus the localStorage
// glue. Render-layer only.

/** Player-facing volume channels (one slider each in Settings > Audio). */
export type AudioChannel = 'music' | 'sfx' | 'voices' | 'ambience' | 'ui';

export const AUDIO_CHANNELS: readonly AudioChannel[] = ['music', 'sfx', 'voices', 'ambience', 'ui'];

export interface AudioSettings {
  masterVolume: number;
  muted: boolean;
  music: number;
  sfx: number;
  voices: number;
  ambience: number;
  ui: number;
}

export const SETTINGS_STORAGE_KEY = 'kingdoms.audio';

const DEFAULT_MASTER = 0.7;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Local dev hosts start muted so a reload does not blast the developer. */
export function shouldDefaultMuted(hostname: string | undefined): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname?.endsWith('.localhost') === true
  );
}

export function defaultSettings(muted: boolean): AudioSettings {
  return { masterVolume: DEFAULT_MASTER, muted, music: 1, sfx: 1, voices: 1, ambience: 1, ui: 1 };
}

/**
 * Parse a stored settings blob. Missing or malformed fields fall back to the
 * defaults, so older saves (only {masterVolume, muted}) migrate cleanly.
 */
export function parseSettings(raw: string | null, defaultMuted: boolean): AudioSettings {
  const fallback = defaultSettings(defaultMuted);
  if (!raw) return fallback;
  const parsed = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>>;
  const unit = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : d);
  return {
    masterVolume: unit(parsed.masterVolume, fallback.masterVolume),
    muted: typeof parsed.muted === 'boolean' ? parsed.muted : fallback.muted,
    music: unit(parsed.music, 1),
    sfx: unit(parsed.sfx, 1),
    voices: unit(parsed.voices, 1),
    ambience: unit(parsed.ambience, 1),
    ui: unit(parsed.ui, 1),
  };
}

export function loadSettings(): AudioSettings {
  const defaultMuted = shouldDefaultMuted(globalThis.location?.hostname);
  try {
    return parseSettings(localStorage.getItem(SETTINGS_STORAGE_KEY), defaultMuted);
  } catch (err) {
    // Corrupt JSON or blocked storage: defaults, but say why.
    console.warn('[audio] loadSettings failed, using defaults:', err);
    return defaultSettings(defaultMuted);
  }
}

export function persistSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[audio] persist failed, settings not saved:', err);
  }
}
