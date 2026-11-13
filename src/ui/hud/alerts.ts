/**
 * Alerts: heraldic toasts on the right edge for things that need attention
 * (under attack, building finished or lost, age reached, research done, not
 * enough resources, population capped). Everything comes typed from the
 * scene's alert feed (already rate-limited per fight); toasts with a location
 * jump the camera on click, Space jumps to the latest located alert (and
 * follows a fight that is still going on). Repeats within a short window
 * stack a counter instead of spamming new toasts. Refusals for missing
 * resources also flash those resources in the top bar.
 */

import type { GameScene } from '../../render/game-scene';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, plainDashes } from '../dom';
import {
  drainSceneAlerts,
  getScene,
  lastFightPosition,
  panToTile,
  type ResourceName,
  type TilePoint,
  type UiAlert,
  type UiAlertKind,
} from '../game-bridge';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { addMinimapPing } from './minimap';
import { flashMissingResources, flashPopulation } from './top-bar';

/** What a toast shows: a scene alert, or a UI-local notice (objectives, tech panel). */
export interface HudAlert {
  kind: UiAlertKind;
  text: string;
  at?: TilePoint;
  missing?: readonly ResourceName[];
}

const MAX_TOASTS = 4;
const TTL: Record<UiAlertKind, number> = {
  attack: 8000,
  'building-lost': 7000,
  'building-complete': 5000,
  'unit-trained': 3500,
  'research-complete': 6000,
  'age-up': 7000,
  resources: 3000,
  population: 4500,
  denied: 3000,
  info: 4500,
};
const ICON: Record<UiAlertKind, IconName> = {
  attack: 'alert',
  'building-lost': 'defeat',
  'building-complete': 'hammer',
  'unit-trained': 'person',
  'research-complete': 'research',
  'age-up': 'crown',
  resources: 'lock',
  population: 'pop',
  denied: 'stop',
  info: 'info',
};
/** Kinds that also ping the minimap. */
const PINGED: ReadonlySet<UiAlertKind> = new Set<UiAlertKind>(['attack', 'building-lost']);
/** Refusals of one kind say the same thing in different words (the pop-cap
 *  warning and a refused train order): the newest wording replaces the toast. */
const MERGED_BY_KIND: ReadonlySet<UiAlertKind> = new Set<UiAlertKind>(['population', 'resources']);

interface Toast {
  el: HTMLElement;
  alert: HudAlert;
  count: number;
  at: number;
  ttl: number;
  timer: number;
}

let stack: HTMLElement | null = null;
let live: HTMLElement | null = null;
const toasts: Toast[] = [];
let lastLocated: HudAlert | null = null;

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

function jumpTo(alert: HudAlert): void {
  const scene = getScene();
  if (!scene || !alert.at) return;
  // An attack alert follows the fight if it moved since the toast appeared.
  const target = alert.kind === 'attack' ? (lastFightPosition(scene) ?? alert.at) : alert.at;
  panToTile(scene, target.x, target.y);
}

export function pushAlert(alert: HudAlert): void {
  if (!stack || appState.phase !== 'match') return;
  if (alert.missing && alert.missing.length > 0) flashMissingResources(alert.missing);
  if (alert.kind === 'population') flashPopulation();
  if (alert.at && PINGED.has(alert.kind)) addMinimapPing(alert.at, alert.kind === 'attack' ? 'attack' : 'loss');
  const now = performance.now();
  const same = toasts.find(
    (t) =>
      t.alert.kind === alert.kind &&
      (MERGED_BY_KIND.has(alert.kind) || t.alert.text === alert.text) &&
      now - t.at < 4000
  );
  if (same) {
    same.count++;
    same.at = now;
    same.alert = alert;
    const textEl = same.el.querySelector('.toast-text');
    if (textEl) textEl.textContent = plainDashes(alert.text);
    const badge = same.el.querySelector('.toast-count');
    if (badge) badge.textContent = `x${same.count}`;
    window.clearTimeout(same.timer);
    same.timer = window.setTimeout(() => removeToast(same), same.ttl);
    if (alert.at) lastLocated = alert;
    return;
  }
  const located = alert.at !== undefined;
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
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || hasOpenLayer() || isTextEntryTarget(ev.target)) return;
    if (ev.code === 'Space' && !ev.repeat) {
      if (jumpToLastAlert()) ev.preventDefault();
    }
  });
}

function toHudAlert(alert: UiAlert): HudAlert {
  return {
    kind: alert.kind,
    text: alert.text,
    ...(alert.at ? { at: alert.at } : {}),
    ...(alert.missing ? { missing: alert.missing } : {}),
  };
}

/** Show the alerts the scene raised since the last frame. */
export function updateAlerts(scene: GameScene): void {
  for (const alert of drainSceneAlerts(scene)) pushAlert(toHudAlert(alert));
}

export function resetAlerts(): void {
  for (const t of [...toasts]) removeToast(t);
  lastLocated = null;
}
