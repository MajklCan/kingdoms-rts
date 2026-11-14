/**
 * Army rally point marker: a small pennant on a pole at the rally tile and a
 * dashed guide line from the selected army building. Looping, drawn
 * immediate-mode into the effects layer's shared graphics; the rally display
 * stops it when the selection or the rally point changes.
 */

import type { EffectFactory } from './effects-layer';

export const RALLY_FLAG_EFFECT = 'rally-flag';

const COLOR = 0x4ecdc4;
const POLE_HEIGHT = 26;
const DASH = 6;
const GAP = 5;

export const rallyFlagEffect: EffectFactory = (ctx, spawn) => {
  let elapsed = 0;
  return {
    update(dtMs) {
      // Wall-clock-ish sway that still freezes while the game is paused.
      elapsed += dtMs;
      const g = ctx.gfx;
      const { x, y } = spawn.at;
      if (spawn.to) {
        const dx = x - spawn.to.x;
        const dy = y - spawn.to.y;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          g.lineStyle(1.5, COLOR, 0.55);
          const ux = dx / len;
          const uy = dy / len;
          for (let d = 0; d < len; d += DASH + GAP) {
            const end = Math.min(len, d + DASH);
            g.lineBetween(spawn.to.x + ux * d, spawn.to.y + uy * d, spawn.to.x + ux * end, spawn.to.y + uy * end);
          }
        }
      }
      // Ground ring, pole, pennant.
      g.lineStyle(1.5, COLOR, 0.9);
      g.strokeEllipse(x, y, 18, 9);
      g.lineStyle(2, 0x2b1d12, 1);
      g.lineBetween(x, y, x, y - POLE_HEIGHT);
      const sway = Math.sin(elapsed / 220) * 2;
      g.fillStyle(COLOR, 1);
      g.fillTriangle(x + 1, y - POLE_HEIGHT, x + 1, y - POLE_HEIGHT + 10, x + 14 + sway, y - POLE_HEIGHT + 5);
      return true;
    },
  };
};
