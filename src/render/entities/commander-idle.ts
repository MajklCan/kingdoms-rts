/**
 * The Commander's idle gag: after he has stood with nothing to do for a few
 * seconds he rolls a cigarette, lights it and smokes, and now and then sits
 * down for a moment. Purely visual: it is derived from "idle for this long"
 * and render time, never stored in the sim and never drawn from its rng. Any
 * order (a move, an attack target, a fight) clears the idle timer, so the
 * next frame is the plain idle or move art again.
 */

export type IdleGagAnim = 'idle' | 'idle-smoke' | 'idle-sit';

export interface IdleGagPick {
  anim: IdleGagAnim;
  /** Time spent in the current anim of the cycle, ms. */
  localMs: number;
}

/** Plain idle before the first gag. */
export const IDLE_GAG_DELAY_MS = 4000;

/** One round of the gag: smoke, a breather, sit, a breather, then again. */
const CYCLE: ReadonlyArray<{ anim: IdleGagAnim; ms: number }> = [
  { anim: 'idle-smoke', ms: 12000 },
  { anim: 'idle', ms: 2000 },
  { anim: 'idle-sit', ms: 6000 },
  { anim: 'idle', ms: 2000 },
];
const CYCLE_MS = CYCLE.reduce((sum, step) => sum + step.ms, 0);

/** Which idle anim plays after `idleMs` of standing still. */
export function commanderIdleAnim(idleMs: number): IdleGagPick {
  if (!(idleMs > IDLE_GAG_DELAY_MS)) return { anim: 'idle', localMs: Math.max(0, idleMs) };
  let t = (idleMs - IDLE_GAG_DELAY_MS) % CYCLE_MS;
  for (const step of CYCLE) {
    if (t < step.ms) return { anim: step.anim, localMs: t };
    t -= step.ms;
  }
  return { anim: 'idle', localMs: 0 };
}

/** Frame of a gag anim: smoking loops, sitting plays through once and holds. */
export function idleGagFrame(pick: IdleGagPick, frames: number, frameMs: number): number {
  if (frames <= 0 || frameMs <= 0) return 0;
  const raw = Math.floor(pick.localMs / frameMs);
  return pick.anim === 'idle-sit' ? Math.min(frames - 1, raw) : raw % frames;
}

/** Remembers, per unit, since when it has been idle (render time, ms). */
export class IdleGagTracker {
  private readonly since = new Map<number, number>();

  /** Gag pick for a unit, or null when it is busy (its idle timer is reset). */
  pick(eid: number, idle: boolean, nowMs: number): IdleGagPick | null {
    if (!idle) {
      this.since.delete(eid);
      return null;
    }
    let start = this.since.get(eid);
    if (start === undefined) {
      start = nowMs;
      this.since.set(eid, start);
    }
    return commanderIdleAnim(nowMs - start);
  }

  forget(eid: number): void {
    this.since.delete(eid);
  }

  clear(): void {
    this.since.clear();
  }
}
