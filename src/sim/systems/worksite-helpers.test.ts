import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import {
  Gatherer,
  GathererStateId,
  Health,
  ResourceCarry,
  ResourceKindId,
  WorksiteHelper,
  WorksiteWorker,
} from '../components';
import { BuildingDefId, UnitDefId } from '../defs';
import { TechId } from '../tech-tree';
import { isIdleVillager } from '../core/idle-villagers';
import { worksThisTick } from '../core/worksite-membership';
import { worksiteWorkerQuery } from '../core/queries';
import { spawnFoundation } from '../factories/buildings';
import { checksumWorld } from '../checksum';
import { sanitizeWireCommand } from '../../net/commands';
import { toSelfDescribingInput } from '../input/self-describing';
import { setSelected } from '../core/selection';
import {
  P1,
  P2,
  buildingSpot,
  completedBuilding,
  quietWorld,
  stepN,
  villagersNear,
} from '../testing/villager-jobs-fixture';
import {
  WORKSITE_EXTRA_HELPERS,
  countWorksiteHelpers,
  helpRefusal,
  worksiteHelperCapacity,
} from './worksite-helpers';
import { countWorksiteWorkers, getWorksiteWorkerSlots } from './worksites';
import type { SimWorld } from '../core/types';

function crewOf(world: SimWorld, site: number): number[] {
  return worksiteWorkerQuery(world.ecs).filter((eid) => WorksiteWorker.siteEid[eid] === site);
}

/** Lumber crews research: a lumber hut takes 3 crew instead of 1. */
function withLumberCrews(world: SimWorld): SimWorld {
  world.researchedTechs[P1].add(TechId.LUMBER_CREWS);
  return world;
}

function assign(world: SimWorld, eids: number[], site: number, playerId = P1): void {
  world.inputs.push({ type: 'cmdAssignWorksite', playerId, eids, targetEid: site });
}

