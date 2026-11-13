/**
 * Keyboard shortcuts. B arms building selection, then a letter picks the
 * building; outside that the same letters are commands (H = hold position).
 * Shortcuts are ignored while a DOM text field has focus.
 */

import { UnitStanceId } from '@sim/components';
import { setLastEvent } from '../../debug/overlay';
import { ZOOM_KEY_STEP, type CameraController } from '../camera/camera-controller';
import type { PlayerCommands } from '../commands/player-commands';
import type { BuildMode, BuildPlacement } from '../placement/build-placement';
import type { PointerController } from './pointer-controller';
import { isTextEntryTarget } from './text-entry';

export interface HotkeyDeps {
  placement: BuildPlacement;
  commands: PlayerCommands;
  camera: CameraController;
  pointer: PointerController;
  toggleGameSpeed(): void;
}

/** B + key: [key, mode, prompt]. */
const BUILD_KEYS: Array<[string, Exclude<BuildMode, 'none'>, string]> = [
  ['M', 'FARM', 'build FARM - left-click to place'],
  ['I', 'MILL', 'build MILL - left-click to place'],
  ['L', 'LUMBER_CAMP', 'build LUMBER HUT - left-click near trees'],
  ['G', 'GOLD_MINE', 'build GOLD MINE - left-click near gold'],
  ['C', 'STONE_QUARRY', 'build STONE QUARRY - left-click near stone'],
  ['R', 'BARRACKS', 'build BARRACKS - left-click to place'],
  ['A', 'ARCHERY_RANGE', 'build ARCHERY RANGE - left-click to place'],
  ['T', 'STABLE', 'build STABLE - left-click to place'],
  ['F', 'FOUNDRY', 'build FOUNDRY - left-click to place'],
  ['Y', 'DEFENSIVE_TOWER', 'build DEFENSIVE TOWER - left-click to place'],
];

export function installHotkeys(scene: Phaser.Scene, deps: HotkeyDeps): void {
  const { placement, commands, camera, pointer } = deps;
  const onHotkey = (eventName: string, handler: (ev: KeyboardEvent) => void): void => {
    scene.input.keyboard?.on(eventName, (ev: KeyboardEvent) => {
      if (isTextEntryTarget(ev.target)) return;
      handler(ev);
    });
  };

  onHotkey('keydown-B', () => {
    placement.awaitBuildKind();
    setLastEvent('build: M farm · I mill · L wood · C stone · other buildings unlock through research');
  });
  onHotkey('keydown-H', () => {
    if (placement.awaitingBuildKind) {
      placement.startBuildMode('HOUSE', 'build HOUSE - left-click to place, right-click to cancel');
    } else {
      commands.setStance(UnitStanceId.HOLD_POSITION);
    }
  });
  for (const [key, mode, message] of BUILD_KEYS) {
    onHotkey(`keydown-${key}`, () => {
      if (placement.awaitingBuildKind) placement.startBuildMode(mode, message);
    });
  }
  onHotkey('keydown-ESC', () => {
    if (placement.isActive) {
      placement.reset();
      setLastEvent('placement cancelled');
    }
  });
  onHotkey('keydown-Q', () => commands.trainHotkey(0));
  onHotkey('keydown-E', () => commands.secondaryHotkey());
  onHotkey('keydown-V', () => placement.startArmyRallyMode());
  onHotkey('keydown-DELETE', () => commands.removeSelectedBuildings());

  onHotkey('keydown-PLUS', () => camera.applyZoom(ZOOM_KEY_STEP));
  onHotkey('keydown-EQUALS', () => camera.applyZoom(ZOOM_KEY_STEP));
  onHotkey('keydown-MINUS', () => camera.applyZoom(-ZOOM_KEY_STEP));
  onHotkey('keydown-F1', (ev) => {
    ev.preventDefault();
    pointer.selectAllVillagers();
  });
  onHotkey('keydown-F2', (ev) => {
    ev.preventDefault();
    pointer.selectAllMilitary();
  });
  onHotkey('keydown-X', () => deps.toggleGameSpeed());
}
