import { describe, expect, it } from 'vitest';
import { TECH_TREE, TechId } from '../../sim/tech-tree';
import { CENTRE_ID, layoutTechTree, neighbourInDirection, type LayoutInput, type Point } from './tech-tree-layout';

const INPUT: LayoutInput[] = TECH_TREE.filter((t) => t.path !== 'start').map((t) => ({
  id: t.id,
  path: t.path,
  requires: t.requires ?? [],
  requiresAny: t.requiresAny ?? [],
}));

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe.each([
  ['roomy', false],
  ['compact', true],
])('tech tree layout (%s)', (_name, compact) => {
  const layout = layoutTechTree(INPUT, compact);

  it('places every research inside the board without overlapping seals', () => {
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(INPUT.map((n) => n.id).sort());
    const discs = [...layout.nodes, { id: CENTRE_ID, ...layout.centre }];
    for (const n of layout.nodes) {
      expect(n.x - n.r).toBeGreaterThan(0);
      expect(n.x + n.r).toBeLessThan(layout.width);
      expect(n.y - n.r).toBeGreaterThan(0);
      expect(n.y + n.r).toBeLessThan(layout.height);
    }
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const gap = Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y) - discs[i].r - discs[j].r;
        expect(gap, `${discs[i].id} / ${discs[j].id}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('draws the real requirement graph', () => {
    const pairs = layout.links.map((l) => `${l.from}>${l.to}`).sort();
    expect(pairs).toEqual(
      [
        `${CENTRE_ID}>${TechId.BARRACKS_PIKEMEN}`,
        `${CENTRE_ID}>${TechId.LUMBER_CREWS}`,
        `${TechId.BARRACKS_PIKEMEN}>${TechId.ARCHERS}`,
        `${TechId.BARRACKS_PIKEMEN}>${TechId.HOUSING_I}`,
        `${TechId.BARRACKS_PIKEMEN}>${TechId.MILLS}`,
        `${TechId.HOUSING_I}>${TechId.HOUSING_II}`,
        `${TechId.LUMBER_CREWS}>${TechId.MINING_CREWS}`,
        `${TechId.ARCHERS}>${TechId.CASTLE_AGE}`,
        `${TechId.MINING_CREWS}>${TechId.CASTLE_AGE}`,
        `${TechId.MILLS}>${TechId.FARMS}`,
        `${TechId.FARMS}>${TechId.FARMS_II}`,
        `${TechId.CASTLE_AGE}>${TechId.GUNPOWDER_AGE}`,
      ].sort()
    );
    expect(layout.junctions.map((j) => j.to)).toEqual([TechId.CASTLE_AGE]);
  });

  it('has no crossing links and no link running through a seal', () => {
    const discs = [...layout.nodes, { id: CENTRE_ID, ...layout.centre }];
    for (let i = 0; i < layout.links.length; i++) {
      const a = layout.links[i];
      for (let j = i + 1; j < layout.links.length; j++) {
        const b = layout.links[j];
        expect(segmentsCross(a.a, a.b, b.a, b.b), `${a.from}>${a.to} x ${b.from}>${b.to}`).toBe(false);
      }
      for (const d of discs) {
        if (d.id === a.from || d.id === a.to) continue;
        expect(distToSegment(d, a.a, a.b), `${a.from}>${a.to} near ${d.id}`).toBeGreaterThan(d.r + 0.8);
      }
    }
  });

  it('puts deeper research further from the emblem along each chain', () => {
    const dist = (id: string): number => {
      const n = layout.nodes.find((p) => p.id === id)!;
      return Math.hypot(n.x - layout.centre.x, n.y - layout.centre.y);
    };
    for (const link of layout.links) {
      if (link.from === CENTRE_ID) continue;
      expect(dist(link.to), `${link.from}>${link.to}`).toBeGreaterThan(dist(link.from));
    }
  });

  it('gives research without a designed slot a place below the chart', () => {
    const extra = layoutTechTree([...INPUT, { id: 'future_tech', path: 'military', requires: [], requiresAny: [] }], compact);
    const node = extra.nodes.find((n) => n.id === 'future_tech')!;
    expect(node.y + node.r).toBeLessThan(extra.height);
    expect(extra.height).toBeGreaterThan(layout.height);
  });

  it('moves focus with the arrow keys to the seal in that direction', () => {
    expect(neighbourInDirection(layout.nodes, TechId.BARRACKS_PIKEMEN, 'right')).toBe(TechId.ARCHERS);
    expect(neighbourInDirection(layout.nodes, TechId.BARRACKS_PIKEMEN, 'left')).toBe(TechId.HOUSING_I);
    expect(neighbourInDirection(layout.nodes, TechId.BARRACKS_PIKEMEN, 'down')).toBe(TechId.LUMBER_CREWS);
    expect(neighbourInDirection(layout.nodes, TechId.CASTLE_AGE, 'right')).toBe(TechId.GUNPOWDER_AGE);
    expect(neighbourInDirection(layout.nodes, TechId.GUNPOWDER_AGE, 'right')).toBeNull();
  });
});
