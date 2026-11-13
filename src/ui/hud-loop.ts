/** rAF pump that refreshes every DOM HUD element from the active GameScene. */

import { updateDebugOverlayFromScene } from './dev/debug-overlay';
import { getScene } from './game-bridge';
import { updateActionGrid } from './hud/action-grid';
import { updateEventTicker } from './hud/event-ticker';
import { renderMinimap } from './hud/minimap';
import { updateResourceBarFromScene } from './hud/resource-bar';
import { updateSelectionPanel } from './hud/selection-panel';
import { renderMissionCard } from './panels/mission-panel';
import { renderTechTree } from './panels/tech-tree';
import { updateGameOver } from './screens/game-over';

function tickOverlay(): void {
  const scene = getScene();
  if (scene && scene.scene.isActive()) {
    const me = scene.getPerspectivePlayerId();
    updateResourceBarFromScene(scene);
    const status = scene.getStatusInfo();
    updateDebugOverlayFromScene(scene, status);
    renderMinimap(scene);
    updateSelectionPanel(scene);
    updateActionGrid(scene);
    renderTechTree(scene);
    renderMissionCard(scene);
    updateEventTicker(scene, status);
    updateGameOver(scene, me);
  }
  requestAnimationFrame(tickOverlay);
}

export function startHudLoop(): void {
  requestAnimationFrame(tickOverlay);
}
