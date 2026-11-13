// Music + ambience playback on the engine's buses. A "program" says what to
// play (menu theme with gaps, peaceful songs with gaps, an endless battle
// chain); switching programs is one equal-power crossfade, and asking for the
// program already running is a no-op, so the director can call every frame.
//
// - gapped: song (fade in, play its window, fade out) -> quiet gap with only
//   ambience -> next song (never the same one twice in a row).
// - chain: battle segments that cross into each other before each file's
//   ending, alternating tracks, so the loop never dies out and slams back.
// Ambience beds loop natively and crossfade between each other.

import type { AudioEngine } from './audio-engine';
import { dbToGain, equalPowerCurve, type BusId } from './mix';
import {
  chainHandoverAt,
  holdRamp,
  rampActive,
  rampValue,
  randomGap,
  songTimes,
  trackWindow,
  type Ramp,
  type TrackWindow,
} from './music-plan';

export interface MusicProgram {
  id: string;
  kind: 'gapped' | 'chain' | 'silent';
  pick: (last: string | null) => string | null;
  /** gapped: quiet seconds between songs. */
  gap?: readonly [number, number];
  /** Fade-in of each song (gapped) or of the first segment (chain). */
  fadeIn: number;
  /** gapped: fade-out at each song's end. */
  fadeOut?: number;
  /** chain: crossfade between segments. */
  xfade?: number;
}

export const SILENT_PROGRAM: MusicProgram = { id: 'silent', kind: 'silent', pick: () => null, fadeIn: 0 };

interface Deck {
  key: string;
  bus: BusId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  full: number;
  ramp: Ramp;
  startAt: number;
  win: TrackWindow;
  fadeOutAt: number;
  endAt: number;
  handoverAt: number;
  fading: boolean;
  stopAt: number;
}

export interface Crossfade {
  at: number;
  from: string | null;
  to: string;
  fadeOutS: number;
  fadeInS: number;
}

const CURVE_STEPS = 64;
const RETRY_S = 5;

export class MusicPlayer {
  private program: MusicProgram = SILENT_PROGRAM;
  private songs: Deck[] = [];
  private current: Deck | null = null;
  private nextAt = Infinity;
  private lastKey: string | null = null;
  private beds: Deck[] = [];
  private bedKey: string | null = null;
  private pendingFadeOut = 0;
  readonly crossfades: Crossfade[] = [];

  constructor(
    private readonly engine: AudioEngine,
    private readonly buffer: (key: string) => AudioBuffer | null,
    private readonly trimDb: (key: string) => number,
    private readonly rand: () => number = Math.random
  ) {}

  get programId(): string {
    return this.program.id;
  }

  /**
   * Switch program. Running songs fade out over `fadeOut`; the new program's
   * first song starts after `delay` (overlap = crossfade). Same id: no-op.
   */
  setProgram(program: MusicProgram, transition: { fadeOut: number; delay?: number }): void {
    if (program.id === this.program.id) return;
    const now = this.engine.now();
    for (const d of this.songs) if (!d.fading || d.ramp.to > 0) this.fadeTo(d, 0, transition.fadeOut, now);
    this.pendingFadeOut = transition.fadeOut;
    this.program = program;
    this.current = null;
    this.nextAt = program.kind === 'silent' ? Infinity : now + Math.max(0, transition.delay ?? 0);
  }

  /** Crossfade the ambience bed (null = fade to silence). */
  setBed(key: string | null, fade: number): void {
    if (key === this.bedKey) return;
    const now = this.engine.now();
    for (const d of this.beds) if (d.ramp.to > 0) this.fadeTo(d, 0, fade, now);
    this.bedKey = key;
    if (!key) return;
    const deck = this.startDeck(key, 'ambience', now, fade, true);
    if (deck) this.beds.push(deck);
  }

  update(): void {
    const now = this.engine.now();
    this.songs = this.songs.filter((d) => d.stopAt > now);
    this.beds = this.beds.filter((d) => d.stopAt > now);
    const p = this.program;
    if (p.kind === 'silent') return;
    const cur = this.current;
    if (!cur) {
      if (now >= this.nextAt) this.startNext(now, p.fadeIn, this.pendingFadeOut);
      return;
    }
    if (p.kind === 'gapped') {
      if (!cur.fading && now >= cur.fadeOutAt) this.fadeTo(cur, 0, Math.max(0.05, cur.endAt - now), now);
      if (now >= cur.endAt) {
        this.current = null;
        this.pendingFadeOut = 0;
        this.nextAt = now + randomGap(p.gap ?? [8, 16], this.rand);
      }
    } else if (now >= cur.handoverAt - 0.5) {
      // Schedule the next segment to start exactly at the handover point.
      const xfade = p.xfade ?? 3;
      const at = Math.max(now, cur.handoverAt);
      this.fadeTo(cur, 0, xfade, at);
      this.current = null;
      this.startNext(at, xfade, xfade);
    }
  }

  /** Everything fades to silence (scene teardown). */
  stopAll(fade: number): void {
    this.setProgram(SILENT_PROGRAM, { fadeOut: fade });
    this.setBed(null, fade);
  }

