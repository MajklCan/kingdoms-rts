/**
 * Performance mode for weak GPUs (in-car browsers, old tablets): ambient
 * life (birds, wildlife, leaves, chimney smoke, cloud shadows, motes) stops,
 * trees stop swaying and particle bursts are thinned. Combat and economy
 * feedback stays, so the game reads the same, only calmer.
 *
 * Preference: 'auto' turns it on by itself when a frame-time probe (fed by
 * the UI, touch only) reports a slow device; 'on' / 'off' force it.
 */

export type PerfModePref = 'auto' | 'on' | 'off';

let pref: PerfModePref = 'auto';
let autoOn = false;

export function performanceMode(): boolean {
  return pref === 'on' || (pref === 'auto' && autoOn);
}

export function perfModePref(): PerfModePref {
  return pref;
}

export function setPerfModePref(next: PerfModePref): void {
  pref = next;
}

/** The auto probe decided this device is slow (kept for the session). */
export function setPerfModeAuto(on: boolean): void {
  autoOn = on;
}

export function perfModeAutoEngaged(): boolean {
  return autoOn;
}

/**
 * Frame-time probe: rolling average over `windowMs`; reports slow once the
 * average stays above `limitMs` for `holdMs`. Pure, fed by timestamps.
 */
export class FrameTimeProbe {
  private samples: Array<{ t: number; dt: number }> = [];
  private slowSince: number | null = null;

  constructor(
    private readonly limitMs = 25,
    private readonly windowMs = 1000,
    private readonly holdMs = 4000
  ) {}

  /** Feed one frame; returns true when the device has been slow long enough. */
  frame(t: number, dtMs: number): boolean {
    // A hidden tab or a breakpoint is not a slow GPU.
    if (dtMs > 250) {
      this.samples = [];
      this.slowSince = null;
      return false;
    }
    this.samples.push({ t, dt: dtMs });
    while (this.samples.length > 0 && t - this.samples[0]!.t > this.windowMs) this.samples.shift();
    const span = this.samples.length;
    if (span < 10) return false;
    const avg = this.samples.reduce((s, x) => s + x.dt, 0) / span;
    if (avg <= this.limitMs) {
      this.slowSince = null;
      return false;
    }
    if (this.slowSince === null) this.slowSince = t;
    return t - this.slowSince >= this.holdMs;
  }

  average(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((s, x) => s + x.dt, 0) / this.samples.length;
  }
}
