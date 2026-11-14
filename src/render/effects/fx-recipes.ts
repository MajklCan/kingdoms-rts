/**
 * Particle recipes: the look of every world VFX in one place. Each recipe
 * takes layer-local screen px (`ctx.tileToScreen` space) and spawns a handful
 * of pooled particles; none of them keep state, so callers decide timing.
 */

import { rand, type FxParticles } from './fx-particles';

export const FX_COLORS = {
  dust: 0xc2a77c,
  dustDark: 0x8f7a5a,
  snowDust: 0xf2f5f8,
  smokeLight: 0xe4e1db,
  smokeGrey: 0x8d8984,
  smokeDark: 0x3d3935,
  gunSmoke: 0xeeece6,
  spark: 0xffd479,
  fire: 0xff8a2b,
  fireCore: 0xffc95a,
  ember: 0xff9a3c,
  wood: 0xc8995f,
  bark: 0x6e4b2a,
  stone: 0xaeb2b8,
  gold: 0xf3cb4f,
  goldGlint: 0xfff2b0,
  debris: 0x6f5c47,
  debrisStone: 0x8d877e,
  scorch: 0x1c1712,
  leaf: 0x6f9a3a,
  grain: 0xe2c46a,
} as const;

/** A few soft dust puffs kicked up at the feet (deaths, footfalls, impacts). */
export function dustPuff(fx: FxParticles, x: number, y: number, size = 1, tint: number = FX_COLORS.dust, count = 5): void {
  for (let i = 0; i < count; i++) {
    fx.emit('normal', {
      frame: 'puff',
      x: x + rand(-7, 7) * size,
      y: y + rand(-2, 2) * size,
      vx: rand(-22, 22) * size,
      vy: rand(-16, -4) * size,
      drag: 2.4,
      life: rand(520, 860) * Math.sqrt(size),
      scale: 0.3 * size,
      scaleEnd: 0.75 * size,
      alpha: 0.5,
      fadeIn: 0.12,
      fadeOut: 0.6,
      tint,
      rotation: rand(0, Math.PI * 2),
    });
  }
}

/** Bright sparks flying out of a hit (sword on armour, pick on gold). */
export function sparks(fx: FxParticles, x: number, y: number, count = 5, tint: number = FX_COLORS.spark, speed = 95): void {
  for (let i = 0; i < count; i++) {
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const v = rand(0.5, 1) * speed;
    fx.emit('add', {
      frame: 'streak',
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      ay: 260,
      life: rand(160, 300),
      scale: rand(0.4, 0.6),
      scaleEnd: 0.15,
      alpha: 1,
      fadeOut: 0.5,
      tint,
      align: true,
    });
  }
  fx.emit('add', { frame: 'glow', x, y, life: 90, scale: 0.28, scaleEnd: 0.4, alpha: 0.75, tint, fadeOut: 0.8 });
}

/** Chips of wood / stone / gold with gravity, landing near where they flew from. */
export function chips(fx: FxParticles, x: number, y: number, tint: number, count = 4, tint2 = tint): void {
  for (let i = 0; i < count; i++) {
    fx.emit('normal', {
      frame: 'chip',
      x: x + rand(-3, 3),
      y: y + rand(-3, 1),
      vx: rand(-55, 55),
      vy: rand(-120, -50),
      ay: 420,
      floorY: y + rand(4, 10),
      life: rand(650, 950),
      scale: rand(0.45, 0.85),
      alpha: 1,
      fadeOut: 0.3,
      tint: i % 2 === 0 ? tint : tint2,
      rotation: rand(0, Math.PI),
      spin: rand(-10, 10),
    });
  }
}

/** Musket muzzle: a short flash and a puff of white smoke drifting forward. */
export function muzzleSmoke(fx: FxParticles, x: number, y: number, dx: number, dy: number, big = false): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = big ? 1.9 : 1;
  fx.emit('add', {
    frame: 'glow',
    x: x + ux * 4 * size,
    y: y + uy * 4 * size,
    life: big ? 120 : 70,
    scale: 0.42 * size,
    scaleEnd: 0.6 * size,
    alpha: 0.95,
    tint: 0xffe0a0,
    fadeOut: 0.7,
  });
  const puffs = big ? 7 : 3;
  for (let i = 0; i < puffs; i++) {
    const v = rand(12, 34) * size;
    fx.emit('normal', {
      frame: 'puff',
      x: x + ux * rand(2, 8) * size,
      y: y + uy * rand(2, 8) * size,
      vx: ux * v + rand(-6, 6),
      vy: uy * v * 0.6 - rand(6, 14),
      drag: 1.2,
      life: rand(900, 1400) * (big ? 1.5 : 1),
      scale: 0.26 * size,
      scaleEnd: 0.85 * size,
      alpha: big ? 0.5 : 0.42,
      fadeIn: 0.08,
      fadeOut: 0.7,
      tint: FX_COLORS.gunSmoke,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-0.6, 0.6),
    });
  }
}

