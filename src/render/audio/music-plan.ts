// Music scheduling math: per-track play windows (skip lead-in silence, leave
// before a long fade-out tail), gain ramps you can read back mid-flight, song
// picking without immediate repeats, randomized quiet gaps. Pure.

export interface TrackWindow {
  /** Where to start reading the file (s). */
  inSec: number;
  /** Musical end: gapped songs fade out by here, chained loops cross here. */
  outSec: number;
}

/**
 * Measured 2026-11-13 (ffmpeg, 250 ms RMS windows). battle_theme has a 5 s
 * decaying ending after 25 s; looped raw it died out and slammed back every
 * 30 s. village_theme has 0.47 s of lead-in silence.
 */
const WINDOWS: Record<string, Partial<TrackWindow>> = {
  menu_theme: { outSec: 29.3 },
  village_theme: { inSec: 0.45, outSec: 29.4 },
  ingame_1: { outSec: 29.95 },
  // 90 s, natural decay from 86 s; 2.7 s of trailing silence cut.
  ingame_2: { inSec: 0.2, outSec: 88 },
  battle_theme: { outSec: 25.5 },
  battle_2: { inSec: 0.03 },
};

export function trackWindow(key: string, duration: number): TrackWindow {
  const w = WINDOWS[key] ?? {};
  const inSec = Math.min(Math.max(0, w.inSec ?? 0), Math.max(0, duration - 1));
  const outSec = Math.max(inSec + 1, Math.min(duration, w.outSec ?? duration));
  return { inSec, outSec };
}

/** A gain automation segment, kept so its value can be read at any time. */
export interface Ramp {
  t0: number;
  dur: number;
  from: number;
  to: number;
  shape: 'equal-power' | 'linear';
}

export function holdRamp(t0: number, value: number): Ramp {
  return { t0, dur: 0, from: value, to: value, shape: 'linear' };
}

/** Value of a ramp at time t. Equal-power matches mix.equalPowerCurve. */
export function rampValue(r: Ramp, t: number): number {
  if (r.dur <= 0 || t >= r.t0 + r.dur) return r.to;
  if (t <= r.t0) return r.from;
  const x = (t - r.t0) / r.dur;
  if (r.shape === 'linear') return r.from + (r.to - r.from) * x;
  if (r.to >= r.from) return r.from + (r.to - r.from) * Math.sin((x * Math.PI) / 2);
  return r.to + (r.from - r.to) * Math.cos((x * Math.PI) / 2);
}

export function rampActive(r: Ramp, t: number): boolean {
  return r.dur > 0 && t >= r.t0 && t < r.t0 + r.dur;
}

/** Random pick that avoids repeating the previous song when there is a choice. */
export function pickNext(list: readonly string[], last: string | null, rand: () => number): string | null {
  if (list.length === 0) return null;
  const pool = list.length > 1 && last !== null ? list.filter((k) => k !== last) : list;
  const from = pool.length > 0 ? pool : list;
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}

export function randomGap(range: readonly [number, number], rand: () => number): number {
  return range[0] + rand() * (range[1] - range[0]);
}

/** One song of a gapped program: when its fade-out starts and when it ends. */
export function songTimes(startAt: number, win: TrackWindow, fadeOutSec: number): { fadeOutAt: number; endAt: number } {
  const len = win.outSec - win.inSec;
  const endAt = startAt + len;
  return { fadeOutAt: Math.max(startAt, endAt - fadeOutSec), endAt };
}

/** One segment of a chained loop: when the next segment must start crossing. */
export function chainHandoverAt(startAt: number, win: TrackWindow, xfadeSec: number): number {
  const len = win.outSec - win.inSec;
  return startAt + Math.max(len / 2, len - xfadeSec);
}
