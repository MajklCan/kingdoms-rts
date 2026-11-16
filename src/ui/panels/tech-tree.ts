/**
 * Technology tree: a radial chart on parchment. The realm's emblem sits in
 * the middle and research spreads outward from it as round seals joined by
 * branch-coloured links; ages are the big seals. Seals show icon, name,
 * cost (red where short) and status (locked, ready, researching with a
 * progress ring, done). The board scales to fit the dialog. Opens from the
 * top bar or the K key; arrow keys move between seals.
 *
 * Geometry lives in tech-tree-layout.ts, markup in tech-tree-view.ts.
 */

import type { GameScene } from '../../render/game-scene';
import { AgeId } from '../../sim/defs';
import { TechId, type TechIdValue } from '../../sim/tech-tree';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, plainDashes } from '../dom';
import { missingResources, parseCost } from '../format';
import { getScene, reportFailure } from '../game-bridge';
import { pushAlert } from '../hud/alerts';
import { attachTip } from '../hud/tooltip';
import { setPanelExpanded } from '../hud/top-bar';
import { createModal, type Modal } from './modal';
import { COMPACT_ASPECT, layoutTechTree, neighbourInDirection, type Direction, type TechLayout } from './tech-tree-layout';
import { ageName, boardHtml, statusLabel, type Bank, type TechNode } from './tech-tree-view';

const LEGEND: Array<[branch: string, label: string]> = [
  ['military', 'military'],
  ['economy', 'economy'],
  ['food', 'food'],
  ['housing', 'housing'],
  ['age', 'ages'],
];

const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** The board may grow a little past its design size on roomy screens. */
const MAX_SCALE = 1.2;

let modal: Modal | null = null;
let board: HTMLElement | null = null;
let fit: HTMLElement | null = null;
let layout: TechLayout | null = null;
let lastSig = '';
/** Tech the panel was opened for (locked age button, age plaque): it and its missing research are marked. */
let goalId: TechIdValue | null = null;
let goalNote: HTMLElement | null = null;

function bankOf(scene: GameScene): Bank {
  return scene.getResources(scene.getPerspectivePlayerId()) as unknown as Bank;
}

/** A very wide, short dialog (phone landscape) gets the compact chart. */
function wantsCompact(): boolean {
  return !!fit && fit.clientHeight > 0 && fit.clientWidth / fit.clientHeight > COMPACT_ASPECT;
}

/** The dialog changed size: pick the shape that suits it, then scale to fit. */
function onResize(): void {
  const scene = getScene();
  if (scene) renderTechTree(scene);
  fitBoard();
}

function fitBoard(): void {
  if (!fit || !board || !layout || !modal?.isOpen()) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const availW = fit.clientWidth;
  const availH = fit.clientHeight;
  if (availW <= 0 || availH <= 0) return;
  const w = layout.width * rem;
  const hgt = layout.height * rem;
  const scale = Math.min(MAX_SCALE, availW / w, availH / hgt);
  board.style.transform = `translate(${Math.max(0, (availW - w * scale) / 2).toFixed(1)}px, ${Math.max(0, (availH - hgt * scale) / 2).toFixed(1)}px) scale(${scale.toFixed(4)})`;
}

function onBoardClick(ev: MouseEvent): void {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-tech-id]');
  const scene = getScene();
  if (!btn || !scene) return;
  const node = scene.getTechTree(scene.getPerspectivePlayerId()).find((n) => n.id === btn.dataset.techId);
  if (!node) return;
  if (node.status !== 'available') {
    pushAlert({ kind: 'info', text: node.status === 'locked' ? `${node.name} is still locked` : `${node.name}: ${statusLabel(node)}` });
    return;
  }
  if (!node.affordable) {
    reportFailure({ reason: 'resources', subject: node.name, missing: missingResources(parseCost(node.cost), bankOf(scene)) });
    return;
  }
  scene.researchTech(node.id, scene.getPerspectivePlayerId());
  lastSig = '';
  renderTechTree(scene);
}