/** Arrow lands: a tiny dust kick and a splinter or two. */
export function arrowThunk(fx: FxParticles, x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    fx.emit('normal', {
      frame: 'dot',
      x: x + rand(-2, 2),
      y: y + rand(-1, 1),
      vx: rand(-26, 26),
      vy: rand(-36, -12),
      ay: 120,
      life: rand(260, 420),
      scale: rand(0.5, 0.8),
      scaleEnd: 0.2,
      alpha: 0.75,
      tint: FX_COLORS.dust,
    });
  }
  chips(fx, x, y, FX_COLORS.wood, 2);
}

/** Melee contact: a few sparks and a tiny flash. */
export function swordClash(fx: FxParticles, x: number, y: number): void {
  sparks(fx, x, y, 4, 0xfff0c0, 80);
}

/** A musket ball hits: dust kicked up, a pale spark. */
export function bulletHit(fx: FxParticles, x: number, y: number): void {
  for (let i = 0; i < 4; i++) {
    fx.emit('normal', {
      frame: 'dot',
      x: x + rand(-2, 2),
      y: y + rand(-1, 1),
      vx: rand(-30, 30),
      vy: rand(-55, -20),
      ay: 160,
      life: rand(300, 480),
      scale: rand(0.6, 1),
      scaleEnd: 0.3,
      alpha: 0.7,
      tint: FX_COLORS.dust,
    });
  }
  fx.emit('add', { frame: 'spark', x, y, life: 80, scale: 0.8, scaleEnd: 0.3, alpha: 0.8, tint: 0xfff3d0 });
}

/** Cannon ball / mortar shell burst: flash, fireball, debris, smoke, scorch. */
export function explosion(fx: FxParticles, x: number, y: number, big = false): void {
  const k = big ? 1.35 : 1;
  fx.emit('add', { frame: 'glow', x, y: y - 6 * k, life: 170, scale: 1.4 * k, scaleEnd: 1.9 * k, alpha: 0.9, tint: 0xffd08a, fadeOut: 0.8 });
  for (let i = 0; i < 7; i++) {
    fx.emit('add', {
      frame: 'puff',
      x: x + rand(-8, 8) * k,
      y: y - rand(2, 12) * k,
      vx: rand(-30, 30) * k,
      vy: rand(-55, -20) * k,
      drag: 3,
      life: rand(320, 520),
      scale: 0.45 * k,
      scaleEnd: 1.05 * k,
      alpha: 0.95,
      tint: i % 2 === 0 ? FX_COLORS.fire : FX_COLORS.fireCore,
      rotation: rand(0, Math.PI * 2),
      fadeOut: 0.6,
    });
  }
  const shards = fx.headroom('normal') > 200 ? 10 : 5;
  for (let i = 0; i < shards; i++) {
    fx.emit('normal', {
      frame: i % 3 === 0 ? 'chip' : 'shard',
      x: x + rand(-4, 4),
      y: y - rand(0, 6),
      vx: rand(-120, 120) * k,
      vy: rand(-230, -90) * k,
      ay: 520,
      floorY: y + rand(-4, 10),
      life: rand(900, 1300),
      scale: rand(0.6, 1.1),
      alpha: 1,
      fadeOut: 0.25,
      tint: i % 2 === 0 ? FX_COLORS.debris : FX_COLORS.dustDark,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-14, 14),
    });
  }
  for (let i = 0; i < 7; i++) {
    fx.emit('normal', {
      frame: 'puff',
      x: x + rand(-12, 12) * k,
      y: y - rand(4, 16) * k,
      vx: rand(-14, 14) + 6,
      vy: rand(-26, -10),
      drag: 0.6,
      life: rand(1700, 2700) * k,
      scale: 0.55 * k,
      scaleEnd: 1.6 * k,
      alpha: 0.55,
      fadeIn: 0.12,
      fadeOut: 0.6,
      tint: i < 3 ? FX_COLORS.smokeDark : FX_COLORS.smokeGrey,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-0.5, 0.5),
      delay: rand(40, 160),
    });
  }
  fx.emit('ground', { frame: 'ring', x, y, life: 360, scale: 0.35 * k, scaleEnd: 1.5 * k, alpha: 0.6, tint: 0xf0e2c0, fadeOut: 0.9 });
  scorch(fx, x, y, 0.75 * k);
  dustRing(fx, x, y, 14 * k, 7 * k, 8, FX_COLORS.dust, 1 * k);
}

/** Dark blotch on the ground that fades out over ~20 s. */
export function scorch(fx: FxParticles, x: number, y: number, size = 1): void {
  fx.emit('ground', {
    frame: 'scorch',
    x,
    y,
    life: 20000,
    scale: 0.7 * size,
    alpha: 0.5,
    fadeIn: 0.005,
    fadeOut: 0.35,
    tint: FX_COLORS.scorch,
  });
}

/** Puffs racing outward along an iso ellipse on the ground (placement thud, impacts). */
export function dustRing(
  fx: FxParticles,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count = 12,
  tint: number = FX_COLORS.dust,
  size = 1
): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(-0.15, 0.15);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    fx.emit('ground', {
      frame: 'puff',
      x: cx + ca * rx,
      y: cy + sa * ry,
      vx: ca * rand(26, 44) * size,
      vy: sa * rand(13, 22) * size - 4,
      drag: 3.2,
      life: rand(560, 860),
      scale: 0.35 * size,
      scaleEnd: 0.8 * size,
      squash: 0.8,
      alpha: 0.6,
      fadeIn: 0.08,
      tint,
      rotation: rand(0, Math.PI * 2),
    });
  }
}

