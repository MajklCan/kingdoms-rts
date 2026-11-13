/**
 * Save / load ledger: three local save slots (slot I keeps the legacy
 * manual-save key so older saves still load), export to and import from a
 * file, and the Late Game Test fixture in dev builds. Saving is offered only
 * during a single-player match; loading works from the menu too.
 */

import { SIM } from '../../config';
import { AGE_TABLE } from '../../sim/defs';
import { parseSavedGame, type SavedGameV1 } from '../../sim/save-load';
import { appState } from '../app-state';
import { downloadTextFile, h, readStorage, removeStorage, writeStorage } from '../dom';
import { formatClock } from '../format';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import { loadLateGameTest, loadSnapshot } from '../match/match-flow';
import { confirmDialog } from './confirm';
import { createModal, dismissSilently, type Modal } from './modal';

export const LOCAL_SAVE_KEY = 'kingdoms.manualSave.v1';
const SLOT_KEYS = [LOCAL_SAVE_KEY, 'kingdoms.save.slot2.v1', 'kingdoms.save.slot3.v1'];
const ROMAN = ['I', 'II', 'III'];

export type SaveLoadMode = 'save' | 'load';

let modal: Modal | null = null;
let mode: SaveLoadMode = 'load';
let list: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let modeTabs: { save: HTMLButtonElement; load: HTMLButtonElement } | null = null;
let fileInput: HTMLInputElement | null = null;
let afterClose: (() => void) | null = null;

function readSlot(i: number): SavedGameV1 | null {
  const raw = readStorage(SLOT_KEYS[i]!);
  return raw ? parseSavedGame(raw) : null;
}

export function hasAnySave(): boolean {
  return SLOT_KEYS.some((_, i) => readSlot(i) !== null);
}

function canSave(): boolean {
  const scene = getScene();
  return appState.phase === 'match' && !!scene && !scene.isMultiplayer();
}

function setStatus(text: string, tone: 'info' | 'error' = 'info'): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function describe(save: SavedGameV1): string {
  const when = new Date(save.savedAt);
  const date = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return [date, `Game time ${formatClock(save.tick / SIM.TICK_HZ)}`].filter(Boolean).join(' · ');
}

function saveLabel(): string {
  const scene = getScene();
  if (!scene) return 'Saved game';
  const mission = scene.getCampaignMission();
  const age = AGE_TABLE.find((a) => a.id === scene.getAge(scene.getPerspectivePlayerId()).current)?.name ?? '';
  return `${mission ? mission.name : 'Skirmish'}${age ? ` · ${age}` : ''}`;
}

async function saveTo(i: number): Promise<void> {
  const scene = getScene();
  if (!scene || !canSave()) return;
  if (readSlot(i)) {
    const ok = await confirmDialog({
      title: `Overwrite slot ${ROMAN[i]}?`,
      body: 'The chronicle already written in this slot will be replaced.',
      confirmLabel: 'Overwrite',
      danger: true,
    });
    if (!ok) return;
  }
  const snapshot = scene.createSaveSnapshot(saveLabel());
  if (writeStorage(SLOT_KEYS[i]!, JSON.stringify(snapshot))) {
    setStatus(`Saved to slot ${ROMAN[i]}.`);
  } else {
    setStatus('Could not save: browser storage is full or blocked. Try Export instead.', 'error');
  }
  render();
}

function load(save: SavedGameV1): void {
  if (modal) dismissSilently(modal);
  afterClose = null;
  loadSnapshot(save, save.label || 'Saved game');
}

async function remove(i: number): Promise<void> {
  const ok = await confirmDialog({
    title: `Erase slot ${ROMAN[i]}?`,
    body: 'This saved game will be deleted from this browser. It cannot be recovered.',
    confirmLabel: 'Erase',
    danger: true,
  });
  if (!ok) return;
  removeStorage(SLOT_KEYS[i]!);
  setStatus(`Slot ${ROMAN[i]} erased.`);
  render();
}

