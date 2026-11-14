// WebAudio graph shared by every sound in the game, built on Phaser's
// AudioContext (so Phaser's unlock-on-gesture and blur handling still apply):
//
//   voice gain -> [pan] -> bus level -> bus duck -> master -> compressor
//     -> limiter -> speakers
//
// Buses: music, ambience, sfx, ui, voice. One-shots get a 4 ms attack and a
// 20 ms release (no clicks at start or at a hard file end), are admitted by
// SfxLimiter (cooldown, per-key cap, bus cap, stealing) and are cut at the
// file's last audible sample so trailing silence never holds a voice slot.
// Ducks are smooth setTargetAtTime moves, never jumps.

import {
  BUS_GAIN,
  BUS_IDS,
  BUS_VOICE_CAP,
  DUCK_ATTACK_TC,
  DUCK_RELEASE_TC,
  MASTER_MAKEUP,
  combinedDuck,
  type BusId,
  type DuckTargets,
} from './mix';
import { SfxLimiter, type DropReason } from './sfx-limiter';

export interface OneShot {
  key: string;
  bus: BusId;
  buffer: AudioBuffer;
  /** Final linear level of this voice (trims, cue volume, spatial, jitter). */
  gain: number;
  pan?: number;
  rate?: number;
  /** Start offset from now, seconds. */
  delay?: number;
  priority: number;
  maxVoices: number;
  /** Seconds between two starts of this key. */
  cooldown: number;
}

export type PlayOutcome = { ok: true; id: number; endsAt: number; duration: number } | { ok: false; reason: DropReason | 'locked' };

export interface PlayLogEntry {
  t: number;
  key: string;
  bus: BusId;
  result: 'play' | DropReason | 'locked';
  gain: number;
  stole: number;
}

interface Bus {
  level: GainNode;
  duck: GainNode;
  duckTarget: number;
}

interface Voice {
  id: number;
  key: string;
  bus: BusId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  endsAt: number;
}

const ATTACK_S = 0.004;
const RELEASE_S = 0.02;
const LOG_SIZE = 200;
/** Samples below -60 dBFS at the end of a file count as silence. */
const TAIL_THRESHOLD = 0.001;

export class AudioEngine {
  private readonly master: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly buses: Record<BusId, Bus>;
  private readonly voices = new Map<number, Voice>();
  private readonly admission = new SfxLimiter(BUS_VOICE_CAP);
  private readonly ducks = new Map<string, { targets: DuckTargets; until: number }>();
  private readonly tails = new WeakMap<AudioBuffer, number>();
  private nextId = 1;
  private suspendedForHidden = false;
  readonly analyser: AnalyserNode;
  readonly log: PlayLogEntry[] = [];
  readonly stats = {
    played: 0,
    dropped: { cooldown: 0, 'key-cap': 0, 'bus-cap': 0, locked: 0 } as Record<DropReason | 'locked', number>,
    stolen: 0,
    maxPerKey: {} as Record<string, number>,
    maxPerBus: {} as Record<string, number>,
  };