describe('worksite helpers', () => {
  it('a free villager joins a lumber hut, fills an open slot and delivers wood', () => {
    const world = withLumberCrews(quietWorld());
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    stepN(world, 2);
    const crewBefore = countWorksiteWorkers(world, hut);
    expect(crewBefore).toBe(1);
    expect(getWorksiteWorkerSlots(world, hut)).toBeGreaterThan(crewBefore);
    const [v] = villagersNear(world, hut, 1);
    const pop = world.population[P1].current;
    const woodBefore = world.resources[P1][ResourceKindId.WOOD];

    assign(world, [v], hut);
    stepN(world, 1);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(true);
    expect(WorksiteHelper.extra[v]).toBe(0);
    // A helper is not crew and takes no extra population place.
    expect(countWorksiteWorkers(world, hut)).toBe(crewBefore);
    expect(world.population[P1].current).toBe(pop);
    expect(isIdleVillager(world, v, P1)).toBe(false);

    stepN(world, 900);
    expect(world.resources[P1][ResourceKindId.WOOD]).toBeGreaterThan(woodBefore + 20);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(true);
  });

  it('takes open slots plus two extras, extras work 3 of 5 ticks', () => {
    const world = withLumberCrews(quietWorld());
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    stepN(world, 2);
    const open = getWorksiteWorkerSlots(world, hut) - countWorksiteWorkers(world, hut);
    const capacity = worksiteHelperCapacity(world, hut);
    expect(capacity).toBe(open + WORKSITE_EXTRA_HELPERS);
    const group = villagersNear(world, hut, capacity + 1);

    assign(world, group, hut);
    stepN(world, 1);
    const helpers = group.filter((eid) => hasComponent(world.ecs, WorksiteHelper, eid));
    expect(helpers).toHaveLength(capacity);
    expect(helpRefusal(world, hut, P1)).toBe('full');
    const extras = helpers.filter((eid) => WorksiteHelper.extra[eid] === 1);
    expect(extras).toHaveLength(WORKSITE_EXTRA_HELPERS);

    let worked = 0;
    const startTick = world.tick;
    for (let i = 0; i < 100; i++) {
      world.tick = startTick + i;
      if (worksThisTick(world, extras[0])) worked++;
    }
    world.tick = startTick;
    expect(worked).toBe(60);
    expect(worksThisTick(world, helpers.find((eid) => WorksiteHelper.extra[eid] === 0)!)).toBe(true);
  });

  it('a trained crew member turns the last slot helper into an extra', () => {
    const world = withLumberCrews(quietWorld());
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    stepN(world, 2);
    const open = getWorksiteWorkerSlots(world, hut) - countWorksiteWorkers(world, hut);
    const group = villagersNear(world, hut, open);
    assign(world, group, hut);
    stepN(world, 1);
    expect(group.every((eid) => WorksiteHelper.extra[eid] === 0)).toBe(true);

    completedBuilding(world, BuildingDefId.HOUSE, P1, 0);
    completedBuilding(world, BuildingDefId.HOUSE, P1, 1);
    world.inputs.push({ type: 'trainUnit', playerId: P1, atEid: hut, defId: UnitDefId.VILLAGER });
    stepN(world, 600);
    expect(crewOf(world, hut).length).toBe(countWorksiteWorkers(world, hut));
    expect(countWorksiteWorkers(world, hut)).toBeGreaterThan(1);
    expect(group.filter((eid) => WorksiteHelper.extra[eid] === 1)).toHaveLength(1);
  });

  it('a farm helper earns food at a farm with a full crew', () => {
    const world = quietWorld();
    const farm = completedBuilding(world, BuildingDefId.FARM);
    stepN(world, 2);
    const [v] = villagersNear(world, farm, 1);
    assign(world, [v], farm);
    stepN(world, 1);
    expect(WorksiteHelper.extra[v]).toBe(1);
    stepN(world, 400);
    expect(ResourceCarry.amount[v] > 0 || Gatherer.state[v] !== GathererStateId.IDLE).toBe(true);
    expect(ResourceCarry.kind[v]).toBe(ResourceKindId.FOOD);
  });

  it('any other order takes a helper off the worksite', () => {
    const world = withLumberCrews(quietWorld());
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const vs = villagersNear(world, hut, 3);
    assign(world, vs, hut);
    stepN(world, 1);
    expect(vs.every((eid) => hasComponent(world.ecs, WorksiteHelper, eid))).toBe(true);

    world.inputs.push({ type: 'cmdMove', playerId: P1, eids: [vs[0]], to: { x: 10, y: 10 } });
    world.inputs.push({ type: 'cmdStop', playerId: P1, eids: [vs[1]] });
    const spot = buildingSpot(world, BuildingDefId.HOUSE);
    const site = spawnFoundation(world, BuildingDefId.HOUSE, spot.x, spot.y, P1);
    world.inputs.push({ type: 'cmdBuild', playerId: P1, eids: [vs[2]], targetEid: site });
    stepN(world, 1);
    expect(vs.some((eid) => hasComponent(world.ecs, WorksiteHelper, eid))).toBe(false);
    expect(countWorksiteHelpers(world, hut)).toBe(0);
  });

  it('refuses foundations, foreign worksites and non-worksites', () => {
    const world = quietWorld();
    const spot = buildingSpot(world, BuildingDefId.LUMBER_CAMP);
    const foundation = spawnFoundation(world, BuildingDefId.LUMBER_CAMP, spot.x, spot.y, P1);
    const enemyHut = completedBuilding(world, BuildingDefId.LUMBER_CAMP, P2);
    const house = completedBuilding(world, BuildingDefId.HOUSE);
    expect(helpRefusal(world, foundation, P1)).toBe('unfinished');
    expect(helpRefusal(world, enemyHut, P1)).toBe('foreign');
    expect(helpRefusal(world, house, P1)).toBe('not-worksite');

    const [v] = villagersNear(world, foundation, 1);
    assign(world, [v], enemyHut);
    assign(world, [v], house);
    assign(world, [v], foundation);
    stepN(world, 1);
    expect(hasComponent(world.ecs, WorksiteHelper, v)).toBe(false);
  });

  it('a removed worksite frees its helpers alive', () => {
    const world = quietWorld();
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const vs = villagersNear(world, hut, 2);
    assign(world, vs, hut);
    stepN(world, 30);
    world.inputs.push({ type: 'cmdRemoveBuildings', playerId: P1, eids: [hut] });
    stepN(world, 2);
    for (const eid of vs) {
      expect(hasComponent(world.ecs, WorksiteHelper, eid)).toBe(false);
      expect(Health.hp[eid]).toBeGreaterThan(0);
    }
  });

  it('helpers survive a save round trip with identical checksums', async () => {
    const { serializeSimWorld } = await import('../save/serialize');
    const { loadSimWorldSnapshot } = await import('../save/load');
    const world = quietWorld(5);
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const vs = villagersNear(world, hut, 4);
    assign(world, vs, hut);
    stepN(world, 120);
    const saved = JSON.parse(JSON.stringify(serializeSimWorld(world, 'helpers')));
    const restored = quietWorld(1);
    loadSimWorldSnapshot(restored, saved);
    expect(checksumWorld(restored)).toBe(checksumWorld(world));
    for (let i = 0; i < 200; i++) {
      stepN(world, 1);
      stepN(restored, 1);
    }
    expect(checksumWorld(restored)).toBe(checksumWorld(world));
  });
});

describe('assign-to-worksite command', () => {
  it('validates the wire shape', () => {
    expect(sanitizeWireCommand(1, { type: 'cmdAssignWorksite', playerId: 1, eids: [3, 4], targetEid: 9 })).not.toBeNull();
    expect(sanitizeWireCommand(1, { type: 'cmdAssignWorksite', playerId: 2, eids: [3], targetEid: 9 })).toBeNull();
    expect(sanitizeWireCommand(1, { type: 'cmdAssignWorksite', playerId: 1, eids: 'x', targetEid: 9 })).toBeNull();
    expect(sanitizeWireCommand(1, { type: 'cmdAssignWorksite', playerId: 1, eids: [3] })).toBeNull();
    expect(sanitizeWireCommand(1, { type: 'assignWorksiteSelected', targetEid: 9 })).toBeNull();
  });

  it('turns the selection-relative form into cmdAssignWorksite', () => {
    const world = quietWorld();
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const [v] = villagersNear(world, hut, 1);
    setSelected(world, v, true);
    expect(toSelfDescribingInput(world, P1, { type: 'assignWorksiteSelected', targetEid: hut })).toEqual({
      type: 'cmdAssignWorksite',
      playerId: P1,
      eids: [v],
      targetEid: hut,
    });
  });

  it('ignores other players villagers', () => {
    const world = quietWorld();
    const hut = completedBuilding(world, BuildingDefId.LUMBER_CAMP);
    const [foreign] = villagersNear(world, hut, 1, P2);
    assign(world, [foreign], hut, P1);
    stepN(world, 1);
    expect(hasComponent(world.ecs, WorksiteHelper, foreign)).toBe(false);
  });
});
