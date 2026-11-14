// AudioManager: the game's single audio entry point. Owns the engine (buses,
// limiter, ducking), the music player, the unit-voice arbiter and the player's
// settings. Render-layer only; the sim never touches this.
//
// The pieces:
//   audio-engine.ts    WebAudio graph, one-shot voices, ducking, meters
//   sfx-limiter.ts     cooldown / per-key cap / bus cap / stealing (pure)
//   music-player.ts    program playback, equal-power crossfades, beds
//   music-programs.ts  menu / peace / battle programs
//   bark-arbiter.ts    one voice line at a time, no repeats (pure)
//   mix.ts             bus gains, per-file trims, policies, duck targets
//   audio-settings.ts  persisted volumes

import { AudioEngine } from './audio-engine';
import { AUDIO_CHANNELS, clamp, loadSettings, persistSettings, type AudioChannel, type AudioSettings } from './audio-settings';
import { BarkArbiter } from './bark-arbiter';
import {
  BUS_IDS,
  CHANNEL_OF_BUS,
  DUCK,
  IMPACT_HOLD_S,
  IMPACT_KEYS,
  MUSIC_TRIM_DB,
  SFX_POLICY,
  SFX_TRIM_DB,
  VOICE_TRIM_DB,
  dbToGain,
  variation,
} from './mix';
import type { PeaceFlavor } from './music-director';
import { MusicPlayer, SILENT_PROGRAM } from './music-player';
import { buildPrograms, type MusicPrograms } from './music-programs';
import type { SfxKey, VoiceBarkType, VoiceCategory } from './sound-map';

export type { AudioChannel } from './audio-settings';

export interface PlayOptions {
  /** Stereo pan, -1 (left) .. 1 (right). */
  pan?: number;
  /** Cue level 0..1 (already includes spatial falloff). */
  volume?: number;
  /** Minimum ms between two starts of this key. */
  minIntervalMs?: number;
  /** Route through the UI bus (stingers that must survive a world fade). */
  ui?: boolean;
}

export type BarkResult = 'played' | 'busy' | 'none';

export interface MusicTransition {
  fadeOut: number;
  delay?: number;
}

