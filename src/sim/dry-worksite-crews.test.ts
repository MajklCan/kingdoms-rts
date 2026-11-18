import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { SIM } from '../config';
import {
  Building,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  Resource,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  VillagerTag,
  WorksiteWorker,
  type ResourceKind,
} from './components';
import { AgeId, BuildingDefId } from './defs';
import { spawnWorksiteWorker } from './systems/worksites';
import {
  AI_PLAYER_ID,
  LOCAL_PLAYER_ID,
  buildingQuery,
  countWorksiteWorkers,
  createSimWorld,
  removeSimEntity,
  resourceQuery,
  spawnCompletedBuilding,
  step,
  unitQuery,
  worksiteWorkerQuery,
  type SimWorld,
} from './world';

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function removeResources(world: SimWorld, kind: ResourceKind): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === kind) removeSimEntity(world, eid);
  }
}

function crewOf(world: SimWorld, siteEid: number): number[] {
  return worksiteWorkerQuery(world.ecs).filter((eid) => WorksiteWorker.siteEid[eid] === siteEid);
}

/** A completed site with its free first worker already spent and no crew. */
function unstaffedSite(world: SimWorld, defId: number, x: number, y: number, playerId: number): number {
  const site = spawnCompletedBuilding(world, defId, x, y, playerId);
  for (const worker of crewOf(world, site)) removeSimEntity(world, worker);
  ResourceWorksite.freeWorkersSpawned[site] = 1;
  return site;
}

/** A completed gold mine of `playerId` with no gold left on the map and `crew` idle workers. */
function dryMineWithCrew(world: SimWorld, playerId: number, crew: number): number {
  const spawn = world.map.spawns[playerId];
  const mine = unstaffedSite(world, BuildingDefId.GOLD_MINE, spawn.x + 5, spawn.y - 4, playerId);
  for (let i = 0; i < crew; i++) {
    const worker = spawnWorksiteWorker(world, mine);
    if (worker === null) throw new Error('no spawn spot for a crew worker');
    Gatherer.state[worker] = GathererStateId.IDLE;
  }
  return mine;
}

function emptyMint(world: SimWorld, playerId: number): number {
  const spawn = world.map.spawns[playerId];
  return unstaffedSite(world, BuildingDefId.MINT, spawn.x + 5, spawn.y + 4, playerId);
}

function castleWorldWithoutGold(): SimWorld {
  const world = createSimWorld(7, { startingAge: AgeId.CASTLE });
  world.paused = false;
  // The computer seat stays computer-controlled, but its brain stays out.
  world.aiPlayers[AI_PLAYER_ID] = null;
  removeResources(world, ResourceKindId.GOLD);
  return world;
}

