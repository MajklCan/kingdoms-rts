import { describe, expect, it } from 'vitest';
import { BANNER, CENTRE_ID, layoutTechTree, neighbourInDirection, RING_LABEL, SEAL_R, type Box, type LayoutInput, type Point } from './tech-tree-layout';
import { fixtureTree } from './tech-tree.fixture';
import { layoutInput } from './tech-tree-view';

const INPUT: LayoutInput[] = layoutInput(fixtureTree().nodes);

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function boxHitsCircle(box: Box, c: Point, r: number): boolean {
  const dx = c.x - Math.max(box.x0, Math.min(c.x, box.x1));
  const dy = c.y - Math.max(box.y0, Math.min(c.y, box.y1));
  return Math.hypot(dx, dy) < r;
}

function around(c: Point, w: number, h: number): Box {
  return { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
}

describe('ring chart layout', () => {
  const layout = layoutTechTree(INPUT);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const reach = (p: Point): number => Math.hypot(p.x - layout.centre.x, p.y - layout.centre.y);
  const angle = (p: Point): number => Math.atan2(layout.centre.y - p.y, p.x - layout.centre.x);

  it('draws true circles around the middle of a square chart', () => {
    expect(layout.width).toBe(layout.height);
    expect(layout.centre.x).toBe(layout.width / 2);
    expect(layout.centre.y).toBe(layout.height / 2);
    expect(layout.bands.map((b) => b.ring)).toEqual([1, 2, 3]);
    expect(layout.bands[0]!.r).toBeGreaterThan(layout.centre.well);
    expect(layout.bands[1]!.r).toBeGreaterThan(layout.bands[0]!.r);
    expect(layout.bands[2]!.r).toBeGreaterThan(layout.bands[1]!.r);
    expect(layout.bands[2]!.r).toBeLessThan(layout.width / 2);
  });

  it('gives every seal a comfortable size and air to its neighbours, whatever the dialog', () => {
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(INPUT.map((n) => n.id).sort());
    for (const n of layout.nodes) {
      expect(n.r).toBe(SEAL_R);
      expect(n.r).toBeGreaterThanOrEqual(2.2);
      for (const m of layout.nodes) {
        if (m.id !== n.id) expect(Math.hypot(n.x - m.x, n.y - m.y)).toBeGreaterThan(n.r + m.r + 1.5);
      }
    }
  });

  it('puts each seal in the band of its ring, clear of the settlement', () => {
    const edges = [layout.centre.well, ...layout.bands.map((b) => b.r)];
    for (const n of layout.nodes) {
      expect(reach(n) - n.r).toBeGreaterThan(edges[n.ring - 1]!);
      expect(reach(n) + n.r).toBeLessThan(edges[n.ring]!);
    }
  });

  it('spreads the five paths evenly and runs each outward along its ray', () => {
    const rays = new Map<string, number>();
    for (const n of layout.nodes) {
      const a = angle(n);
      if (!rays.has(n.path)) rays.set(n.path, a);
      expect(Math.cos(a)).toBeCloseTo(Math.cos(rays.get(n.path)!), 6);
      expect(Math.sin(a)).toBeCloseTo(Math.sin(rays.get(n.path)!), 6);
    }
    const sorted = [...rays.values()].map((a) => (a + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
    sorted.forEach((a, i) => {
      const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 2 * Math.PI;
      expect(next - a).toBeCloseTo((2 * Math.PI) / 5, 6);
    });
    for (const node of INPUT) {
      const parent = node.parents[0];
      if (parent && INPUT.find((n) => n.id === parent)?.path === node.path) expect(reach(byId.get(node.id)!)).toBeGreaterThan(reach(byId.get(parent)!));
    }
  });

  it('links each research to its parent on the path, roots to the settlement', () => {
    const main = layout.links.filter((l) => !l.cross);
    expect(main).toHaveLength(INPUT.length);
    for (const node of INPUT) {
      const link = main.find((l) => l.to === node.id)!;
      expect(link.from).toBe(node.parents[0] ?? CENTRE_ID);
      expect(link.path).toBe(node.path);
    }
  });

  it('draws a prerequisite on another path as a cross link between neighbouring rays', () => {
    const crossLinks = layout.links.filter((l) => l.cross);
    expect(crossLinks.map((l) => `${l.from}>${l.to}`)).toEqual(['gold_mines>knights']);
    expect(crossLinks[0]!.path).toBe('mines');
    // It keeps to ring II all the way.
    for (const p of crossLinks[0]!.points) {
      expect(reach(p)).toBeGreaterThan(layout.bands[0]!.r);
      expect(reach(p)).toBeLessThan(layout.bands[1]!.r);
    }
  });

  it('keeps links from crossing each other or running through a seal', () => {
    const segments = layout.links.flatMap((l) => l.points.slice(1).map((b, i) => ({ link: l, a: l.points[i]!, b })));
    for (const s of segments) {
      for (const t of segments) {
        if (s.link !== t.link) expect(segmentsCross(s.a, s.b, t.a, t.b)).toBe(false);
      }
      for (const n of layout.nodes) {
        if (n.id === s.link.from || n.id === s.link.to) continue;
        expect(distToSegment(n, s.a, s.b)).toBeGreaterThan(n.r);
      }
    }
  });

  it('gives each path a gate on every ring edge that leads further, beside the ray', () => {
    const lastRing = Math.max(...INPUT.map((n) => n.ring));
    const want = INPUT.filter((n) => n.ring < lastRing).map((n) => `${n.ring}:${n.path}`);
    expect(layout.gates.map((g) => `${g.ring}:${g.path}`).sort()).toEqual([...new Set(want)].sort());
    for (const gate of layout.gates) {
      expect(reach(gate)).toBeCloseTo(layout.bands[gate.ring - 1]!.r, 6);
      for (const n of layout.nodes) expect(Math.hypot(n.x - gate.x, n.y - gate.y)).toBeGreaterThan(n.r + 1.2);
    }
  });

  it('places names and costs clear of seals, links, plates, banners and each other', () => {
    const linkPoints = layout.links.flatMap((l) => l.points);
    for (const n of layout.nodes) {
      expect(n.label.x0).toBeGreaterThanOrEqual(0);
      expect(n.label.y0).toBeGreaterThanOrEqual(0);
      expect(n.label.x1).toBeLessThanOrEqual(layout.width);
      expect(n.label.y1).toBeLessThanOrEqual(layout.height);
      expect(boxHitsCircle(n.label, layout.centre, layout.centre.r)).toBe(false);
      for (const m of layout.nodes) {
        expect(boxHitsCircle(n.label, m, m.r)).toBe(false);
        if (m.id !== n.id) expect(boxesOverlap(n.label, m.label)).toBe(false);
      }
      for (const p of linkPoints) expect(p.x > n.label.x0 && p.x < n.label.x1 && p.y > n.label.y0 && p.y < n.label.y1).toBe(false);
      for (const gate of layout.gates) expect(boxHitsCircle(n.label, gate, 0.7)).toBe(false);
      for (const plate of layout.ringLabels) expect(boxesOverlap(n.label, around(plate, RING_LABEL.w, RING_LABEL.h))).toBe(false);
      for (const p of layout.paths) expect(boxesOverlap(n.label, around(p.banner, BANNER.w, BANNER.h))).toBe(false);
    }
  });

  it('names every ring on its band, all on one line between two paths', () => {
    expect(layout.ringLabels.map((l) => l.ring)).toEqual([1, 2, 3]);
    const edges = [layout.centre.well, ...layout.bands.map((b) => b.r)];
    for (const plate of layout.ringLabels) {
      expect(plate.x).toBeCloseTo(layout.centre.x, 6);
      expect(plate.y).toBeLessThan(layout.centre.y);
      expect(reach(plate)).toBeGreaterThan(edges[plate.ring - 1]!);
      expect(reach(plate)).toBeLessThan(edges[plate.ring]!);
      for (const n of layout.nodes) expect(boxHitsCircle(around(plate, RING_LABEL.w, RING_LABEL.h), n, n.r)).toBe(false);
    }
  });

  it('ends every path in a banner beyond the outer ring, inside the chart', () => {
    expect(layout.paths.map((p) => p.path).sort()).toEqual(['arms', 'land', 'mines', 'timber', 'walls']);
    const outer = layout.bands[layout.bands.length - 1]!.r;
    for (const p of layout.paths) {
      expect(reach(p.banner)).toBeGreaterThan(outer + BANNER.h / 2);
      const box = around(p.banner, BANNER.w, BANNER.h);
      expect(box.x0).toBeGreaterThan(0);
      expect(box.y0).toBeGreaterThan(0);
      expect(box.x1).toBeLessThan(layout.width);
      expect(box.y1).toBeLessThan(layout.height);
      const seal = layout.nodes.find((n) => n.path === p.path)!;
      expect(Math.cos(angle(p.banner))).toBeCloseTo(Math.cos(angle(seal)), 6);
      expect(Math.sin(angle(p.banner))).toBeCloseTo(Math.sin(angle(seal)), 6);
    }
  });

  it('moves focus with the arrow keys and reaches every seal', () => {
    const seen = new Set<string>([INPUT[0]!.id]);
    const queue = [INPUT[0]!.id];
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const next = neighbourInDirection(layout.nodes, id, dir);
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(INPUT.length);
    expect(neighbourInDirection(layout.nodes, 'mining_crews', 'right')).toBe('gold_mines');
    expect(neighbourInDirection(layout.nodes, 'palisades', 'left')).toBe('watchtowers');
    expect(neighbourInDirection(layout.nodes, 'mills', 'down')).toBe('farms');
  });
});

describe('ring chart layout with other data', () => {
  it('lays out paths and rings it has never heard of', () => {
    const input: LayoutInput[] = [
      { id: 'a1', path: 'faith', ring: 1, parents: [] },
      { id: 'a2', path: 'faith', ring: 1, parents: ['a1'] },
      { id: 'a3', path: 'faith', ring: 1, parents: ['a2'] },
      { id: 'b1', path: 'trade', ring: 1, parents: [] },
      { id: 'b2', path: 'trade', ring: 2, parents: ['b1', 'a3'] },
      { id: 'b3', path: 'trade', ring: 4, parents: ['b2'] },
    ];
    const layout = layoutTechTree(input);
    const reach = (p: Point): number => Math.hypot(p.x - layout.centre.x, p.y - layout.centre.y);
    expect(layout.nodes).toHaveLength(6);
    expect(layout.bands.map((b) => b.ring)).toEqual([1, 2, 3, 4]);
    for (const n of layout.nodes) {
      for (const m of layout.nodes) if (m.id !== n.id) expect(Math.hypot(n.x - m.x, n.y - m.y)).toBeGreaterThan(n.r + m.r);
    }
    // Within a band, children sit further out than their parents.
    const [a1, a2, a3] = ['a1', 'a2', 'a3'].map((id) => layout.nodes.find((n) => n.id === id)!);
    expect(reach(a1!)).toBeLessThan(reach(a2!));
    expect(reach(a2!)).toBeLessThan(reach(a3!));
    expect(layout.links.filter((l) => l.cross).map((l) => `${l.from}>${l.to}`)).toEqual(['a3>b2']);
    expect(layout.paths.map((p) => p.path)).toEqual(['faith', 'trade']);
  });
});
