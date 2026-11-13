/**
 * Click marker for orders: a ground diamond that snaps in and fades out where
 * a move, attack, attack-move or rally order lands. Drawn immediate-mode into
 * the effects layer's shared graphics, so it costs no game objects.
 */

import type { EffectFactory } from './effects-layer';

export const ORDER_MARKER_EFFECT = 'order-marker';

export type OrderMarkerKind = 'move' | 'attack' | 'attack-move' | 'rally';

const COLORS: Record<OrderMarkerKind, number> = {
  move: 0x9be36b,
  attack: 0xff4d3d,
  'attack-move': 0xffa13d,
  rally: 0x4ecdc4,
};

const DURATION_MS = 650;
/** Half extents of the diamond at full size (iso 2:1). */
const HALF_W = 18;
const HALF_H = 9;

function isMarkerKind(value: unknown): value is OrderMarkerKind {
  return value === 'move' || value === 'attack' || value === 'attack-move' || value === 'rally';
}

export const orderMarkerEffect: EffectFactory = (ctx, spawn) => {
  const kind = isMarkerKind(spawn.params.kind) ? spawn.params.kind : 'move';
  const color = COLORS[kind];
  const duration = spawn.durationMs ?? DURATION_MS;
  let elapsed = 0;
  return {
    update(dtMs) {
      elapsed += dtMs;
      const t = Math.min(1, elapsed / duration);
      // Snap in from 1.5x, settle at 1x, then fade.
      const scale = 1 + 0.5 * Math.pow(1 - t, 3);
      const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const { x, y } = spawn.at;
      const w = HALF_W * scale;
      const h = HALF_H * scale;
      const g = ctx.gfx;
      g.lineStyle(2, color, alpha);
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x + w, y);
      g.lineTo(x, y + h);
      g.lineTo(x - w, y);
      g.closePath();
      g.strokePath();
      g.fillStyle(color, alpha * 0.18);
      g.fillPath();
      if (kind === 'attack' || kind === 'attack-move') {
        // Crossed swords read as "fight here" at a glance.
        g.lineBetween(x - w * 0.45, y - h * 0.45, x + w * 0.45, y + h * 0.45);
        g.lineBetween(x + w * 0.45, y - h * 0.45, x - w * 0.45, y + h * 0.45);
      } else {
        g.fillStyle(color, alpha);
        g.fillCircle(x, y, 2);
      }
      return elapsed < duration;
    },
  };
};
