/**
 * Technology panel: the ring chart. The settlement's medallion sits in the
 * middle, five research paths run outward through the ring bands (I Dark
 * Age, II Castle Age, III Gunpowder Age), and a ring opens once two paths
 * are complete in the ring before it. Seals show icon, name, cost (red
 * where short) and state (locked, ready, done); research is instant.
 *
 * The chart is drawn at a comfortable size and is larger than the dialog:
 * drag to move over it (mouse or finger), zoom with the wheel, a pinch, the
 * buttons or + and -. It opens centred on the settlement, or on the goal.
 * Opens from the top bar or the K key; arrow keys move between seals and
 * the chart follows the focus.
 *
 * Geometry lives in tech-tree-layout.ts, markup in tech-tree-view.ts, the
 * ring rules and goal marks in tech-tree-rings.ts, the pan and zoom math in
 * tech-tree-viewport.ts.
 */

import type { GameScene } from '../../render/game-scene';
import type { TechIdValue } from '../../sim/tech-tree';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, plainDashes } from '../dom';
import { missingResources, parseCost } from '../format';
import { getScene, reportFailure } from '../game-bridge';
import { pushAlert } from '../hud/alerts';
import { attachTip } from '../hud/tooltip';
import { setPanelExpanded } from '../hud/top-bar';
import { icon } from '../icons/icon';
import { createModal, type Modal } from './modal';
import { layoutTechTree, neighbourInDirection, type Direction, type PlacedNode, type TechLayout } from './tech-tree-layout';
import {
  lockReason,
  NO_GOAL,
  pathName,
  ringEra,
  ringGoalMarks,
  ringNumeral,
  techGoalMarks,
  type GoalMarks,
  type TechNode,
  type TechRings,
} from './tech-tree-rings';
import { boardHtml, counterText, layoutInput, type Bank } from './tech-tree-view';
import { centreOn, clampView, openZoom, panBy, reveal, zoomAt, type Extent, type View } from './tech-tree-viewport';

const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** A press that moves this far (px) is a drag, not a click. */
const DRAG_THRESHOLD = 6;
const ZOOM_STEP = 1.25;
/** Window kept around a seal the focus moves to (px). */
const REVEAL_PAD = 28;

/** What the panel was opened for: nothing, one research, or the next ring. */
type Goal = { kind: 'none' } | { kind: 'tech'; id: string } | { kind: 'ring' };

let modal: Modal | null = null;
let board: HTMLElement | null = null;
/** The window onto the chart. */
let fit: HTMLElement | null = null;
let layout: TechLayout | null = null;
let lastSig = '';
let goal: Goal = { kind: 'none' };
let goalNote: HTMLElement | null = null;
let view: View = { zoom: 1, x: 0, y: 0 };
/** The next render places the view afresh (the panel was just opened). */
let needsOpenView = false;

interface TechState {
  nodes: TechNode[];
  rings: TechRings;
  bank: Bank;
}

function readTech(scene: GameScene): TechState {
  const playerId = scene.getPerspectivePlayerId();
  return { nodes: scene.getTechTree(playerId), rings: scene.getTechRings(playerId), bank: scene.getResources(playerId) };
}

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function extent(): Extent | null {
  if (!fit || !layout || fit.clientWidth <= 0 || fit.clientHeight <= 0) return null;
  const rem = remPx();
  return { boardW: layout.width * rem, boardH: layout.height * rem, viewW: fit.clientWidth, viewH: fit.clientHeight };
}

/** Show `next`; `glide` eases there (keyboard and buttons), a drag or pinch follows the finger at once. */
function setView(next: View, glide = false): void {
  view = next;
  if (!board) return;
  board.classList.toggle('is-gliding', glide);
  board.style.transform = `translate(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px) scale(${view.zoom.toFixed(4)})`;
}

/** The chart rectangle (px at zoom 1) a seal and its label take. */
function sealRect(node: PlacedNode): { x: number; y: number; w: number; h: number } {
  const rem = remPx();
  const x0 = Math.min(node.x - node.r, node.label.x0);
  const y0 = Math.min(node.y - node.r, node.label.y0);
  const x1 = Math.max(node.x + node.r, node.label.x1);
  const y1 = Math.max(node.y + node.r, node.label.y1);
  return { x: x0 * rem, y: y0 * rem, w: (x1 - x0) * rem, h: (y1 - y0) * rem };
}

