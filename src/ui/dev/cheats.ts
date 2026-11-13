/** Cheat / debug buttons (Reveal, +500, spawns, state dump). Disabled in multiplayer. */

import { setLastEvent } from '../../debug/overlay';
import type { MultiplayerSessionDebugSnapshot } from '../../net/session';
import { appState } from '../app-state';
import { byId, downloadTextFile } from '../dom';
import { getScene } from '../game-bridge';

export function shouldDisableCheatButtons(): boolean {
  const scene = getScene();
  const sessionState = appState.mpSession?.state;
  return (
    appState.titleMode === 'multiplayer' ||
    scene?.isMultiplayer() === true ||
    sessionState === 'connecting' ||
    sessionState === 'lobby' ||
    sessionState === 'playing'
  );
}

export function updateCheatButtonsDisabled(): void {
  const disabled = shouldDisableCheatButtons();
  for (const button of document.querySelectorAll<HTMLButtonElement>('#save-load-panel .cheat-button')) {
    button.disabled = disabled;
    button.title = disabled ? 'Cheats are disabled in multiplayer' : '';
  }
}

function runCheatAction(action: () => void): void {
  if (shouldDisableCheatButtons()) {
    updateCheatButtonsDisabled();
    setLastEvent('cheats disabled in multiplayer');
    return;
  }
  action();
}

export function bindCheatControls(): void {
  const revealBtn = byId<HTMLButtonElement>('cheat-reveal-map');
  const resourcesBtn = byId<HTMLButtonElement>('cheat-add-resources');
  const cavalryBtn = byId<HTMLButtonElement>('cheat-spawn-cavalry');
  const machineGunBtn = byId<HTMLButtonElement>('cheat-spawn-machine-gun');
  const mortarBtn = byId<HTMLButtonElement>('cheat-spawn-mortar');
  const dumpBtn = byId<HTMLButtonElement>('cheat-dump-state');
  if (!revealBtn || !resourcesBtn || !cavalryBtn || !machineGunBtn || !mortarBtn || !dumpBtn) return;

  revealBtn.addEventListener('click', () => runCheatAction(() => getScene()?.cheatRevealMap(1)));
  resourcesBtn.addEventListener('click', () => runCheatAction(() => getScene()?.cheatAddResources(1, 500)));
  cavalryBtn.addEventListener('click', () => runCheatAction(() => getScene()?.cheatSpawnCavalryByTownHall(1)));
  machineGunBtn.addEventListener('click', () => runCheatAction(() => getScene()?.cheatSpawnMachineGunByTownHall(1)));
  mortarBtn.addEventListener('click', () => runCheatAction(() => getScene()?.cheatSpawnMortarByTownHall(1)));
  dumpBtn.addEventListener('click', () => {
    if (shouldDisableCheatButtons()) {
      updateCheatButtonsDisabled();
      setLastEvent('cheats disabled in multiplayer');
      return;
    }
    const scene = getScene();
    if (!scene) return;
    const snapshot = scene.createSaveSnapshot('Debug Dump');
    const debugApi = window as unknown as {
      __GAME__?: { debugDump?: () => Record<string, unknown> };
      __MP__?: { snapshot?: () => MultiplayerSessionDebugSnapshot | null };
    };
    const payload = {
      debug: debugApi.__GAME__?.debugDump?.() ?? null,
      mp: debugApi.__MP__?.snapshot?.() ?? null,
      save: snapshot,
    };
    downloadTextFile(
      `kingdoms-state-${snapshot.tick}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
    setLastEvent(`debug dump downloaded (${snapshot.tick})`);
  });
  updateCheatButtonsDisabled();
}
