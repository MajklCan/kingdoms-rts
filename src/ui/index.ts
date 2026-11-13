/**
 * UI entry: wires every DOM screen and panel to the Phaser game. Called once
 * from main.ts after the Phaser.Game exists.
 */

import type Phaser from 'phaser';
import { bindBuildInfo } from './build-info';
import { bindCheatControls } from './dev/cheats';
import { bindDebugOverlayToggle } from './dev/debug-overlay';
import { attachGame } from './game-bridge';
import { startHudLoop } from './hud-loop';
import { bindMinimapClick } from './hud/minimap';
import { bindPauseToggle, bindSpeedToggle, installStaticResourceIcons } from './hud/resource-bar';
import {
  bindMultiplayerClientDiagnostics,
  installMultiplayerDebugApi,
  startMultiplayerPump,
} from './multiplayer/pump';
import { bindAudioSettings } from './panels/audio-settings';
import { bindMissionControls } from './panels/mission-panel';
import { bindSaveLoadControls } from './panels/save-load';
import { bindTechTreeControls } from './panels/tech-tree';
import { bindCampaignSelect } from './screens/campaign-select';
import { bindGameOver } from './screens/game-over';
import { bindMainMenu } from './screens/main-menu';
import { bindMultiplayerLobby } from './screens/multiplayer-lobby';
import { bindSkirmishSetup } from './screens/skirmish-setup';
import { bindUiSounds } from './ui-sounds';

export function mountUi(game: Phaser.Game): void {
  attachGame(game);
  bindBuildInfo();
  bindMainMenu();
  bindSkirmishSetup();
  bindCampaignSelect();
  installMultiplayerDebugApi();
  bindMultiplayerLobby();
  bindMultiplayerClientDiagnostics();
  startMultiplayerPump();
  bindSpeedToggle();
  bindPauseToggle();
  installStaticResourceIcons();
  bindTechTreeControls();
  bindMissionControls();
  bindSaveLoadControls();
  bindAudioSettings();
  bindUiSounds();
  bindCheatControls();
  bindGameOver();
  bindDebugOverlayToggle();
  bindMinimapClick();
  startHudLoop();
}
