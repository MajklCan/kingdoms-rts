/**
 * rAF pump that refreshes the HUD from the active GameScene. Runs every
 * frame but only does work during a match; each module throttles itself and
 * skips DOM writes when nothing changed.
 */

import { appState } from './app-state';
import { updateDevPanel } from './dev/dev-panel';
import { getScene, isSceneReady } from './game-bridge';
import { updateAlerts } from './hud/alerts';
import { tickCommandTips, updateCommandGrid } from './hud/command-grid';
import { updateControlGroups } from './hud/control-groups';
import { updateEventLog } from './hud/event-log';
import { updatePausedBanner } from './hud/hud-root';
import { updateIdleVillagers } from './hud/idle-villagers';
import { renderMinimap } from './hud/minimap';
import { updateSelectionPanel } from './hud/selection-panel';
import { updateTopBar } from './hud/top-bar';
import { updateTracker } from './match/tracker';
import { updateObjectives } from './panels/objectives';
import { renderTechTree } from './panels/tech-tree';
import { updateGameOver } from './screens/game-over';

function tick(now: number): void {
  requestAnimationFrame(tick);
  const scene = getScene();
  if (!isSceneReady(scene)) return;
  updateDevPanel(scene);
  if (appState.phase !== 'match') return;
  updateTracker(scene, now);
  updateTopBar(scene);
  updatePausedBanner(scene.isPaused());
  renderMinimap(scene, now);
  updateSelectionPanel(scene);
  updateCommandGrid(scene);
  tickCommandTips(now);
  updateControlGroups(scene);
  updateIdleVillagers(scene, now);
  updateEventLog(scene, now);
  updateAlerts(scene, now);
  renderTechTree(scene);
  updateObjectives(scene);
  updateGameOver(scene);
}

export function startHudLoop(): void {
  requestAnimationFrame(tick);
}
