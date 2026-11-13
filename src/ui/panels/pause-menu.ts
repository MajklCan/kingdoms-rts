/**
 * Pause menu (Esc / F10 / menu button): resume, save, load, settings,
 * objectives, quit to menu. Single player freezes the sim while it is open
 * and restores the previous pause state afterwards; multiplayer keeps
 * running and says so.
 */

import { hasOpenLayer, rovingFocus } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget } from '../dom';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { quitToMenu } from '../match/match-flow';
import { confirmDialog } from './confirm';
import { createModal, dismissSilently, type Modal } from './modal';
import { openObjectives } from './objectives';
import { openSaveLoad } from './save-load';
import { openSettings } from './settings';

let modal: Modal | null = null;
let wasPaused = false;
let note: HTMLElement | null = null;
let saveBtn: HTMLButtonElement | null = null;
let objectivesBtn: HTMLButtonElement | null = null;

function item(iconName: IconName, label: string, onclick: () => void, id?: string): HTMLButtonElement {
  return h('button', { type: 'button', class: 'pause-item', id, onclick }, icon(iconName), h('span', null, label));
}

function ensureModal(): Modal {
  if (modal) return modal;
  modal = createModal({
    id: 'pause-menu',
    eyebrow: 'The council convenes',
    title: 'Paused',
    className: 'modal-pause',
    onClose: () => {
      const scene = getScene();
      if (scene && !scene.isMultiplayer() && !wasPaused) scene.setPaused(false);
    },
  });
  saveBtn = item('save', 'Save Game', () => openSaveLoad('save'), 'pause-save');
  objectivesBtn = item('objectives', 'Objectives', () => openObjectives(), 'pause-objectives');
  const list = h(
    'nav',
    { class: 'pause-list', 'aria-label': 'Game menu' },
    item('play', 'Resume', () => modal?.close(), 'pause-resume'),
    saveBtn,
    item('load', 'Load Game', () => openSaveLoad('load'), 'pause-load'),
    item('settings', 'Settings', () => openSettings('audio'), 'pause-settings'),
    item('keyboard', 'Controls', () => openSettings('controls'), 'pause-controls'),
    objectivesBtn,
    item('quit', 'Quit to Menu', () => void quit(), 'pause-quit')
  );
  rovingFocus(list, '.pause-item');
  note = h('p', { class: 'pause-note', role: 'note' });
  modal.body.append(note, list);
  return modal;
}

async function quit(): Promise<void> {
  const mp = getScene()?.isMultiplayer() ?? false;
  const ok = await confirmDialog({
    title: 'Abandon the battle?',
    body: mp ? 'You will leave the multiplayer match. Your rival keeps the field.' : 'Unsaved progress in this match will be lost.',
    confirmLabel: 'Quit to Menu',
    danger: true,
  });
  if (!ok) return;
  if (modal) dismissSilently(modal);
  quitToMenu();
}

export function openPauseMenu(): void {
  const scene = getScene();
  if (!scene || appState.phase !== 'match') return;
  const m = ensureModal();
  if (m.isOpen()) return;
  const mp = scene.isMultiplayer();
  wasPaused = scene.isPaused();
  if (!mp) scene.setPaused(true);
  m.titleEl.textContent = mp ? 'Game Menu' : 'Paused';
  if (note) {
    note.textContent = mp ? 'The battle continues while this menu is open.' : '';
    note.hidden = !mp;
  }
  if (saveBtn) saveBtn.disabled = mp;
  if (objectivesBtn) objectivesBtn.hidden = scene.getCampaignMission() === null;
  m.open();
}

export function isPauseMenuOpen(): boolean {
  return modal?.isOpen() ?? false;
}

export function closePauseMenuSilently(): void {
  if (modal) dismissSilently(modal);
}

export function bindPauseMenuKeys(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || hasOpenLayer()) return;
    const scene = getScene();
    if (!scene) return;
    if (ev.key === 'F10') {
      ev.preventDefault();
      openPauseMenu();
      return;
    }
    if (ev.key === 'Escape' && !isTextEntryTarget(ev.target)) {
      // Escape first cancels placement / rally modes in the scene.
      if (scene.getBuildMode() !== '-') return;
      ev.preventDefault();
      openPauseMenu();
    }
  });
}
