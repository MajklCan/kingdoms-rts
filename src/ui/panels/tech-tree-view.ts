/**
 * Markup of the ring chart: ring bands as tinted discs on a dark field, the
 * settlement's medallion in the middle, path-coloured links, a round seal
 * per research, a gate per path on each ring edge, a name plate per ring
 * and a banner at the end of each path. Strings only; tech-tree.ts owns the
 * modal, events and state, tech-tree-layout.ts the geometry,
 * tech-tree-rings.ts the rules.
 */

import { escapeHtml } from '../dom';
import { missingResources, parseCost, RESOURCE_KEYS, type ResourceKey } from '../format';
import { RESOURCE_ICON_SMALL, TECH_ICON } from '../icons/catalog';
import { iconHtml } from '../icons/icon';
import { BANNER, CENTRE_ID, RING_LABEL, type LayoutInput, type PlacedLink, type PlacedNode, type Point, type TechLayout } from './tech-tree-layout';
import {
  lockReason,
  nextRingProgress,
  pathName,
  ringEra,
  ringNumeral,
  ringState,
  type GoalMarks,
  type TechNode,
  type TechRings,
} from './tech-tree-rings';

export type Bank = Record<ResourceKey, number>;

function costKeys(node: TechNode): ResourceKey[] {
  const cost = parseCost(node.cost);
  return RESOURCE_KEYS.filter((k) => (cost[k] ?? 0) > 0);
}

/** Room the name and cost of a seal need, in rem (an estimate the layout places labels with). */
export function labelWidth(node: TechNode): number {
  return Math.max(node.name.length * 0.54 + 0.6, costKeys(node).length * 3.05, 5.6);
}

export function layoutInput(nodes: readonly TechNode[]): LayoutInput[] {
  return nodes.map((n) => ({ id: n.id, path: n.path, ring: n.ring, parents: n.parents, labelW: labelWidth(n) }));
}

function costHtml(node: TechNode, bank: Bank): string {
  const cost = parseCost(node.cost);
  const keys = costKeys(node);
  if (keys.length === 0) return '<span class="tech-cost-free">Free</span>';
  return keys
    .map((k) => {
      const need = cost[k] ?? 0;
      const short = need > (bank[k] ?? 0);
      return `<span class="tech-res${short ? ' is-short' : ''}">${iconHtml(RESOURCE_ICON_SMALL[k])}${need}</span>`;
    })
    .join('');
}

