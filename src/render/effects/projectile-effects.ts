/**
 * Ranged-attack projectiles drawn immediate-mode into the effects layer:
 * arrows (archers, towers), bullets (gunmen, machine guns), cannon balls and
 * mortar shells. Each travels from `spawn.at` to `spawn.to` in `durationMs`.
 */

import type { EffectFactory, EffectsLayer } from './effects-layer';

export type ProjectileKind = 'arrow' | 'bullet' | 'cannon' | 'mortar';

export const PROJECTILE_EFFECT: Record<ProjectileKind, string> = {
  arrow: 'projectile-arrow',
  bullet: 'projectile-bullet',
  cannon: 'projectile-cannon',
  mortar: 'projectile-mortar',
};

type ProjectileDraw = (
  g: Phaser.GameObjects.Graphics,
  t: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number
) => void;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const drawBullet: ProjectileDraw = (g, t, sx, sy, ex, ey) => {
  const tailT = Math.max(0, t - 0.22);
  const x = lerp(sx, ex, t);
  const y = lerp(sy, ey, t);
  const tx = lerp(sx, ex, tailT);
  const ty = lerp(sy, ey, tailT);
  g.lineStyle(4, 0x2c2418, 0.45);
  g.lineBetween(tx, ty, x, y);
  g.lineStyle(2, 0xfff0a6, 0.95);
  g.lineBetween(tx, ty, x, y);
};

const drawCannonBall: ProjectileDraw = (g, t, sx, sy, ex, ey) => {
  const arc = -Math.sin(t * Math.PI) * 18;
  const x = lerp(sx, ex, t);
  const y = lerp(sy, ey, t) + arc;
  const pulse = Math.sin(t * Math.PI);
  g.fillStyle(0x0f1114, 0.75);
  g.fillCircle(x + 2, y + 2, 5);
  g.fillStyle(0x34383b, 1);
  g.fillCircle(x, y, 4);
  g.fillStyle(0x9aa0a8, 0.7);
  g.fillCircle(x - 1.5, y - 1.5, 1.5);
  if (t > 0.75) {
    g.lineStyle(2, 0xd6a51f, (t - 0.75) * 2.2);
    g.strokeCircle(ex, ey, 8 + pulse * 5);
  }
};

/** High, slow lob with a smoke trail; bigger impact bloom than a cannon. */
const drawMortarShell: ProjectileDraw = (g, t, sx, sy, ex, ey) => {
  const arc = -Math.sin(t * Math.PI) * 46;
  const x = lerp(sx, ex, t);
  const y = lerp(sy, ey, t) + arc;
  const tailT = Math.max(0, t - 0.12);
  const tailArc = -Math.sin(tailT * Math.PI) * 46;
  const tx = lerp(sx, ex, tailT);
  const ty = lerp(sy, ey, tailT) + tailArc;
  const pulse = Math.sin(t * Math.PI);
  g.lineStyle(3, 0xb7bdc0, 0.35 * (1 - t));
  g.lineBetween(tx, ty, x, y);
  g.fillStyle(0x0f1114, 0.7);
  g.fillCircle(x + 2, y + 2, 4.5);
  g.fillStyle(0x2a2f32, 1);
  g.fillCircle(x, y, 3.5);
  g.fillStyle(0xb89a4a, 0.85);
  g.fillCircle(x - 1, y - 1.5, 1.3);
  if (t > 0.7) {
    g.lineStyle(2, 0xd6a51f, (t - 0.7) * 2.4);
    g.strokeCircle(ex, ey, 10 + pulse * 8);
  }
};

const drawArrow: ProjectileDraw = (g, t, sx, sy, ex, ey) => {
  const tailT = Math.max(0, t - 0.1);
  const arc = -Math.sin(t * Math.PI) * 10;
  const tailArc = -Math.sin(tailT * Math.PI) * 10;
  const x = lerp(sx, ex, t);
  const y = lerp(sy, ey, t) + arc;
  const tx = lerp(sx, ex, tailT);
  const ty = lerp(sy, ey, tailT) + tailArc;

  g.lineStyle(3, 0x2c2418, 0.45);
  g.lineBetween(tx, ty, x, y);
  g.lineStyle(2, 0xf1d58a, 1);
  g.lineBetween(tx, ty, x, y);

  const angle = Math.atan2(y - ty, x - tx);
  const headLen = 4;
  const wing = 2.5;
  const bx = x - Math.cos(angle) * headLen;
  const by = y - Math.sin(angle) * headLen;
  const px = Math.cos(angle + Math.PI / 2) * wing;
  const py = Math.sin(angle + Math.PI / 2) * wing;
  g.fillStyle(0xc0c4d0, 1);
  g.fillTriangle(x, y, bx + px, by + py, bx - px, by - py);
};

const DRAW: Record<ProjectileKind, ProjectileDraw> = {
  arrow: drawArrow,
  bullet: drawBullet,
  cannon: drawCannonBall,
  mortar: drawMortarShell,
};

function projectileEffect(draw: ProjectileDraw): EffectFactory {
  return (ctx, spawn) => {
    const { x: sx, y: sy } = spawn.at;
    const { x: ex, y: ey } = spawn.to ?? spawn.at;
    const durationMs = Math.max(1, spawn.durationMs ?? 300);
    let elapsedMs = 0;
    return {
      update(dtMs) {
        elapsedMs += dtMs;
        const t = Math.min(1, elapsedMs / durationMs);
        if (t >= 1) return false;
        draw(ctx.gfx, t, sx, sy, ex, ey);
        return true;
      },
    };
  };
}

export function registerProjectileEffects(effects: EffectsLayer): void {
  for (const kind of Object.keys(DRAW) as ProjectileKind[]) {
    effects.register(PROJECTILE_EFFECT[kind], projectileEffect(DRAW[kind]));
  }
}
