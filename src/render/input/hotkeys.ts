/**
 * Keyboard shortcuts. While the build buttons show (a villager selected:
 * buildings need a builder) a building's letter starts placing it, as its
 * button does; B then a letter does the same. Otherwise the same letters are
 * commands (H = hold position, G = villager rally, R = train the Commander).
 * Shortcuts are ignored while a DOM text field has focus.
 */

import { UnitStanceId } from '@sim/components';
import { setLastEvent } from '../../debug/overlay';
import type { CameraController } from '../camera/camera-controller';
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
  /** Start the build button with this hotkey if one is showing; false if none. */
  buildHotkey(key: string): boolean;
}

/**
 * B + key (or the key alone while the build buttons show): [key, mode, prompt].
 * W, A, S and D are left out: they pan the camera.
 */
const BUILD_KEYS: Array<[string, Exclude<BuildMode, 'none'>, string]> = [
  ['M', 'FARM', 'build FARM - left-click to place'],
  ['I', 'MILL', 'build MILL - left-click to place'],
  ['L', 'LUMBER_CAMP', 'build LUMBER HUT - left-click near trees'],
  ['G', 'GOLD_MINE', 'build GOLD MINE - left-click near gold'],
  ['C', 'STONE_QUARRY', 'build STONE QUARRY - left-click near stone'],
  ['R', 'BARRACKS', 'build BARRACKS - left-click to place'],
  ['N', 'ARCHERY_RANGE', 'build ARCHERY RANGE - left-click to place'],
  ['T', 'STABLE', 'build STABLE - left-click to place'],
  ['F', 'FOUNDRY', 'build FOUNDRY - left-click to place'],
  ['Y', 'DEFENSIVE_TOWER', 'build DEFENSIVE TOWER - left-click to place'],
  ['Z', 'WALL', 'build WALL - drag from the start tile to the end tile, or click both'],
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
    const noBuilder = commands.builderFailure();
    if (noBuilder) {
      commands.fail(noBuilder);
      return;
    }
    placement.awaitBuildKind();
    setLastEvent('build: M farm · I mill · L wood · C stone · other buildings unlock through research');
  });
  onHotkey('keydown-H', () => {
    if (placement.awaitingBuildKind) {
      placement.startBuildMode('HOUSE', 'build HOUSE - left-click to place, right-click to cancel');
    } else if (!deps.buildHotkey('H')) {
      commands.setStance(UnitStanceId.HOLD_POSITION);
    }
  });
  // Before the build letters, which clear awaitingBuildKind: after B, or
  // with the build buttons showing, G is a gold mine; otherwise it is the
  // town center's villager rally.
  onHotkey('keydown-G', () => {
    if (!placement.awaitingBuildKind && !deps.buildHotkey('G')) placement.startVillagerRallyMode();
  });
  // Same reason: R is the barracks while building, else it trains the Commander.
  onHotkey('keydown-R', () => {
    if (!placement.awaitingBuildKind && !deps.buildHotkey('R')) commands.trainHotkey(2, true);
  });
  for (const [key, mode, message] of BUILD_KEYS) {
    onHotkey(`keydown-${key}`, () => {
      if (placement.awaitingBuildKind) placement.startBuildMode(mode, message);
      else if (key !== 'G' && key !== 'R') deps.buildHotkey(key);
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

  onHotkey('keydown-PLUS', () => camera.zoomStep(1));
  onHotkey('keydown-EQUALS', () => camera.zoomStep(1));
  onHotkey('keydown-MINUS', () => camera.zoomStep(-1));
  onHotkey('keydown-NUMPAD_ADD', () => camera.zoomStep(1));
  onHotkey('keydown-NUMPAD_SUBTRACT', () => camera.zoomStep(-1));
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
