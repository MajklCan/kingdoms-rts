/** Debug overlay: backtick toggle + per-frame stats feed. */

import { updateDebugOverlay } from '../../debug/overlay';
import type { GameScene } from '../../render/game-scene';
import { byId, isTextEntryTarget } from '../dom';

export function bindDebugOverlayToggle(): void {
  window.addEventListener('keydown', (ev) => {
    if (isTextEntryTarget(ev.target)) return;
    if (ev.key === '`' || ev.key === '~') {
      byId('debug-overlay')?.classList.toggle('hidden');
    }
  });
}

export function updateDebugOverlayFromScene(
  scene: GameScene,
  status: ReturnType<GameScene['getStatusInfo']>
): void {
  updateDebugOverlay({
    fps: scene.fps ?? 0,
    tick: scene.getTick(),
    entities: scene.getEntityCount(),
    selected: scene.getSelectedSummary(),
    gather: status.text,
    build: scene.getBuildMode(),
    zoom: scene.zoom,
    speed: scene.getGameSpeed(),
  });
}
