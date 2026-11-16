import { describe, expect, it } from 'vitest';
import { BuildingDefId } from '@sim/defs';
import {
  P1,
  completedBuilding,
  quietWorld,
  stepN,
  tcOf,
  villagersNear,
} from '@sim/testing/villager-jobs-fixture';
import { villagerStatusText } from './villager-status';

describe('villager status line', () => {
  it('says what a villager is doing', () => {
    const world = quietWorld();
    const farm = completedBuilding(world, BuildingDefId.FARM);
    const [idle, helper] = villagersNear(world, tcOf(world, P1), 2);
    expect(villagerStatusText(world, idle)).toBe('idle');
    world.inputs.push({ type: 'cmdAssignWorksite', playerId: P1, eids: [helper], targetEid: farm });
    stepN(world, 2);
    expect(villagerStatusText(world, helper)).toBe('helping at Farm (extra hand, 60%)');
    expect(villagerStatusText(world, farm)).toBeNull();
  });
});