/**
 * Where the chart opens: on the settlement, or in goal mode on the marked
 * research. If all of it fits the window it is centred as a group; if not,
 * the window opens on the research to start with (the first that is open,
 * else the goal itself).
 */
function openView(marks: GoalMarks, glide = false): void {
  const e = extent();
  if (!e || !layout) return;
  const rem = remPx();
  // The first ring should fill the window's height where the window allows it.
  const zoom = openZoom(e, (layout.bands[0]?.r ?? layout.centre.well) * 2 * rem);
  const wanted = layout.nodes.filter((n) => n.id === marks.goalId || marks.pathIds.has(n.id));
  let target = { x: layout.centre.x * rem, y: layout.centre.y * rem };
  if (wanted.length > 0) {
    const rects = wanted.map(sealRect);
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w));
    const y1 = Math.max(...rects.map((r) => r.y + r.h));
    const fits = (x1 - x0) * zoom <= e.viewW - 2 * REVEAL_PAD && (y1 - y0) * zoom <= e.viewH - 2 * REVEAL_PAD;
    const firstId = board?.querySelector<HTMLElement>('.tech-node.is-path.is-available, .tech-node.is-goal.is-available')?.dataset.techId ?? marks.goalId;
    const first = wanted.find((n) => n.id === firstId) ?? wanted[0]!;
    target = fits ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: first.x * rem, y: first.y * rem };
  }
  setView(centreOn(e, zoom, target.x, target.y), glide);
}

/** The dialog changed size: keep what is in the middle of the window in the middle. */
function onResize(): void {
  const e = extent();
  if (!e) return;
  if (needsOpenView) {
    const scene = getScene();
    if (scene) renderTechTree(scene);
    return;
  }
  setView(clampView(view, e));
}

function zoomBy(factor: number): void {
  const e = extent();
  if (e) setView(zoomAt(view, e, factor, e.viewW / 2, e.viewH / 2), true);
}

function recentre(): void {
  const scene = getScene();
  if (scene) openView(marksFor(readTech(scene)), true);
}

// --- Drag to pan, pinch and wheel to zoom ---------------------------------------

const pointers = new Map<number, { x: number; y: number }>();
let dragMoved = false;
let pressAt: { x: number; y: number } | null = null;
let pinchDist = 0;
/** A drag just ended: the click that follows it is not a click on a seal. */
let swallowClick = false;

function localPoint(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const box = fit!.getBoundingClientRect();
  return { x: ev.clientX - box.left, y: ev.clientY - box.top };
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) {
    pressAt = { x: ev.clientX, y: ev.clientY };
    dragMoved = false;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    dragMoved = true;
  }
}

function onPointerMove(ev: PointerEvent): void {
  const last = pointers.get(ev.pointerId);
  const e = extent();
  if (!last || !e || !fit) return;
  const dx = ev.clientX - last.x;
  const dy = ev.clientY - last.y;
  if (pointers.size === 1) {
    if (!dragMoved && pressAt && Math.hypot(ev.clientX - pressAt.x, ev.clientY - pressAt.y) < DRAG_THRESHOLD) return;
    if (!dragMoved) {
      dragMoved = true;
      fit.classList.add('is-dragging');
      fit.setPointerCapture(ev.pointerId);
    }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    setView(panBy(view, e, dx, dy));
    return;
  }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = localPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    // The moving finger carries half of the pair's midpoint with it.
    const moved = panBy(view, e, dx / 2, dy / 2);
    setView(pinchDist > 0 ? zoomAt(moved, e, dist / pinchDist, mid.x, mid.y) : moved);
    pinchDist = dist;
  }
}

function onPointerEnd(ev: PointerEvent): void {
  if (!pointers.delete(ev.pointerId)) return;
  if (pointers.size > 0) return;
  fit?.classList.remove('is-dragging');
  if (dragMoved) {
    swallowClick = true;
    // A drag that ends outside any seal produces no click to swallow.
    window.setTimeout(() => (swallowClick = false), 0);
  }
  pressAt = null;
}

function onClickCapture(ev: MouseEvent): void {
  if (!swallowClick) return;
  swallowClick = false;
  ev.stopPropagation();
  ev.preventDefault();
}

function onWheel(ev: WheelEvent): void {
  const e = extent();
  if (!e) return;
  ev.preventDefault();
  const p = localPoint(ev);
  // A pinch on a trackpad arrives as a ctrl-wheel with small deltas.
  setView(zoomAt(view, e, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)), p.x, p.y));
}