/** Arrow keys walk the chart: focus moves to the nearest seal that way. */
function onBoardKey(ev: KeyboardEvent): void {
  const direction = ARROW_KEYS[ev.key];
  const fromId = (ev.target as HTMLElement).closest<HTMLElement>('[data-tech-id]')?.dataset.techId;
  if (!direction || !fromId || !layout || !board) return;
  ev.preventDefault();
  ev.stopPropagation();
  const next = neighbourInDirection(layout.nodes, fromId, direction);
  if (next) board.querySelector<HTMLElement>(`[data-tech-id="${next}"]`)?.focus({ preventScroll: true });
}

function ensureModal(): Modal {
  if (modal) return modal;
  modal = createModal({
    id: 'tech-tree-panel',
    eyebrow: 'Scholars of the realm',
    title: 'Technology',
    className: 'modal-tech',
    onOpen: () => setPanelExpanded('tech', true),
    onClose: () => {
      goalId = null;
      setPanelExpanded('tech', false);
    },
  });
  board = h('div', { class: 'tech-board', id: 'tech-tree-board' });
  fit = h('div', { class: 'tech-fit' }, board);
  const legend = h(
    'div',
    { class: 'tech-legend', 'aria-hidden': 'true' },
    ...LEGEND.map(([branch, label]) => h('span', { class: `legend-item ${branch}` }, h('i'), label)),
    h('span', { class: 'legend-item legend-age' }, h('b', null, 'II'), 'needs that age')
  );
  goalNote = h('p', { class: 'tech-goal', role: 'status' });
  goalNote.hidden = true;
  modal.body.append(fit);
  modal.foot.append(goalNote, legend);
  board.addEventListener('click', onBoardClick);
  board.addEventListener('keydown', onBoardKey);
  new ResizeObserver(onResize).observe(fit);
  return modal;
}

/** Why a locked seal is locked, in the player's words. */
function lockReason(node: TechNode, byId: Map<string, TechNode>, currentAge: number): string {
  const open = (id: string): boolean => byId.get(id)?.status !== 'researched';
  const names = (ids: readonly string[]): string => ids.map((id) => byId.get(id)?.name ?? id).join(' and ');
  const needs: string[] = [];
  const missing = node.requires.filter((id) => byId.has(id) && open(id));
  if (missing.length > 0) needs.push(names(missing));
  if (node.requiresAny.length > 0 && !node.requiresAny.some((group) => !group.some(open))) {
    needs.push(node.requiresAny.map((group) => names(group.filter(open))).join(', or '));
  }
  if (node.requiresAge > currentAge) needs.push(ageName(node.requiresAge));
  return needs.length > 0 ? `Requires ${needs.join('; ')}` : 'Not available in this mission';
}

function attachTips(byId: Map<string, TechNode>): void {
  if (!board) return;
  for (const btn of board.querySelectorAll<HTMLElement>('[data-tech-id]')) {
    attachTip(btn, () => {
      const s = getScene();
      const node = s?.getTechTree(s.getPerspectivePlayerId()).find((x) => x.id === btn.dataset.techId);
      if (!s || !node) return null;
      const bank = bankOf(s);
      const cost = parseCost(node.cost);
      return {
        title: node.name,
        body: plainDashes(node.description),
        cost,
        bank,
        meta: node.unlocks.length ? `Unlocks: ${node.unlocks.join(', ')}` : undefined,
        disabled:
          node.status === 'locked'
            ? lockReason(node, byId, s.getAge(s.getPerspectivePlayerId()).current)
            : node.status === 'available' && !node.affordable
              ? `Not enough ${missingResources(cost, bank).join(' and ')}`
              : undefined,
        hint: node.status === 'available' && node.affordable ? 'Click to research' : undefined,
      };
    });
  }
  const emblem = board.querySelector<HTMLElement>('#tech-emblem');
  if (emblem) {
    attachTip(emblem, () => {
      const s = getScene();
      if (!s) return null;
      return {
        title: ageName(s.getAge(s.getPerspectivePlayerId()).current),
        body: 'Your realm. It starts with lumber huts and stone mines; research spreads outward from here.',
      };
    });
  }
}

