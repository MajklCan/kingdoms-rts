/** Top resource bar: resource counts, population, age, pause + speed toggles. */

import { setLastEvent, updateResourceBar } from '../../debug/overlay';
import type { GameScene } from '../../render/game-scene';
import { byId, isTextEntryTarget } from '../dom';
import { getScene } from '../game-bridge';
import { installStaticResourceIcons } from '../icons/voxel-icons';

export function bindSpeedToggle(): void {
  const speedBtn = byId('speed-toggle');
  if (!speedBtn) return;
  speedBtn.addEventListener('click', () => {
    getScene()?.toggleGameSpeed();
  });
}

export function updatePauseToggle(scene: GameScene): void {
  const pauseBtn = byId<HTMLButtonElement>('pause-toggle');
  if (!pauseBtn) return;
  const paused = scene.isPaused();
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.classList.toggle('active', paused);
  pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  pauseBtn.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
}

function togglePausedFromUi(): void {
  const scene = getScene();
  if (!scene) return;
  const paused = !scene.isPaused();
  scene.setPaused(paused);
  setLastEvent(paused ? 'paused' : 'resumed');
  updatePauseToggle(scene);
}

export function bindPauseToggle(): void {
  const pauseBtn = byId('pause-toggle');
  pauseBtn?.addEventListener('click', togglePausedFromUi);
  window.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() !== 'p') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || isTextEntryTarget(ev.target)) return;
    ev.preventDefault();
    togglePausedFromUi();
  });
}

export { installStaticResourceIcons };

export function updateResourceBarFromScene(scene: GameScene): void {
  const me = scene.getPerspectivePlayerId();
  const pop = scene.getPop(me);
  const age = scene.getAge(me);
  let ageLabel = age.name;
  if (age.advancing && age.nextName) {
    ageLabel = `${age.name} → ${age.nextName} ${Math.floor(age.progressFrac * 100)}%`;
  }
  updateResourceBar({
    ...scene.getResources(me),
    popCurrent: pop.current,
    popCap: pop.cap,
    age: ageLabel,
    speed: scene.getGameSpeed(),
  });
  updatePauseToggle(scene);
}
