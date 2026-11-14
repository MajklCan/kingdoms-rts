/**
 * Touch gesture recognizer: a pure state machine over timestamped pointer
 * events (no DOM, no Phaser), so the thresholds are unit tested.
 *
 *   one finger, quick release in place      tap (count 2 when it lands on the previous tap)
 *   one finger, held in place               pressArmed after LONG_PRESS_MS, press on release
 *   one finger, moved past the slop         pan (with a release velocity for inertia)
 *   held until armed, then moved            box (selection rectangle)
 *   two fingers                             pinch (centre + scale), which also pans
 *
 * A second finger always wins: it ends a pan, drops a box or an armed press
 * and starts a pinch. When one finger of a pinch lifts, the other one keeps
 * panning; it never turns into a tap.
 *
 * Coordinates are whatever the caller feeds in (CSS px in practice); the
 * slops are in the same unit.
 */

export interface GestureConfig {
  /** Movement that still counts as "in place" for a tap or long press. */
  tapSlop: number;
  longPressMs: number;
  /** Second tap within this time and distance makes a double tap. */
  doubleTapMs: number;
  doubleTapSlop: number;
  /** Release velocity is measured over this trailing window. */
  velocityWindowMs: number;
  /** A finger that rested this long before lifting releases with no velocity. */
  restBeforeReleaseMs: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  tapSlop: 10,
  longPressMs: 350,
  doubleTapMs: 300,
  doubleTapSlop: 30,
  velocityWindowMs: 100,
  restBeforeReleaseMs: 60,
};

export type GestureEvent =
  | { type: 'tap'; x: number; y: number; count: 1 | 2 }
  | { type: 'pressArmed'; x: number; y: number }
  | { type: 'press'; x: number; y: number }
  | { type: 'pressCancel' }
  | { type: 'panStart'; x: number; y: number }
  | { type: 'pan'; x: number; y: number; dx: number; dy: number }
  | { type: 'panEnd'; x: number; y: number; vx: number; vy: number }
  | { type: 'boxStart'; x: number; y: number }
  | { type: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'boxEnd'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'boxCancel' }
  | { type: 'pinchStart'; cx: number; cy: number }
  | { type: 'pinch'; cx: number; cy: number; scale: number }
  | { type: 'pinchEnd'; cx: number; cy: number };

type State = 'idle' | 'pending' | 'armed' | 'panning' | 'boxing' | 'pinching';

interface Finger {
  id: number;
  x: number;
  y: number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

export class GestureRecognizer {
  private state: State = 'idle';
  private fingers: Finger[] = [];
  private downX = 0;
  private downY = 0;
  private downAt = 0;
  private lastX = 0;
  private lastY = 0;
  private samples: Sample[] = [];
  private pinchDist0 = 1;
  private lastTap: { x: number; y: number; t: number } | null = null;

  constructor(private readonly cfg: GestureConfig = DEFAULT_GESTURE_CONFIG) {}

  get activeState(): State {
    return this.state;
  }

  get fingerCount(): number {
    return this.fingers.length;
  }

  /** When the pending long press arms, or null when none is pending. */
  get longPressDueAt(): number | null {
    return this.state === 'pending' ? this.downAt + this.cfg.longPressMs : null;
  }

  down(id: number, x: number, y: number, t: number): GestureEvent[] {
    if (this.fingers.some((f) => f.id === id)) return [];
    if (this.fingers.length >= 2) return [];
    this.fingers.push({ id, x, y });
    if (this.fingers.length === 1) {
      this.state = 'pending';
      this.downX = this.lastX = x;
      this.downY = this.lastY = y;
      this.downAt = t;
      this.samples = [{ t, x, y }];
      return [];
    }
    // Second finger: whatever one finger was doing gives way to a pinch.
    const out = this.endSingle(t, true);
    this.state = 'pinching';
    this.pinchDist0 = Math.max(1, this.pinchDistance());
    const c = this.pinchCentre();
    out.push({ type: 'pinchStart', cx: c.x, cy: c.y });
    return out;
  }

  move(id: number, x: number, y: number, t: number): GestureEvent[] {
    const finger = this.fingers.find((f) => f.id === id);
    if (!finger) return [];
    finger.x = x;
    finger.y = y;
    const out: GestureEvent[] = [];
    if (this.state === 'pinching') {
      const c = this.pinchCentre();
      out.push({ type: 'pinch', cx: c.x, cy: c.y, scale: this.pinchDistance() / this.pinchDist0 });
      return out;
    }
    if (this.fingers[0]?.id !== id) return out;
    this.samples.push({ t, x, y });
    while (this.samples.length > 2 && t - this.samples[0]!.t > this.cfg.velocityWindowMs) this.samples.shift();
    const moved = Math.hypot(x - this.downX, y - this.downY) > this.cfg.tapSlop;
    if (this.state === 'pending' && moved) {
      this.state = 'panning';
      out.push({ type: 'panStart', x: this.downX, y: this.downY });
      this.lastX = this.downX;
      this.lastY = this.downY;
    } else if (this.state === 'armed' && moved) {
      this.state = 'boxing';
      out.push({ type: 'boxStart', x: this.downX, y: this.downY });
    }
    if (this.state === 'panning') {
      out.push({ type: 'pan', x, y, dx: x - this.lastX, dy: y - this.lastY });
      this.lastX = x;
      this.lastY = y;
    } else if (this.state === 'boxing') {
      out.push({ type: 'box', x0: this.downX, y0: this.downY, x1: x, y1: y });
    }
    return out;
  }