export class AudioManager {
  private readonly engine: AudioEngine | null;
  private readonly music: MusicPlayer | null;
  private readonly programs: MusicPrograms;
  private readonly barks = new BarkArbiter();
  private settings: AudioSettings;
  private flavor: PeaceFlavor = 'playlist';
  private barkVoiceId: number | null = null;
  private paused = false;
  private worldSilenced = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.settings = loadSettings();
    this.engine = AudioEngine.fromScene(scene);
    this.music = this.engine
      ? new MusicPlayer(this.engine, (k) => this.buffer(`music-${k}`), (k) => MUSIC_TRIM_DB[k] ?? 0)
      : null;
    this.programs = buildPrograms((k) => this.hasTrack(k), () => this.flavor);
    this.applySettings();
  }

  // NOTE: mp3 is listed FIRST. Phaser picks the first URL whose extension the
  // browser claims to support, and several browsers claim Ogg but fail to
  // decode our Opus-in-Ogg clips. mp3 decodes everywhere; ogg is the fallback.

  static queueLoad(load: Phaser.Loader.LoaderPlugin, keys: readonly string[]): void {
    for (const key of keys) load.audio(`sfx-${key}`, [`assets/audio/sfx/${key}.mp3`, `assets/audio/sfx/${key}.ogg`]);
  }

  static queueLoadMusic(load: Phaser.Loader.LoaderPlugin, keys: readonly string[]): void {
    for (const key of keys) load.audio(`music-${key}`, [`assets/audio/music/${key}.mp3`, `assets/audio/music/${key}.ogg`]);
  }

  static queueLoadVoices(load: Phaser.Loader.LoaderPlugin, keys: readonly string[]): void {
    for (const key of keys) {
      load.audio(`voice-${key}`, [`assets/audio/voices/${key}.mp3`, `assets/audio/voices/${key}.ogg`]);
    }
  }

  // --- Settings ---

  get masterVolume(): number {
    return this.settings.masterVolume;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  setMasterVolume(value: number): void {
    this.updateSettings({ masterVolume: clamp(value, 0, 1) });
  }

  getChannelVolume(channel: AudioChannel): number {
    return this.settings[channel];
  }

  setChannelVolume(channel: AudioChannel, value: number): void {
    if (!AUDIO_CHANNELS.includes(channel)) return;
    this.updateSettings({ [channel]: clamp(value, 0, 1) });
  }

  setMuted(muted: boolean): void {
    this.updateSettings({ muted });
  }

  toggleMuted(): boolean {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  // --- Music + ambience ---

  hasTrack(key: string): boolean {
    return this.scene.cache?.audio?.exists(`music-${key}`) === true;
  }

  playMenuMusic(transition: MusicTransition = { fadeOut: 1.5, delay: 0.5 }): void {
    this.music?.setProgram(this.programs.menu, transition);
  }

  playPeaceMusic(transition: MusicTransition): void {
    this.music?.setProgram(this.programs.peace, transition);
  }

  playBattleMusic(transition: MusicTransition): void {
    this.music?.setProgram(this.programs.battle, transition);
  }

  stopMusic(fadeOut: number): void {
    this.music?.setProgram(SILENT_PROGRAM, { fadeOut });
  }

  /** Which peaceful song comes next (never interrupts the current one). */
  setPeaceFlavor(flavor: PeaceFlavor): void {
    this.flavor = flavor;
  }

  setAmbience(key: string | null, fade: number): void {
    this.music?.setBed(key, fade);
  }

  // --- World state ---

  /** Pause menu: world sounds stop, ambience fades out, music steps back. */
  setGamePaused(paused: boolean): void {
    if (paused === this.paused || !this.engine) return;
    this.paused = paused;
    if (paused) {
      this.engine.holdDuck('pause', DUCK.pause, Infinity);
      this.silenceWorldVoices();
    } else {
      this.engine.releaseDuck('pause');
    }
  }

  /** Match over or left: world SFX and voices fade and stay off until reset. */
  setWorldSilenced(silenced: boolean): void {
    if (silenced === this.worldSilenced || !this.engine) return;
    this.worldSilenced = silenced;
    if (silenced) {
      this.engine.holdDuck('world-off', { sfx: 0, voice: 0 }, Infinity);
      this.silenceWorldVoices();
    } else {
      this.engine.releaseDuck('world-off');
    }
  }

  update(): void {
    this.engine?.update();
    this.music?.update();
  }

  // --- One-shots ---

  /** Play an SFX. False when muted, paused, culled, rate-limited or missing. */
  play(key: SfxKey, opts: PlayOptions = {}): boolean {
    const engine = this.engine;
    if (!engine || this.settings.muted || this.settings.masterVolume <= 0) return false;
    const policy = SFX_POLICY[key];
    const bus = opts.ui ? 'ui' : policy.bus;
    if (bus === 'sfx' && (this.paused || this.worldSilenced)) return false;
    const buffer = this.buffer(`sfx-${key}`);
    if (!buffer) return false;
    const v = variation(policy, Math.random);
    const out = engine.play({
      key,
      bus,
      buffer,
      gain: dbToGain(SFX_TRIM_DB[key]) * (opts.volume ?? 1) * v.gain,
      pan: opts.pan,
      rate: v.rate,
      delay: v.delayMs / 1000,
      priority: policy.priority,
      maxVoices: policy.maxVoices,
      cooldown: (opts.minIntervalMs ?? 0) / 1000,
    });
    if (out.ok && IMPACT_KEYS.has(key)) engine.holdDuck('impact', DUCK.impact, out.endsAt - out.duration + IMPACT_HOLD_S);
    return out.ok;
  }

  /**
   * A unit voice line. 'busy' when another line has the floor (or the click
   * was too soon), 'none' when this persona has no lines (caller may blip).
   */
  playVoiceBark(category: VoiceCategory, type: VoiceBarkType, lineCount: number): BarkResult {
    const engine = this.engine;
    if (!engine || this.settings.muted || this.paused || this.worldSilenced) return 'none';
    const lines: number[] = [];
    for (let n = 0; n < lineCount; n++) if (this.buffer(voiceAsset(category, type, n))) lines.push(n);
    const nowMs = engine.now() * 1000;
    const decision = this.barks.request(nowMs, category, type, lines, Math.random);
    if (decision.action === 'skip' || decision.line === undefined) return decision.reason === 'no-lines' ? 'none' : 'busy';
    const name = `${category}_${type}_${decision.line}`;
    const buffer = this.buffer(`voice-${name}`);
    if (!buffer) return 'none';
    const replacing = decision.action === 'replace' && this.barkVoiceId !== null;
    if (replacing && this.barkVoiceId !== null) engine.stopVoice(this.barkVoiceId, 0.06);
    const out = engine.play({
      key: 'voice',
      bus: 'voice',
      buffer,
      gain: dbToGain(VOICE_TRIM_DB[name] ?? 0),
      delay: replacing ? 0.04 : 0,
      priority: 3,
      maxVoices: 2,
      cooldown: 0,
    });
    if (!out.ok) return 'busy';
    this.barks.started(nowMs, category, type, decision.line, out.duration * 1000);
    this.barkVoiceId = out.id;
    engine.holdDuck('voice', DUCK.voice, out.endsAt);
    return 'played';
  }

  /** Dev snapshot for window.__AUDIO__ (see audio-debug.ts). */
  debugSnapshot(): Record<string, unknown> | null {
    const engine = this.engine;
    if (!engine) return null;
    const now = engine.now();
    return {
      time: Math.round(now * 1000) / 1000,
      ctxState: engine.ctx.state,
      settings: { ...this.settings },
      paused: this.paused,
      worldSilenced: this.worldSilenced,
      flavor: this.flavor,
      voiceSpeaking: this.barks.isSpeaking(now * 1000),
      buses: engine.busState(),
      voices: engine.voiceCounts(),
      meters: engine.meters(),
      music: this.music?.snapshot() ?? null,
      crossfades: this.music ? [...this.music.crossfades] : [],
      stats: JSON.parse(JSON.stringify(engine.stats)) as unknown,
      recent: engine.log.slice(-60),
    };
  }

  /** Clear the engine counters (debug). */
  debugResetStats(): void {
    if (!this.engine) return;
    const s = this.engine.stats;
    s.played = 0;
    s.stolen = 0;
    for (const k of Object.keys(s.dropped) as Array<keyof typeof s.dropped>) s.dropped[k] = 0;
    s.maxPerKey = {};
    s.maxPerBus = {};
    this.engine.log.length = 0;
    this.music?.crossfades.splice(0);
  }

  private silenceWorldVoices(): void {
    const engine = this.engine;
    if (!engine) return;
    engine.stopBus('sfx', 0.2);
    engine.stopBus('voice', 0.2);
    engine.releaseDuck('voice');
    this.barks.silence(engine.now() * 1000);
    this.barkVoiceId = null;
  }

  private updateSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applySettings();
    persistSettings(this.settings);
  }

  private applySettings(): void {
    const engine = this.engine;
    if (!engine) return;
    engine.setMaster(this.settings.masterVolume, this.settings.muted);
    for (const bus of BUS_IDS) engine.setBusLevel(bus, this.settings[CHANNEL_OF_BUS[bus]]);
  }

  private buffer(assetKey: string): AudioBuffer | null {
    const cache = this.scene.cache?.audio;
    if (!cache?.exists(assetKey)) return null;
    const data = cache.get(assetKey) as unknown;
    return typeof AudioBuffer !== 'undefined' && data instanceof AudioBuffer ? data : null;
  }
}

function voiceAsset(category: VoiceCategory, type: VoiceBarkType, n: number): string {
  return `voice-${category}_${type}_${n}`;
}