/** Focus moved to a seal (Tab, arrow keys, opening on a goal): bring it into the window. */
function onFocusIn(ev: FocusEvent): void {
  const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-tech-id]')?.dataset.techId;
  const node = layout?.nodes.find((n) => n.id === id);
  const e = extent();
  // A press on a seal focuses it too; the chart must not slide away under the pointer.
  if (!node || !e || pointers.size > 0) return;
  const next = reveal(view, e, sealRect(node), REVEAL_PAD);
  if (next.x !== view.x || next.y !== view.y) setView(next, true);
}

function onBoardClick(ev: MouseEvent): void {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-tech-id]');
  const scene = getScene();
  if (!btn || !scene) return;
  const { nodes, rings, bank } = readTech(scene);
  const node = nodes.find((n) => n.id === btn.dataset.techId);
  if (!node) return;
  if (node.status === 'researched') {
    pushAlert({ kind: 'info', text: `${node.name} is already researched` });
    return;
  }
  if (node.status !== 'available') {
    pushAlert({ kind: 'info', text: `${node.name}: ${lockReason(node, nodes, rings)}` });
    return;
  }
  if (!node.affordable) {
    reportFailure({ reason: 'resources', subject: node.name, missing: missingResources(parseCost(node.cost), bank) });
    return;
  }
  scene.researchTech(node.id as TechIdValue, scene.getPerspectivePlayerId());
  // Research is instant: show the new state in this same frame.
  lastSig = '';
  renderTechTree(scene);
}

/** + and - zoom, 0 returns to the opening view. */
function onDialogKey(ev: KeyboardEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === '+' || ev.key === '=') zoomBy(ZOOM_STEP);
  else if (ev.key === '-' || ev.key === '_') zoomBy(1 / ZOOM_STEP);
  else if (ev.key === '0') recentre();
  else return;
  ev.preventDefault();
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
      goal = { kind: 'none' };
      setPanelExpanded('tech', false);
    },
  });
  board = h('div', { class: 'tech-board', id: 'tech-tree-board' });
  fit = h('div', { class: 'tech-fit' }, board);
  const zoomButton = (name: 'plus' | 'minus', label: string, factor: number): HTMLElement => {
    const btn = h('button', { type: 'button', class: 'tech-tool', 'aria-label': label, title: label }, icon(name));
    btn.addEventListener('click', () => zoomBy(factor));
    return btn;
  };
  const centreBtn = h('button', { type: 'button', class: 'tech-tool tech-tool-text', title: 'Back to the opening view (0)' }, 'Centre');
  centreBtn.addEventListener('click', recentre);
  const tools = h(
    'div',
    { class: 'tech-tools', role: 'group', 'aria-label': 'Chart view' },
    zoomButton('minus', 'Zoom out (-)', 1 / ZOOM_STEP),
    zoomButton('plus', 'Zoom in (+)', ZOOM_STEP),
    centreBtn
  );
  const legend = h(
    'div',
    { class: 'tech-legend', 'aria-hidden': 'true' },
    h('span', { class: 'legend-item' }, 'Drag to move, scroll or pinch to zoom'),
    h('span', { class: 'legend-item legend-gate' }, h('i'), 'path complete in that ring'),
    h('span', { class: 'legend-item' }, 'two complete paths open the next ring')
  );
  goalNote = h('p', { class: 'tech-goal', role: 'status' });
  goalNote.hidden = true;
  modal.body.append(h('div', { class: 'tech-stage' }, fit, tools));
  modal.foot.append(goalNote, legend);
  board.addEventListener('click', onBoardClick);
  board.addEventListener('keydown', onBoardKey);
  board.addEventListener('focusin', onFocusIn);
  fit.addEventListener('click', onClickCapture, true);
  fit.addEventListener('pointerdown', onPointerDown);
  fit.addEventListener('pointermove', onPointerMove);
  fit.addEventListener('pointerup', onPointerEnd);
  fit.addEventListener('pointercancel', onPointerEnd);
  fit.addEventListener('wheel', onWheel, { passive: false });
  modal.dialog.addEventListener('keydown', onDialogKey);
  new ResizeObserver(onResize).observe(fit);
  return modal;
}