function costWords(node: TechNode): string {
  const cost = parseCost(node.cost);
  const parts = costKeys(node).map((k) => `${cost[k]} ${k}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/** What a screen reader hears for a seal. */
function sealLabel(node: TechNode, nodes: readonly TechNode[], rings: TechRings, bank: Bank, mark: string): string {
  const where = `${pathName(node.path)} path, ring ${ringNumeral(node.ring)}`;
  let state: string;
  if (node.status === 'researched') state = 'Researched';
  else if (node.status === 'available' && node.affordable) state = `Ready to research for ${costWords(node)}`;
  else if (node.status === 'available') state = `Not enough ${missingResources(parseCost(node.cost), bank).join(' and ')}: costs ${costWords(node)}`;
  else state = `Locked. ${lockReason(node, nodes, rings)}`;
  return escapeHtml(`${node.name}. ${where}. ${state}.${mark}`);
}

function nodeHtml(node: TechNode, place: PlacedNode, nodes: readonly TechNode[], rings: TechRings, bank: Bank, marks: GoalMarks): string {
  const usable = node.status === 'available' && node.affordable;
  const isGoal = marks.goalId === node.id;
  const onPath = !isGoal && marks.pathIds.has(node.id);
  const markWords = isGoal ? ' Your goal.' : onPath ? (marks.goalRing ? ` Opens ring ${ringNumeral(marks.goalRing)}.` : ' Needed for your goal.') : '';
  const classes = [
    'tech-node',
    node.path,
    `is-${node.status}`,
    node.status === 'available' ? (node.affordable ? 'is-ready' : 'is-short') : '',
    `side-${place.side}`,
    isGoal ? 'is-goal' : '',
    onPath ? 'is-path' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const pip =
    node.status === 'researched'
      ? `<span class="tech-pip is-check">${iconHtml('check')}</span>`
      : node.status === 'locked'
        ? `<span class="tech-pip is-lock">${iconHtml('lock')}</span>`
        : '';
  const detail = node.status === 'researched' ? '<span class="tech-done">Researched</span>' : costHtml(node, bank);
  const style =
    `--x:${place.x.toFixed(3)}rem;--y:${place.y.toFixed(3)}rem;--r:${place.r.toFixed(3)}rem;` +
    `--lx:${(place.label.x0 - (place.x - place.r)).toFixed(3)}rem;--ly:${(place.label.y0 - (place.y - place.r)).toFixed(3)}rem;` +
    `--lw:${(place.label.x1 - place.label.x0).toFixed(3)}rem;--lh:${(place.label.y1 - place.label.y0).toFixed(3)}rem`;
  return `<button type="button" class="${classes}" data-tech-id="${node.id}" aria-disabled="${!usable}" aria-label="${sealLabel(node, nodes, rings, bank, markWords)}" style="${style}">
    <span class="tech-seal"><span class="tech-face">${iconHtml(TECH_ICON[node.icon] ?? 'c-research', 'tech-icon is-big')}</span>${pip}</span>
    <span class="tech-label"><span class="tech-name">${escapeHtml(node.name)}</span><span class="tech-cost">${detail}</span></span>
  </button>`;
}

function pathD(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');
}

/** A small arrow head at the end of a cross link, pointing at the research that needs it. */
function arrowHead(link: PlacedLink): string {
  const tip = link.points[link.points.length - 1]!;
  const before = link.points[link.points.length - 2]!;
  const len = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const ux = (tip.x - before.x) / len;
  const uy = (tip.y - before.y) / len;
  const back = { x: tip.x - ux * 0.9, y: tip.y - uy * 0.9 };
  const corner = (sign: number): string => `${(back.x - uy * 0.5 * sign).toFixed(2)},${(back.y + ux * 0.5 * sign).toFixed(2)}`;
  return `${(tip.x + ux * 0.3).toFixed(2)},${(tip.y + uy * 0.3).toFixed(2)} ${corner(1)} ${corner(-1)}`;
}

function chartHtml(layout: TechLayout, byId: ReadonlyMap<string, TechNode>, rings: TechRings, marks: GoalMarks): string {
  const { centre, width, height } = layout;
  const next = nextRingProgress(rings);
  // Outermost band first, so each inner band paints over the one around it.
  const bands = [...layout.bands]
    .reverse()
    .map((band) => {
      const state = ringState(rings, band.ring);
      const cls = `tech-band ring-${band.ring} ${state?.open === false ? 'is-closed' : 'is-open'}${next?.ring === band.ring ? ' is-next' : ''}${marks.goalRing === band.ring ? ' is-goal' : ''}`;
      const disc = `cx="${centre.x}" cy="${centre.y}" r="${band.r.toFixed(2)}"`;
      return `<g class="${cls}"><circle class="tech-band-fill" ${disc} /><circle class="tech-band-rim" ${disc} /><circle class="tech-band-line" ${disc} /></g>`;
    })
    .join('');
  const well = `<circle class="tech-well" cx="${centre.x}" cy="${centre.y}" r="${centre.well.toFixed(2)}" />`;
  const spokes = layout.paths.map((p) => `<path class="tech-spoke ${p.path}" d="${pathD([p.from, p.to])}" />`).join('');
  const links = layout.links
    .map((link) => {
      const done = link.from === CENTRE_ID || byId.get(link.from)?.status === 'researched';
      const reached = byId.get(link.to)?.status === 'researched';
      const cls = `tech-link ${link.path}${link.cross ? ' is-cross' : ''}${done ? ' is-done' : ''}${done && reached ? ' is-walked' : ''}`;
      const head = link.cross ? `<polygon class="tech-link-head ${link.path}${done ? ' is-done' : ''}" points="${arrowHead(link)}" />` : '';
      return `<path class="${cls}" d="${pathD(link.points)}" />${head}`;
    })
    .join('');
  const gates = layout.gates
    .map((gate) => {
      const full = ringState(rings, gate.ring)?.maxedPaths.includes(gate.path) ?? false;
      const s = 0.72;
      return `<rect class="tech-gate ${gate.path}${full ? ' is-full' : ''}" x="${(gate.x - s).toFixed(2)}" y="${(gate.y - s).toFixed(2)}" width="${2 * s}" height="${2 * s}" transform="rotate(45 ${gate.x.toFixed(2)} ${gate.y.toFixed(2)})" />`;
    })
    .join('');
  return `<svg class="tech-chart" viewBox="0 0 ${width} ${height}" aria-hidden="true">${bands}${well}${spokes}${links}${gates}</svg>`;
}

/** "Open", "1 of 2 paths", "Closed": where a ring stands. */
function ringStatus(rings: TechRings, ring: number): string {
  const state = ringState(rings, ring);
  const next = nextRingProgress(rings);
  if (!state || state.open) return 'Open';
  if (next?.ring === ring) return `${next.done} of ${next.need} paths`;
  return 'Closed';
}

/** One name plate per ring, all alike: numeral, age, state. */
function ringLabelsHtml(layout: TechLayout, rings: TechRings): string {
  return layout.ringLabels
    .map((label) => {
      const open = ringState(rings, label.ring)?.open !== false;
      return `<div class="tech-ring-label${open ? ' is-open' : ' is-closed'}" style="--x:${label.x.toFixed(3)}rem;--y:${label.y.toFixed(3)}rem;--w:${RING_LABEL.w}rem;--h:${RING_LABEL.h}rem" aria-hidden="true">
        <b class="tech-ring-num">${ringNumeral(label.ring)}</b><span class="tech-ring-era">${ringEra(label.ring)}</span><span class="tech-ring-state">${open ? '' : iconHtml('lock')}${ringStatus(rings, label.ring)}</span>
      </div>`;
    })
    .join('');
}

function bannersHtml(layout: TechLayout): string {
  return layout.paths
    .map(
      (p) =>
        `<div class="tech-banner ${p.path}" style="--x:${p.banner.x.toFixed(3)}rem;--y:${p.banner.y.toFixed(3)}rem;--w:${BANNER.w}rem;--h:${BANNER.h}rem" aria-hidden="true">${escapeHtml(pathName(p.path))}</div>`
    )
    .join('');
}

/** "Ring II: 1 of 2 paths complete" for the ring that opens next, as words. */
export function counterText(rings: TechRings): string {
  const next = nextRingProgress(rings);
  if (!next) return 'All rings open';
  return `Ring ${ringNumeral(next.ring)}: ${next.done} of ${next.need} paths complete`;
}

function emblemHtml(layout: TechLayout, rings: TechRings): string {
  const { centre } = layout;
  const next = nextRingProgress(rings);
  const pips = next ? Array.from({ length: next.need }, (_, i) => `<i class="tech-count-pip${i < next.done ? ' is-full' : ''}"></i>`).join('') : '';
  const label = `Your settlement. Ring ${ringNumeral(rings.openRing)} is open: ${ringEra(rings.openRing)}. ${counterText(rings)}.`;
  const count = next
    ? `<span class="tech-count-row"><span class="tech-count-pips">${pips}</span><b>${next.done} of ${next.need}</b></span><span class="tech-count-text">paths complete</span>`
    : '<span class="tech-count-text">All rings open</span>';
  return `<div class="tech-emblem" id="tech-emblem" role="img" aria-label="${escapeHtml(label)}" style="--x:${centre.x}rem;--y:${centre.y}rem;--r:${centre.r}rem">
    <span class="tech-emblem-face">
      ${iconHtml('tech-settlement', 'tech-emblem-icon is-big')}
      <span class="tech-emblem-name">${ringEra(rings.openRing)}</span>
      <span class="tech-count${next ? '' : ' is-all'}">${count}</span>
    </span>
  </div>`;
}

export function boardHtml(layout: TechLayout, nodes: readonly TechNode[], rings: TechRings, bank: Bank, marks: GoalMarks): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = new Map(layout.nodes.map((p) => [p.id, p]));
  const seals = nodes
    .map((n) => {
      const place = placed.get(n.id);
      return place ? nodeHtml(n, place, nodes, rings, bank, marks) : '';
    })
    .join('');
  return chartHtml(layout, byId, rings, marks) + ringLabelsHtml(layout, rings) + bannersHtml(layout) + emblemHtml(layout, rings) + seals;
}
