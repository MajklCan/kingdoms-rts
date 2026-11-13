/**
 * Technology tree: a large parchment chart of research nodes joined by
 * branch-coloured links. Nodes show icon, name, cost (red where short),
 * and status (locked, ready, researching with progress, done). The board
 * scales to fit the dialog. Opens from the top bar or the K key.
 */

import type { GameScene } from '../../render/game-scene';
import { TechId, type TechIdValue } from '../../sim/tech-tree';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, plainDashes } from '../dom';
import { missingResources, parseCost, RESOURCE_KEYS, type ResourceKey } from '../format';
import { getScene, reportFailure } from '../game-bridge';
import { TECH_ICON } from '../icons/catalog';
import { iconHtml } from '../icons/icon';
import { pushAlert } from '../hud/alerts';
import { attachTip } from '../hud/tooltip';
import { setPanelExpanded } from '../hud/top-bar';
import { createModal, type Modal } from './modal';

type TechBranch = 'military' | 'housing' | 'economy' | 'food' | 'castle' | 'gunpowder';
type TechNode = ReturnType<GameScene['getTechTree']>[number];

const TECH_TREE_LINKS: Array<{ from: TechIdValue; to: TechIdValue; branch: TechBranch }> = [
  { from: TechId.BARRACKS_PIKEMEN, to: TechId.ARCHERS, branch: 'military' },
  { from: TechId.ARCHERS, to: TechId.CASTLE_AGE, branch: 'military' },
  { from: TechId.HOUSING_I, to: TechId.HOUSING_II, branch: 'housing' },
  { from: TechId.LUMBER_CREWS, to: TechId.MINING_CREWS, branch: 'economy' },
  { from: TechId.MINING_CREWS, to: TechId.CASTLE_AGE, branch: 'economy' },
  { from: TechId.CASTLE_AGE, to: TechId.HOUSING_II, branch: 'castle' },
  { from: TechId.BARRACKS_PIKEMEN, to: TechId.MILLS, branch: 'food' },
  { from: TechId.CASTLE_AGE, to: TechId.FARMS, branch: 'castle' },
  { from: TechId.MILLS, to: TechId.FARMS, branch: 'food' },
  { from: TechId.GUNPOWDER_AGE, to: TechId.FARMS_II, branch: 'gunpowder' },
  { from: TechId.FARMS, to: TechId.FARMS_II, branch: 'food' },
  { from: TechId.CASTLE_AGE, to: TechId.GUNPOWDER_AGE, branch: 'gunpowder' },
];

// Board geometry in rem (1rem = 16px at 1280x720).
const BOARD_W = 77.5;
const BOARD_H = 43;
const NODE_W = 15.6;
const NODE_H = 5.25;
const X_SCALE = 14 / 16;
const Y_SCALE = 4 / 16;
const LEFT_PAD = 12 / 16;
const TOP_PAD = 20 / 16;

let modal: Modal | null = null;
let board: HTMLElement | null = null;
let fit: HTMLElement | null = null;
let lastSig = '';

function point(node: { x: number; y: number }): { x: number; y: number } {
  return { x: LEFT_PAD + node.x * X_SCALE, y: TOP_PAD + node.y * Y_SCALE };
}

function costHtml(cost: string, bank: Record<ResourceKey, number>): string {
  const parsed = parseCost(cost);
  const keys = RESOURCE_KEYS.filter((k) => (parsed[k] ?? 0) > 0);
  if (keys.length === 0) return '<span class="tech-cost-free">Free</span>';
  return keys
    .map((k) => {
      const need = parsed[k] ?? 0;
      const short = need > (bank[k] ?? 0);
      return `<span class="tech-res${short ? ' is-short' : ''}">${iconHtml(k, `res-${k}`)}${need}</span>`;
    })
    .join('');
}

function statusLabel(node: TechNode): string {
  if (node.status === 'researched') return 'Researched';
  if (node.status === 'researching') return `${Math.floor(node.progressFrac * 100)}%`;
  if (node.status === 'available') return node.affordable ? 'Ready' : 'Need resources';
  return 'Locked';
}

function fitBoard(): void {
  if (!fit || !board || !modal?.isOpen()) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const availW = fit.clientWidth;
  const availH = fit.clientHeight;
  const scale = Math.min(1, availW / (BOARD_W * rem), availH / (BOARD_H * rem));
  board.style.transform = `scale(${scale.toFixed(4)})`;
  board.style.marginLeft = `${Math.max(0, (availW - BOARD_W * rem * scale) / 2)}px`;
}

function ensureModal(): Modal {
  if (modal) return modal;
  modal = createModal({
    id: 'tech-tree-panel',
    eyebrow: 'Scholars of the realm',
    title: 'Technology',
    className: 'modal-tech',
    onOpen: () => setPanelExpanded('tech', true),
    onClose: () => setPanelExpanded('tech', false),
  });
  board = h('div', { class: 'tech-board', id: 'tech-tree-board' });
  fit = h('div', { class: 'tech-fit' }, board);
  const legend = h(
    'div',
    { class: 'tech-legend', 'aria-hidden': 'true' },
    ...(['military', 'economy', 'food', 'housing', 'castle', 'gunpowder'] as const).map((b) => h('span', { class: `legend-item ${b}` }, h('i'), b))
  );
  modal.body.append(fit);
  modal.foot.append(legend);
  board.addEventListener('click', (ev) => {
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
      const bank = scene.getResources(scene.getPerspectivePlayerId()) as unknown as Record<ResourceKey, number>;
      const missing = missingResources(parseCost(node.cost), bank);
      reportFailure({ reason: 'resources', subject: node.name, missing });
      return;
    }
    scene.researchTech(node.id, scene.getPerspectivePlayerId());
    lastSig = '';
    renderTechTree(scene);
  });
  window.addEventListener('resize', fitBoard);
  return modal;
}

