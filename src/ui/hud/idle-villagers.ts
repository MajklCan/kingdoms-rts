/**
 * Idle villager button: shows how many of your villagers stand around with
 * nothing to do. Click it (or press .) to select the next one and centre the
 * camera on them, cycling through the idle list in a stable order (the list
 * is re-read each time, so villagers that went back to work drop out).
 */

import type { GameScene } from '../../render/game-scene';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, setAttr, setText } from '../dom';
import { entityTile, getIdleVillagers, getScene, panToTile, selectEntities } from '../game-bridge';
import { icon } from '../icons/icon';
import { attachTip } from './tooltip';

let btn: HTMLButtonElement | null = null;
let countEl: HTMLElement | null = null;
/** Last villager we jumped to; the next press continues after it. */
let lastVisited = -1;
let lastCheck = 0;
let idle: number[] = [];

function selectNext(): void {
  const scene = getScene();
  if (!scene) return;
  idle = getIdleVillagers(scene, scene.getPerspectivePlayerId());
  if (idle.length === 0) return;
  // The list is in ascending entity order: take the first after the last one
  // visited, wrapping around.
  const eid = idle.find((e) => e > lastVisited) ?? idle[0]!;
  lastVisited = eid;
  selectEntities(scene, [eid]);
  const at = entityTile(scene, eid);
  if (at) panToTile(scene, at.x, at.y);
}

export function buildIdleButton(): HTMLElement {
  countEl = h('span', { class: 'idle-count' }, '0');
  btn = h(
    'button',
    { type: 'button', class: 'idle-btn', id: 'idle-villager', 'aria-keyshortcuts': '.', 'aria-disabled': 'true' },
    icon('idle', 'idle-icon'),
    countEl
  );
  btn.addEventListener('click', () => {
    if (btn!.getAttribute('aria-disabled') !== 'true') selectNext();
  });
  attachTip(btn, () => ({
    title: 'Idle villagers',
    hotkey: '.',
    body: idle.length > 0 ? `${idle.length} villager${idle.length === 1 ? ' is' : 's are'} idle. Click to find the next one.` : 'Every villager is at work.',
  }));
  return btn;
}

export function bindIdleVillagers(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || hasOpenLayer() || isTextEntryTarget(ev.target)) return;
    if (ev.key === '.' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      selectNext();
    }
  });
}

export function updateIdleVillagers(scene: GameScene, now: number): void {
  if (!btn || now - lastCheck < 300) return;
  lastCheck = now;
  idle = getIdleVillagers(scene, scene.getPerspectivePlayerId());
  const n = idle.length;
  setText(countEl, String(n));
  setAttr(btn, 'aria-disabled', String(n === 0));
  setAttr(btn, 'aria-label', `Idle villagers: ${n}`);
  btn.classList.toggle('has-idle', n > 0);
}

export function resetIdleVillagers(): void {
  lastVisited = -1;
  idle = [];
}