export function renderTechTree(scene: GameScene): void {
  if (!modal?.isOpen() || !board) return;
  const playerId = scene.getPerspectivePlayerId();
  const nodes = scene.getTechTree(playerId);
  const bank = bankOf(scene);
  const currentAge = scene.getAge(playerId).current;
  const compact = wantsCompact();
  const sig =
    `${playerId}|${goalId ?? ''}|${currentAge}|${compact ? 'c' : 'r'}|` +
    nodes.map((n) => `${n.id}:${n.status}:${n.affordable ? 1 : 0}:${Math.floor(n.progressFrac * 100)}`).join('|') +
    // Costs only change colour when a resource crosses a price, so the bank itself is not in the signature.
    `|${nodes.map((n) => missingResources(parseCost(n.cost), bank).join(',')).join(';')}`;
  if (sig === lastSig) return;
  lastSig = sig;

  const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.techId;
  const byId = new Map<string, TechNode>();
  for (const n of nodes) byId.set(n.id, n);
  const goal = goalId ? byId.get(goalId) : undefined;
  // Once the goal is open, the other path no longer matters: only a locked goal marks its paths.
  const pathIds = goal?.status === 'locked' ? goalPathIds(goal, byId) : new Set<string>();
  renderGoalNote(goal, byId);

  layout = layoutTechTree(nodes, compact);
  board.classList.toggle('is-compact', compact);
  board.style.width = `${layout.width}rem`;
  board.style.height = `${layout.height}rem`;
  board.innerHTML = boardHtml(layout, nodes, bank, currentAge, { goal, pathIds });
  attachTips(byId);
  fitBoard();
  if (focusedId) board.querySelector<HTMLElement>(`[data-tech-id="${focusedId}"]`)?.focus({ preventScroll: true });
}

/** Unresearched research on any path to `goal` (one level: what it requires). */
function goalPathIds(goal: TechNode, byId: Map<string, TechNode>): Set<string> {
  const ids = new Set<string>();
  for (const id of [...goal.requires, ...goal.requiresAny.flat()]) {
    if (byId.get(id)?.status !== 'researched') ids.add(id);
  }
  return ids;
}

/** "Castle Age needs one path: Barracks ✓ then Archers, or Lumber Crews then Mining Crews." */
function renderGoalNote(goal: TechNode | undefined, byId: Map<string, TechNode>): void {
  if (!goalNote) return;
  if (!goal || goal.status !== 'locked') {
    goalNote.hidden = !goal;
    goalNote.textContent = goal ? `${goal.name}: ${statusLabel(goal).toLowerCase()}. Advance it at the Town Center.` : '';
    return;
  }
  const name = (id: TechIdValue): string => {
    const n = byId.get(id);
    return n ? `${n.name}${n.status === 'researched' ? ' ✓' : ''}` : id;
  };
  const paths = goal.requiresAny.length > 0
    ? goal.requiresAny.map((group) => [...goal.requires, ...group].map(name).join(' then '))
    : [goal.requires.map(name).join(' then ')];
  goalNote.hidden = false;
  goalNote.textContent = `${goal.name} needs ${paths.length > 1 ? 'one research path' : 'this research'} first: ${paths.join(', or ')}.`;
}

/**
 * Open the panel. With `goal`, that tech and the research it still needs
 * are marked, and focus lands on the first research you can start for it.
 */
export function openTechTree(goal?: TechIdValue): void {
  const scene = getScene();
  if (!scene) return;
  const m = ensureModal();
  goalId = goal ?? null;
  if (!m.isOpen()) m.open();
  lastSig = '';
  renderTechTree(scene);
  requestAnimationFrame(fitBoard);
  const first =
    board?.querySelector<HTMLElement>('.tech-node.is-path.is-available, .tech-node.is-goal.is-available') ??
    board?.querySelector<HTMLElement>('.tech-node.is-available, .tech-node');
  first?.focus({ preventScroll: true });
}

/** Open the panel on the next age: what it costs and the research it needs. */
export function openTechTreeForNextAge(): void {
  const scene = getScene();
  if (!scene) return;
  const age = scene.getAge(scene.getPerspectivePlayerId()).current;
  const goal = age === AgeId.DARK ? TechId.CASTLE_AGE : age === AgeId.CASTLE ? TechId.GUNPOWDER_AGE : undefined;
  openTechTree(goal);
}

export function toggleTechTree(): void {
  if (modal?.isOpen()) modal.close();
  else openTechTree();
}

export function bindTechTreeKey(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || isTextEntryTarget(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key.toLowerCase() !== 'k') return;
    if (hasOpenLayer() && !modal?.isOpen()) return;
    ev.preventDefault();
    toggleTechTree();
  });
}