/**
 * Building collapse: a billowing dust cloud over the footprint (diamond of
 * half-size hw x hh px around the centre), rising to `topPx`, and debris.
 */
export function collapse(fx: FxParticles, cx: number, cy: number, hw: number, hh: number, topPx: number): void {
  const room = fx.headroom('normal');
  const clouds = room > 300 ? 22 : 10;
  for (let i = 0; i < clouds; i++) {
    const u = rand(-1, 1);
    const v = rand(-1, 1);
    const px = cx + (u - v) * hw * 0.5;
    const py = cy + (u + v) * hh * 0.5;
    const lift = rand(0, Math.min(60, topPx * 0.6));
    fx.emit('normal', {
      frame: 'puff',
      x: px,
      y: py - lift,
      vx: rand(-20, 20) + (u - v) * 10,
      vy: rand(-26, -6),
      drag: 0.9,
      life: rand(1500, 2600),
      scale: rand(0.6, 0.9),
      scaleEnd: rand(1.6, 2.2),
      alpha: 0.7,
      fadeIn: 0.1,
      fadeOut: 0.55,
      tint: i % 3 === 0 ? FX_COLORS.dustDark : FX_COLORS.dust,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-0.4, 0.4),
      delay: rand(0, 380),
    });
  }
  const shards = room > 300 ? 16 : 6;
  for (let i = 0; i < shards; i++) {
    fx.emit('normal', {
      frame: i % 2 === 0 ? 'shard' : 'chip',
      x: cx + rand(-hw, hw) * 0.5,
      y: cy - rand(10, Math.max(12, topPx * 0.7)),
      vx: rand(-90, 90),
      vy: rand(-160, -40),
      ay: 480,
      floorY: cy + rand(-hh * 0.5, hh * 0.6),
      life: rand(1100, 1600),
      scale: rand(0.8, 1.4),
      alpha: 1,
      fadeOut: 0.25,
      tint: i % 3 === 0 ? FX_COLORS.debrisStone : FX_COLORS.debris,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-12, 12),
      delay: rand(0, 220),
    });
  }
  dustRing(fx, cx, cy, hw * 0.9, hh * 0.9, 16, FX_COLORS.dust, 1.4);
}

/** One flame lick (call repeatedly); embers now and then at intensity 3. */
export function flame(fx: FxParticles, x: number, y: number, intensity: number): void {
  const k = 0.7 + intensity * 0.18;
  fx.emit('add', {
    frame: 'flame',
    x: x + rand(-3, 3) * k,
    y: y + rand(-1, 2),
    vx: rand(-6, 8),
    vy: rand(-40, -26) * k,
    life: rand(380, 640),
    scale: rand(0.45, 0.62) * k,
    scaleEnd: 0.12,
    alpha: 0.9,
    fadeIn: 0.12,
    fadeOut: 0.5,
    tint: Math.random() < 0.5 ? FX_COLORS.fire : FX_COLORS.fireCore,
  });
  if (intensity >= 3 && Math.random() < 0.35) {
    fx.emit('add', {
      frame: 'spark',
      x: x + rand(-6, 6),
      y,
      vx: rand(-12, 22),
      vy: rand(-70, -40),
      drag: 0.8,
      life: rand(700, 1200),
      scale: rand(0.35, 0.55),
      scaleEnd: 0.1,
      alpha: 1,
      tint: FX_COLORS.ember,
    });
  }
}

/** One smoke puff of a rising plume (chimneys, fires). */
export function smoke(fx: FxParticles, x: number, y: number, tint: number, size = 1, alpha = 0.4, wind = 9): void {
  fx.emit('normal', {
    frame: 'puff',
    x: x + rand(-1.5, 1.5),
    y,
    vx: wind + rand(-3, 5),
    vy: rand(-24, -16) * Math.sqrt(size),
    drag: 0.15,
    life: rand(2300, 3300) * Math.sqrt(size),
    scale: 0.22 * size,
    scaleEnd: 0.95 * size,
    alpha,
    fadeIn: 0.12,
    fadeOut: 0.65,
    tint,
    rotation: rand(0, Math.PI * 2),
    spin: rand(-0.5, 0.5),
  });
}

/** A short twinkle (gold glints, water glints). */
export function glint(fx: FxParticles, x: number, y: number, tint: number, size = 1, pool: 'add' | 'normal' = 'add'): void {
  fx.emit(pool, {
    frame: 'star',
    x,
    y,
    life: rand(420, 640),
    scale: 0.2 * size,
    scaleEnd: 0.75 * size,
    alpha: 0.95,
    fadeIn: 0.4,
    fadeOut: 0.6,
    tint,
    rotation: rand(0, 0.6),
    spin: rand(0.8, 1.6),
  });
}