export function renderTechTree(scene: GameScene): void {
  if (!modal?.isOpen() || !board) return;
  const playerId = scene.getPerspectivePlayerId();
  const nodes = scene.getTechTree(playerId);
  const bank = scene.getResources(playerId) as unknown as Record<ResourceKey, number>;
  const sig =
    `${playerId}|` +
    nodes.map((n) => `${n.id}:${n.status}:${n.affordable ? 1 : 0}:${Math.floor(n.progressFrac * 100)}`).join('|') +
    `|${RESOURCE_KEYS.map((k) => Math.floor(bank[k] ?? 0)).join(',')}`;
  if (sig === lastSig) return;
  lastSig = sig;

  const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.techId;
  const byId = new Map<string, TechNode>();
  for (const n of nodes) byId.set(n.id, n);
  const links: string[] = [];
  const ex = NODE_W / 2;
  const ey = NODE_H / 2;
  for (const link of TECH_TREE_LINKS) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    const a = point(from);
    const b = point(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const sx = dx >= 0 ? 1 : -1;
    const sy = dy >= 0 ? 1 : -1;
    let pts: Array<[number, number]>;
    if (Math.abs(dx) < 0.01) pts = [[a.x + ex, a.y + (sy > 0 ? NODE_H : 0)], [b.x + ex, b.y + (sy > 0 ? 0 : NODE_H)]];
    else {
      const start: [number, number] = [a.x + (sx > 0 ? NODE_W : 0), a.y + ey];
      const end: [number, number] = [b.x + (sx > 0 ? 0 : NODE_W), b.y + ey];
      const midX = (start[0] + end[0]) / 2;
      pts = [start, [midX, start[1]], [midX, end[1]], end];
    }
    const done = from.status === 'researched';
    links.push(`<polyline class="${link.branch}${done ? ' is-done' : ''}" points="${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" />`);
  }

  const nodeHtml = nodes
    .map((n) => {
      const p = point(n);
      const ic = TECH_ICON[n.icon] ?? 'research';
      const progress = n.status === 'researching' ? `<span class="tech-progress"><i style="--p:${n.progressFrac.toFixed(3)}"></i></span>` : '';
      const statusIcon = n.status === 'researched' ? iconHtml('check', 'tech-status-icon') : n.status === 'locked' ? iconHtml('lock', 'tech-status-icon') : '';
      const usable = n.status === 'available' && n.affordable;
      return `<button type="button" class="tech-node ${n.path} is-${n.status}${n.status === 'available' && !n.affordable ? ' is-short' : ''}" data-tech-id="${n.id}" aria-disabled="${!usable}"
        aria-label="${n.name}. ${statusLabel(n)}." style="left:${p.x}rem;top:${p.y}rem">
        <span class="tech-medal">${iconHtml(ic, 'tech-icon')}</span>
        <span class="tech-copy"><span class="tech-name">${n.name}</span><span class="tech-cost">${costHtml(n.cost, bank)}</span></span>
        <span class="tech-status">${statusIcon}${statusLabel(n)}</span>${progress}
      </button>`;
    })
    .join('');

  board.innerHTML = `<svg class="tech-links" viewBox="0 0 ${BOARD_W} ${BOARD_H}" preserveAspectRatio="none" aria-hidden="true">${links.join('')}</svg>${nodeHtml}`;
  for (const btn of board.querySelectorAll<HTMLElement>('[data-tech-id]')) {
    attachTip(btn, () => {
      const s = getScene();
      const node = s?.getTechTree(s.getPerspectivePlayerId()).find((x) => x.id === btn.dataset.techId);
      if (!s || !node) return null;
      const b = s.getResources(s.getPerspectivePlayerId()) as unknown as Record<ResourceKey, number>;
      const requires = [...(node.requires ?? []), ...(node.requiresAny ?? []).flat()]
        .map((id) => byId.get(id)?.name)
        .filter(Boolean)
        .join(', ');
      return {
        title: node.name,
        body: plainDashes(node.description),
        cost: parseCost(node.cost),
        bank: b,
        meta: node.unlocks.length ? `Unlocks: ${node.unlocks.join(', ')}` : undefined,
        disabled: node.status === 'locked' ? `Requires ${requires || 'earlier research'}` : node.status === 'available' && !node.affordable ? `Not enough ${missingResources(parseCost(node.cost), b).join(' and ')}` : undefined,
      };
    });
  }
  if (focusedId) board.querySelector<HTMLElement>(`[data-tech-id="${focusedId}"]`)?.focus({ preventScroll: true });
}

export function openTechTree(): void {
  const scene = getScene();
  if (!scene) return;
  const m = ensureModal();
  if (m.isOpen()) return;
  m.open();
  lastSig = '';
  renderTechTree(scene);
  requestAnimationFrame(fitBoard);
  const first = board?.querySelector<HTMLElement>('.tech-node.is-available, .tech-node');
  first?.focus({ preventScroll: true });
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