  snapshot(): {
    program: string;
    songs: Array<{ key: string; gain: number; full: number; fading: boolean; startAt: number }>;
    audibleSongs: number;
    crossfading: boolean;
    bed: string | null;
    beds: Array<{ key: string; gain: number }>;
    nextSongIn: number | null;
  } {
    const now = this.engine.now();
    const songs = this.songs.map((d) => ({
      key: d.key,
      gain: round3(rampValue(d.ramp, now)),
      full: round3(d.full),
      fading: rampActive(d.ramp, now),
      startAt: round3(d.startAt),
    }));
    const audible = this.songs.filter((d) => d.startAt <= now && rampValue(d.ramp, now) > d.full * 0.03);
    return {
      program: this.program.id,
      songs,
      audibleSongs: audible.length,
      crossfading: this.songs.some((d) => rampActive(d.ramp, now)),
      bed: this.bedKey,
      beds: this.beds.map((d) => ({ key: d.key, gain: round3(rampValue(d.ramp, now)) })),
      nextSongIn: this.current || !Number.isFinite(this.nextAt) ? null : round3(this.nextAt - now),
    };
  }

  private startNext(at: number, fadeIn: number, outgoingFade: number): void {
    const p = this.program;
    const key = p.pick(this.lastKey);
    const deck = key ? this.startDeck(key, 'music', at, fadeIn, false) : null;
    if (!deck || !key) {
      this.nextAt = at + RETRY_S;
      return;
    }
    const outgoing = this.songs.find((d) => d.fading && d.ramp.to === 0 && d.stopAt > at);
    if (outgoing) {
      this.crossfades.push({ at: round3(at), from: outgoing.key, to: key, fadeOutS: outgoingFade, fadeInS: fadeIn });
      if (this.crossfades.length > 30) this.crossfades.shift();
    }
    if (p.kind === 'gapped') {
      const t = songTimes(at, deck.win, p.fadeOut ?? 3);
      deck.fadeOutAt = t.fadeOutAt;
      deck.endAt = t.endAt;
    } else {
      deck.handoverAt = chainHandoverAt(at, deck.win, p.xfade ?? 3);
    }
    this.songs.push(deck);
    this.current = deck;
    this.lastKey = key;
  }

  private startDeck(key: string, bus: BusId, at: number, fadeIn: number, loop: boolean): Deck | null {
    const buffer = this.buffer(key);
    if (!buffer) return null;
    const ctx = this.engine.ctx;
    const win = trackWindow(key, buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    const gain = ctx.createGain();
    const full = dbToGain(this.trimDb(key));
    // Curves must not share a start time with another event, hence the 5 ms.
    const rampAt = at + 0.005;
    gain.gain.setValueAtTime(0, at);
    if (fadeIn > 0) {
      gain.gain.setValueCurveAtTime(equalPowerCurve(CURVE_STEPS, 'in', 0, full), rampAt, fadeIn);
    } else {
      gain.gain.setValueAtTime(full, rampAt);
    }
    src.connect(gain);
    gain.connect(this.engine.busInput(bus));
    src.start(at, loop ? 0 : win.inSec);
    return {
      key,
      bus,
      src,
      gain,
      full,
      ramp: fadeIn > 0 ? { t0: rampAt, dur: fadeIn, from: 0, to: full, shape: 'equal-power' } : holdRamp(rampAt, full),
      startAt: at,
      win,
      fadeOutAt: Infinity,
      endAt: Infinity,
      handoverAt: Infinity,
      fading: false,
      stopAt: Infinity,
    };
  }

  /** Equal-power move of a deck's gain from its current value, at `at`. */
  private fadeTo(deck: Deck, target: number, dur: number, at: number): void {
    const now = this.engine.now();
    const when = Math.max(now, at);
    const from = rampValue(deck.ramp, when);
    const param = deck.gain.gain;
    const start = when + 0.002;
    try {
      holdAt(param, when, from, now);
      if (dur > 0.01) {
        const dir = target >= from ? 'in' : 'out';
        param.setValueCurveAtTime(equalPowerCurve(CURVE_STEPS, dir, from, target), start, dur);
      } else {
        param.setValueAtTime(target, start);
      }
    } catch (err) {
      // Automation clash (browser without cancelAndHoldAtTime): land on the
      // target rather than leave a deck stuck at full level.
      console.warn('[audio] fade fell back to a direct set:', err);
      param.cancelScheduledValues(0);
      param.setValueAtTime(target, now);
    }
    deck.ramp = { t0: start, dur: Math.max(0, dur), from, to: target, shape: 'equal-power' };
    if (target <= 0) {
      deck.fading = true;
      deck.stopAt = start + dur + 0.05;
      try {
        deck.src.stop(deck.stopAt);
      } catch {
        /* already stopped */
      }
    }
  }
}

/** Freeze a param at `from` at time `when`, dropping later automation. */
function holdAt(param: AudioParam, when: number, from: number, now: number): void {
  if (when <= now + 0.001) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(when);
      return;
    }
    // No cancelAndHold (Firefox): clear everything, then pin the value.
    param.cancelScheduledValues(0);
    param.setValueAtTime(from, when);
    return;
  }
  param.cancelScheduledValues(when);
  param.setValueAtTime(from, when);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
