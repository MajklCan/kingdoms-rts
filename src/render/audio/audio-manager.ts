// AudioManager — thin wrapper over Phaser's sound system for game SFX.
//
// Render-layer only. Owns loading, per-key throttling, a global concurrency
// cap, spatial panning, and a persisted master volume / mute. The sim never
// touches this; game-scene drains sim events/cues and calls play().
//
// Throttling is the answer to "many units act at once": the same sound key is
// rate-limited (minIntervalMs), so 30 villagers chopping collapse into a
// pleasant trickle rather than a wall of noise.

import type { SfxKey } from './sound-map';

const STORAGE_KEY = 'kingdoms.audio';

/** Hard ceiling on simultaneously-playing sounds — safety net against audio
 *  storms. Per-key throttling does most of the work; this bounds the rest. */
const MAX_CONCURRENT = 12;

interface AudioSettings {
  masterVolume: number; // 0..1
  muted: boolean;
}

interface PlayOptions {
  /** Stereo pan, -1 (left) .. 1 (right). Default 0 (centre). */
  pan?: number;
  /** Linear volume multiplier on top of master volume, 0..1. Default 1. */
  volume?: number;
  /** Minimum ms between plays of this same key. Default 0 (no throttle). */
  minIntervalMs?: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function loadSettings(): AudioSettings {
  const fallback: AudioSettings = { masterVolume: 0.7, muted: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      masterVolume:
        typeof parsed.masterVolume === 'number'
          ? clamp(parsed.masterVolume, 0, 1)
          : fallback.masterVolume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : fallback.muted,
    };
  } catch {
    return fallback;
  }
}

export class AudioManager {
  private readonly scene: Phaser.Scene;
  private readonly lastPlayed = new Map<string, number>();
  private settings: AudioSettings;
  private active = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.settings = loadSettings();
  }

  /** Queue every SFX file on the scene loader. Call from scene preload(). */
  static queueLoad(load: Phaser.Loader.LoaderPlugin, keys: readonly string[]): void {
    for (const key of keys) {
      load.audio(`sfx-${key}`, [
        `assets/audio/sfx/${key}.ogg`,
        `assets/audio/sfx/${key}.mp3`,
      ]);
    }
  }

  get masterVolume(): number {
    return this.settings.masterVolume;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  setMasterVolume(value: number): void {
    this.settings = { ...this.settings, masterVolume: clamp(value, 0, 1) };
    this.persist();
  }

  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
    this.persist();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  /** Play a sound effect by key. No-ops cleanly when muted, throttled, over the
   *  concurrency cap, or when the asset failed to load. */
  play(key: SfxKey, opts: PlayOptions = {}): void {
    if (this.settings.muted || this.settings.masterVolume <= 0) return;

    const now = this.scene.time.now;
    const minInterval = opts.minIntervalMs ?? 0;
    if (minInterval > 0) {
      const last = this.lastPlayed.get(key);
      if (last !== undefined && now - last < minInterval) return;
    }

    const assetKey = `sfx-${key}`;
    if (!this.scene.cache.audio.exists(assetKey)) return; // asset missing / not loaded
    if (this.active >= MAX_CONCURRENT) return;

    const volume = clamp((opts.volume ?? 1) * this.settings.masterVolume, 0, 1);
    if (volume <= 0) return;

    const sound = this.scene.sound.add(assetKey);
    const release = (): void => {
      this.active = Math.max(0, this.active - 1);
      sound.destroy();
    };
    sound.once('complete', release);
    sound.once('stop', release);
    // Phaser WebAudio honours `pan` in the play config.
    sound.play({ volume, pan: clamp(opts.pan ?? 0, -1, 1) });
    this.active += 1;
    this.lastPlayed.set(key, now);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // localStorage unavailable (private mode etc.) — settings stay in-memory.
    }
  }
}
