/**
 * UI entry: builds every DOM layer (menu, loading, HUD, modals, game over,
 * tooltip, dev panel) into #ui-root, wires keyboard and match lifecycle,
 * and reveals the title screen once the Phaser scene is ready. Called once
 * from main.ts after the Phaser.Game exists.
 */

import type Phaser from 'phaser';
import { bindLayerKeys, syncSceneKeyboard } from './a11y/layers';
import { bindNativeFeel } from './a11y/native-feel';
import { setPhase } from './app-state';
import { bindDevPanel, buildDevPanel } from './dev/dev-panel';
import { byId, wait } from './dom';
import { attachGame, getScene, isSceneReady } from './game-bridge';
import { startHudLoop } from './hud-loop';
import { hideAgeBanner } from './hud/age-banner';
import { bindAlerts, resetAlerts } from './hud/alerts';
import { resetCommandGrid } from './hud/command-grid';
import { bindControlGroups, resetControlGroups } from './hud/control-groups';
import { bindEventLog, resetEventLog } from './hud/event-log';
import { bindHudKeys, buildHud } from './hud/hud-root';
import { bindIdleVillagers, resetIdleVillagers } from './hud/idle-villagers';
import { resetMinimap } from './hud/minimap';
import { resetSelectionPanel } from './hud/selection-panel';
import { bindTooltipDismiss, getTooltipRoot, hideTip } from './hud/tooltip';
import { resetTopBar } from './hud/top-bar';
import { onMatchEnd, onMatchStart } from './match/match-flow';
import { bindMultiplayerClientDiagnostics, installMultiplayerDebugApi, startMultiplayerPump } from './multiplayer/pump';
import { dismissAllModals, getModalRoot } from './panels/modal';
import { bindObjectivesKey, resetObjectives } from './panels/objectives';
import { bindPauseMenuKeys } from './panels/pause-menu';
import { applyStoredUiScale } from './panels/settings';
import { bindTechTreeKey } from './panels/tech-tree';
import { bindCampaignSelect } from './screens/campaign-select';
import { getConnectionLostRoot, resetConnectionLost } from './screens/connection-lost';
import { getGameOverRoot, resetGameOver } from './screens/game-over';
import { getLoadingRoot } from './screens/loading';
import { bindMainMenu } from './screens/main-menu';
import { bindMenuShell, enterMenu, getMenuRoot } from './screens/menu-shell';
import { bindMultiplayerLobby } from './screens/multiplayer-lobby';
import { bindSkirmishSetup } from './screens/skirmish-setup';
import { bindCursor } from './skin/cursors';
import { bindPixelScale } from './skin/pixel-scale';
import { bindUiSounds } from './ui-sounds';

function resetMatchUi(): void {
  dismissAllModals();
  hideTip();
  resetAlerts();
  resetControlGroups();
  resetEventLog();
  resetIdleVillagers();
  resetSelectionPanel();
  resetCommandGrid();
  resetMinimap();
  resetGameOver();
  resetConnectionLost();
  resetObjectives();
  resetTopBar();
  hideAgeBanner();
}

async function revealWhenReady(): Promise<void> {
  // The scene decodes audio and bakes textures before create() runs.
  for (let i = 0; i < 1200 && !isSceneReady(getScene()); i++) await wait(25);
  setPhase('menu');
  syncSceneKeyboard();
  enterMenu('root');
  const splash = byId('boot-splash');
  if (splash) {
    splash.classList.add('is-done');
    window.setTimeout(() => splash.remove(), 600);
  }
}

export function mountUi(game: Phaser.Game): void {
  attachGame(game);
  bindNativeFeel();
  applyStoredUiScale();
  bindPixelScale();
  setPhase('boot');

  const root = byId('ui-root');
  if (!root) throw new Error('#ui-root missing from index.html');

  // Screens register into the menu shell in display order.
  bindMainMenu();
  bindSkirmishSetup();
  bindCampaignSelect();
  bindMultiplayerLobby();

  const dev = buildDevPanel();
  root.append(buildHud(), getMenuRoot(), getModalRoot(), getGameOverRoot(), getConnectionLostRoot(), getLoadingRoot(), getTooltipRoot());
  if (dev) root.append(dev);

  bindLayerKeys();
  bindMenuShell();
  bindHudKeys();
  bindPauseMenuKeys();
  bindTechTreeKey();
  bindObjectivesKey();
  bindControlGroups();
  bindIdleVillagers();
  bindAlerts();
  bindEventLog();
  bindTooltipDismiss();
  bindDevPanel();
  bindUiSounds();
  bindCursor();

  installMultiplayerDebugApi();
  bindMultiplayerClientDiagnostics();
  startMultiplayerPump();

  onMatchStart(() => resetMatchUi());
  onMatchEnd(() => resetMatchUi());

  startHudLoop();
  void revealWhenReady();
}
