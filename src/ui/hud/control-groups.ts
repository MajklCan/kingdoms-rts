/**
 * Control groups: Ctrl+1..9 stores the selection (Alt+1..9 does the same,
 * since Windows browsers take Ctrl+number for tab switching), Shift+1..9
 * adds to a group, 1..9 recalls it and a quick double tap jumps the camera
 * there.
 * The strip above the selection panel shows every stored group with its
 * dominant unit and head count; click recalls, double click jumps.
 * Nine fixed slots (empty ones invisible) keep the layout from shifting.
 */

import type { GameScene } from '../../render/game-scene';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, setText } from '../dom';
import {
  centroidOf,
  entityKindKey,
  filterOwnedAlive,
  getScene,
  getSelectedEids,
  panToTile,
  selectEntities,
} from '../game-bridge';
import { BUILDING_ICON_BY_DEF, UNIT_ICON_BY_DEF } from '../icons/catalog';
import { icon, setIcon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { logLine } from './event-log';
import { attachTip } from './tooltip';

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const DOUBLE_TAP_MS = 350;

const groups = new Map<number, number[]>();
const slotEls = new Map<number, HTMLButtonElement>();
let lastTap: { n: number; at: number } | null = null;
let lastSig = '';

function dominantIcon(scene: GameScene, eids: number[]): IconName {
  const counts = new Map<string, number>();
  for (const eid of eids) {
    const k = entityKindKey(scene, eid);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  if (best.startsWith('u')) return UNIT_ICON_BY_DEF[Number(best.slice(1))] ?? 'person';
  if (best.startsWith('b')) return BUILDING_ICON_BY_DEF[Number(best.slice(1))] ?? 'house';
  return 'banners';
}

function recall(n: number, jump: boolean): void {
  const scene = getScene();
  if (!scene) return;
  const me = scene.getPerspectivePlayerId();
  const alive = filterOwnedAlive(scene, groups.get(n) ?? [], me);
  if (alive.length === 0) {
    groups.delete(n);
    return;
  }
  groups.set(n, alive);
  selectEntities(scene, alive);
  if (jump) {
    const c = centroidOf(scene, alive);
    if (c) panToTile(scene, c.x, c.y);
  }
}

export function buildControlGroups(): HTMLElement {
  const strip = h('div', { class: 'cg-strip', role: 'group', 'aria-label': 'Control groups' });
  for (const n of SLOTS) {
    const slot = h(
      'button',
      { type: 'button', class: 'cg-slot', 'data-group': n, tabindex: '-1' },
      h('span', { class: 'cg-num' }, String(n)),
      icon('person', 'cg-icon'),
      h('span', { class: 'cg-count' })
    );
    slot.addEventListener('click', () => recall(n, false));
    slot.addEventListener('dblclick', () => recall(n, true));
    attachTip(slot, () =>
      groups.has(n)
        ? { title: `Group ${n}`, hotkey: String(n), body: `${groups.get(n)!.length} units. Press ${n} to select, twice to jump there.` }
        : null
    );
    slotEls.set(n, slot);
    strip.append(slot);
  }
  return strip;
}

export function bindControlGroups(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || hasOpenLayer() || isTextEntryTarget(ev.target)) return;
    const m = /^Digit([1-9])$/.exec(ev.code);
    if (!m) return;
    const n = Number(m[1]);
    const scene = getScene();
    if (!scene) return;
    const me = scene.getPerspectivePlayerId();
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      ev.preventDefault();
      const sel = filterOwnedAlive(scene, getSelectedEids(scene), me);
      if (sel.length === 0) {
        groups.delete(n);
        logLine(`Group ${n} cleared`);
      } else {
        groups.set(n, sel);
        logLine(`Group ${n} set (${sel.length})`);
      }
      return;
    }
    if (ev.shiftKey) {
      ev.preventDefault();
      const sel = filterOwnedAlive(scene, getSelectedEids(scene), me);
      const merged = Array.from(new Set([...(groups.get(n) ?? []), ...sel]));
      if (merged.length > 0) groups.set(n, merged);
      return;
    }
    if (ev.repeat) return;
    const now = performance.now();
    const jump = lastTap !== null && lastTap.n === n && now - lastTap.at < DOUBLE_TAP_MS;
    lastTap = { n, at: now };
    recall(n, jump);
  });
}

export function updateControlGroups(scene: GameScene): void {
  const me = scene.getPerspectivePlayerId();
  let sig = '';
  for (const n of SLOTS) {
    const eids = groups.get(n);
    if (!eids) continue;
    const alive = filterOwnedAlive(scene, eids, me);
    if (alive.length !== eids.length) {
      if (alive.length === 0) groups.delete(n);
      else groups.set(n, alive);
    }
    sig += `${n}:${alive.length};`;
  }
  if (sig === lastSig) return;
  lastSig = sig;
  for (const n of SLOTS) {
    const slot = slotEls.get(n)!;
    const eids = groups.get(n);
    const on = !!eids && eids.length > 0;
    slot.classList.toggle('is-set', on);
    slot.tabIndex = on ? 0 : -1;
    slot.setAttribute('aria-hidden', String(!on));
    if (on) {
      setIcon(slot.querySelector<HTMLElement>('.cg-icon')!, dominantIcon(scene, eids!));
      setText(slot.querySelector('.cg-count'), String(eids!.length));
      slot.setAttribute('aria-label', `Group ${n}, ${eids!.length} units`);
    }
  }
}

export function resetControlGroups(): void {
  groups.clear();
  lastSig = '';
  lastTap = null;
}
