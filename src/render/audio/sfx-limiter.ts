// Voice admission for one-shot sounds: per-key cooldown, per-key concurrency
// cap with stealing, a per-bus cap with priority stealing, and density-aware
// level so stacked copies of one sound do not sum into a loud phasey burst.
// Pure: time is passed in (seconds), the engine does the actual playing.

import type { BusId } from './mix';

export interface ActiveVoice {
  id: number;
  key: string;
  bus: BusId;
  priority: number;
  /** Level the voice was started at (after spatial + trims). */
  gain: number;
  startedAt: number;
  endsAt: number;
}

export interface VoiceRequest {
  key: string;
  bus: BusId;
  priority: number;
  maxVoices: number;
  /** Minimum seconds between two starts of this key. */
  cooldown: number;
  gain: number;
}

export type DropReason = 'cooldown' | 'key-cap' | 'bus-cap';

export interface Admission {
  ok: boolean;
  reason?: DropReason;
  /** Voice ids to fade out to make room. */
  steal: number[];
  /** Multiply the new voice's level by this (1 / sqrt(1 + copies still sounding)). */
  gainScale: number;
}

export class SfxLimiter {
  private readonly voices = new Map<number, ActiveVoice>();
  private readonly lastStart = new Map<string, number>();

  constructor(private readonly busCaps: Partial<Record<BusId, number>>) {}

  /** Forget voices whose end time has passed. */
  prune(now: number): void {
    for (const [id, v] of this.voices) if (v.endsAt <= now) this.voices.delete(id);
  }

  admit(now: number, req: VoiceRequest): Admission {
    this.prune(now);
    const last = this.lastStart.get(req.key);
    if (last !== undefined && now - last < req.cooldown) return drop('cooldown');

    const steal: number[] = [];
    const sameKey = [...this.voices.values()].filter((v) => v.key === req.key);
    if (sameKey.length >= req.maxVoices) {
      const weakest = minBy(sameKey, (v) => score(v, now));
      if (!weakest || score(weakest, now) >= req.gain) return drop('key-cap');
      steal.push(weakest.id);
    }

    // Copies still sounding, weighted by how much of each is left.
    let copies = 0;
    for (const v of sameKey) if (!steal.includes(v.id)) copies += remaining(v, now);
    const gainScale = 1 / Math.sqrt(1 + copies);

    const cap = this.busCaps[req.bus];
    if (cap !== undefined) {
      const onBus = [...this.voices.values()].filter((v) => v.bus === req.bus && !steal.includes(v.id));
      if (onBus.length >= cap) {
        const victim = minBy(onBus, (v) => v.priority * 10 + score(v, now));
        const beats = victim && (victim.priority < req.priority ||
          (victim.priority === req.priority && score(victim, now) < req.gain * gainScale));
        if (!victim || !beats) return drop('bus-cap');
        steal.push(victim.id);
      }
    }
    return { ok: true, steal, gainScale };
  }

  /** Record a voice that the engine actually started. */
  commit(voice: ActiveVoice): void {
    this.voices.set(voice.id, voice);
    this.lastStart.set(voice.key, voice.startedAt);
  }

  release(id: number): void {
    this.voices.delete(id);
  }

  clearBus(bus: BusId): void {
    for (const [id, v] of this.voices) if (v.bus === bus) this.voices.delete(id);
  }

  active(now: number): ActiveVoice[] {
    this.prune(now);
    return [...this.voices.values()];
  }
}

function drop(reason: DropReason): Admission {
  return { ok: false, reason, steal: [], gainScale: 0 };
}

/** Fraction of the voice still to play, 0..1. */
function remaining(v: ActiveVoice, now: number): number {
  const len = v.endsAt - v.startedAt;
  if (len <= 0) return 0;
  return Math.max(0, Math.min(1, (v.endsAt - now) / len));
}

/** How much a voice still contributes: level x remaining fraction. */
function score(v: ActiveVoice, now: number): number {
  return v.gain * remaining(v, now);
}

function minBy<T>(items: T[], f: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestV = Infinity;
  for (const it of items) {
    const v = f(it);
    if (v < bestV) {
      bestV = v;
      best = it;
    }
  }
  return best;
}
