/** Save / load controls (manual localStorage slot + Late Game Test fixture). */

import { setLastEvent } from '../../debug/overlay';
import { LATE_GAME_TEST_SAVE_ID, parseSavedGame } from '../../sim/save-load';
import { byId } from '../dom';
import { getScene } from '../game-bridge';
import { hideTitleScreen } from '../screens/main-menu';

export const LOCAL_SAVE_KEY = 'kingdoms.manualSave.v1';

export function bindSaveLoadControls(): void {
  const saveBtn = byId<HTMLButtonElement>('save-game-button');
  const loadBtn = byId<HTMLButtonElement>('load-game-button');
  const slotSelect = byId<HTMLSelectElement>('save-slot-select');
  if (!saveBtn || !loadBtn || !slotSelect) return;

  const refreshManualSlot = () => {
    const manualOption = slotSelect.querySelector<HTMLOptionElement>('option[value="manual"]');
    if (!manualOption) return;
    const saved = localStorage.getItem(LOCAL_SAVE_KEY);
    manualOption.disabled = saved === null;
    manualOption.textContent = saved === null ? 'Manual Save (empty)' : 'Manual Save';
    if (slotSelect.value === 'manual' && saved === null) {
      slotSelect.value = LATE_GAME_TEST_SAVE_ID;
    }
  };

  saveBtn.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) return;
    const snapshot = scene.createSaveSnapshot('Manual Save');
    localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(snapshot));
    refreshManualSlot();
    slotSelect.value = 'manual';
    setLastEvent('manual save written');
  });

  loadBtn.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) return;
    hideTitleScreen();

    if (slotSelect.value === LATE_GAME_TEST_SAVE_ID) {
      scene.loadLateGameTestSave();
      return;
    }

    const raw = localStorage.getItem(LOCAL_SAVE_KEY);
    const snapshot = raw ? parseSavedGame(raw) : null;
    if (!snapshot) {
      refreshManualSlot();
      setLastEvent('no valid manual save');
      return;
    }
    scene.loadSaveSnapshot(snapshot, 'Manual Save');
  });

  refreshManualSlot();
}
