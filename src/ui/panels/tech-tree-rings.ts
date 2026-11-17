/**
 * Ring rules as the Technology panel reads them. Pure data, no DOM.
 *
 * Research lies on five paths that cross three rings. Ring N+1 opens once
 * enough paths are "complete" in ring N: every research of that path lying
 * in ring N is done. The sim owns the rule (`scene.getTechRings`); this
 * file holds the shapes the panel works with, the same rule derived from a
 * node list (for fixtures and as a fallback), and what the panel marks when
 * it is opened for a goal.
 */

import { parseCost, RESOURCE_KEYS } from '../format';

/** A research as the panel sees it (a structural subset of the scene's TechTreeNode). */
export interface TechNode {
  id: string;
  name: string;
  description: string;
  /** Key into TECH_ICON; equal to the tech id. */
  icon: string;
  path: string;
  ring: number;
  /** All prerequisites: the parent on the same path first, then any on another path. */
  parents: readonly string[];
  /** "250 wood 150 stone" */
  cost: string;
  unlocks: readonly string[];
  /** 'researched' | 'available' | 'locked' */
  status: string;
  affordable: boolean;
  /** Why a locked research is locked, in the player's words. */
  lockedReason?: string;
}

export interface RingState {
  ring: number;
  open: boolean;
  /** Complete paths the ring before must have for this ring to open. */
  need: number;
  /** Paths complete in this ring. */
  maxedPaths: readonly string[];
  /** Paths that have research in this ring. */
  pathsWithContent: readonly string[];
}

export interface TechRings {
  openRing: number;
  rings: readonly RingState[];
}

export const PATHS_NEEDED = 2;

export const RING_NUMERAL = ['', 'I', 'II', 'III', 'IV', 'V'];
const RING_ERA = ['', 'Dark Age', 'Castle Age', 'Gunpowder Age'];

export function ringNumeral(ring: number): string {
  return RING_NUMERAL[ring] ?? String(ring);
}

/** The era a ring stands for; buildings take that look once it opens. */
export function ringEra(ring: number): string {
  return RING_ERA[ring] ?? `Ring ${ringNumeral(ring)}`;
}

const PATH_NAME: Record<string, string> = {
  arms: 'Arms',
  timber: 'Timber',
  mines: 'Mines',
  walls: 'Walls',
  land: 'Land',
};

export function pathName(path: string): string {
  return PATH_NAME[path] ?? path.charAt(0).toUpperCase() + path.slice(1);
}

function isDone(node: TechNode | undefined): boolean {
  return node?.status === 'researched';
}

/** The ring rule worked out from the node list alone. */
export function deriveRings(nodes: readonly TechNode[], need = PATHS_NEEDED): TechRings {
  const last = nodes.reduce((max, n) => Math.max(max, n.ring), 1);
  const rings: RingState[] = [];
  let open = true;
  for (let ring = 1; ring <= last; ring++) {
    const inRing = nodes.filter((n) => n.ring === ring);
    const pathsWithContent = [...new Set(inRing.map((n) => n.path))];
    const maxedPaths = pathsWithContent.filter((path) => inRing.every((n) => n.path !== path || isDone(n)));
    rings.push({ ring, open, need, maxedPaths, pathsWithContent });
    open = open && maxedPaths.length >= need;
  }
  return { openRing: rings.reduce((top, r) => (r.open ? r.ring : top), 1), rings };
}

export function ringState(rings: TechRings, ring: number): RingState | undefined {
  return rings.rings.find((r) => r.ring === ring);
}

/** The ring that opens next, with how far along it is; undefined once every ring is open. */
export function nextRingProgress(rings: TechRings): { ring: number; done: number; need: number; from: RingState } | undefined {
  const closed = rings.rings.find((r) => !r.open);
  const from = closed && ringState(rings, closed.ring - 1);
  if (!closed || !from) return undefined;
  return { ring: closed.ring, done: Math.min(from.maxedPaths.length, closed.need), need: closed.need, from };
}

/** What the chart marks when the panel was opened for a goal. */
export interface GoalMarks {
  /** The research the player asked for, if any. */
  goalId: string | null;
  /** The ring the player wants opened, if any. */
  goalRing: number | null;
  /** Research still to do on the way there. */
  pathIds: ReadonlySet<string>;
  /** One sentence for the foot of the dialog; empty when there is nothing to say. */
  note: string;
}

export const NO_GOAL: GoalMarks = { goalId: null, goalRing: null, pathIds: new Set(), note: '' };

