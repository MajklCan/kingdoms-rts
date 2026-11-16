/**
 * Geometry of the radial technology chart. Pure math, no DOM.
 *
 * The realm's emblem sits in the middle and research spreads outward from
 * it: the further from the emblem, the deeper the research. Links come from
 * the real `requires` / `requiresAny` graph; only where a seal sits on the
 * chart is designed by hand (SLOTS), so that no link crosses another:
 *
 *   Manor - Timber - BARRACKS - Archers
 *                  /    |              \
 *   Crop - Farm - Mills EMBLEM          CASTLE AGE - GUNPOWDER AGE
 *                       |              /
 *                     LUMBER - Mining
 *
 * The two early paths (military above, economy below) close a ring around
 * the "either path" mark and meet in the Castle Age seal. Age requirements
 * are not links: seals carry the numeral of the age they need.
 *
 * All lengths are in rem; the panel scales the whole board to fit. On a
 * very wide, short dialog (phone landscape) the `compact` shape squeezes the
 * rows together so the seals can be drawn larger.
 */

import { TechId, type TechIdValue } from '../../sim/tech-tree';

/** What the layout needs to know about a research node. */
export interface LayoutInput {
  id: string;
  path: string;
  requires: readonly string[];
  requiresAny: readonly (readonly string[])[];
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode extends Point {
  id: string;
  /** Seal radius. */
  r: number;
  /** Ages are the big seals. */
  milestone: boolean;
  /** Side of the seal the name and cost sit on: away from the emblem. */
  label: 'above' | 'below';
}

export interface PlacedLink {
  /** Tech id, or CENTRE_ID for the emblem. */
  from: string;
  to: string;
  /** Branch whose colour the link wears. */
  branch: string;
  /** Segment between the two seal rims. */
  a: Point;
  b: Point;
}

/** Where a tech with several alternative paths says "either path". */
export interface PlacedJunction extends Point {
  to: string;
}

export interface TechLayout {
  compact: boolean;
  width: number;
  height: number;
  centre: Point & { r: number };
  /** Radii of the faint guide circles around the emblem. */
  rings: number[];
  nodes: PlacedNode[];
  links: PlacedLink[];
  junctions: PlacedJunction[];
}

export const CENTRE_ID = 'centre';

const BOARD_W = 77;
const CENTRE_X = 37.5;

/** The two shapes of the chart: roomy (desktop) and compact (phone landscape). */
interface Shape {
  height: number;
  emblemR: number;
  /** Rows are squeezed towards the emblem's row by this factor. */
  ySqueeze: number;
}

const ROOMY: Shape = { height: 31.5, emblemR: 4.25, ySqueeze: 1 };
const COMPACT: Shape = { height: 26, emblemR: 3, ySqueeze: 0.7 };

/** Dialogs wider than this (width / height) get the compact shape. */
export const COMPACT_ASPECT = 2.8;

const NODE_R = 2.75;
const MILESTONE_R = 3.6;
/** Clear parchment between a seal rim and the end of a link. */
const LINK_GAP = 0.35;

/** Seal positions as offsets from the emblem. */
const SLOTS: Partial<Record<TechIdValue, readonly [number, number]>> = {
  [TechId.BARRACKS_PIKEMEN]: [0, -9.2],
  [TechId.ARCHERS]: [11, -9.4],
  [TechId.LUMBER_CREWS]: [0, 9.2],
  [TechId.MINING_CREWS]: [11, 9.4],
  [TechId.CASTLE_AGE]: [21.5, 0],
  [TechId.GUNPOWDER_AGE]: [33, 0],
  [TechId.HOUSING_I]: [-11, -9.4],
  [TechId.HOUSING_II]: [-22.5, -7],
  [TechId.MILLS]: [-11.5, 1],
  [TechId.FARMS]: [-22, 4.6],
  [TechId.FARMS_II]: [-32.5, 8.2],
};

/** Research without a designed slot still shows: an extra row under the chart. */
const SPARE_ROW_H = 9;
const SPARE_STEP = 9;

function isMilestone(node: LayoutInput): boolean {
  return node.path === 'age';
}

function place(nodes: readonly LayoutInput[], shape: Shape): PlacedNode[] {
  const centreY = shape.height / 2;
  const spares = nodes.filter((node) => !SLOTS[node.id as TechIdValue]);
  return nodes.map((node) => {
    const slot = SLOTS[node.id as TechIdValue];
    const spare = spares.indexOf(node);
    const dx = slot ? slot[0] : (spare - (spares.length - 1) / 2) * SPARE_STEP;
    const dy = slot ? slot[1] * shape.ySqueeze : centreY + SPARE_ROW_H / 2 - 1;
    const milestone = isMilestone(node);
    return {
      id: node.id,
      x: CENTRE_X + dx,
      y: centreY + dy,
      r: milestone ? MILESTONE_R : NODE_R,
      milestone,
      label: dy < -3 ? 'above' : 'below',
    };
  });
}

/**
 * Parents of a node on the chart: its `requires`, the last research of each
 * `requiresAny` path, else the age before it, else the emblem (research that
 * needs only what the realm starts with).
 */
function parentsOf(node: LayoutInput, shown: ReadonlyMap<string, LayoutInput>, order: readonly LayoutInput[]): string[] {
  const parents = node.requires.filter((id) => shown.has(id));
  for (const group of node.requiresAny) {
    const last = [...group].reverse().find((id) => shown.has(id));
    if (last && !parents.includes(last)) parents.push(last);
  }
  if (parents.length > 0) return parents;
  if (isMilestone(node)) {
    const earlier = order.slice(0, order.indexOf(node)).reverse().find(isMilestone);
    if (earlier) return [earlier.id];
  }
  return [CENTRE_ID];
}

function rimToRim(from: Point & { r: number }, to: Point & { r: number }): { a: Point; b: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const start = from.r + LINK_GAP;
  const end = to.r + LINK_GAP;
  return {
    a: { x: from.x + ux * start, y: from.y + uy * start },
    b: { x: to.x - ux * end, y: to.y - uy * end },
  };
}

export function layoutTechTree(nodes: readonly LayoutInput[], compact = false): TechLayout {
  const shape = compact ? COMPACT : ROOMY;
  const shown = new Map(nodes.map((n) => [n.id, n]));
  const placed = place(nodes, shape);
  const at = new Map<string, Point & { r: number }>(placed.map((p) => [p.id, p]));
  const centre = { x: CENTRE_X, y: shape.height / 2, r: shape.emblemR };
  at.set(CENTRE_ID, centre);

  const links: PlacedLink[] = [];
  const junctions: PlacedJunction[] = [];
  for (const node of nodes) {
    const to = at.get(node.id);
    if (!to) continue;
    const parents = parentsOf(node, shown, nodes);
    for (const parentId of parents) {
      const from = at.get(parentId);
      if (!from) continue;
      const parentPath = shown.get(parentId)?.path;
      // A link into an age wears the colour of the path that leads there.
      const branch = isMilestone(node) && parentPath && parentPath !== 'age' ? parentPath : node.path;
      links.push({ from: parentId, to: node.id, branch, ...rimToRim(from, to) });
    }
    if (node.requiresAny.length > 1) {
      const ends = parents.map((id) => at.get(id)).filter((p): p is Point & { r: number } => !!p);
      if (ends.length > 1) {
        junctions.push({
          to: node.id,
          x: ends.reduce((sum, p) => sum + p.x, 0) / ends.length,
          y: ends.reduce((sum, p) => sum + p.y, 0) / ends.length,
        });
      }
    }
  }

  // Guide circles through the first research and through the first age.
  const ringThrough = (id: TechIdValue): number[] => {
    const p = at.get(id);
    return p && shown.has(id) ? [Math.hypot(p.x - centre.x, p.y - centre.y)] : [];
  };
  const rings = [...ringThrough(TechId.BARRACKS_PIKEMEN), ...ringThrough(TechId.CASTLE_AGE)];
  const height = shape.height + (placed.some((p) => p.y > shape.height) ? SPARE_ROW_H : 0);
  return { compact, width: BOARD_W, height, centre, rings, nodes: placed, links, junctions };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_VECTOR: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * The seal an arrow key moves to: the nearest one roughly in that direction
 * (within 65 degrees of it; seals straight ahead win over closer ones off
 * to the side). Null when nothing lies that way.
 */
export function neighbourInDirection(nodes: readonly PlacedNode[], fromId: string, direction: Direction): string | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const dir = DIRECTION_VECTOR[direction];
  let best: string | null = null;
  let bestScore = Infinity;
  for (const node of nodes) {
    if (node.id === fromId) continue;
    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const dist = Math.hypot(dx, dy);
    const along = dx * dir.x + dy * dir.y;
    if (along <= 0 || along / dist < Math.cos((65 * Math.PI) / 180)) continue;
    const score = dist * (3 - (2 * along) / dist);
    if (score < bestScore) {
      bestScore = score;
      best = node.id;
    }
  }
  return best;
}
