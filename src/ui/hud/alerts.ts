/**
 * Alerts: heraldic toasts on the right edge for things that need attention
 * (under attack, building finished, age reached, research done, not enough
 * resources). Toasts with a location jump the camera on click; Space jumps
 * to the most recent located alert. Repeats within a short window stack a
 * counter instead of spamming new toasts.
 */

import type { GameScene } from '../../render/game-scene';
import { BUILDING_TABLE } from '../../sim/defs';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, plainDashes } from '../dom';
import { drainSceneAlerts, entityTile, getScene, type UiAlert } from '../game-bridge';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { onTrackerEvent } from '../match/tracker';

const MAX_TOASTS = 4;
const TTL: Record<UiAlert['kind'], number> = {
  attack: 8000,
  'building-complete': 5000,
  'unit-trained': 3500,
  'research-complete': 6000,
  'age-up': 7000,
  resources: 3000,
  info: 4500,
};
const ICON: Record<UiAlert['kind'], IconName> = {
  attack: 'alert',
  'building-complete': 'hammer',
  'unit-trained': 'person',
  'research-complete': 'research',
  'age-up': 'crown',
  resources: 'lock',
  info: 'info',
};

interface Toast {
  el: HTMLElement;
  alert: UiAlert;
  count: number;
  at: number;
  ttl: number;
  timer: number;
}

let stack: HTMLElement | null = null;
let live: HTMLElement | null = null;
const toasts: Toast[] = [];
let lastLocated: UiAlert | null = null;
let lastAttackAt = 0;
let lastAttackPos: { x: number; y: number } | null = null;
let lastAge = -1;
const researched = new Set<string>();
let techPrimed = false;
let lastTechCheck = 0;

export function buildAlerts(): HTMLElement {
  live = h('div', { class: 'live-region', role: 'status', 'aria-live': 'polite' });
  stack = h('div', { class: 'alert-stack', id: 'alert-stack', 'aria-label': 'Alerts' }, live);
  return stack;
}

function removeToast(t: Toast): void {
  window.clearTimeout(t.timer);
  const idx = toasts.indexOf(t);
  if (idx >= 0) toasts.splice(idx, 1);
  t.el.classList.add('is-leaving');
  window.setTimeout(() => t.el.remove(), 220);
}

function jumpTo(alert: UiAlert): void {
  const scene = getScene();
  if (!scene || alert.tileX === undefined || alert.tileY === undefined) return;
  scene.panToTile(alert.tileX, alert.tileY);
}

export function pushAlert(alert: UiAlert): void {
  if (!stack || appState.phase !== 'match') return;
  const now = performance.now();
  const same = toasts.find((t) => t.alert.kind === alert.kind && t.alert.text === alert.text && now - t.at < 4000);
  if (same) {
    same.count++;
    same.at = now;
    same.alert = alert;
    const badge = same.el.querySelector('.toast-count');
    if (badge) badge.textContent = `x${same.count}`;
    window.clearTimeout(same.timer);
    same.timer = window.setTimeout(() => removeToast(same), same.ttl);
    if (alert.tileX !== undefined) lastLocated = alert;
    return;
  }
  const located = alert.tileX !== undefined && alert.tileY !== undefined;
  const text = plainDashes(alert.text);
  const el = h(
    located ? 'button' : 'div',
    {
      type: located ? 'button' : null,
      class: `toast toast-${alert.kind}${located ? ' is-located' : ''}`,
      'aria-label': located ? `${text}. Jump to location.` : null,
    },
    h('span', { class: 'toast-seal', 'aria-hidden': 'true' }, icon(ICON[alert.kind])),
    h('span', { class: 'toast-text' }, text),
    h('span', { class: 'toast-count' }),
    located ? h('span', { class: 'toast-jump', 'aria-hidden': 'true' }, icon('eye')) : null
  );
  const ttl = TTL[alert.kind];
  const toast: Toast = { el, alert, count: 1, at: now, ttl, timer: 0 };
  if (located) {
    el.addEventListener('click', () => {
      jumpTo(toast.alert);
      removeToast(toast);
    });
    lastLocated = alert;
  }
  toast.timer = window.setTimeout(() => removeToast(toast), ttl);
  el.addEventListener('pointerenter', () => window.clearTimeout(toast.timer));
  el.addEventListener('pointerleave', () => {
    toast.timer = window.setTimeout(() => removeToast(toast), 1800);
  });
  toasts.push(toast);
  stack.append(el);
  while (toasts.length > MAX_TOASTS) removeToast(toasts[0]!);
  if (live) live.textContent = text;
}

export function jumpToLastAlert(): boolean {
  if (!lastLocated) return false;
  jumpTo(lastLocated);
  return true;
}

export function bindAlerts(): void {
  onTrackerEvent((ev, scene) => {
    if (ev.type === 'building-complete') {
      const name = BUILDING_TABLE[ev.defId]?.name ?? 'Building';
      const pos = entityTile(scene, ev.eid);
      pushAlert({ kind: 'building-complete', text: `${name} completed`, tileX: pos?.x, tileY: pos?.y });
    } else if (ev.type === 'under-attack') {
      const now = performance.now();
      const far = !lastAttackPos || Math.hypot(lastAttackPos.x - ev.x, lastAttackPos.y - ev.y) > 10;
      if (now - lastAttackAt > 15000 || (far && now - lastAttackAt > 4000)) {
        lastAttackAt = now;
        lastAttackPos = { x: ev.x, y: ev.y };
        pushAlert({ kind: 'attack', text: ev.isBuilding ? 'Your buildings are under attack!' : 'Your forces are under attack!', tileX: ev.x, tileY: ev.y });
      } else if (!far) {
        // Keep the jump target fresh while the same fight goes on.
        lastLocated = { kind: 'attack', text: '', tileX: ev.x, tileY: ev.y };
        lastAttackPos = { x: ev.x, y: ev.y };
      }
    }
  });

  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || hasOpenLayer() || isTextEntryTarget(ev.target)) return;
    if (ev.code === 'Space' && !ev.repeat) {
      if (jumpToLastAlert()) ev.preventDefault();
    }
  });
}

/** Poll scene state for age-ups, finished research and scene-provided alerts. */
export function updateAlerts(scene: GameScene, now: number): void {
  const fromScene = drainSceneAlerts(scene);
  if (fromScene) for (const a of fromScene) pushAlert(a);

  const me = scene.getPerspectivePlayerId();
  const age = scene.getAge(me);
  if (lastAge >= 0 && age.current > lastAge) {
    pushAlert({ kind: 'age-up', text: `${age.name} reached` });
  }
  lastAge = age.current;

  if (now - lastTechCheck > 500) {
    lastTechCheck = now;
    for (const node of scene.getTechTree(me)) {
      if (node.status !== 'researched') continue;
      if (!researched.has(node.id)) {
        researched.add(node.id);
        if (techPrimed && !/age$/i.test(node.name)) pushAlert({ kind: 'research-complete', text: `Research complete: ${node.name}` });
      }
    }
    techPrimed = true;
  }
}

export function resetAlerts(): void {
  for (const t of [...toasts]) removeToast(t);
  lastLocated = null;
  lastAttackAt = 0;
  lastAttackPos = null;
  lastAge = -1;
  researched.clear();
  techPrimed = false;
  lastTechCheck = 0;
}
