/** Bottom-centre event ticker: current status line (+ progress) and build mode. */

import type { GameScene } from '../../render/game-scene';
import { byId } from '../dom';

export function updateEventTicker(scene: GameScene, status: ReturnType<GameScene['getStatusInfo']>): void {
  // Tick label on minimap.
  const mmTick = byId('mm-tick');
  if (mmTick) mmTick.textContent = 'tick ' + scene.getTick();
  // Ticker (last event + build mode).
  const evt = byId('ticker-event');
  const bldLine = byId('ticker-build');
  if (evt) {
    evt.textContent = '';
    const label = document.createElement('span');
    label.className = 'status-label';
    label.textContent = status.text || 'Idle';
    evt.appendChild(label);
    if (status.progressFrac !== null) {
      const progress = document.createElement('span');
      progress.className = 'status-progress';
      const fill = document.createElement('span');
      fill.style.width = `${Math.floor(status.progressFrac * 100)}%`;
      progress.appendChild(fill);
      evt.appendChild(progress);
    }
  }
  if (bldLine) bldLine.textContent = 'Build mode: ' + scene.getBuildMode();
}
