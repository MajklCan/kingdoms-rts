/**
 * Geometry of the ring chart in the Technology panel. Pure math, no DOM.
 *
 * The settlement sits in the middle. Around it lie the ring bands (I, II,
 * III) as true circles, and the research paths run outward through them as
 * straight rays, evenly spread. The chart is drawn at a comfortable size
 * and is usually larger than the dialog: the panel pans and zooms over it
 * (tech-tree-viewport.ts), it is never squeezed to fit.
 *
 * Nothing here knows a research by name. A seal's place follows from its
 * path (which ray), its ring (which band) and its parents (its order inside
 * the band; a parent on another path becomes a curved cross link). A band
 * is as wide as its fullest path needs. Names and costs sit beside the
 * seals where they collide with nothing.
 *
 * All lengths are in rem.
 */

export interface LayoutInput {
  id: string;
  path: string;
  ring: number;
  /** Prerequisites: the parent on the same path first, then any on another path. */
  parents: readonly string[];
  /** Width of the name-and-cost label beside the seal. */
  labelW?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type LabelSide = 'below' | 'above' | 'right' | 'left';

export interface PlacedNode extends Point {
  id: string;
  path: string;
  ring: number;
  /** Seal radius. */
  r: number;
  /** Where the name and cost sit; text is centred above and below, and starts at the seal on the sides. */
  side: LabelSide;
  label: Box;
}

export interface PlacedLink {
  /** Parent research, or CENTRE_ID for the settlement. */
  from: string;
  to: string;
  /** Path whose colour the link wears. */
  path: string;
  /** Rim to rim; a cross link (a parent on another path) bends along its ring. */
  points: Point[];
  cross: boolean;
}

export interface PlacedBand {
  ring: number;
  /** Radius of the band's outer edge. */
  r: number;
}

/** The mark on a ring's outer edge that fills when a path is complete in that ring. */
export interface PlacedGate extends Point {
  ring: number;
  path: string;
}

/** A path's ray from the settlement to its name banner beyond the outer ring. */
export interface PlacedPath {
  path: string;
  from: Point;
  to: Point;
  /** Centre of the name banner. */
  banner: Point;
}

/** Where a ring's name plate sits: on the band, just inside its outer edge, between two paths. */
export interface PlacedRingLabel extends Point {
  ring: number;
}

export interface TechLayout {
  width: number;
  height: number;
  /** The settlement's medallion (`r`) in its clear disc (`well`), where ring I begins. */
  centre: Point & { r: number; well: number };
  bands: PlacedBand[];
  nodes: PlacedNode[];
  links: PlacedLink[];
  gates: PlacedGate[];
  paths: PlacedPath[];
  ringLabels: PlacedRingLabel[];
}

export const CENTRE_ID = 'centre';

/** Radius of the clear disc around the settlement, where ring I begins. */
const CENTRE_R = 6.6;
const EMBLEM_R = 5.2;
export const SEAL_R = 2.3;
/** Room one seal takes along its ray: the seal and the air around it. */
const SLOT = 6.4;
/** Beyond the outer ring: the path banners, then a margin. */
const BANNER_REACH = 2.9;
const MARGIN = 7.2;
/** Clear field between a seal rim and the end of a link. */
const LINK_GAP = 0.35;
const LABEL_GAP = 0.4;
const LABEL_H = 2.6;
const LABEL_AIR = 0.4;
const DEFAULT_LABEL_W = 7;
/** How far a gate sits to the side of its ray, along the ring edge. */
const GATE_OFFSET = 3.6;
const GATE_R = 0.75;
export const RING_LABEL: Readonly<{ w: number; h: number; inset: number }> = { w: 12.5, h: 2.2, inset: 1.9 };
export const BANNER: Readonly<{ w: number; h: number }> = { w: 7, h: 2 };

/** Paths the chart knows take the rays in this order (arms next to mines, which it borrows from); others follow. */
const PATH_ORDER = ['mines', 'arms', 'timber', 'walls', 'land'];
/** Angle of the first ray in degrees, anticlockwise from east; the rest follow evenly. */
const FIRST_RAY = -18;

function at(centre: Point, r: number, deg: number): Point {
  const t = (deg * Math.PI) / 180;
  return { x: centre.x + r * Math.cos(t), y: centre.y - r * Math.sin(t) };
}

/** Each path's ray angle. */
function assignRays(nodes: readonly LayoutInput[]): Map<string, number> {
  const found = [...new Set(nodes.map((n) => n.path))];
  const paths = [...PATH_ORDER.filter((p) => found.includes(p)), ...found.filter((p) => !PATH_ORDER.includes(p))];
  return new Map(paths.map((path, i) => [path, FIRST_RAY + (i * 360) / paths.length]));
}

/** The angle for the ring name plates: the middle of the widest gap between rays, the one nearest the top. */
function ladderAngle(rays: ReadonlyMap<string, number>): number {
  const angles = [...rays.values()].map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
  if (angles.length === 0) return 90;
  let best = 90;
  let bestScore = -Infinity;
  angles.forEach((a, i) => {
    const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 360;
    const mid = (a + next) / 2;
    const fromTop = Math.abs(((mid - 90 + 540) % 360) - 180);
    const score = (next - a) * 10 - fromTop;
    if (score > bestScore) {
      bestScore = score;
      best = mid;
    }
  });
  return best;
}

/** Seals of one path in one ring, parents before children. */
function orderInBand(group: readonly LayoutInput[]): LayoutInput[] {
  const depth = (node: LayoutInput, seen = new Set<string>()): number => {
    if (seen.has(node.id)) return 0;
    seen.add(node.id);
    const inside = node.parents.map((id) => group.find((n) => n.id === id)).filter((n): n is LayoutInput => !!n);
    return inside.reduce((max, parent) => Math.max(max, depth(parent, seen) + 1), 0);
  };
  return [...group].sort((a, b) => depth(a) - depth(b));
}

function intersects(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function boxHitsCircle(box: Box, c: Point, r: number): boolean {
  const dx = c.x - Math.max(box.x0, Math.min(c.x, box.x1));
  const dy = c.y - Math.max(box.y0, Math.min(c.y, box.y1));
  return dx * dx + dy * dy < r * r;
}

function boxHitsPoint(box: Box, p: Point, pad: number): boolean {
  return p.x > box.x0 - pad && p.x < box.x1 + pad && p.y > box.y0 - pad && p.y < box.y1 + pad;
}

function centred(c: Point, w: number, h: number): Box {
  return { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
}

/** Points along a polyline, about `step` apart. */
function sample(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

interface Obstacles {
  width: number;
  height: number;
  circles: Array<Point & { r: number }>;
  boxes: Box[];
  points: Point[];
}

/** How badly a label box collides with what is already on the chart (0 = clear). */
function collisions(box: Box, obstacles: Obstacles): number {
  let score = 0;
  if (box.x0 < 0.2 || box.y0 < 0.2 || box.x1 > obstacles.width - 0.2 || box.y1 > obstacles.height - 0.2) score += 100;
  for (const c of obstacles.circles) if (boxHitsCircle(box, c, c.r + 0.3)) score += 10;
  // Text needs air beside it: other boxes count from a little way off sideways.
  const wide = { ...box, x0: box.x0 - LABEL_AIR, x1: box.x1 + LABEL_AIR };
  for (const b of obstacles.boxes) if (intersects(wide, b)) score += 10;
  for (const p of obstacles.points) if (boxHitsPoint(box, p, 0.25)) score += 1;
  return score;
}

function labelBox(node: Point & { r: number }, side: LabelSide, w: number, shift: number): Box {
  const off = node.r + LABEL_GAP;
  if (side === 'below') return { x0: node.x - w / 2 + shift, y0: node.y + off, x1: node.x + w / 2 + shift, y1: node.y + off + LABEL_H };
  if (side === 'above') return { x0: node.x - w / 2 + shift, y0: node.y - off - LABEL_H, x1: node.x + w / 2 + shift, y1: node.y - off };
  if (side === 'right') return { x0: node.x + off, y0: node.y - LABEL_H / 2 + shift, x1: node.x + off + w, y1: node.y + LABEL_H / 2 + shift };
  return { x0: node.x - off - w, y0: node.y - LABEL_H / 2 + shift, x1: node.x - off, y1: node.y + LABEL_H / 2 + shift };
}

interface LabelCandidate {
  side: LabelSide;
  shift: number;
  /** How far this place is from the one the label would take on an empty chart. */
  penalty: number;
}

/**
 * Places to try for a seal's label. Beside a flat ray the label belongs
 * under the seal, else over it; beside a steep one it belongs at the seal's
 * side, on the outer side of the chart first. Every side is also tried slid
 * along the seal in small steps, each step a little less welcome.
 */
function labelCandidates(node: Point & { r: number }, w: number, centre: Point): LabelCandidate[] {
  const dx = node.x - centre.x;
  const dy = node.y - centre.y;
  const outer: LabelSide = dx >= -0.01 ? 'right' : 'left';
  const inner: LabelSide = outer === 'right' ? 'left' : 'right';
  const away: LabelSide = dy < 0 ? 'above' : 'below';
  const toward: LabelSide = dy < 0 ? 'below' : 'above';
  const flat = Math.abs(dy) < Math.abs(dx) * 0.6;
  // [side, how unwelcome the side is]
  const sides: Array<[LabelSide, number]> = flat
    ? [
        ['below', 0],
        ['above', 0.5],
        [outer, 4],
        [inner, 4.5],
      ]
    : [
        [outer, 0],
        [inner, 0.5],
        [away, 3],
        [toward, 3.5],
      ];
  const out: LabelCandidate[] = [];
  for (const [side, unwelcome] of sides) {
    const reach = side === 'above' || side === 'below' ? w / 2 : LABEL_H / 2 + node.r * 0.5;
    for (let step = -4; step <= 4; step++) out.push({ side, shift: (step * reach) / 4, penalty: unwelcome + Math.abs(step) * 0.6 });
  }
  return out.sort((a, b) => a.penalty - b.penalty);
}

/** The best place for one label given everything else on the chart: the clearest, then the most welcome. */
function placeLabel(node: Point & { r: number }, w: number, centre: Point, obstacles: Obstacles): { side: LabelSide; label: Box; score: number } {
  let best: { side: LabelSide; label: Box; score: number } | null = null;
  for (const { side, shift } of labelCandidates(node, w, centre)) {
    const label = labelBox(node, side, w, shift);
    const score = collisions(label, obstacles);
    if (!best || score < best.score) best = { side, label, score };
    if (score === 0) break;
  }
  return best!;
}

/** Trim a polyline so it starts and ends `startGap` / `endGap` short of its end points. */
function trimmed(points: readonly Point[], startGap: number, endGap: number): Point[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const kept = points.filter((p) => Math.hypot(p.x - first.x, p.y - first.y) >= startGap && Math.hypot(p.x - last.x, p.y - last.y) >= endGap);
  return kept.length >= 2 ? kept : [first, last];
}

export function layoutTechTree(nodes: readonly LayoutInput[]): TechLayout {
  const rays = assignRays(nodes);
  const lastRing = nodes.reduce((max, n) => Math.max(max, n.ring), 1);
  const group = (path: string, ring: number): LayoutInput[] => orderInBand(nodes.filter((n) => n.path === path && n.ring === ring));

  // A band is as wide as its fullest path needs.
  const edges = [CENTRE_R];
  for (let ring = 1; ring <= lastRing; ring++) {
    let most = 1;
    for (const path of rays.keys()) most = Math.max(most, group(path, ring).length);
    edges.push(edges[edges.length - 1]! + most * SLOT);
  }
  const outer = edges[edges.length - 1]!;
  const half = outer + MARGIN;
  const mid: Point = { x: half, y: half };
  const centre = { ...mid, r: EMBLEM_R, well: CENTRE_R };

  const polar = new Map<string, { r: number; deg: number }>();
  for (const [path, deg] of rays) {
    for (let ring = 1; ring <= lastRing; ring++) {
      const seals = group(path, ring);
      const inner = edges[ring - 1]!;
      const width = edges[ring]! - inner;
      seals.forEach((node, i) => polar.set(node.id, { r: inner + ((i + 0.5) / seals.length) * width, deg }));
    }
  }
  const spot = new Map<string, Point>();
  for (const [id, p] of polar) spot.set(id, at(mid, p.r, p.deg));

  const shown = new Set(nodes.map((n) => n.id));
  const links: PlacedLink[] = [];
  for (const node of nodes) {
    const to = spot.get(node.id);
    const here = polar.get(node.id);
    if (!to || !here) continue;
    const parents = node.parents.filter((id) => shown.has(id));
    const main = parents[0];
    const start = main ? spot.get(main)! : at(mid, EMBLEM_R, here.deg);
    links.push({ from: main ?? CENTRE_ID, to: node.id, path: node.path, cross: false, points: trimmed([start, to], main ? SEAL_R + LINK_GAP : LINK_GAP, SEAL_R + LINK_GAP) });
    for (const other of parents.slice(1)) {
      const from = polar.get(other);
      const fromPath = nodes.find((n) => n.id === other)?.path ?? node.path;
      if (!from) continue;
      // Along the ring: sweep the angle the short way round, easing the radius across.
      const sweep = ((here.deg - from.deg + 540) % 360) - 180;
      const steps = 40;
      const curve: Point[] = [];
      for (let k = 0; k <= steps; k++) curve.push(at(mid, from.r + ((here.r - from.r) * k) / steps, from.deg + (sweep * k) / steps));
      links.push({ from: other, to: node.id, path: fromPath, cross: true, points: trimmed(curve, SEAL_R + LINK_GAP, SEAL_R + LINK_GAP + 0.4) });
    }
  }

  const bands: PlacedBand[] = [];
  for (let ring = 1; ring <= lastRing; ring++) bands.push({ ring, r: edges[ring]! });

  // Gates on every edge that leads to a further ring, a short way anticlockwise of the ray.
  const gates: PlacedGate[] = [];
  for (let ring = 1; ring < lastRing; ring++) {
    for (const [path, deg] of rays) {
      if (group(path, ring).length === 0) continue;
      const r = edges[ring]!;
      gates.push({ ring, path, ...at(mid, r, deg + (GATE_OFFSET / r) * (180 / Math.PI)) });
    }
  }

  const paths: PlacedPath[] = [...rays].map(([path, deg]) => ({
    path,
    from: at(mid, EMBLEM_R, deg),
    to: at(mid, outer + BANNER_REACH - BANNER.h / 2, deg),
    banner: at(mid, outer + BANNER_REACH, deg),
  }));

  const ladder = ladderAngle(rays);
  const ringLabels: PlacedRingLabel[] = [];
  for (let ring = 1; ring <= lastRing; ring++) ringLabels.push({ ring, ...at(mid, edges[ring]! - RING_LABEL.inset, ladder) });

  const obstacles: Obstacles = {
    width: half * 2,
    height: half * 2,
    circles: [...[...spot.values()].map((p) => ({ ...p, r: SEAL_R })), { ...mid, r: CENTRE_R - 0.6 }],
    boxes: [
      ...gates.map((g) => centred(g, GATE_R * 2.6, GATE_R * 2.6)),
      ...ringLabels.map((l) => centred(l, RING_LABEL.w, RING_LABEL.h)),
      ...paths.map((p) => centred(p.banner, BANNER.w, BANNER.h)),
    ],
    points: [...links.flatMap((link) => sample(link.points, 0.5)), ...paths.flatMap((p) => sample([p.from, p.to], 0.5))],
  };

  // Labels: inner seals first, each where it is clearest. Then a few rounds in which every label is
  // placed again with all the others in view, so an early choice can give way.
  const fixed = obstacles.boxes;
  const byReach = [...nodes].sort((a, b) => (polar.get(a.id)?.r ?? 0) - (polar.get(b.id)?.r ?? 0)).filter((n) => spot.has(n.id));
  const labels = new Map<string, { side: LabelSide; label: Box; score: number }>();
  const place = (node: LayoutInput): void => {
    const others = [...labels].filter(([id]) => id !== node.id).map(([, l]) => l.label);
    labels.set(node.id, placeLabel({ ...spot.get(node.id)!, r: SEAL_R }, node.labelW ?? DEFAULT_LABEL_W, mid, { ...obstacles, boxes: [...fixed, ...others] }));
  };
  for (const node of byReach) place(node);
  for (let round = 0; round < 6 && [...labels.values()].some((l) => l.score > 0); round++) {
    for (const node of byReach) place(node);
  }
  const placed: PlacedNode[] = [];
  for (const node of nodes) {
    const p = spot.get(node.id);
    const found = labels.get(node.id);
    if (p && found) placed.push({ id: node.id, path: node.path, ring: node.ring, x: p.x, y: p.y, r: SEAL_R, side: found.side, label: found.label });
  }

  return { width: half * 2, height: half * 2, centre, bands, nodes: placed, links, gates, paths, ringLabels };
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
