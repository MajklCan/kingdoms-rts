/** Skirmish setup panel: starting age, map, AI difficulty, Begin button. */

import { AgeId, type AgeIdValue } from '../../sim/defs';
import { normalizeMapId, type MapIdValue } from '../../sim/map-gen';
import { normalizeAiDifficulty, type AiDifficulty } from '../../sim/world';
import { byId } from '../dom';
import { getScene } from '../game-bridge';
import { hideTitleScreen } from './main-menu';

export function parseStartingAge(value: string | undefined): AgeIdValue {
  const parsed = Number(value);
  if (parsed === AgeId.CASTLE) return AgeId.CASTLE;
  if (parsed === AgeId.GUNPOWDER) return AgeId.GUNPOWDER;
  if (parsed === AgeId.TOTAL_WAR) return AgeId.TOTAL_WAR;
  return AgeId.DARK;
}

export function parseStartingMap(value: string | undefined): MapIdValue {
  return normalizeMapId(value);
}

export function parseAiDifficulty(value: string | undefined): AiDifficulty {
  return normalizeAiDifficulty(value);
}

export function bindSkirmishSetup(): void {
  const titleEl = byId('title-screen');
  const startBtn = byId('start-button');
  const ageSelect = byId<HTMLSelectElement>('starting-age-select');
  const mapSelect = byId<HTMLSelectElement>('starting-map-select');
  const difficultySelect = byId<HTMLSelectElement>('ai-difficulty-select');
  if (!titleEl || !startBtn) return;
  startBtn.addEventListener('click', () => {
    const startingAge = parseStartingAge(ageSelect?.value);
    const startingMap = parseStartingMap(mapSelect?.value);
    const aiDifficulty = parseAiDifficulty(difficultySelect?.value);
    const scene = getScene();
    if (scene) scene.startNewGame(startingAge, startingMap, aiDifficulty);
    hideTitleScreen();
  });
}
