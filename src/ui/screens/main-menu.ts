/**
 * Title screen: wordmark top-left, one column of mode charters and the
 * secondary buttons on the left, the painted map owns the rest. A "Continue"
 * charter leads the list while the autosave slot holds a match. The entry
 * gate (menu-gate.ts) runs on this same DOM.
 */

import { h, readStorage, setText } from '../dom';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { continueAutosave } from '../match/match-flow';
import { openSaveLoad } from '../panels/save-load';
import { openSettings } from '../panels/settings';
import { autosaveSummary, getKnownAutosave, loadAutosave, onAutosaveChange, refreshAutosave } from '../saves/autosave';
import type { AutosaveMeta } from '../saves/autosave-meta';
import { buildFullscreenButton } from '../touch/fullscreen';
import { previousMenuScreen, registerMenuScreen, rovingFocus, showMenuScreen, type MenuScreenId } from './menu-shell';

export const PLAYER_NAME_KEY = 'kingdoms.playerName';

export function storedPlayerName(): string {
  const raw = readStorage(PLAYER_NAME_KEY)?.trim();
  return raw ? raw.slice(0, 20) : 'Commander';
}

function charter(mode: MenuScreenId, iconName: IconName, label: string): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'charter',
      'data-mode': mode,
      onclick: () => showMenuScreen(mode),
    },
    h('span', { class: 'medallion', 'aria-hidden': 'true' }, h('span', { class: 'medallion-disc' }), icon(iconName, 'medallion-icon')),
    h('span', { class: 'charter-body' }, h('span', { class: 'charter-label' }, label)),
    icon('chevron-right', 'charter-arrow')
  );
}

function pill(iconName: IconName, label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: 'pill', onclick }, icon(iconName), label);
}

export function buildTagText(): string {
  const commit = __GIT_COMMIT__ && __GIT_COMMIT__ !== 'unknown' ? ` · ${__GIT_COMMIT__}` : '';
  return `Prototype · v${__APP_VERSION__}${commit}`;
}

/** "Continue" charter: hidden until the autosave slot holds a resumable match. */
function continueCharter(): { el: HTMLButtonElement; sync: (meta: AutosaveMeta | null) => void } {
  const sub = h('span', { class: 'charter-sub', id: 'menu-continue-summary' });
  let loading = false;
  const el = h(
    'button',
    {
      type: 'button',
      class: 'charter charter--continue',
      id: 'menu-continue',
      hidden: true,
      onclick: () => {
        if (loading) return;
        loading = true;
        // A save that no longer loads is dropped; the slot change hides this charter.
        void loadAutosave().then((record) => {
          loading = false;
          if (record) continueAutosave(record);
        });
      },
    },
    h('span', { class: 'medallion', 'aria-hidden': 'true' }, h('span', { class: 'medallion-disc' }), icon('play', 'medallion-icon')),
    h('span', { class: 'charter-body' }, h('span', { class: 'charter-label' }, 'Continue'), sub),
    icon('chevron-right', 'charter-arrow')
  );
  const sync = (meta: AutosaveMeta | null): void => {
    const hadFocus = document.activeElement === el;
    el.hidden = meta === null;
    if (meta) setText(sub, autosaveSummary(meta));
    else if (hadFocus) el.parentElement?.querySelector<HTMLElement>('.charter:not([hidden])')?.focus();
  };
  return { el, sync };
}

/** Stagger index for the gate reveal (see .menu-root[data-gate] in menu.css). */
function stagger<T extends HTMLElement>(el: T, i: number): T {
  el.style.setProperty('--i', String(i));
  return el;
}

export function bindMainMenu(): void {
  const resume = continueCharter();
  onAutosaveChange(resume.sync);
  const nav = h(
    'nav',
    { class: 'charter-list', 'aria-label': 'Game modes' },
    stagger(resume.el, 0),
    stagger(charter('campaign', 'mode-campaign', 'Campaign'), 1),
    stagger(charter('skirmish', 'mode-skirmish', 'Skirmish'), 2),
    stagger(charter('multiplayer', 'mode-multiplayer', 'Multiplayer'), 3)
  );
  const secondary = stagger(
    h(
      'div',
      { class: 'pill-row' },
      pill('load', 'Load Game', () => openSaveLoad('load')),
      pill('settings', 'Settings', () => openSettings('audio')),
      pill('keyboard', 'Controls', () => openSettings('controls'))
    ),
    4
  );
  // In-car and phone browsers: hide the browser bars with one tap.
  const fullscreen = buildFullscreenButton('pill pill--icon touch-only', 'menu-fullscreen');

  const nameEl = h('span', { class: 'nameplate-name', id: 'nameplate-name' }, storedPlayerName());
  const gateBtn = h(
    'button',
    { type: 'button', class: 'gate-btn', id: 'menu-gate-btn', hidden: true, 'data-silent': '', 'aria-label': 'Press any key to enter' },
    icon('sound-on', 'gate-icon'),
    h('span', { class: 'mouse-only' }, 'Press any key'),
    h('span', { class: 'touch-only' }, 'Tap to enter')
  );
  const el = h(
    'section',
    { class: 'menu-screen--title', 'aria-labelledby': 'menu-title' },
    h(
      'div',
      { class: 'menu-brand', id: 'menu-brand' },
      h(
        'div',
        { class: 'menu-brand-inner' },
        h('img', { class: 'menu-crest', src: '/assets/ui/crest.svg', alt: '', width: 200, height: 244, draggable: 'false' }),
        h('h1', { class: 'menu-title', id: 'menu-title' }, 'Kingdoms')
      )
    ),
    h('div', { class: 'menu-col' }, nav, secondary),
    h(
      'div',
      { class: 'menu-foot' },
      h(
        'div',
        { class: 'nameplate', 'aria-label': 'Player' },
        h('span', { class: 'nameplate-avatar', 'aria-hidden': 'true' }, icon('helm')),
        h('span', { class: 'nameplate-text' }, nameEl, h('span', { class: 'nameplate-rank' }, 'Lord of Bohemia'))
      ),
      h('div', { class: 'build-tag', id: 'build-info', 'aria-label': 'Game version' }, buildTagText())
    ),
    h('div', { class: 'menu-actions' }, fullscreen),
    gateBtn
  );
  rovingFocus(nav, '.charter');
  rovingFocus(secondary, '.pill', 'horizontal');
  registerMenuScreen({
    id: 'root',
    el,
    // Coming back from a sub-screen lands on the charter that opened it.
    focusTarget: () => nav.querySelector<HTMLElement>(`.charter[data-mode="${previousMenuScreen()}"]`) ?? nav.querySelector<HTMLElement>('.charter:not([hidden])'),
    onShow: () => {
      nameEl.textContent = storedPlayerName();
      // Last known slot first (no pop-in), then the truth from storage.
      resume.sync(getKnownAutosave());
      void refreshAutosave();
    },
  });
}
