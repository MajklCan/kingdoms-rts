/**
 * Command grid (bottom right): a fixed 5x3 board of carved sockets. Each
 * action shows its icon, hotkey badge and queue count; disabled actions stay
 * focusable (aria-disabled) so a click or hover explains why. Rich tooltips
 * show cost (red where you are short), time, population and a description.
 * More than 15 actions page with a "more" socket.
 */

import type { GameScene } from '../../render/game-scene';
import { h, plainDashes, setAttr, setText } from '../dom';
import { missingResources, parseCost, parseMeta, type ResourceKey } from '../format';
import { actionDescription, actionIcon, actionKeyHint } from '../icons/catalog';
import { icon, setIcon } from '../icons/icon';
import { reportFailure } from '../game-bridge';
import { attachTip, refreshTip, type TipContent } from './tooltip';

type Action = ReturnType<GameScene['getAvailableActions']>[number];

const COLS = 5;
const ROWS = 3;
const CELLS = COLS * ROWS;

let grid: HTMLElement | null = null;
let cells: HTMLButtonElement[] = [];
let current: Action[] = [];
let lastSig = '';
let page = 0;
let activeScene: GameScene | null = null;

function bank(scene: GameScene): Record<ResourceKey, number> {
  return scene.getResources(scene.getPerspectivePlayerId()) as unknown as Record<ResourceKey, number>;
}

function tipFor(action: Action): TipContent {
  const scene = activeScene;
  const cost = parseCost(action.cost);
  const meta = parseMeta(action.meta);
  const b = scene ? bank(scene) : undefined;
  let disabled = action.enabled ? undefined : plainDashes(action.disabledReason ?? '');
  if (!action.enabled && !disabled) {
    const missing = b ? missingResources(cost, b) : [];
    disabled = missing.length > 0 ? `Not enough ${missing.join(' and ')}` : 'Not available right now';
  }
  const isTrain = action.kind === 'train';
  return {
    title: plainDashes(action.label),
    hotkey: action.key ? actionKeyHint(action.id, action.key) : undefined,
    body: actionDescription(action.id) || undefined,
    cost,
    bank: b,
    seconds: meta.seconds,
    pop: meta.pop,
    meta: meta.extra && meta.extra !== 'Research' ? plainDashes(meta.extra) : undefined,
    disabled,
    hint: isTrain && action.enabled ? 'Shift-click to queue five.' : undefined,
  };
}

function onCellClick(ev: MouseEvent, index: number): void {
  const scene = activeScene;
  if (!scene) return;
  const cell = cells[index]!;
  if (cell.dataset.more === '1') {
    page = (page + 1) % Math.ceil(current.length / (CELLS - 1));
    lastSig = '';
    updateCommandGrid(scene);
    return;
  }
  const action = actionAt(index);
  if (!action) return;
  if (!action.enabled) {
    // Same typed path as a refused hotkey: error sound, alert, and the
    // missing resources flash in the top bar.
    const missing = missingResources(parseCost(action.cost), bank(scene));
    // "Train Pikeman" reads as "Not enough food for Pikeman", like the hotkey path.
    const label = plainDashes(action.label);
    const subject = label.replace(/^(Train|Build|Research) /, '');
    if (missing.length > 0) reportFailure({ reason: 'resources', subject, missing });
    else if (/population/i.test(action.disabledReason ?? '')) reportFailure({ reason: 'population', subject });
    else reportFailure({ reason: 'unavailable', text: tipFor(action).disabled || `${label} is not available` });
    cell.classList.remove('is-denied');
    void cell.offsetWidth;
    cell.classList.add('is-denied');
    return;
  }
  scene.triggerAction(action.id, action.kind === 'train' && ev.shiftKey ? 5 : 1);
  cell.classList.remove('is-fired');
  void cell.offsetWidth;
  cell.classList.add('is-fired');
}

function pageSize(): number {
  return current.length > CELLS ? CELLS - 1 : CELLS;
}

function actionAt(index: number): Action | undefined {
  const size = pageSize();
  if (index >= size) return undefined;
  return current[page * size + index];
}

