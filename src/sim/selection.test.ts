import { describe, expect, it } from 'vitest';
import {
  createSimWorld,
  findBuildingAt,
  findEntityNear,
  selectUnitsOfSameKindInRadius,
  selectedQuery,
  setSelected,
  spawnArcher,
  spawnCompletedBuilding,
  spawnSpearman,
} from './world';
import { BuildingDefId } from './defs';

describe('selection helpers', () => {
  it('selects only owned same-kind units inside the radius', () => {
    const world = createSimWorld(123);
    const source = spawnArcher(world, 0, 0, 1);
    const nearbySameKind = spawnArcher(world, 2, 1, 1);
    const farSameKind = spawnArcher(world, 8, 0, 1);
    const enemySameKind = spawnArcher(world, 1, 1, 2);
    const nearbyOtherKind = spawnSpearman(world, 1, 0, 1);

    setSelected(world, nearbyOtherKind, true);

    const count = selectUnitsOfSameKindInRadius(world, source, 3, 1);
    const selected = new Set(selectedQuery(world.ecs));

    expect(count).toBe(2);
    expect(selected.has(source)).toBe(true);
    expect(selected.has(nearbySameKind)).toBe(true);
    expect(selected.has(farSameKind)).toBe(false);
    expect(selected.has(enemySameKind)).toBe(false);
    expect(selected.has(nearbyOtherKind)).toBe(false);
  });

  it('picks buildings by their full occupied footprint', () => {
    const world = createSimWorld(124);
    const barracks = spawnCompletedBuilding(world, BuildingDefId.BARRACKS, 4, 4, 1);

    expect(findBuildingAt(world, 3, 3, 0.01)).toBe(barracks);
    expect(findEntityNear(world, 3.2, 3.2, 0.7)).toBe(barracks);
    expect(findBuildingAt(world, 2, 3, 0.01)).toBeNull();
  });
});
