/**
 * Ground critters for the ambient life (deer, rabbits, ducks, frogs,
 * chickens, a dog): a tiny state machine per animal on fractional tile
 * coordinates, drawn as a life-sheet image at its feet and painter-sorted
 * with the entities. Never interactive.
 */

import { clamp01, type FxHost } from './fx-host';
import { groundPoint, type LifePool, type LifeRng } from './life-kit';
import type { LifeFrame } from './life-sprites';

export type MobState = 'idle' | 'alt' | 'move' | 'flee' | 'gone';

export interface Mob {
  img: Phaser.GameObjects.Image;
  /** Tile position (fractional). */
  x: number;
  y: number;
  /** Tile velocity, tiles/s. */
  vx: number;
  vy: number;
  state: MobState;
  /** Game time the current state ends. */
  until: number;
  born: number;
  phase: number;
  /** Home tile (leash centre) for village animals. */
  homeX: number;
  homeY: number;
  /** Fade-out start for animals leaving the scene, or Infinity. */
  leaving: number;
  /** Pixels above the ground (dragonflies). */
  lift: number;
}

export function makeMob(img: Phaser.GameObjects.Image, x: number, y: number, now: number, rng: LifeRng): Mob {
  return {
    img,
    x,
    y,
    vx: 0,
    vy: 0,
    state: 'idle',
    until: now + rng.range(800, 2600),
    born: now,
    phase: rng.range(0, 1000),
    homeX: x,
    homeY: y,
    leaving: Infinity,
    lift: 0,
  };
}

/** Head off in a random direction at `speed` tiles/s. */
export function wander(m: Mob, rng: LifeRng, speed: number): void {
  const a = rng.range(0, Math.PI * 2);
  m.vx = Math.cos(a) * speed;
  m.vy = Math.sin(a) * speed;
}

/** Head away from `from` at `speed` tiles/s (a little spread so a herd fans out). */
export function fleeFrom(m: Mob, from: { x: number; y: number }, rng: LifeRng, speed: number): void {
  let dx = m.x - from.x;
  let dy = m.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const a = Math.atan2(dy, dx) + rng.range(-0.45, 0.45);
  m.vx = Math.cos(a) * speed;
  m.vy = Math.sin(a) * speed;
}

/** Head toward the home tile if it strayed further than `leash` tiles. */
export function leashHome(m: Mob, leash: number, speed: number): boolean {
  const dx = m.homeX - m.x;
  const dy = m.homeY - m.y;
  const d = Math.hypot(dx, dy);
  if (d <= leash) return false;
  m.vx = (dx / d) * speed;
  m.vy = (dy / d) * speed;
  return true;
}

/**
 * Integrate the velocity, unless `blocked` says the next tile is off limits
 * (then the animal stops and turns around).
 */
export function stepMob(m: Mob, dtMs: number, blocked: (x: number, y: number) => boolean): void {
  if (m.vx === 0 && m.vy === 0) return;
  const dt = dtMs / 1000;
  const nx = m.x + m.vx * dt;
  const ny = m.y + m.vy * dt;
  if (blocked(nx, ny)) {
    m.vx = -m.vx;
    m.vy = -m.vy;
    return;
  }
  m.x = nx;
  m.y = ny;
}

/** Place the image at the mob's feet; faces its screen-space heading. */
export function drawMob(host: FxHost, pool: LifePool, m: Mob, frame: LifeFrame, now: number): void {
  const p = groundPoint(host, m.x, m.y);
  const sdx = m.vx - m.vy;
  if (Math.abs(sdx) > 0.01) m.img.setFlipX(sdx < 0);
  if (m.img.frame.name !== frame) m.img.setFrame(frame);
  m.img.setPosition(p.x, p.y - m.lift);
  pool.setDepth(m.img, p.y);
  const fadeIn = clamp01((now - m.born) / 500);
  const fadeOut = m.leaving === Infinity ? 1 : clamp01(1 - (now - m.leaving) / 700);
  m.img.setAlpha(fadeIn * fadeOut);
  if (m.leaving !== Infinity && now - m.leaving >= 700) m.state = 'gone';
}

/** Two-frame cycle at `ms` per frame. */
export function cycle<T>(a: T, b: T, now: number, phase: number, ms: number): T {
  return Math.floor((now + phase) / ms) % 2 === 0 ? a : b;
}
