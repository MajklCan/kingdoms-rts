/**
 * Settings: Audio (mute + per-channel volume), Game (speed, interface
 * scale) and Controls (hotkey reference). Opens from the main menu and the
 * pause menu. Audio values live in the AudioManager (which persists them);
 * interface scale persists in localStorage.
 */

import type { AudioChannel } from '../../render/audio/audio-manager';
import { h, readStorage, writeStorage } from '../dom';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import { syncPixelScale } from '../skin/pixel-scale';
import { createModal, type Modal } from './modal';

export type SettingsTab = 'audio' | 'game' | 'controls';

const UI_SCALE_KEY = 'kingdoms.uiScale';
const SCALES = [
  { value: '0.9', label: 'Compact' },
  { value: '1', label: 'Standard' },
  { value: '1.15', label: 'Large' },
  { value: '1.3', label: 'Huge' },
];

const CHANNELS: ReadonlyArray<{ channel: AudioChannel | 'master'; label: string }> = [
  { channel: 'master', label: 'Master' },
  { channel: 'music', label: 'Music' },
  { channel: 'sfx', label: 'Effects' },
  { channel: 'voices', label: 'Voices' },
  { channel: 'ambience', label: 'Ambience' },
];

const HOTKEYS: Array<{ group: string; rows: Array<[string, string]> }> = [
  {
    group: 'Camera',
    rows: [
      ['W A S D', 'Pan the camera'],
      ['Wheel / + -', 'Zoom'],
      ['Minimap', 'Click or drag to move the view'],
      ['Minimap right-click', 'Send the selection there (A held: attack-move)'],
      ['Space', 'Jump to the latest alert'],
    ],
  },
  {
    group: 'Selection',
    rows: [
      ['Click / drag', 'Select units or buildings'],
      ['Double-click', 'Select every unit of that type on screen'],
      ['F1', 'Select all villagers'],
      ['F2', 'Select all military'],
      ['.', 'Next idle villager'],
      ['Ctrl 1-9', 'Store a control group'],
      ['Alt 1-9', 'Store a control group (when Ctrl+number switches tabs)'],
      ['Shift 1-9', 'Add to a control group'],
      ['1-9', 'Recall a group, tap twice to jump'],
    ],
  },
  {
    group: 'Orders',
    rows: [
      ['Right-click', 'Move, gather or attack'],
      ['A then click', 'Attack-move toward the cursor'],
      ['H', 'Hold position'],
      ['V', 'Set army rally point'],
      ['Right-click', 'With only army buildings selected: set the rally point'],
      ['Delete', 'Remove selected buildings'],
    ],
  },
  {
    group: 'Economy',
    rows: [
      ['B then H', 'Build a house'],
      ['B then M / I', 'Build a farm / mill'],
      ['B then L / C / G', 'Lumber hut / stone quarry / gold mine'],
      ['B then R / T / F / Y', 'Barracks / stable / foundry / tower'],
      ['Q / E', 'Train / advance or secondary'],
      ['Shift+click', 'Queue five units'],
    ],
  },
  {
    group: 'Interface',
    rows: [
      ['Esc / F10', 'Game menu'],
      ['P', 'Pause'],
      ['X', 'Toggle game speed'],
      ['K', 'Technology tree'],
      ['O', 'Objectives'],
    ],
  },
];

let modal: Modal | null = null;
let tabs: Record<SettingsTab, { tab: HTMLButtonElement; panel: HTMLElement }> | null = null;
const sliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>();
let muteSwitch: HTMLButtonElement | null = null;
let audioNote: HTMLElement | null = null;
let speedInputs: HTMLInputElement[] = [];

export function applyStoredUiScale(): void {
  const v = Number(readStorage(UI_SCALE_KEY) ?? '1');
  const scale = Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1;
  document.documentElement.style.setProperty('--ui-user-scale', String(scale));
  syncPixelScale();
}

function fill(input: HTMLInputElement): void {
  input.style.setProperty('--fill', `${input.value}%`);
}

function refreshAudio(): void {
  const audio = getScene()?.getAudio();
  if (audioNote) audioNote.hidden = !!audio;
  if (!audio) return;
  if (muteSwitch) muteSwitch.setAttribute('aria-checked', String(audio.muted));
  for (const { channel } of CHANNELS) {
    const s = sliders.get(channel);
    if (!s) continue;
    const v = channel === 'master' ? audio.masterVolume : audio.getChannelVolume(channel);
    s.input.value = String(Math.round(v * 100));
    s.out.textContent = `${Math.round(v * 100)}%`;
    fill(s.input);
  }
}

function refreshGame(): void {
  const scene = getScene();
  const speed = scene?.getGameSpeed() ?? 1;
  for (const input of speedInputs) input.checked = Number(input.value) === speed;
}

