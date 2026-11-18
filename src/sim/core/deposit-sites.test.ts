import { describe, expect, it } from 'vitest';
import { Position, Resource, ResourceKindId } from '../components';
import { MAP_DEFS, MapId, SKIRMISH_MAP_DEFS, normalizeSkirmishMapId } from '../map-gen';
import { createSimWorld, resourceQuery, type SimWorld } from '../world';
import { HOME_STONE_AMOUNT, HOME_STONE_NODES, mirrorThrough, planDeposits } from './deposit-sites';

interface Share {
  /** Within 16 tiles of the town and clearly on its side. */
  secure: number;
  /** Everything clearly nearer to this town than to the other (contested fields left out). */
  nearer: number;
}

function stoneShares(world: SimWorld, kind: number): { p1: Share; p2: Share; contested: number } {
  const [p1, p2] = [world.map.spawns[1]!, world.map.spawns[2]!];
  const out = { p1: { secure: 0, nearer: 0 }, p2: { secure: 0, nearer: 0 }, contested: 0 };
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] !== kind) continue;
    const d1 = Math.hypot(Position.x[eid] - p1.x, Position.y[eid] - p1.y);
    const d2 = Math.hypot(Position.x[eid] - p2.x, Position.y[eid] - p2.y);
    const amount = Resource.amount[eid];
    if (Math.abs(d1 - d2) < 6) {
      out.contested += amount;
      continue;
    }
    const side = d1 < d2 ? out.p1 : out.p2;
    side.nearer += amount;
    if (Math.min(d1, d2) <= 16) side.secure += amount;
  }
  return out;
}

describe('skirmish deposits', () => {
  it('gives both sides the same stone and gold on every skirmish map', () => {
    for (const def of SKIRMISH_MAP_DEFS) {
      for (const seed of [1, 2, 3]) {
        const world = createSimWorld(seed, { mapId: def.id });
        for (const kind of [ResourceKindId.STONE, ResourceKindId.GOLD]) {
          const shares = stoneShares(world, kind);
          const label = `${def.id} seed ${seed} kind ${kind}`;
          // One displaced node at most (a twin that had to step off water).
          expect(Math.abs(shares.p1.nearer - shares.p2.nearer), label).toBeLessThanOrEqual(1000);
          expect(Math.abs(shares.p1.secure - shares.p2.secure), label).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('puts a home field, a natural expansion and contested stone on every skirmish map', () => {
    const home = HOME_STONE_NODES * HOME_STONE_AMOUNT;
    for (const def of SKIRMISH_MAP_DEFS) {
      for (const seed of [1, 2]) {
        const stone = stoneShares(createSimWorld(seed, { mapId: def.id }), ResourceKindId.STONE);
        const label = `${def.id} seed ${seed}`;
        // Home plus a natural expansion in reach of each town.
        expect(stone.p1.secure, label).toBeGreaterThanOrEqual(home + 2000);
        expect(stone.p2.secure, label).toBeGreaterThanOrEqual(home + 2000);
        // And stone worth fighting over between them.
        expect(stone.contested, label).toBeGreaterThanOrEqual(4000);
      }
    }
  });

  it('plans mirrored sites and moves the centre to the shores when the middle is water', () => {
    const p1 = { x: 12, y: 50 };
    const p2 = { x: 51, y: 13 };
    const open = planDeposits({ width: 64, height: 64 }, p1, p2, () => true);
    expect(open.center).toEqual({ x: 32, y: 32 });
    expect(open.natural).not.toBeNull();
    expect(open.flanks).toHaveLength(1);
    const twin = mirrorThrough(open.mid, open.natural!);
    expect(Math.hypot(twin.x - p2.x, twin.y - p2.y)).toBeCloseTo(Math.hypot(open.natural!.x - p1.x, open.natural!.y - p1.y), 0);
    // A flank is as far from one town as from the other.
    const flank = open.flanks[0]!;
    expect(Math.abs(Math.hypot(flank.x - p1.x, flank.y - p1.y) - Math.hypot(flank.x - p2.x, flank.y - p2.y))).toBeLessThan(1.5);

    const lake = planDeposits({ width: 64, height: 64 }, p1, p2, (x, y) => Math.hypot(x - 31.5, y - 31.5) > 7);
    expect(lake.center).toBeNull();
    expect(lake.flanks.length).toBe(2);
    // On the shore: most of each field's 5 x 5 is dry land.
    for (const spot of lake.flanks) expect(Math.hypot(spot.x - 31.5, spot.y - 31.5)).toBeGreaterThan(5.5);
  });
});

describe('skirmish map list', () => {
  it('leaves the campaign-only Sudoměř map out of skirmish but keeps it for its mission', () => {
    expect(MAP_DEFS.some((def) => def.id === MapId.SUDOMER_PONDS)).toBe(true);
    expect(SKIRMISH_MAP_DEFS.some((def) => def.id === MapId.SUDOMER_PONDS)).toBe(false);
    expect(normalizeSkirmishMapId(MapId.SUDOMER_PONDS)).toBe(MapId.RIVERLANDS);
    expect(normalizeSkirmishMapId(MapId.BLANIK_NIGHT_WATCH)).toBe(MapId.BLANIK_NIGHT_WATCH);
  });
});