function attachTips(): void {
  if (!board) return;
  for (const btn of board.querySelectorAll<HTMLElement>('[data-tech-id]')) {
    attachTip(btn, () => {
      const scene = getScene();
      if (!scene) return null;
      const { nodes, rings, bank } = readTech(scene);
      const node = nodes.find((n) => n.id === btn.dataset.techId);
      if (!node) return null;
      const cost = parseCost(node.cost);
      const where = `${pathName(node.path)} path, ring ${ringNumeral(node.ring)}`;
      return {
        title: node.name,
        body: plainDashes(node.description),
        cost: node.status === 'researched' ? undefined : cost,
        bank,
        meta: node.unlocks.length ? `Unlocks: ${node.unlocks.join(', ')}. ${where}.` : `${where}.`,
        disabled:
          node.status === 'locked'
            ? lockReason(node, nodes, rings)
            : node.status === 'available' && !node.affordable
              ? `Not enough ${missingResources(cost, bank).join(' and ')}`
              : undefined,
        hint: node.status === 'researched' ? 'Researched' : node.status === 'available' && node.affordable ? 'Click to research' : undefined,
      };
    });
  }
  const emblem = board.querySelector<HTMLElement>('#tech-emblem');
  if (emblem) {
    attachTip(emblem, () => {
      const scene = getScene();
      if (!scene) return null;
      const { rings } = readTech(scene);
      return {
        title: `Your settlement: ${ringEra(rings.openRing)}`,
        body: 'Research spreads outward from here along five paths. A path is complete in a ring when all its research in that ring is done; two complete paths open the next ring, and your buildings take the look of its age.',
        meta: counterText(rings),
      };
    });
  }
}

function marksFor(state: TechState): GoalMarks {
  if (goal.kind === 'tech') return techGoalMarks(goal.id, state.nodes, state.rings);
  if (goal.kind === 'ring') return ringGoalMarks(state.nodes, state.rings);
  return NO_GOAL;
}

export function renderTechTree(scene: GameScene): void {
  if (!modal?.isOpen() || !board) return;
  const state = readTech(scene);
  const { nodes, rings, bank } = state;
  const sig =
    `${scene.getPerspectivePlayerId()}|${goal.kind}:${goal.kind === 'tech' ? goal.id : ''}|` +
    nodes.map((n) => `${n.id}:${n.status}:${n.affordable ? 1 : 0}:${n.lockedReason ?? ''}`).join('|') +
    `|${rings.rings.map((r) => `${r.ring}:${r.open ? 1 : 0}:${r.maxedPaths.join(',')}`).join(';')}` +
    // Costs only change colour when a resource crosses a price, so the bank itself is not in the signature.
    `|${nodes.map((n) => missingResources(parseCost(n.cost), bank).join(',')).join(';')}`;
  const marks = marksFor(state);
  if (sig !== lastSig) {
    lastSig = sig;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.techId;
    if (goalNote) {
      goalNote.hidden = marks.note === '';
      goalNote.textContent = marks.note;
    }
    layout = layoutTechTree(layoutInput(nodes));
    board.style.width = `${layout.width}rem`;
    board.style.height = `${layout.height}rem`;
    board.innerHTML = boardHtml(layout, nodes, rings, bank, marks);
    attachTips();
    if (focusedId) board.querySelector<HTMLElement>(`[data-tech-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }
  // The window has no size until the dialog is laid out; place the opening view as soon as it has.
  if (needsOpenView && extent()) {
    needsOpenView = false;
    openView(marks);
  }
}

function openWith(next: Goal): void {
  const scene = getScene();
  if (!scene) return;
  const m = ensureModal();
  goal = next;
  if (!m.isOpen()) m.open();
  lastSig = '';
  needsOpenView = true;
  renderTechTree(scene);
  // Focus the first research the player can start for the goal, else the first open one.
  const first =
    board?.querySelector<HTMLElement>('.tech-node.is-path.is-available, .tech-node.is-goal.is-available') ??
    board?.querySelector<HTMLElement>('.tech-node.is-path, .tech-node.is-goal') ??
    board?.querySelector<HTMLElement>('.tech-node.is-available, .tech-node');
  first?.focus({ preventScroll: true });
}

/**
 * Open the panel. With `goal`, that research and the research it still
 * needs are marked, and focus lands on the first of them you can start.
 */
export function openTechTree(goalId?: TechIdValue): void {
  openWith(goalId ? { kind: 'tech', id: goalId } : { kind: 'none' });
}

/** Open the panel on the next ring: the cheapest research that completes two paths is marked. */
export function openTechTreeForNextAge(): void {
  openWith({ kind: 'ring' });
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