  constructor(readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    setCompressor(this.comp, { threshold: -14, knee: 8, ratio: 3, attack: 0.005, release: 0.25 });
    this.limiter = ctx.createDynamicsCompressor();
    setCompressor(this.limiter, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.limiter.connect(this.analyser);
    const buses = {} as Record<BusId, Bus>;
    for (const id of BUS_IDS) {
      const level = ctx.createGain();
      const duck = ctx.createGain();
      level.gain.value = BUS_GAIN[id];
      level.connect(duck);
      duck.connect(this.master);
      buses[id] = { level, duck, duckTarget: 1 };
    }
    this.buses = buses;
    this.watchVisibility();
  }

  /** The engine for a scene whose sound manager is WebAudio; null otherwise. */
  static fromScene(scene: Phaser.Scene): AudioEngine | null {
    const ctx = (scene.sound as Partial<Phaser.Sound.WebAudioSoundManager> | undefined)?.context;
    return ctx && typeof ctx.createGain === 'function' ? new AudioEngine(ctx) : null;
  }

  now(): number {
    return this.ctx.currentTime;
  }

  /** False until the first user gesture unlocks audio (and while hidden). */
  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** Mix gain x the player's channel volume for one bus. */
  setBusLevel(bus: BusId, userVolume: number): void {
    this.buses[bus].level.gain.setTargetAtTime(BUS_GAIN[bus] * userVolume, this.now(), 0.05);
  }

  setMaster(volume: number, muted: boolean): void {
    this.master.gain.setTargetAtTime(muted ? 0 : volume * MASTER_MAKEUP, this.now(), 0.03);
  }

  /** Hold a duck until `until` (engine seconds; Infinity = until released). */
  holdDuck(id: string, targets: DuckTargets, until: number): void {
    const cur = this.ducks.get(id);
    this.ducks.set(id, { targets, until: Math.max(until, cur?.until ?? -Infinity) });
    this.applyDucks();
  }

  releaseDuck(id: string): void {
    if (this.ducks.delete(id)) this.applyDucks();
  }

  /** Bus input node; music decks and ambience beds connect here. */
  busInput(bus: BusId): AudioNode {
    return this.buses[bus].level;
  }

  play(shot: OneShot): PlayOutcome {
    const now = this.now();
    if (!this.running) return this.drop(shot, 'locked', now);
    const verdict = this.admission.admit(now, {
      key: shot.key,
      bus: shot.bus,
      priority: shot.priority,
      maxVoices: shot.maxVoices,
      cooldown: shot.cooldown,
      gain: shot.gain,
    });
    if (!verdict.ok) return this.drop(shot, verdict.reason ?? 'bus-cap', now);
    for (const id of verdict.steal) this.stopVoice(id, 0.04);
    this.stats.stolen += verdict.steal.length;

    const level = shot.gain * verdict.gainScale;
    const rate = shot.rate ?? 1;
    const t = now + Math.max(0, shot.delay ?? 0);
    const tail = this.audibleLength(shot.buffer);
    const duration = tail / rate;
    const end = t + duration;

    const src = this.ctx.createBufferSource();
    src.buffer = shot.buffer;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + ATTACK_S);
    gain.gain.setValueAtTime(level, Math.max(t + ATTACK_S, end - RELEASE_S));
    gain.gain.linearRampToValueAtTime(0, end);
    src.connect(gain);
    if (shot.pan !== undefined && shot.pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, shot.pan));
      gain.connect(panner);
      panner.connect(this.buses[shot.bus].level);
    } else {
      gain.connect(this.buses[shot.bus].level);
    }
    const id = this.nextId++;
    src.onended = () => this.forget(id);
    src.start(t);
    src.stop(end + 0.01);
    this.voices.set(id, { id, key: shot.key, bus: shot.bus, src, gain, endsAt: end });
    this.admission.commit({ id, key: shot.key, bus: shot.bus, priority: shot.priority, gain: level, startedAt: t, endsAt: end });
    this.stats.played++;
    this.record({ t: now, key: shot.key, bus: shot.bus, result: 'play', gain: round3(level), stole: verdict.steal.length });
    this.trackPeaks(shot.key, shot.bus);
    return { ok: true, id, endsAt: end, duration };
  }

  /** Fade one voice out and stop it. */
  stopVoice(id: number, fade = 0.05): void {
    const v = this.voices.get(id);
    if (!v) return;
    const now = this.now();
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    try {
      v.src.stop(now + fade + 0.01);
    } catch {
      /* already stopped */
    }
    this.forget(id);
  }

  /** Fade out every one-shot on a bus (pause, leaving the match). */
  stopBus(bus: BusId, fade = 0.15): void {
    for (const v of [...this.voices.values()]) if (v.bus === bus) this.stopVoice(v.id, fade);
    this.admission.clearBus(bus);
  }

  /** Per frame: expire ducks and voices that ended without an event. */
  update(): void {
    const now = this.now();
    let expired = false;
    for (const [id, d] of this.ducks) {
      if (d.until <= now) {
        this.ducks.delete(id);
        expired = true;
      }
    }
    if (expired) this.applyDucks();
    for (const v of this.voices.values()) if (v.endsAt + 0.5 < now) this.forget(v.id);
  }

  voiceCounts(): { byBus: Record<string, number>; byKey: Record<string, number> } {
    const byBus: Record<string, number> = {};
    const byKey: Record<string, number> = {};
    const now = this.now();
    for (const v of this.voices.values()) {
      if (v.endsAt <= now) continue;
      byBus[v.bus] = (byBus[v.bus] ?? 0) + 1;
      byKey[v.key] = (byKey[v.key] ?? 0) + 1;
    }
    return { byBus, byKey };
  }

  busState(): Record<BusId, { level: number; duck: number }> {
    const out = {} as Record<BusId, { level: number; duck: number }>;
    for (const id of BUS_IDS) {
      out[id] = { level: round3(this.buses[id].level.gain.value), duck: round3(this.buses[id].duckTarget) };
    }
    return out;
  }

  meters(): { master: number; compReductionDb: number; limiterReductionDb: number; peak: number } {
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    return {
      master: round3(this.master.gain.value),
      compReductionDb: round3(this.comp.reduction),
      limiterReductionDb: round3(this.limiter.reduction),
      peak: round3(peak),
    };
  }

  /** Seconds of the buffer up to its last audible sample (cached). */
  audibleLength(buffer: AudioBuffer): number {
    const cached = this.tails.get(buffer);
    if (cached !== undefined) return cached;
    let last = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = data.length - 1; i > last; i--) {
        if (Math.abs(data[i]) > TAIL_THRESHOLD) {
          last = i;
          break;
        }
      }
    }
    const len = Math.max(0.05, Math.min(buffer.duration, (last + 1) / buffer.sampleRate + 0.03));
    this.tails.set(buffer, len);
    return len;
  }

  private applyDucks(): void {
    const now = this.now();
    const active = [...this.ducks.values()].map((d) => d.targets);
    for (const id of BUS_IDS) {
      const bus = this.buses[id];
      const target = combinedDuck(id, active);
      if (Math.abs(target - bus.duckTarget) < 1e-3) continue;
      const tc = target < bus.duckTarget ? DUCK_ATTACK_TC : DUCK_RELEASE_TC;
      bus.duck.gain.cancelScheduledValues(now);
      bus.duck.gain.setTargetAtTime(target, now, tc);
      bus.duckTarget = target;
    }
  }

  private forget(id: number): void {
    if (this.voices.delete(id)) this.admission.release(id);
  }

  private drop(shot: OneShot, reason: DropReason | 'locked', now: number): PlayOutcome {
    this.stats.dropped[reason]++;
    this.record({ t: now, key: shot.key, bus: shot.bus, result: reason, gain: round3(shot.gain), stole: 0 });
    return { ok: false, reason };
  }

  private record(entry: PlayLogEntry): void {
    this.log.push({ ...entry, t: Math.round(entry.t * 1000) / 1000 });
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }

  private trackPeaks(key: string, bus: BusId): void {
    const { byBus, byKey } = this.voiceCounts();
    this.stats.maxPerKey[key] = Math.max(this.stats.maxPerKey[key] ?? 0, byKey[key] ?? 0);
    this.stats.maxPerBus[bus] = Math.max(this.stats.maxPerBus[bus] ?? 0, byBus[bus] ?? 0);
  }

  /** Suspend while the tab is hidden; resume only what we suspended. */
  private watchVisibility(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this.suspendedForHidden = true;
          void this.ctx.suspend();
        }
      } else if (this.suspendedForHidden) {
        this.suspendedForHidden = false;
        void this.ctx.resume();
      }
    });
  }
}

function setCompressor(
  node: DynamicsCompressorNode,
  p: { threshold: number; knee: number; ratio: number; attack: number; release: number }
): void {
  node.threshold.value = p.threshold;
  node.knee.value = p.knee;
  node.ratio.value = p.ratio;
  node.attack.value = p.attack;
  node.release.value = p.release;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
