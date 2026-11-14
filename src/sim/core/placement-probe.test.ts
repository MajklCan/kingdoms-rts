import { describe, expect, it } from 'vitest';
import { MAP } from '../../config';
import { Position, Resource, ResourceKindId, type ResourceKind } from '../components';
import { BUILDING_TABLE } from '../defs';
import { canPlaceBuildingAt } from '../input/buildings';
import { MapId } from '../map-gen';
import { createSimWorld, resourceQuery } from '../world';
import { findNearestResource, findResourceAt } from './lookup';
import { ResourceProbe } from './placement-probe';

const KINDS: ResourceKind[] = [ResourceKindId.FOOD, ResourceKindId.WOOD, ResourceKindId.GOLD, ResourceKindId.STONE];

describe('ResourceProbe', () => {
  it('answers exactly like the plain lookups and canPlaceBuildingAt', () => {
    for (const mapId of [MapId.RIVERLANDS, MapId.KRKONOSE_WINTER_CROWN]) {
      const world = createSimWorld(4242, { mapId });
      // A few emptied and off-grid nodes, which the lookups treat differently.
      const nodes = [...resourceQuery(world.ecs)];
      Resource.amount[nodes[0]] = 0;
      Position.x[nodes[1]] += 0.4;
      Position.y[nodes[2]] -= 0.45;
      const probe = new ResourceProbe(world);
      let checked = 0;
      for (let y = -1; y <= MAP.HEIGHT; y += 1) {
        for (let x = -1; x <= MAP.WIDTH; x += 1) {
          for (const r of [0.35, 0.6]) {
            expect(probe.hasResourceAt(x, y, r), `${x},${y} r${r}`).toBe(findResourceAt(world, x, y, r) !== null);
          }
          for (const kind of KINDS) {
            const target = findNearestResource(world, x, y, kind, 6);
            const want = target === null ? null : Math.hypot(Position.x[target] - x, Position.y[target] - y);
            expect(probe.nearestDistance(x, y, kind, 6)).toBe(want);
          }
          for (const def of BUILDING_TABLE) {
            expect(canPlaceBuildingAt(world, def, x, y, probe), `${def.id} ${x},${y}`).toBe(canPlaceBuildingAt(world, def, x, y));
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT);
    }
  });
});