describe('crews of dried-up worksites', () => {
  it("an AI's idle crew at a dry gold mine moves to its unstaffed mint and makes gold", () => {
    const world = castleWorldWithoutGold();
    const mine = dryMineWithCrew(world, AI_PLAYER_ID, 3);
    const mint = emptyMint(world, AI_PLAYER_ID);
    expect(countWorksiteWorkers(world, mint)).toBe(0);

    stepN(world, SIM.TICK_HZ * 2);
    expect(countWorksiteWorkers(world, mine)).toBe(0);
    expect(countWorksiteWorkers(world, mint)).toBe(3);

    const before = world.resources[AI_PLAYER_ID][ResourceKindId.GOLD];
    stepN(world, SIM.TICK_HZ * 60);
    expect(world.resources[AI_PLAYER_ID][ResourceKindId.GOLD]).toBeGreaterThan(before + 30);
  });

  it('a human player keeps his own crews where he put them', () => {
    const world = castleWorldWithoutGold();
    const mine = dryMineWithCrew(world, LOCAL_PLAYER_ID, 3);
    const mint = emptyMint(world, LOCAL_PLAYER_ID);
    stepN(world, SIM.TICK_HZ * 2);
    expect(countWorksiteWorkers(world, mine)).toBe(3);
    expect(countWorksiteWorkers(world, mint)).toBe(0);
  });

  it('a worker left idle with part of a load delivers it before he moves', () => {
    const world = castleWorldWithoutGold();
    const mine = dryMineWithCrew(world, AI_PLAYER_ID, 1);
    const [worker] = crewOf(world, mine);
    ResourceCarry.kind[worker] = ResourceKindId.GOLD;
    ResourceCarry.amount[worker] = 5;
    const mint = emptyMint(world, AI_PLAYER_ID);
    const before = world.resources[AI_PLAYER_ID][ResourceKindId.GOLD];
    stepN(world, 2);
    expect(WorksiteWorker.siteEid[worker]).toBe(mine);
    expect(Gatherer.state[worker]).toBe(GathererStateId.RETURNING);
    // Delivered, then moved on.
    stepN(world, SIM.TICK_HZ * 30);
    expect(ResourceCarry.amount[worker]).toBe(0);
    expect(world.resources[AI_PLAYER_ID][ResourceKindId.GOLD] - before).toBeGreaterThanOrEqual(5);
    expect(WorksiteWorker.siteEid[worker]).toBe(mint);
  });
});

describe('a helper sent to a mint with gold in hand', () => {
  it('delivers his load first instead of losing it', () => {
    const world = castleWorldWithoutGold();
    const mint = emptyMint(world, LOCAL_PLAYER_ID);
    const helper = unitQuery(world.ecs).find((eid) => Owner.player[eid] === LOCAL_PLAYER_ID &&
      hasComponent(world.ecs, VillagerTag, eid) && !hasComponent(world.ecs, WorksiteWorker, eid))!;
    ResourceCarry.kind[helper] = ResourceKindId.GOLD;
    ResourceCarry.amount[helper] = 10;
    const before = world.resources[LOCAL_PLAYER_ID][ResourceKindId.GOLD];
    world.inputs.push({ type: 'cmdAssignWorksite', playerId: LOCAL_PLAYER_ID, eids: [helper], targetEid: mint });
    step(world);
    expect(ResourceCarry.amount[helper]).toBe(10);
    expect(Gatherer.state[helper]).toBe(GathererStateId.RETURNING);

    let ticks = 0;
    while (ResourceCarry.amount[helper] > 0 && ticks < SIM.TICK_HZ * 60) {
      step(world);
      ticks++;
    }
    expect(ResourceCarry.amount[helper]).toBe(0);
    expect(world.resources[LOCAL_PLAYER_ID][ResourceKindId.GOLD] - before).toBeGreaterThanOrEqual(10);

    // Then he walks to the mint and works there.
    stepN(world, SIM.TICK_HZ * 40);
    expect(Gatherer.state[helper]).toBe(GathererStateId.BUILDING);
  });
});

describe('the computer player with a full workforce and its gold gone', () => {
  it('still raises a mint', () => {
    const world = createSimWorld(7, { startingAge: AgeId.CASTLE, aiDifficulty: 'hard' });
    world.paused = false;
    removeResources(world, ResourceKindId.GOLD);
    world.resources[AI_PLAYER_ID].set([5000, 5000, 5000, 5000]);
    // Fill the workforce (51 workers at hard: 75 less the army's 24) with
    // crew standing at a dry mine, as after a long game.
    dryMineWithCrew(world, AI_PLAYER_ID, 55);
    const mints = (): number => buildingQuery(world.ecs).filter((eid) =>
      Owner.player[eid] === AI_PLAYER_ID && Building.defId[eid] === BuildingDefId.MINT && Health.hp[eid] > 0
    ).length;

    let ticks = 0;
    while (mints() === 0 && ticks < SIM.TICK_HZ * 30) {
      step(world);
      ticks++;
    }
    expect(mints()).toBeGreaterThan(0);
  });
});