function render(): void {
  if (!list || !modeTabs) return;
  const saving = mode === 'save';
  modeTabs.save.setAttribute('aria-selected', String(saving));
  modeTabs.load.setAttribute('aria-selected', String(!saving));
  modeTabs.save.disabled = !canSave();
  modeTabs.save.tabIndex = saving ? 0 : -1;
  modeTabs.load.tabIndex = saving ? -1 : 0;
  if (modal) modal.titleEl.textContent = saving ? 'Save Game' : 'Load Game';
  const rows: HTMLElement[] = [];
  SLOT_KEYS.forEach((_, i) => {
    const save = readSlot(i);
    const action = saving
      ? h('button', { type: 'button', class: 'btn btn-seal', onclick: () => void saveTo(i) }, icon('save'), save ? 'Overwrite' : 'Save here')
      : h('button', { type: 'button', class: 'btn btn-seal', disabled: !save, onclick: () => save && load(save) }, icon('load'), 'Load');
    rows.push(
      h(
        'li',
        { class: `slot-row${save ? '' : ' is-empty'}` },
        h('span', { class: 'slot-num', 'aria-hidden': 'true' }, ROMAN[i]!),
        h(
          'span',
          { class: 'slot-body' },
          h('strong', { class: 'slot-title' }, save ? save.label || 'Saved game' : 'Empty slot'),
          h('span', { class: 'slot-meta' }, save ? describe(save) : saving ? 'Ready for a new chronicle' : 'Nothing written here yet')
        ),
        h(
          'span',
          { class: 'slot-actions' },
          save ? h('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': `Erase slot ${ROMAN[i]}`, onclick: () => void remove(i) }, icon('close')) : null,
          action
        )
      )
    );
  });
  if (!saving && import.meta.env.DEV) {
    rows.push(
      h(
        'li',
        { class: 'slot-row is-fixture' },
        h('span', { class: 'slot-num', 'aria-hidden': 'true' }, icon('hammer')),
        h('span', { class: 'slot-body' }, h('strong', { class: 'slot-title' }, 'Late Game Test'), h('span', { class: 'slot-meta' }, 'Developer fixture with a built-up economy')),
        h('span', { class: 'slot-actions' }, h('button', { type: 'button', class: 'btn btn-ink', id: 'load-late-game', onclick: () => {
          if (modal) dismissSilently(modal);
          afterClose = null;
          loadLateGameTest();
        } }, 'Load'))
      )
    );
  }
  list.replaceChildren(...rows);
}

function ensureModal(): Modal {
  if (modal) return modal;
  modal = createModal({
    id: 'save-load-panel',
    eyebrow: 'The chronicle ledger',
    title: 'Load Game',
    className: 'modal-saves',
    onClose: () => {
      const fn = afterClose;
      afterClose = null;
      fn?.();
    },
  });
  const saveTab = h('button', { type: 'button', class: 'tab', role: 'tab' }, icon('save'), 'Save');
  const loadTab = h('button', { type: 'button', class: 'tab', role: 'tab' }, icon('load'), 'Load');
  saveTab.addEventListener('click', () => {
    mode = 'save';
    render();
  });
  loadTab.addEventListener('click', () => {
    mode = 'load';
    render();
  });
  modeTabs = { save: saveTab, load: loadTab };
  list = h('ul', { class: 'slot-list', 'aria-label': 'Save slots' });
  statusEl = h('p', { class: 'slot-status', role: 'status', 'aria-live': 'polite' });
  fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput!.files?.[0];
    fileInput!.value = '';
    if (!file) return;
    const save = parseSavedGame(await file.text());
    if (!save) {
      setStatus('That file is not a Kingdoms save.', 'error');
      return;
    }
    load(save);
  });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-ink', id: 'save-export' }, icon('download'), 'Export');
  exportBtn.addEventListener('click', () => {
    const scene = getScene();
    if (!scene || !canSave()) {
      setStatus('Exporting needs a single-player match in progress.', 'error');
      return;
    }
    const snapshot = scene.createSaveSnapshot(saveLabel());
    downloadTextFile(`kingdoms-save-${snapshot.tick}.json`, JSON.stringify(snapshot), 'application/json');
    setStatus('Save exported as a file.');
  });
  const importBtn = h('button', { type: 'button', class: 'btn btn-ink' }, icon('load'), 'Import');
  importBtn.addEventListener('click', () => fileInput?.click());

  modal.body.append(h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Save or load' }, saveTab, loadTab), list, statusEl, fileInput);
  const close = h('button', { type: 'button', class: 'btn btn-ink' }, 'Close');
  close.addEventListener('click', () => modal?.close());
  modal.foot.append(h('div', { class: 'foot-left' }, exportBtn, importBtn), close);
  return modal;
}

/** Open the ledger. `onClose` runs when it is dismissed (not after a load). */
export function openSaveLoad(which: SaveLoadMode, onClose?: () => void): void {
  const m = ensureModal();
  mode = which === 'save' && canSave() ? 'save' : 'load';
  afterClose = onClose ?? null;
  setStatus(appState.phase === 'match' && getScene()?.isMultiplayer() ? 'Saving is not available in multiplayer.' : '');
  render();
  m.open(list?.querySelector<HTMLElement>('.btn:not([disabled])') ?? null);
}
