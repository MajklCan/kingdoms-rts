import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import {
  BuildOrder,
  Gatherer,
  GathererStateId,
  Position,
  Resource,
  ResourceKindId,
  VillagerJobId,
  WorksiteHelper,
} from '../components';
import { BuildingDefId } from '../defs';
import { isIdleVillager } from '../core/idle-villagers';
import { resourceQuery } from '../core/queries';
import { spawnFoundation } from '../factories/buildings';
import type { SimWorld } from '../core/types';
import { aiPutIdleBuildersToWork } from '../ai/idle-builders';
import {
  P1,
  P2,
  buildingSpot,
  completedBuilding,
  quietWorld,
  stepN,
  tcOf,
  villagersNear,
} from '../testing/villager-jobs-fixture';
import { rememberedJob } from './villager-work';

function nearestTree(world: SimWorld, from: number): number {
  return [...resourceQuery(world.ecs)]
    .filter((eid) => Resource.kind[eid] === ResourceKindId.WOOD)
    .sort(
      (a, b) =>
        Math.hypot(Position.x[a] - Position.x[from], Position.y[a] - Position.y[from]) -
        Math.hypot(Position.x[b] - Position.x[from], Position.y[b] - Position.y[from])
    )[0];
}

function buildHouseWith(world: SimWorld, eid: number): number {
  const spot = buildingSpot(world, BuildingDefId.HOUSE);
  const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
  world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [eid], targetEid: site });
  stepN(world, 1);
  expect(BuildOrder.targetEid[eid]).toBe(site);
  for (let i = 0; i < 3000 && BuildOrder.targetEid[eid] >= 0; i++) stepN(world, 1);
  return site;
}

describe('builder goes back to work', () => {
  it('returns to chopping wood after building a house', () => {
    const world = quietWorld();
    const [v] = villagersNear(world, tcOf(world, P1), 1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [v], targetEid: nearestTree(world, v) });
    stepN(world, 200);
    expect(rememberedJob(world, v)).toBe(VillagerJobId.GATHER);

    buildHouseWith(world, v);
    expect(BuildOrder.targetEid[v]).toBe(-1);
    stepN(world, 2);
    expect(Gatherer.state[v]).not.toBe(GathererStateId.IDLE);
    expect(Resource.kind[Gatherer.targetEid[v]]).toBe(ResourceKindId.WOOD);
  });

  it('returns to helping his worksite after building a house', () => {
    const world = quietWorld();
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const [v] = villagersNear(world, hut, 1);
    world.inputs.push({ type: 'cmdAssignWorksite', playerId: P1, eids: [v], targetEid: hut });
    stepN(world, 40);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(true);

    buildHouseWith(world, v);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(true);
    expect(WorksiteHelper.siteEid[v]).toBe(hut);
  });

  it('stays idle when the player moved him before the build order', () => {
    const world = quietWorld();
    const [v] = villagersNear(world, tcOf(world, P1), 1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [v], targetEid: nearestTree(world, v) });
    stepN(world, 100);
    world.inputs.push({ type: 'cmdMove', playerId: P1, eids: [v], to: { x: Position.x[v], y: Position.y[v] } });
    stepN(world, 1);
    expect(rememberedJob(world, v)).toBe(VillagerJobId.NONE);

    buildHouseWith(world, v);
    stepN(world, 2);
    expect(isIdleVillager(world, v, P1)).toBe(true);
  });

  it('stays idle when his old worksite is gone', () => {
    const world = quietWorld();
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const [v] = villagersNear(world, hut, 1);
    world.inputs.push({ type: 'cmdAssignWorksite', playerId: P1, eids: [v], targetEid: hut });
    stepN(world, 20);
    const spot = buildingSpot(world, BuildingDefId.HOUSE);
    const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
    world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [v], targetEid: site });
    world.inputs.push({ type: 'cmdRemoveBuildings', playerId: P1, eids: [hut] });
    stepN(world, 1);
    for (let i = 0; i < 3000 && BuildOrder.targetEid[v] >= 0; i++) stepN(world, 1);
    stepN(world, 2);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(false);
    expect(isIdleVillager(world, v, P1)).toBe(true);
  });
});

describe('AI builders with nothing to build', () => {
  it('help at an AI worksite instead of idling', () => {
    const world = quietWorld();
    world.humanPlayers = new Set([P1]);
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP, P2);
    const [v] = villagersNear(world, tcOf(world, P2), 1, P2);
    expect(isIdleVillager(world, v, P2)).toBe(true);
    aiPutIdleBuildersToWork(world, P2, [v]);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(true);
    expect(WorksiteHelper.siteEid[v]).toBe(hut);
  });
});