  up(id: number, x: number, y: number, t: number): GestureEvent[] {
    const idx = this.fingers.findIndex((f) => f.id === id);
    if (idx < 0) return [];
    const finger = this.fingers[idx]!;
    finger.x = x;
    finger.y = y;
    if (this.state === 'pinching') {
      const c = this.pinchCentre();
      this.fingers.splice(idx, 1);
      const out: GestureEvent[] = [{ type: 'pinchEnd', cx: c.x, cy: c.y }];
      const rest = this.fingers[0];
      if (rest) {
        // The remaining finger carries on as a pan, never as a tap.
        this.state = 'panning';
        this.downX = this.lastX = rest.x;
        this.downY = this.lastY = rest.y;
        this.samples = [{ t, x: rest.x, y: rest.y }];
        out.push({ type: 'panStart', x: rest.x, y: rest.y });
      } else {
        this.reset();
      }
      return out;
    }
    if (idx !== 0) {
      this.fingers.splice(idx, 1);
      return [];
    }
    const out = this.move(id, x, y, t);
    this.samples.push({ t, x, y });
    out.push(...this.endSingle(t, false));
    this.fingers.splice(idx, 1);
    this.reset();
    return out;
  }

  /** The browser took the pointer (gesture, palm rejection): drop the gesture cleanly. */
  cancel(id: number, t: number): GestureEvent[] {
    if (!this.fingers.some((f) => f.id === id)) return [];
    const out: GestureEvent[] = [];
    if (this.state === 'pinching') {
      const c = this.pinchCentre();
      out.push({ type: 'pinchEnd', cx: c.x, cy: c.y });
    } else {
      out.push(...this.endSingle(t, true));
    }
    this.fingers = [];
    this.reset();
    return out;
  }

  /** Call when {@link longPressDueAt} passes: arms the long press if still in place. */
  poll(t: number): GestureEvent[] {
    if (this.state !== 'pending' || t - this.downAt < this.cfg.longPressMs) return [];
    this.state = 'armed';
    this.lastTap = null;
    return [{ type: 'pressArmed', x: this.downX, y: this.downY }];
  }

  /**
   * Finish the one-finger gesture. `aborted` = a second finger or a cancel:
   * no tap, no press, a pan stops dead, a box is dropped.
   */
  private endSingle(t: number, aborted: boolean): GestureEvent[] {
    const x = this.fingers[0]?.x ?? this.lastX;
    const y = this.fingers[0]?.y ?? this.lastY;
    switch (this.state) {
      case 'pending': {
        if (aborted) return [];
        if (t - this.downAt >= this.cfg.longPressMs) return [{ type: 'press', x: this.downX, y: this.downY }];
        return [this.tapAt(this.downX, this.downY, t)];
      }
      case 'armed':
        return aborted ? [{ type: 'pressCancel' }] : [{ type: 'press', x: this.downX, y: this.downY }];
      case 'panning': {
        const v = aborted ? { vx: 0, vy: 0 } : this.releaseVelocity(t);
        return [{ type: 'panEnd', x, y, ...v }];
      }
      case 'boxing':
        return aborted ? [{ type: 'boxCancel' }] : [{ type: 'boxEnd', x0: this.downX, y0: this.downY, x1: x, y1: y }];
      default:
        return [];
    }
  }

  private tapAt(x: number, y: number, t: number): GestureEvent {
    const last = this.lastTap;
    const isDouble =
      last !== null && t - last.t <= this.cfg.doubleTapMs && Math.hypot(x - last.x, y - last.y) <= this.cfg.doubleTapSlop;
    // A double tap consumes the pair, so a third tap starts over.
    this.lastTap = isDouble ? null : { x, y, t };
    return { type: 'tap', x, y, count: isDouble ? 2 : 1 };
  }

  /** px per ms over the trailing window; zero when the finger rested before lifting. */
  private releaseVelocity(t: number): { vx: number; vy: number } {
    const s = this.samples.filter((p) => t - p.t <= this.cfg.velocityWindowMs);
    if (s.length < 2) return { vx: 0, vy: 0 };
    const first = s[0]!;
    const last = s[s.length - 1]!;
    // The last movement sample before the release (the release repeats the position).
    let lastMove = s.length - 1;
    while (lastMove > 0 && s[lastMove]!.x === s[lastMove - 1]!.x && s[lastMove]!.y === s[lastMove - 1]!.y) lastMove--;
    if (t - s[lastMove]!.t > this.cfg.restBeforeReleaseMs) return { vx: 0, vy: 0 };
    const dt = Math.max(1, last.t - first.t);
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }

  private pinchCentre(): { x: number; y: number } {
    const [a, b] = this.fingers;
    if (!a) return { x: this.lastX, y: this.lastY };
    if (!b) return { x: a.x, y: a.y };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private pinchDistance(): number {
    const [a, b] = this.fingers;
    if (!a || !b) return 1;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private reset(): void {
    this.state = this.fingers.length > 0 ? this.state : 'idle';
    if (this.fingers.length === 0) this.samples = [];
  }
}
