/** Bottom-left selection portrait: glyph, count badge, name, HP bar, stats. */

import type { GameScene } from '../../render/game-scene';
import { byId } from '../dom';

export function updateSelectionPanel(scene: GameScene): void {
  const panel = byId('selection-panel');
  const glyph = byId('sel-glyph');
  const countBadge = byId('sel-count');
  const nameEl = byId('sel-name');
  const hpFill = byId('sel-hp-fill');
  const statsEl = byId('sel-stats');
  if (!panel || !glyph || !countBadge || !nameEl || !hpFill || !statsEl) return;
  const info = scene.getSelectionInfo();
  if (info.kind === 'none') {
    panel.classList.add('empty');
    return;
  }
  panel.classList.remove('empty');
  glyph.textContent = info.glyph;
  if (info.count > 1) {
    countBadge.classList.add('show');
    countBadge.textContent = '×' + info.count;
  } else {
    countBadge.classList.remove('show');
  }
  nameEl.textContent = info.name;
  // HP bar.
  if (info.hpMax > 0) {
    const frac = Math.max(0, Math.min(1, info.hp / info.hpMax));
    hpFill.style.width = (frac * 100).toFixed(0) + '%';
    hpFill.style.background = frac > 0.6 ? '#4caf50' : frac > 0.3 ? '#ffc107' : '#ff4757';
    statsEl.textContent = `HP ${info.hp}/${info.hpMax}  ${info.stats}`;
  } else {
    hpFill.style.width = '0%';
    statsEl.textContent = info.stats || '-';
  }
}
