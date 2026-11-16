/**
 * Decides when the autosave fires: after `intervalMs` of wall time spent
 * unpaused, and on the frame the match becomes paused. Pure; the caller
 * feeds it frame timestamps.
 */

export const AUTOSAVE_INTERVAL_MS = 30_000;
/** Longest frame gap that counts as play time (a hidden tab stops frames). */
const MAX_FRAME_MS = 1_000;

export type AutosaveTrigger = 'none' | 'interval' | 'paused';

export class AutosaveClock {
  private elapsedMs = 0;
  private lastNow: number | null = null;
  private wasPaused: boolean;

  constructor(
    private readonly intervalMs = AUTOSAVE_INTERVAL_MS,
    paused = false
  ) {
    this.wasPaused = paused;
  }

  /** Advance to `now` (ms). Returns what, if anything, should save this frame. */
  advance(now: number, paused: boolean): AutosaveTrigger {
    const last = this.lastNow;
    this.lastNow = now;
    const becamePaused = paused && !this.wasPaused;
    this.wasPaused = paused;
    if (becamePaused) {
      this.elapsedMs = 0;
      return 'paused';
    }
    if (paused || last === null) return 'none';
    this.elapsedMs += Math.min(MAX_FRAME_MS, Math.max(0, now - last));
    if (this.elapsedMs < this.intervalMs) return 'none';
    this.elapsedMs = 0;
    return 'interval';
  }

  /** A save happened for another reason; start the interval over. */
  restart(): void {
    this.elapsedMs = 0;
  }
}
