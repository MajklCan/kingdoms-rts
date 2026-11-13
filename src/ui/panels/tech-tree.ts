/** Technology tree panel: open/close + node board rendering. */

import type { GameScene } from '../../render/game-scene';
import { TechId, type TechIdValue } from '../../sim/tech-tree';
import { byId } from '../dom';
import { renderResourceCost, renderVoxelIcon } from '../icons/voxel-icons';

type TechBranch = 'military' | 'housing' | 'economy' | 'food' | 'castle' | 'gunpowder';

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

const TECH_TREE_CANVAS_WIDTH = 1240;
const TECH_TREE_CANVAS_HEIGHT = 680;
const TECH_TREE_NODE_WIDTH = 250;
const TECH_TREE_NODE_HEIGHT = 84;
const TECH_TREE_X_SCALE = 14;
const TECH_TREE_Y_SCALE = 4;
const TECH_TREE_LEFT_PAD = 12;
const TECH_TREE_TOP_PAD = 20;

let lastTechTreeSig = '';

export function bindTechTreeControls(): void {
  const panel = byId('tech-tree-panel');
  const toggle = byId<HTMLButtonElement>('tech-toggle');
  const close = byId<HTMLButtonElement>('tech-close');
  if (!panel || !toggle || !close) return;
  const setOpen = (open: boolean) => {
    panel.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  close.addEventListener('click', () => setOpen(false));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
  });
}

function techTreePoint(node: { x: number; y: number }): { x: number; y: number } {
  return {
    x: TECH_TREE_LEFT_PAD + node.x * TECH_TREE_X_SCALE,
    y: TECH_TREE_TOP_PAD + node.y * TECH_TREE_Y_SCALE,
  };
}

export function renderTechTree(scene: GameScene): void {
  const techTreeBoardEl = byId('tech-tree-board');
  if (!techTreeBoardEl) return;
  const playerId = scene.getPerspectivePlayerId();
  const nodes = scene.getTechTree(playerId);
  const sig = `${playerId}|` + nodes
    .map((node) =>
      `${node.id}:${node.status}:${node.affordable ? 1 : 0}:${Math.floor(node.progressFrac * 100)}`
    )
    .join('|');
  if (sig === lastTechTreeSig) return;
  lastTechTreeSig = sig;

  const byTechId = new Map<TechIdValue, (typeof nodes)[number]>();
  for (const node of nodes) byTechId.set(node.id, node);

  const linkParts: string[] = [];
  const cardEdgeX = TECH_TREE_NODE_WIDTH / 2;
  const cardEdgeY = TECH_TREE_NODE_HEIGHT / 2;
  const formatPoints = (points: Array<[number, number]>) =>
    points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const addLink = (fromId: TechIdValue, toId: TechIdValue, branch: TechBranch) => {
    const from = byTechId.get(fromId);
    const to = byTechId.get(toId);
    if (!from) return;
    if (!to) return;
    const fromPoint = techTreePoint(from);
    const toPoint = techTreePoint(to);
    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    const sx = dx >= 0 ? 1 : -1;
    const sy = dy >= 0 ? 1 : -1;
    let points: Array<[number, number]>;
    if (Math.abs(dx) < 0.01) {
      points = [
        [fromPoint.x, fromPoint.y + sy * cardEdgeY],
        [toPoint.x, toPoint.y - sy * cardEdgeY],
      ];
    } else if (Math.abs(dy) < 0.01) {
      points = [
        [fromPoint.x + sx * cardEdgeX, fromPoint.y],
        [toPoint.x - sx * cardEdgeX, toPoint.y],
      ];
    } else {
      const start: [number, number] = [fromPoint.x + sx * cardEdgeX, fromPoint.y];
      const end: [number, number] = [toPoint.x - sx * cardEdgeX, toPoint.y];
      const midX = (start[0] + end[0]) / 2;
      points = [start, [midX, start[1]], [midX, end[1]], end];
    }
    linkParts.push(`<polyline class="${branch}" points="${formatPoints(points)}" />`);
  };
  for (const link of TECH_TREE_LINKS) addLink(link.from, link.to, link.branch);

  techTreeBoardEl.innerHTML =
    `<div class="tech-tree-canvas"><svg class="tech-links" viewBox="0 0 ${TECH_TREE_CANVAS_WIDTH} ${TECH_TREE_CANVAS_HEIGHT}" preserveAspectRatio="none">${linkParts.join('')}</svg>` +
    `${nodes.map(renderTechNode).join('')}</div>`;

  for (const button of techTreeBoardEl.querySelectorAll<HTMLButtonElement>('[data-tech-id]')) {
    button.addEventListener('click', () => {
      scene.researchTech(button.dataset.techId as TechIdValue, playerId);
      lastTechTreeSig = '';
      renderTechTree(scene);
    });
  }
}

function renderTechNode(node: ReturnType<GameScene['getTechTree']>[number]): string {
  const affordableClass = node.affordable || node.status !== 'available' ? 'affordable' : 'unaffordable';
  const disabled = node.status !== 'available' || !node.affordable ? 'disabled' : '';
  const progress =
    node.status === 'researching'
      ? `<span class="tech-progress"><span style="width:${Math.floor(node.progressFrac * 100)}%"></span></span>`
      : '';
  const status =
    node.status === 'researched'
      ? 'Done'
      : node.status === 'researching'
        ? `${Math.floor(node.progressFrac * 100)}%`
        : node.status === 'available'
          ? node.affordable ? 'Ready' : 'Need res'
          : 'Locked';
  const point = techTreePoint(node);
  return `
    <button class="tech-node ${node.path} ${node.status} ${affordableClass}" data-tech-id="${node.id}" ${disabled}
      style="left:${point.x}px;top:${point.y}px">
      ${renderVoxelIcon(node.icon)}
      <span class="tech-copy">
        <span class="tech-name">${node.name}</span>
        <span class="tech-desc">${node.description}</span>
        <span class="tech-unlocks">${node.unlocks.join(' / ')}</span>
      </span>
      <span class="tech-meta">
        <span class="tech-cost">${renderResourceCost(node.cost || 'Free')}</span>
        <span class="tech-status">${status}</span>
      </span>
      ${progress}
    </button>`;
}