function buildAudioPanel(): HTMLElement {
  muteSwitch = h(
    'button',
    { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false', id: 'settings-mute' },
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    'Mute all sound'
  );
  muteSwitch.addEventListener('click', () => {
    const audio = getScene()?.getAudio();
    if (!audio) return;
    audio.setMuted(!audio.muted);
    refreshAudio();
  });
  audioNote = h('p', { class: 'field-note' }, 'Audio is still loading. Try again in a moment.');
  const list = h('div', { class: 'slider-list' });
  for (const { channel, label } of CHANNELS) {
    const id = `vol-${channel}`;
    const input = h('input', { class: 'range', type: 'range', min: 0, max: 100, step: 1, id, 'aria-label': `${label} volume` });
    const out = h('output', { class: 'slider-out', for: id }, '0%');
    input.addEventListener('input', () => {
      const audio = getScene()?.getAudio();
      const v = Number(input.value) / 100;
      out.textContent = `${input.value}%`;
      fill(input);
      if (!audio) return;
      if (channel === 'master') audio.setMasterVolume(v);
      else audio.setChannelVolume(channel, v);
    });
    sliders.set(channel, { input, out });
    list.append(h('div', { class: 'slider-row' }, h('label', { class: 'slider-label', for: id }, label), input, out));
  }
  return h('div', { class: 'settings-section' }, muteSwitch, audioNote, list);
}

function buildGamePanel(): HTMLElement {
  speedInputs = [];
  const speed = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Game speed' });
  for (const [value, label] of [
    ['1', 'Normal'],
    ['2', 'Fast'],
  ] as const) {
    const input = h('input', { type: 'radio', name: 'settings-speed', value });
    input.addEventListener('change', () => getScene()?.setGameSpeed(Number(value)));
    speedInputs.push(input);
    speed.append(h('label', null, input, h('span', null, label)));
  }
  const current = readStorage(UI_SCALE_KEY) ?? '1';
  const scale = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Interface size' });
  for (const s of SCALES) {
    const input = h('input', { type: 'radio', name: 'settings-scale', value: s.value, checked: s.value === current });
    input.addEventListener('change', () => {
      writeStorage(UI_SCALE_KEY, s.value);
      applyStoredUiScale();
    });
    scale.append(h('label', null, input, h('span', null, s.label)));
  }
  return h(
    'div',
    { class: 'settings-section' },
    h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Game speed'), speed, h('p', { class: 'field-note' }, 'Also toggled with X during a match.')),
    h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Interface size'), scale, h('p', { class: 'field-note' }, 'Scales every menu and HUD element on top of the automatic fit to your screen.'))
  );
}

function buildControlsPanel(): HTMLElement {
  return h(
    'div',
    { class: 'settings-section hotkeys' },
    ...HOTKEYS.map((g) =>
      h(
        'section',
        { class: 'hotkey-group' },
        h('h3', { class: 'field-label' }, g.group),
        h(
          'dl',
          { class: 'hotkey-list' },
          ...g.rows.map(([keys, desc]) =>
            h(
              'div',
              { class: 'hotkey-row' },
              h('dt', null, ...keys.split(' ').map((k) => (k === 'then' || k === '/' ? h('span', { class: 'kbd-sep' }, k) : h('kbd', null, k)))),
              h('dd', null, desc)
            )
          )
        )
      )
    )
  );
}

function selectTab(which: SettingsTab, focus = false): void {
  if (!tabs) return;
  for (const [key, { tab, panel }] of Object.entries(tabs) as Array<[SettingsTab, { tab: HTMLButtonElement; panel: HTMLElement }]>) {
    const on = key === which;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    if (on && focus) tab.focus();
  }
  if (which === 'audio') refreshAudio();
  if (which === 'game') refreshGame();
}

function ensureModal(): Modal {
  if (modal) return modal;
  modal = createModal({ id: 'settings-panel', eyebrow: "The steward's ledger", title: 'Settings', className: 'modal-settings' });
  const defs: Array<[SettingsTab, string, HTMLElement, Parameters<typeof icon>[0]]> = [
    ['audio', 'Audio', buildAudioPanel(), 'sound-on'],
    ['game', 'Game', buildGamePanel(), 'settings'],
    ['controls', 'Controls', buildControlsPanel(), 'keyboard'],
  ];
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' });
  const built = {} as Record<SettingsTab, { tab: HTMLButtonElement; panel: HTMLElement }>;
  for (const [key, label, panel, ic] of defs) {
    const tab = h('button', { type: 'button', class: 'tab', role: 'tab', id: `settings-tab-${key}`, 'aria-controls': `settings-panel-${key}` }, icon(ic), label);
    panel.id = `settings-panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => selectTab(key));
    built[key] = { tab, panel };
    tablist.append(tab);
  }
  tablist.addEventListener('keydown', (ev) => {
    const order: SettingsTab[] = ['audio', 'game', 'controls'];
    const idx = order.findIndex((k) => built[k].tab === document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (ev.key === 'ArrowRight') next = (idx + 1) % order.length;
    else if (ev.key === 'ArrowLeft') next = (idx - 1 + order.length) % order.length;
    if (next < 0) return;
    ev.preventDefault();
    selectTab(order[next]!, true);
  });
  tabs = built;
  modal.body.append(tablist, ...defs.map(([, , panel]) => panel));
  const done = h('button', { type: 'button', class: 'btn btn-seal' }, 'Done');
  done.addEventListener('click', () => modal?.close());
  modal.foot.append(done);
  return modal;
}

export function openSettings(tab: SettingsTab = 'audio'): void {
  const m = ensureModal();
  selectTab(tab);
  m.open(tabs?.[tab].tab ?? null);
}

/** Keep the audio controls honest if something else (M key, etc.) changed them. */
export function syncSettingsIfOpen(): void {
  if (modal?.isOpen()) {
    refreshAudio();
    refreshGame();
  }
}
