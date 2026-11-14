/**
 * In-match HUD layout (classic RTS): resource bar across the top, a bottom
 * console with minimap (left), selection panel (centre) and command grid
 * (right). Floating above the console: event log, idle villager button,
 * control groups and alert toasts; in touch mode also the touch bar and the
 * placement Confirm / Cancel plank. Also owns the pause key and the paused
 * banner.
 */

import { setLastEvent } from '../../debug/overlay';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget } from '../dom';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import { openPauseMenu } from '../panels/pause-menu';
import { toggleObjectives } from '../panels/objectives';
import { toggleTechTree } from '../panels/tech-tree';
import { buildFullscreenButton } from '../touch/fullscreen';
import { buildPlacementBar, buildTouchBar } from '../touch/touch-bar';
import { buildAgeBanner } from './age-banner';
import { buildAlerts } from './alerts';
import { buildCommandGrid } from './command-grid';
import { buildControlGroups } from './control-groups';
import { buildEventLog } from './event-log';
import { buildIdleButton } from './idle-villagers';
import { buildMinimap } from './minimap';
import { buildSelectionPanel } from './selection-panel';
import { bindSpeedButton, buildTopBar } from './top-bar';

let pausedBanner: HTMLElement | null = null;

export function buildHud(): HTMLElement {
  const top = buildTopBar({
    onObjectives: () => toggleObjectives(),
    onTech: () => toggleTechTree(),
    onPause: () => togglePause(),
    onMenu: () => openPauseMenu(),
  });
  bindSpeedButton(() => getScene()?.toggleGameSpeed());
  top.querySelector('.topbar-buttons')?.append(buildFullscreenButton('icon-btn touch-only', 'btn-fullscreen'));

  pausedBanner = h(
    'div',
    { class: 'paused-banner', hidden: true, role: 'status' },
    icon('pause'),
    h('span', { class: 'paused-title' }, 'Paused'),
    h('span', { class: 'paused-hint mouse-only' }, 'Press ', h('kbd', null, 'P'), ' to resume'),
    h('span', { class: 'paused-hint touch-only' }, 'Tap pause again to resume')
  );

  const consoleEl = h(
    'footer',
    { class: 'console', id: 'bottom-hud' },
    buildMinimap(),
    buildSelectionPanel(),
    buildCommandGrid()
  );

  const dock = h(
    'div',
    { class: 'console-dock' },
    h('div', { class: 'dock-left' }, buildEventLog(), h('div', { class: 'dock-row' }, buildIdleButton(), buildTouchBar())),
    h('div', { class: 'dock-mid' }, buildControlGroups(), buildPlacementBar()),
    h('div', { class: 'dock-right' }, buildAlerts())
  );

  return h('div', { id: 'hud-root', class: 'hud-root' }, h('div', { class: 'hud-vignette', 'aria-hidden': 'true' }), top, buildAgeBanner(), pausedBanner, dock, consoleEl);
}

function togglePause(): void {
  const scene = getScene();
  if (!scene || scene.isMultiplayer()) return;
  const paused = !scene.isPaused();
  scene.setPaused(paused);
  setLastEvent(paused ? 'paused' : 'resumed');
}

export function bindHudKeys(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || hasOpenLayer() || isTextEntryTarget(ev.target)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key.toLowerCase() === 'p') {
      ev.preventDefault();
      togglePause();
    }
  });
}

export function updatePausedBanner(paused: boolean): void {
  if (!pausedBanner) return;
  const show = paused && !hasOpenLayer();
  if (pausedBanner.hidden === show) pausedBanner.hidden = !show;
}
