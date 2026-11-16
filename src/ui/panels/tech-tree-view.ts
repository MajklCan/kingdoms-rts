/**
 * Markup of the radial technology chart: the realm's emblem in the middle,
 * round seals for research, branch-coloured links between them. Strings
 * only; tech-tree.ts owns the modal, events and state, tech-tree-layout.ts
 * the geometry.
 */

import type { GameScene } from '../../render/game-scene';
import { AGE_TABLE, AgeId } from '../../sim/defs';
import { TechId } from '../../sim/tech-tree';
import { parseCost, RESOURCE_KEYS, type ResourceKey } from '../format';
import { RESOURCE_ICON_SMALL, TECH_ICON } from '../icons/catalog';
import { iconHtml } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { CENTRE_ID, type PlacedNode, type TechLayout } from './tech-tree-layout';

export type TechNode = ReturnType<GameScene['getTechTree']>[number];
export type Bank = Record<ResourceKey, number>;

/** How the chart marks research when the panel was opened for a goal. */
export interface GoalMarks {
  goal: TechNode | undefined;
  pathIds: ReadonlySet<string>;
}

const AGE_NUMERAL = ['I', 'II', 'III', 'IV'];
const AGE_EMBLEM: IconName[] = ['shield', 'tech-castle', 'tech-gunpowder', 'crown'];
/** The age a milestone seal stands for. */
const MILESTONE_AGE: Record<string, number> = {
  [TechId.CASTLE_AGE]: AgeId.CASTLE,
  [TechId.GUNPOWDER_AGE]: AgeId.GUNPOWDER,
};

export function ageName(age: number): string {
  return AGE_TABLE.find((a) => a.id === age)?.name ?? 'Dark Age';
}

export function statusLabel(node: TechNode): string {
  if (node.status === 'researched') return 'Researched';
  if (node.status === 'researching') return `${Math.floor(node.progressFrac * 100)}%`;
  if (node.status === 'available') return node.affordable ? 'Ready' : 'Need resources';
  return 'Locked';
}

function costHtml(cost: string, bank: Bank): string {
  const parsed = parseCost(cost);
  const keys = RESOURCE_KEYS.filter((k) => (parsed[k] ?? 0) > 0);
  if (keys.length === 0) return '<span class="tech-cost-free">Free</span>';
  return keys
    .map((k) => {
      const need = parsed[k] ?? 0;
      const short = need > (bank[k] ?? 0);
      return `<span class="tech-res${short ? ' is-short' : ''}">${iconHtml(RESOURCE_ICON_SMALL[k])}${need}</span>`;
    })
    .join('');
}

/** Second line under the name: cost, progress, or done. */
function detailHtml(node: TechNode, bank: Bank): string {
  if (node.status === 'researched') return '<span class="tech-done">Researched</span>';
  if (node.status === 'researching') return `<span class="tech-busy">Researching ${Math.floor(node.progressFrac * 100)}%</span>`;
  return costHtml(node.cost, bank);
}

function sealHtml(node: TechNode, currentAge: number): string {
  const ic = TECH_ICON[node.icon] ?? 'c-research';
  const ring = node.status === 'researching' ? `<span class="tech-ring" style="--p:${node.progressFrac.toFixed(3)}"></span>` : '';
  const pip =
    node.status === 'researched'
      ? `<span class="tech-pip is-check">${iconHtml('check')}</span>`
      : node.status === 'locked'
        ? `<span class="tech-pip is-lock">${iconHtml('lock')}</span>`
        : '';
  const age = MILESTONE_AGE[node.id] ?? node.requiresAge;
  const numeral = age > 0 ? `<span class="tech-age${currentAge >= age ? ' is-met' : ''}">${AGE_NUMERAL[age] ?? ''}</span>` : '';
  return `<span class="tech-seal">${ring}<span class="tech-face">${iconHtml(ic, 'tech-icon is-big')}</span>${pip}${numeral}</span>`;
}