/** Unresearched prerequisites of `id`, nearest last, without `id` itself. */
function missingAncestors(id: string, byId: ReadonlyMap<string, TechNode>, into = new Set<string>()): Set<string> {
  for (const parentId of byId.get(id)?.parents ?? []) {
    const parent = byId.get(parentId);
    if (!parent || isDone(parent) || into.has(parentId)) continue;
    missingAncestors(parentId, byId, into);
    into.add(parentId);
  }
  return into;
}

function names(ids: Iterable<string>, byId: ReadonlyMap<string, TechNode>): string {
  const list = [...ids].map((id) => byId.get(id)?.name ?? id);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function ringClause(rings: TechRings, ring: number): string {
  const next = nextRingProgress(rings);
  const state = ringState(rings, ring);
  if (!state || state.open || !next) return '';
  if (next.ring !== ring) return `ring ${ringNumeral(ring)} to open`;
  return `ring ${ringNumeral(ring)} to open (${next.done} of ${next.need} paths complete in ring ${ringNumeral(ring - 1)})`;
}

/** Marks for "I want this research": it and every research it still needs. */
export function techGoalMarks(goalId: string, nodes: readonly TechNode[], rings: TechRings): GoalMarks {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const goal = byId.get(goalId);
  if (!goal) return NO_GOAL;
  if (isDone(goal)) return { goalId, goalRing: null, pathIds: new Set(), note: `${goal.name} is researched.` };
  const pathIds = missingAncestors(goalId, byId);
  const needs: string[] = [];
  if (pathIds.size > 0) needs.push(names(pathIds, byId));
  const ring = ringClause(rings, goal.ring);
  if (ring) needs.push(ring);
  const note = needs.length > 0 ? `${goal.name} needs ${needs.join(', and ')}.` : `${goal.name} is ready to research.`;
  return { goalId, goalRing: null, pathIds, note };
}

function totalCost(ids: Iterable<string>, byId: ReadonlyMap<string, TechNode>): number {
  let sum = 0;
  for (const id of ids) {
    const cost = parseCost(byId.get(id)?.cost);
    for (const key of RESOURCE_KEYS) sum += cost[key] ?? 0;
  }
  return sum;
}

/** Every way to pick `count` items, in list order. */
function combinations<T>(items: readonly T[], count: number): T[][] {
  if (count <= 0) return [[]];
  if (items.length < count) return [];
  const [first, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, count - 1).map((combo) => [first, ...combo]), ...combinations(rest, count)];
}

/**
 * Marks for "I want the next ring": the cheapest research that completes
 * the paths still missing in the open ring. Cost is the sum of all four
 * resources; research shared by two paths (a prerequisite on another path)
 * counts once.
 */
export function ringGoalMarks(nodes: readonly TechNode[], rings: TechRings): GoalMarks {
  const next = nextRingProgress(rings);
  if (!next) return { ...NO_GOAL, note: 'Every ring is open.' };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { from } = next;
  const still = next.need - next.done;
  const todo = (path: string): Set<string> => {
    const ids = new Set<string>();
    for (const node of nodes) {
      if (node.path !== path || node.ring !== from.ring || isDone(node)) continue;
      missingAncestors(node.id, byId, ids);
      ids.add(node.id);
    }
    return ids;
  };
  const open = from.pathsWithContent.filter((path) => !from.maxedPaths.includes(path));
  let best: { ids: Set<string>; paths: string[]; cost: number } | null = null;
  for (const paths of combinations(open, still)) {
    const ids = new Set(paths.flatMap((path) => [...todo(path)]));
    const cost = totalCost(ids, byId);
    if (!best || cost < best.cost || (cost === best.cost && ids.size < best.ids.size)) best = { ids, paths, cost };
  }
  const head = `Ring ${ringNumeral(next.ring)} (${ringEra(next.ring)}) opens when ${next.need} paths are complete in ring ${ringNumeral(from.ring)}: ${next.done} of ${next.need} so far.`;
  if (!best) return { goalId: null, goalRing: next.ring, pathIds: new Set(), note: head };
  const way = `Cheapest way: ${names(best.ids, byId)} (${best.paths.map(pathName).join(' and ')}).`;
  return { goalId: null, goalRing: next.ring, pathIds: best.ids, note: `${head} ${way}` };
}

/** Why a locked research is locked: the sim's words, else worked out from the chart. */
export function lockReason(node: TechNode, nodes: readonly TechNode[], rings: TechRings): string {
  if (node.lockedReason) return node.lockedReason;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const missing = node.parents.filter((id) => byId.has(id) && !isDone(byId.get(id)));
  if (missing.length > 0) return `Needs ${names(missing, byId)}`;
  const ring = ringClause(rings, node.ring);
  if (ring) return `Needs ${ring}`;
  return 'Not available in this mission';
}
