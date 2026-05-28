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
import { MENU_MUSIC, INGAME_TRACKS } from './sound-map';

const STORAGE_KEY = 'kingdoms.audio';

/** Hard ceiling on simultaneously-playing sounds — safety net against audio
 *  storms. Per-key throttling does most of the work; this bounds the rest. */
const MAX_CONCURRENT = 12;

/** Music plays as a bed under SFX. Base fraction of master volume, and how far
 *  it ducks while the local player is in combat. */
const MUSIC_BASE = 0.55;
const DUCK_FACTOR = 0.32;

/** Ambience bed (battle din) sits quietly under both music and SFX. */
const AMBIENCE_BASE = 0.4;

/** Intentional quiet stretch between in-game playlist tracks (randomized). */
const SILENCE_GAP_MS_MIN = 6000;
const SILENCE_GAP_MS_MAX = 18000;

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
  /** The single track currently playing (menu theme or one playlist track).
   *  Ducking / mute / volume all operate on this reference. */
  private music?: Phaser.Sound.BaseSound;
  private musicDucked = false;
  private musicCurrentVol = 0;
  /** Which music context is active. Lets context requests be idempotent so the
   *  per-frame music director can call them every frame without restarting. */
  private musicMode: 'none' | 'menu' | 'playlist' | 'single' = 'none';
  /** Asset key of the current single-loop track (village/battle context). */
  private singleKey?: string;
  /** Playlist state — only populated while the in-game playlist is active. */
  private playlist: string[] = [];
  private playlistIndex = 0;
  /** Pending delayedCall for the next playlist track (cancelled on stop). */
  private nextTrackTimer?: Phaser.Time.TimerEvent;
  /** Listener bound to the current track's 'complete' event, for cleanup. */
  private trackCompleteHandler?: () => void;
  /** Independent looping ambience bed (layers over music; not ducked). */
  private ambience?: Phaser.Sound.BaseSound;
  private ambienceKey?: string;
  private ambienceCurrentVol = 0;

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

  /** Queue every music track on the scene loader. Call from scene preload(). */
  static queueLoadMusic(load: Phaser.Loader.LoaderPlugin, keys: readonly string[]): void {
    for (const key of keys) {
      load.audio(`music-${key}`, [
        `assets/audio/music/${key}.ogg`,
        `assets/audio/music/${key}.mp3`,
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
    this.applyMusicVolume(0);
    this.applyAmbienceVolume();
    this.persist();
  }

  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
    if (this.music) {
      if (muted) this.music.pause();
      else {
        this.music.resume();
        this.applyMusicVolume(0);
      }
    }
    if (this.ambience) {
      if (muted) this.ambience.pause();
      else {
        this.ambience.resume();
        this.applyAmbienceVolume();
      }
    }
    this.persist();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  // --- Background music ---
  //
  // Two contexts: a single looping MENU theme, and an IN-GAME playlist of tracks
  // played sequentially (shuffled) with a randomized silence gap between each,
  // looping endlessly. Only one "current track" plays at a time; ducking, mute,
  // and volume all act on it. Everything no-ops gracefully when assets are
  // missing — the cache.audio.exists() guard means zero music files === silence,
  // no errors.

  /** True if a music track's audio actually loaded. */
  hasTrack(key: string): boolean {
    return this.scene.cache.audio.exists(`music-${key}`);
  }

  /** Play the menu theme once (no loop). Idempotent. No-op if asset missing. */
  playMenuMusic(): void {
    if (this.musicMode === 'menu') return;
    this.stopMusic(400);
    this.musicMode = 'menu';
    const assetKey = `music-${MENU_MUSIC}`;
    if (!this.scene.cache.audio.exists(assetKey)) return; // asset missing → silence
    this.startTrack(assetKey, false);
  }

  /** Crossfade to a single looping track (village / battle context). Idempotent
   *  when already playing that track. No-op (returns false) if asset missing, so
   *  the caller can fall back. */
  playLooping(key: string): boolean {
    const assetKey = `music-${key}`;
    if (this.musicMode === 'single' && this.singleKey === assetKey) return true;
    if (!this.scene.cache.audio.exists(assetKey)) return false;
    this.stopMusic(500);
    this.musicMode = 'single';
    this.singleKey = assetKey;
    this.startTrack(assetKey, true);
    return true;
  }

  /** Begin the endless in-game playlist: shuffle the tracks whose assets exist,
   *  play each once (non-looping) with a randomized silence gap between, then
   *  reshuffle and repeat. Idempotent while already in playlist mode. No-op if
   *  zero in-game tracks are present. */
  playGamePlaylist(): void {
    if (this.musicMode === 'playlist') return;
    this.stopMusic(500);
    this.musicMode = 'playlist';
    this.playlist = this.shuffledExistingTracks();
    this.playlistIndex = 0;
    if (this.playlist.length === 0) return; // no in-game assets → silence
    this.playCurrentPlaylistTrack();
  }

  /** Stop the current track (fading out) and cancel any pending next-track timer.
   *  Leaves the music subsystem idle — safe to switch contexts afterwards. */
  stopMusic(fadeMs = 600): void {
    this.cancelNextTrackTimer();
    this.playlist = [];
    this.playlistIndex = 0;
    this.musicMode = 'none';
    this.singleKey = undefined;
    const current = this.music;
    if (!current) return;
    this.detachTrackCompleteHandler(current);
    this.music = undefined;
    if (fadeMs <= 0 || this.musicCurrentVol <= 0) {
      current.stop();
      current.destroy();
      return;
    }
    const snd = current as Phaser.Sound.WebAudioSound;
    const proxy = { v: this.musicCurrentVol };
    this.scene.tweens.add({
      targets: proxy,
      v: 0,
      duration: fadeMs,
      ease: 'Sine.InOut',
      onUpdate: () => {
        if (typeof snd.setVolume === 'function') snd.setVolume(proxy.v);
      },
      onComplete: () => {
        current.stop();
        current.destroy();
      },
    });
  }

  // --- Ambience bed (independent of the music context) ---

  /** Start a looping ambience bed (e.g. battle din). Idempotent. No-op if the
   *  asset is missing. Layers over whatever music is playing; never ducked. */
  playAmbience(key: string): void {
    const assetKey = `music-${key}`;
    if (this.ambienceKey === assetKey && this.ambience) return;
    if (!this.scene.cache.audio.exists(assetKey)) return;
    this.stopAmbience(0);
    this.ambience = this.scene.sound.add(assetKey, { loop: true });
    this.ambienceKey = assetKey;
    this.ambienceCurrentVol = this.ambienceVolume();
    this.ambience.play({ volume: this.ambienceCurrentVol });
    if (this.settings.muted) this.ambience.pause();
  }

  /** Fade out + stop the ambience bed. */
  stopAmbience(fadeMs = 600): void {
    const current = this.ambience;
    this.ambience = undefined;
    this.ambienceKey = undefined;
    if (!current) return;
    if (fadeMs <= 0 || this.ambienceCurrentVol <= 0) {
      current.stop();
      current.destroy();
      return;
    }
    const snd = current as Phaser.Sound.WebAudioSound;
    const proxy = { v: this.ambienceCurrentVol };
    this.scene.tweens.add({
      targets: proxy,
      v: 0,
      duration: fadeMs,
      ease: 'Sine.InOut',
      onUpdate: () => {
        if (typeof snd.setVolume === 'function') snd.setVolume(proxy.v);
      },
      onComplete: () => {
        current.stop();
        current.destroy();
      },
    });
  }

  private ambienceVolume(): number {
    if (this.settings.muted) return 0;
    return this.settings.masterVolume * AMBIENCE_BASE;
  }

  private applyAmbienceVolume(): void {
    if (!this.ambience) return;
    const snd = this.ambience as Phaser.Sound.WebAudioSound;
    if (typeof snd.setVolume !== 'function') return;
    this.ambienceCurrentVol = this.ambienceVolume();
    snd.setVolume(this.ambienceCurrentVol);
  }

  /** Tracks (asset keys) whose audio actually loaded, in shuffled order. */
  private shuffledExistingTracks(): string[] {
    const present = INGAME_TRACKS.map((k) => `music-${k}`).filter((assetKey) =>
      this.scene.cache.audio.exists(assetKey)
    );
    // Fisher–Yates. Math.random is allowed in the render layer (not sim).
    for (let i = present.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [present[i], present[j]] = [present[j], present[i]];
    }
    return present;
  }

  /** Play the track at playlistIndex (non-looping); chain the next on complete. */
  private playCurrentPlaylistTrack(): void {
    const assetKey = this.playlist[this.playlistIndex];
    if (!assetKey) return;
    const track = this.startTrack(assetKey, false);
    const onComplete = (): void => {
      this.detachTrackCompleteHandler(track);
      if (this.music === track) this.music = undefined;
      track.destroy();
      this.scheduleNextPlaylistTrack();
    };
    this.trackCompleteHandler = onComplete;
    track.once('complete', onComplete);
  }

  /** Advance the playlist (reshuffling after the last track) after a silence gap. */
  private scheduleNextPlaylistTrack(): void {
    this.playlistIndex += 1;
    if (this.playlistIndex >= this.playlist.length) {
      this.playlist = this.shuffledExistingTracks();
      this.playlistIndex = 0;
      if (this.playlist.length === 0) return;
    }
    const gap =
      SILENCE_GAP_MS_MIN + Math.random() * (SILENCE_GAP_MS_MAX - SILENCE_GAP_MS_MIN);
    this.nextTrackTimer = this.scene.time.delayedCall(gap, () => {
      this.nextTrackTimer = undefined;
      this.playCurrentPlaylistTrack();
    });
  }

  /** Add + start a track at the current music volume; store it as the current
   *  track so ducking/mute/volume keep working. */
  private startTrack(assetKey: string, loop: boolean): Phaser.Sound.BaseSound {
    const track = this.scene.sound.add(assetKey, { loop });
    this.music = track;
    this.musicCurrentVol = this.musicVolume();
    track.play({ volume: this.musicCurrentVol });
    if (this.settings.muted) track.pause();
    return track;
  }

  private cancelNextTrackTimer(): void {
    if (this.nextTrackTimer) {
      this.nextTrackTimer.remove(false);
      this.nextTrackTimer = undefined;
    }
  }

  private detachTrackCompleteHandler(track: Phaser.Sound.BaseSound): void {
    if (this.trackCompleteHandler) {
      track.off('complete', this.trackCompleteHandler);
      this.trackCompleteHandler = undefined;
    }
  }

  /** Lower the music bed while the local player is in combat; restore after. */
  setMusicDucked(ducked: boolean): void {
    if (ducked === this.musicDucked) return;
    this.musicDucked = ducked;
    // Duck quickly when fighting starts, recover slowly when it ends.
    this.applyMusicVolume(ducked ? 250 : 900);
  }

  private musicVolume(): number {
    if (this.settings.muted) return 0;
    return this.settings.masterVolume * MUSIC_BASE * (this.musicDucked ? DUCK_FACTOR : 1);
  }

  private applyMusicVolume(fadeMs: number): void {
    if (!this.music) return;
    const snd = this.music as Phaser.Sound.WebAudioSound;
    if (typeof snd.setVolume !== 'function') return;
    const target = this.musicVolume();
    if (fadeMs <= 0) {
      snd.setVolume(target);
      this.musicCurrentVol = target;
      return;
    }
    const proxy = { v: this.musicCurrentVol };
    this.scene.tweens.add({
      targets: proxy,
      v: target,
      duration: fadeMs,
      ease: 'Sine.InOut',
      onUpdate: () => {
        snd.setVolume(proxy.v);
        this.musicCurrentVol = proxy.v;
      },
    });
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
