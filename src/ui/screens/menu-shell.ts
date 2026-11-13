/**
 * Title screen shell: the illuminated-manuscript backdrop (painted map,
 * haze, hearth glow, embers, gilded corners) plus a router that swaps the
 * menu screens (root, skirmish, campaign, multiplayer) with a short
 * transition. Screens register themselves; the shell owns Escape-to-back.
 */

import { hasOpenLayer, rovingFocus } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget } from '../dom';
import { startAtmosphere, stopAtmosphere } from './menu-atmosphere';

export type MenuScreenId = 'root' | 'skirmish' | 'campaign' | 'multiplayer';

interface MenuScreen {
  id: MenuScreenId;
  el: HTMLElement;
  /** Element to focus when the screen becomes active. */
  focusTarget?: () => HTMLElement | null;
  onShow?: () => void;
}

const screens = new Map<MenuScreenId, MenuScreen>();
let current: MenuScreenId = 'root';
let previous: MenuScreenId = 'root';
let stage: HTMLElement | null = null;
let root: HTMLElement | null = null;

export function getMenuRoot(): HTMLElement {
  if (root) return root;
  const corners = (['tl', 'tr', 'bl', 'br'] as const).map((pos) =>
    h('div', { class: `menu-corner ${pos}`, 'aria-hidden': 'true' })
  );
  stage = h('main', { class: 'menu-stage', id: 'menu-stage' });
  root = h(
    'div',
    { id: 'menu-root', class: 'menu-root' },
    h('div', { class: 'menu-bg', 'aria-hidden': 'true' }),
    h('div', { class: 'menu-haze', 'aria-hidden': 'true' }),
    h('div', { class: 'menu-glow-hall', 'aria-hidden': 'true' }),
    h('div', { class: 'menu-glow-core', id: 'menu-glow-core', 'aria-hidden': 'true' }),
    h('canvas', { class: 'menu-dust', id: 'menu-dust', 'aria-hidden': 'true' }),
    ...corners,
    stage
  );
  return root;
}

export function registerMenuScreen(screen: MenuScreen): void {
  screens.set(screen.id, screen);
  screen.el.classList.add('menu-screen');
  screen.el.dataset.screen = screen.id;
  screen.el.hidden = screen.id !== current;
  getMenuRoot();
  stage!.append(screen.el);
}

export function showMenuScreen(id: MenuScreenId, focus = true): void {
  const next = screens.get(id);
  if (!next) return;
  const prev = screens.get(current);
  previous = current;
  current = id;
  if (prev && prev !== next) {
    prev.el.hidden = true;
    prev.el.classList.remove('is-entering');
  }
  next.el.hidden = false;
  next.el.classList.remove('is-entering');
  // Force a reflow so the entrance animation restarts each time.
  void next.el.offsetWidth;
  next.el.classList.add('is-entering');
  next.onShow?.();
  if (focus) {
    requestAnimationFrame(() => {
      const target = next.focusTarget?.() ?? next.el.querySelector<HTMLElement>('button, input, [tabindex="0"]');
      target?.focus({ preventScroll: true });
    });
  }
}

export function currentMenuScreen(): MenuScreenId {
  return current;
}

/** The screen shown before the current one (for restoring focus). */
export function previousMenuScreen(): MenuScreenId {
  return previous;
}

/** Enter the title screens (from boot or after quitting a match). */
export function enterMenu(screen: MenuScreenId = 'root'): void {
  showMenuScreen(screen);
  startAtmosphere();
}

export function leaveMenu(): void {
  stopAtmosphere();
}

export function bindMenuShell(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'menu' || hasOpenLayer()) return;
    if (ev.key === 'Escape' && current !== 'root') {
      if (isTextEntryTarget(ev.target)) (ev.target as HTMLElement).blur();
      ev.preventDefault();
      showMenuScreen('root');
    }
  });
}

/** Back link used at the top of every sub-screen. */
export function backButton(label = 'Back'): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: 'link-btn menu-back', onclick: () => showMenuScreen('root') },
    h('span', { class: 'menu-back-arrow', 'aria-hidden': 'true' }),
    label
  );
}

export { rovingFocus };