function nodeHtml(node: TechNode, at: PlacedNode, bank: Bank, currentAge: number, marks: GoalMarks): string {
  const usable = node.status === 'available' && node.affordable;
  const mark = marks.goal?.id === node.id ? ' is-goal' : marks.pathIds.has(node.id) ? ' is-path' : '';
  const markLabel = mark === ' is-goal' ? ' Your goal.' : mark ? ` Needed for ${marks.goal?.name}.` : '';
  const needsAge = node.status === 'locked' && node.requiresAge > currentAge ? ` Needs ${ageName(node.requiresAge)}.` : '';
  const classes = [
    'tech-node',
    node.path,
    `is-${node.status}`,
    node.status === 'available' ? (node.affordable ? 'is-ready' : 'is-short') : '',
    at.milestone ? 'is-milestone' : '',
    `label-${at.label}`,
  ]
    .filter(Boolean)
    .join(' ');
  return `<button type="button" class="${classes}${mark}" data-tech-id="${node.id}" aria-disabled="${!usable}"
    aria-label="${node.name}. ${statusLabel(node)}.${needsAge}${markLabel}" style="--x:${at.x}rem;--y:${at.y}rem;--r:${at.r}rem">
    ${sealHtml(node, currentAge)}
    <span class="tech-label"><span class="tech-name">${node.name}</span><span class="tech-cost">${detailHtml(node, bank)}</span></span>
  </button>`;
}

function linksHtml(layout: TechLayout, byId: ReadonlyMap<string, TechNode>): string {
  const { centre, width, height } = layout;
  const rings = layout.rings.map((r) => `<circle class="tech-orbit" cx="${centre.x}" cy="${centre.y}" r="${r.toFixed(2)}" />`).join('');
  const lines = layout.links
    .map((link) => {
      const done = link.from === CENTRE_ID || byId.get(link.from)?.status === 'researched';
      const reached = byId.get(link.to)?.status === 'researched';
      const cls = `tech-link ${link.branch}${done ? ' is-done' : ''}${done && reached ? ' is-walked' : ''}`;
      return `<line class="${cls}" x1="${link.a.x.toFixed(2)}" y1="${link.a.y.toFixed(2)}" x2="${link.b.x.toFixed(2)}" y2="${link.b.y.toFixed(2)}" />`;
    })
    .join('');
  return `<svg class="tech-links" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rings}${lines}</svg>`;
}

function junctionsHtml(layout: TechLayout, byId: ReadonlyMap<string, TechNode>): string {
  return layout.junctions
    .map((j) => {
      const target = byId.get(j.to);
      if (!target) return '';
      const open = target.status !== 'locked';
      return `<div class="tech-junction${open ? ' is-open' : ''}" style="--x:${j.x}rem;--y:${j.y}rem" aria-hidden="true">
        <span class="tech-or">or</span><span class="tech-or-note">${open ? `${target.name}<br>is open` : `Either path opens<br>${target.name}`}</span>
      </div>`;
    })
    .join('');
}

function emblemHtml(layout: TechLayout, currentAge: number): string {
  const { centre } = layout;
  const ic = AGE_EMBLEM[currentAge] ?? 'crown';
  return `<div class="tech-emblem" id="tech-emblem" role="img" aria-label="Your realm: ${ageName(currentAge)}" style="--x:${centre.x}rem;--y:${centre.y}rem;--r:${centre.r}rem">
    <span class="tech-emblem-face">${iconHtml(ic, 'tech-emblem-icon is-big')}<span class="tech-emblem-name">${ageName(currentAge)}</span></span>
  </div>`;
}

export function boardHtml(layout: TechLayout, nodes: readonly TechNode[], bank: Bank, currentAge: number, marks: GoalMarks): string {
  const byId = new Map(nodes.map((n) => [n.id as string, n]));
  const placed = new Map(layout.nodes.map((p) => [p.id, p]));
  const seals = nodes
    .map((n) => {
      const at = placed.get(n.id);
      return at ? nodeHtml(n, at, bank, currentAge, marks) : '';
    })
    .join('');
  return linksHtml(layout, byId) + junctionsHtml(layout, byId) + emblemHtml(layout, currentAge) + seals;
}