export function buildCommandGrid(): HTMLElement {
  grid = h('div', { class: 'cmd-grid', id: 'action-grid', role: 'toolbar', 'aria-label': 'Commands', 'aria-orientation': 'horizontal' });
  cells = [];
  for (let i = 0; i < CELLS; i++) {
    const cell = h(
      'button',
      { type: 'button', class: 'cmd-cell is-empty', tabindex: '-1', 'aria-hidden': 'true' },
      icon('info', 'cmd-icon'),
      h('span', { class: 'cmd-key' }),
      h('span', { class: 'cmd-queue' })
    );
    cell.addEventListener('click', (ev) => onCellClick(ev, i));
    attachTip(cell, () => {
      if (cell.dataset.more === '1') return { title: 'More commands', body: 'Show the next page of commands.' };
      const action = actionAt(i);
      return action ? tipFor(action) : null;
    });
    cells.push(cell);
    grid.append(cell);
  }
  // Arrow keys move between sockets like a toolbar.
  grid.addEventListener('keydown', (ev) => {
    const idx = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    const live = cells.map((c, i) => (c.classList.contains('is-empty') ? -1 : i)).filter((i) => i >= 0);
    let target = -1;
    if (ev.key === 'ArrowRight') target = live.find((i) => i > idx) ?? live[0] ?? -1;
    else if (ev.key === 'ArrowLeft') target = [...live].reverse().find((i) => i < idx) ?? live[live.length - 1] ?? -1;
    else if (ev.key === 'ArrowDown') target = live.find((i) => i >= idx + COLS) ?? -1;
    else if (ev.key === 'ArrowUp') target = [...live].reverse().find((i) => i <= idx - COLS) ?? -1;
    if (target < 0) return;
    ev.preventDefault();
    cells[target]!.focus();
  });
  return h('section', { class: 'console-commands frame-wood', 'aria-label': 'Commands' }, h('div', { class: 'cmd-inner inlay' }, grid));
}

export function updateCommandGrid(scene: GameScene): void {
  if (!grid) return;
  activeScene = scene;
  const actions = scene.getAvailableActions();
  const sig = actions.map((a) => a.id).join('|');
  current = actions;
  if (sig !== lastSig) {
    if (lastSig.split('|')[0] !== sig.split('|')[0]) page = 0;
    lastSig = sig;
    const pages = Math.max(1, Math.ceil(actions.length / pageSize()));
    if (page >= pages) page = 0;
  }
  const size = pageSize();
  // Build actions light up while their placement ghost is active.
  const buildMode = scene.getBuildMode().replace(/[\s-]+/g, '_');
  let firstFocusable = -1;
  cells.forEach((cell, i) => {
    const isMore = actions.length > CELLS && i === CELLS - 1;
    cell.dataset.more = isMore ? '1' : '';
    if (isMore) {
      cell.classList.remove('is-empty', 'is-disabled', 'is-active');
      cell.classList.add('is-more');
      setIcon(cell.querySelector<HTMLElement>('.cmd-icon')!, 'chevron-right');
      setText(cell.querySelector('.cmd-key'), '');
      setText(cell.querySelector('.cmd-queue'), `${page + 1}/${Math.ceil(actions.length / size)}`);
      setAttr(cell, 'aria-label', 'More commands');
      cell.removeAttribute('aria-hidden');
      cell.removeAttribute('aria-disabled');
      if (firstFocusable < 0) firstFocusable = i;
      return;
    }
    cell.classList.remove('is-more');
    const action = actionAt(i);
    if (!action) {
      cell.classList.add('is-empty');
      cell.classList.remove('is-disabled', 'is-active');
      cell.setAttribute('aria-hidden', 'true');
      cell.tabIndex = -1;
      setText(cell.querySelector('.cmd-key'), '');
      setText(cell.querySelector('.cmd-queue'), '');
      cell.removeAttribute('aria-label');
      cell.removeAttribute('data-action');
      return;
    }
    cell.classList.remove('is-empty');
    cell.removeAttribute('aria-hidden');
    cell.dataset.action = action.id;
    cell.dataset.kind = action.kind;
    setIcon(cell.querySelector<HTMLElement>('.cmd-icon')!, actionIcon(action.id));
    setText(cell.querySelector('.cmd-key'), action.key && action.key.length <= 3 ? action.key : '');
    setText(cell.querySelector('.cmd-queue'), action.queue ? String(action.queue) : '');
    cell.classList.toggle('is-disabled', !action.enabled);
    const placing = action.kind === 'build' && action.id.replace(/^build-/, '').replace(/-/g, '_') === buildMode;
    cell.classList.toggle('is-active', !!action.active || placing);
    setAttr(cell, 'aria-disabled', String(!action.enabled));
    if (action.active !== undefined) setAttr(cell, 'aria-pressed', String(!!action.active));
    else cell.removeAttribute('aria-pressed');
    setAttr(cell, 'aria-label', `${plainDashes(action.label)}${action.key ? `, hotkey ${action.key}` : ''}${action.enabled ? '' : ', unavailable'}`);
    if (firstFocusable < 0) firstFocusable = i;
  });
  // Roving tabindex: exactly one socket in the tab order.
  const focusedIdx = cells.indexOf(document.activeElement as HTMLButtonElement);
  cells.forEach((cell, i) => {
    const want = focusedIdx >= 0 && !cell.classList.contains('is-empty') ? i === focusedIdx : i === firstFocusable;
    cell.tabIndex = want ? 0 : -1;
  });
}

let tipTick = 0;
export function tickCommandTips(now: number): void {
  if (now - tipTick < 250) return;
  tipTick = now;
  refreshTip();
}

export function resetCommandGrid(): void {
  lastSig = '';
  page = 0;
}
