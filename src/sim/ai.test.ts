import { describe, expect, it } from 'vitest';
import { hasComponent, removeEntity } from 'bitecs';
import { MAP } from '../config';
import {
  AttackTarget,
  Building,
  Owner,
  Position,
  Resource,
  ResourceKindId,
  UnitKind,
  UnitKindId,
} from './components';
import { AgeId, BuildingDefId, UnitDefId } from './defs';
import {
  AI_PLAYER_ID,
  buildingQuery,
  createLateGameTestWorld,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  resourceQuery,
  spawnArcher,
  spawnCompletedBuilding,
  spawnSpearman,
  spawnResource,
  step,
  type SimWorld,
  unitQuery,
} from './world';
import { TechId, hasTech } from './tech-tree';

function findOpenTile(world: SimWorld): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 8; y++) {
    for (let x = 6; x < MAP.WIDTH - 8; x++) {
      if (world.map.walkability[y][x] !== 0) continue;
      if (findBuildingAt(world, x, y, 1.5) !== null) continue;
      if (findResourceAt(world, x, y, 0.8) !== null) continue;
      return { x, y };
    }
  }
  throw new Error('No open tile found');
}

function findOpenTileAtRange(
  world: SimWorld,
  cx: number,
  cy: number,
  minRange: number,
  maxRange: number
): { x: number; y: number } {
  return findOpenTileAtRangeMatching(world, cx, cy, minRange, maxRange, () => true);
}

function findOpenTileAtRangeMatching(
  world: SimWorld,
  cx: number,
  cy: number,
  minRange: number,
  maxRange: number,
  matches: (x: number, y: number) => boolean
): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 8; y++) {
    for (let x = 6; x < MAP.WIDTH - 8; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < minRange || dist > maxRange) continue;
      if (world.map.walkability[y][x] !== 0) continue;
      if (findBuildingAt(world, x, y, 1.5) !== null) continue;
      if (findResourceAt(world, x, y, 0.8) !== null) continue;
      if (!matches(x, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No open tile found at range');
}

function removeResources(world: SimWorld, kind: number): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === kind) removeEntity(world.ecs, eid);
  }
}

function aiTownCenter(world: SimWorld): number {
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] === AI_PLAYER_ID && Building.defId[eid] === BuildingDefId.TOWN_CENTER) {
      return eid;
    }
  }
  throw new Error('No AI town center found');
}

function countAiBuildings(world: SimWorld, defId: number): number {
  return buildingQuery(world.ecs).filter(
    (eid) => Owner.player[eid] === AI_PLAYER_ID && Building.defId[eid] === defId
  ).length;
}

function countAiInfantry(world: SimWorld): number {
  return unitQuery(world.ecs).filter(
    (eid) =>
      Owner.player[eid] === AI_PLAYER_ID &&
      (UnitKind.kind[eid] === UnitKindId.ARCHER || UnitKind.kind[eid] === UnitKindId.SPEARMAN)
  ).length;
}

function countQueuedAiInfantry(world: SimWorld): number {
  let count = 0;
  for (const [producerEid, queue] of world.productionQueues) {
    if (!hasComponent(world.ecs, Owner, producerEid)) continue;
    if (Owner.player[producerEid] !== AI_PLAYER_ID) continue;
    count += queue.filter((defId) => defId === UnitDefId.ARCHER || defId === UnitDefId.SPEARMAN).length;
  }
  return count;
}

function countAiArchers(world: SimWorld): number {
  return unitQuery(world.ecs).filter(
    (eid) => Owner.player[eid] === AI_PLAYER_ID && UnitKind.kind[eid] === UnitKindId.ARCHER
  ).length;
}

function spawnAiBuilding(world: SimWorld, defId: number): number {
  const spot = findOpenTile(world);
  return spawnCompletedBuilding(world, defId, spot.x, spot.y, AI_PLAYER_ID);
}

describe('enemy AI', () => {
  it('queues extra worksite workers for its economy sites', () => {
    const world = createSimWorld(201);
    world.paused = false;
    world.resources[AI_PLAYER_ID][0] = 200;
    const spot = findOpenTile(world);
    const lumber = spawnCompletedBuilding(
      world,
      BuildingDefId.LUMBER_CAMP,
      spot.x,
      spot.y,
      AI_PLAYER_ID
    );
    world.researchedTechs[AI_PLAYER_ID].add(TechId.LUMBER_CREWS);

    step(world);

    expect(world.productionQueues.get(lumber)).toContain(UnitDefId.VILLAGER);
  });

  it('does not get archer tech for free before it can pay stone', () => {
    const world = createSimWorld(206);
    world.paused = false;
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    world.resources[AI_PLAYER_ID].set([1000, 1000, 0, 0]);
    removeResources(world, ResourceKindId.STONE);
    world.population[AI_PLAYER_ID].cap = 30;
    const initialArchers = countAiArchers(world);
    const spot = findOpenTile(world);
    spawnCompletedBuilding(world, BuildingDefId.BARRACKS, spot.x, spot.y, AI_PLAYER_ID);

    for (let i = 0; i < 20 * 58; i++) step(world);

    expect(hasTech(world, AI_PLAYER_ID, TechId.ARCHERS)).toBe(false);
    expect(world.resources[AI_PLAYER_ID][ResourceKindId.STONE]).toBeLessThan(200);
    expect(countAiArchers(world)).toBe(initialArchers);
  });

  it('opens food economy before barracks and trains infantry', () => {
    const world = createSimWorld(204);
    world.paused = false;
    const initialInfantry = countAiInfantry(world);

    for (let i = 0; i < 20 * 210; i++) step(world);

    expect(countAiBuildings(world, BuildingDefId.FARM)).toBeGreaterThanOrEqual(1);
    expect(countAiBuildings(world, BuildingDefId.BARRACKS)).toBeGreaterThanOrEqual(1);
    expect(countAiInfantry(world) + countQueuedAiInfantry(world)).toBeGreaterThan(initialInfantry);
  });

  it('uses difficulty to control economy scale and first attack timing', () => {
    const defaultWorld = createSimWorld(205);
    const easy = createSimWorld(205, { aiDifficulty: 'easy' });
    const hard = createSimWorld(205, { aiDifficulty: 'hard' });
    expect(defaultWorld.aiDifficulty).toBe('medium');
    expect(easy.aiPlayers[AI_PLAYER_ID]?.nextAttackTick ?? 0)
      .toBeGreaterThan(hard.aiPlayers[AI_PLAYER_ID]?.nextAttackTick ?? 0);

    for (const world of [easy, hard]) {
      world.paused = false;
      world.aiPlayers[AI_PLAYER_ID]!.nextAttackTick = Number.MAX_SAFE_INTEGER;
      world.resources[AI_PLAYER_ID].set([5000, 5000, 5000, 5000]);
      world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
      const spot = findOpenTile(world);
      spawnCompletedBuilding(world, BuildingDefId.BARRACKS, spot.x, spot.y, AI_PLAYER_ID);
    }

    for (let i = 0; i < 20 * 25; i++) {
      step(easy);
      step(hard);
    }

    expect(countAiBuildings(hard, BuildingDefId.FARM))
      .toBeGreaterThan(countAiBuildings(easy, BuildingDefId.FARM));
    expect(countAiBuildings(hard, BuildingDefId.LUMBER_CAMP))
      .toBeGreaterThanOrEqual(countAiBuildings(easy, BuildingDefId.LUMBER_CAMP));
    expect(countAiBuildings(hard, BuildingDefId.FARM)).toBeGreaterThanOrEqual(3);
    expect(countAiBuildings(hard, BuildingDefId.LUMBER_CAMP)).toBeGreaterThanOrEqual(4);
    expect(countAiBuildings(hard, BuildingDefId.STONE_QUARRY)).toBeGreaterThanOrEqual(1);
  });

  it('hard AI adds food economy when idle barracks are food blocked', () => {
    const world = createSimWorld(207, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([0, 1000, 0, 0]);
    world.population[AI_PLAYER_ID].cap = 40;
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    spawnAiBuilding(world, BuildingDefId.BARRACKS);

    for (let i = 0; i < 20; i++) step(world);

    expect(countAiBuildings(world, BuildingDefId.FARM)).toBeGreaterThanOrEqual(1);
  });

  it('hard AI does not farm boom before placing the first barracks', () => {
    const world = createSimWorld(210, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([0, 1000, 0, 0]);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    spawnAiBuilding(world, BuildingDefId.FARM);
    for (let i = 0; i < 3; i++) spawnAiBuilding(world, BuildingDefId.LUMBER_CAMP);

    for (let i = 0; i < 20; i++) step(world);

    expect(countAiBuildings(world, BuildingDefId.BARRACKS)).toBeGreaterThanOrEqual(1);
    expect(countAiBuildings(world, BuildingDefId.FARM)).toBeLessThanOrEqual(2);
  });

  it('hard AI keeps farm growth tied to supported barracks instead of raw army target', () => {
    const world = createSimWorld(211, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([1000, 1000, 0, 1000]);
    world.population[AI_PLAYER_ID].cap = 40;
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.ARCHERS);
    spawnAiBuilding(world, BuildingDefId.BARRACKS);

    for (let i = 0; i < 20; i++) step(world);

    expect(countAiBuildings(world, BuildingDefId.FARM)).toBeLessThanOrEqual(4);
  });

  it('places AI lumber huts by wood instead of hugging the town center', () => {
    const world = createSimWorld(212, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([0, 1000, 0, 0]);
    removeResources(world, ResourceKindId.WOOD);
    const spawn = world.map.spawns[AI_PLAYER_ID];
    const woodTile = findOpenTileAtRange(world, spawn.x, spawn.y, 12, 16);
    const wood = spawnResource(world, ResourceKindId.WOOD, woodTile.x, woodTile.y, 100);

    step(world);

    const lumber = buildingQuery(world.ecs).find((eid) =>
      Owner.player[eid] === AI_PLAYER_ID && Building.defId[eid] === BuildingDefId.LUMBER_CAMP
    );
    expect(lumber).not.toBeUndefined();
    if (lumber === undefined) return;
    expect(Math.hypot(Position.x[lumber] - Position.x[wood], Position.y[lumber] - Position.y[wood]))
      .toBeLessThanOrEqual(3);
    expect(Math.hypot(Position.x[lumber] - spawn.x, Position.y[lumber] - spawn.y)).toBeGreaterThan(4);
  });

  it('hard AI replaces depleted lumber huts near remote wood', () => {
    const world = createSimWorld(213, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([0, 1000, 0, 0]);
    removeResources(world, ResourceKindId.WOOD);

    const spawn = world.map.spawns[AI_PLAYER_ID];
    const oldSpot = findOpenTileAtRange(world, spawn.x, spawn.y, 4, 7);
    spawnCompletedBuilding(world, BuildingDefId.LUMBER_CAMP, oldSpot.x, oldSpot.y, AI_PLAYER_ID);
    const woodTile = findOpenTileAtRangeMatching(
      world,
      spawn.x,
      spawn.y,
      45,
      50,
      (x, y) => Math.hypot(x - oldSpot.x, y - oldSpot.y) > 42.5
    );
    const wood = spawnResource(world, ResourceKindId.WOOD, woodTile.x, woodTile.y, 100);
    const before = countAiBuildings(world, BuildingDefId.LUMBER_CAMP);

    for (let i = 0; i < 5; i++) step(world);

    const lumberHuts = buildingQuery(world.ecs).filter((eid) =>
      Owner.player[eid] === AI_PLAYER_ID && Building.defId[eid] === BuildingDefId.LUMBER_CAMP
    );
    expect(lumberHuts.length).toBeGreaterThan(before);
    expect(lumberHuts.some((eid) =>
      Math.hypot(Position.x[eid] - Position.x[wood], Position.y[eid] - Position.y[wood]) <= 3
    )).toBe(true);
  });

  it('hard AI fills multiple barracks queues when it can afford units', () => {
    const world = createSimWorld(208, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([1000, 1000, 0, 1000]);
    world.population[AI_PLAYER_ID].cap = 40;
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.ARCHERS);
    const first = spawnAiBuilding(world, BuildingDefId.BARRACKS);
    const second = spawnAiBuilding(world, BuildingDefId.BARRACKS);

    for (let i = 0; i < 20; i++) step(world);

    expect(world.productionQueues.get(first)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(world.productionQueues.get(second)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('hard AI adds barracks when existing production is saturated by a strong economy', () => {
    const world = createSimWorld(209, { aiDifficulty: 'hard' });
    world.paused = false;
    world.resources[AI_PLAYER_ID].set([10000, 10000, 0, 10000]);
    world.population[AI_PLAYER_ID].cap = 75;
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.ARCHERS);
    for (let i = 0; i < 8; i++) spawnAiBuilding(world, BuildingDefId.FARM);
    for (let i = 0; i < 4; i++) spawnAiBuilding(world, BuildingDefId.LUMBER_CAMP);
    spawnAiBuilding(world, BuildingDefId.BARRACKS);

    for (let i = 0; i < 40; i++) step(world);

    expect(countAiBuildings(world, BuildingDefId.BARRACKS)).toBeGreaterThan(1);
  });

  it('uses barracks and stable for a mixed army', () => {
    const world = createSimWorld(202);
    world.paused = false;
    world.ages[AI_PLAYER_ID] = { current: AgeId.CASTLE, progress: -1, totalTicks: 0 };
    world.resources[AI_PLAYER_ID].set([1000, 1000, 1000, 1000]);
    world.population[AI_PLAYER_ID].cap = 40;
    const spot = findOpenTile(world);
    const barracks = spawnCompletedBuilding(world, BuildingDefId.BARRACKS, spot.x, spot.y, AI_PLAYER_ID);
    const stable = spawnCompletedBuilding(world, BuildingDefId.STABLE, spot.x + 4, spot.y, AI_PLAYER_ID);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.ARCHERS);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.GOLD_MINES);
    world.researchedTechs[AI_PLAYER_ID].add(TechId.KNIGHTS);

    for (let i = 0; i <= 20; i++) step(world);

    expect(world.productionQueues.get(barracks)).toContain(UnitDefId.SPEARMAN);
    expect(world.productionQueues.get(barracks)).toContain(UnitDefId.ARCHER);
    expect(world.productionQueues.get(stable)).toContain(UnitDefId.SCOUT_CAVALRY);
  });

  it('pulls nearby military into defense when its base is threatened', () => {
    const world = createSimWorld(203);
    world.paused = false;
    const tc = aiTownCenter(world);
    const enemy = spawnArcher(world, world.map.spawns[AI_PLAYER_ID].x + 2, world.map.spawns[AI_PLAYER_ID].y, 1);

    step(world);

    expect(world.aiPlayers[AI_PLAYER_ID]?.plan).toBe('defending');
    expect(world.aiEvents.some((event) => event.message.includes('defend'))).toBe(true);
    const defenders = unitQuery(world.ecs).filter(
      (eid) =>
        hasComponent(world.ecs, UnitKind, eid) &&
        Owner.player[eid] === AI_PLAYER_ID &&
        hasComponent(world.ecs, AttackTarget, eid)
    );
    expect(defenders.some((eid) => AttackTarget.targetEid[eid] === enemy)).toBe(true);
    expect(tc).toBeGreaterThanOrEqual(0);
  });

  it('does not pull new home units into a far fight against an attacking wave', () => {
    const world = createSimWorld(213, { aiDifficulty: 'hard' });
    world.paused = false;
    const playerSpawn = world.map.spawns[1];
    const aiSpawn = world.map.spawns[AI_PLAYER_ID];
    const enemy = spawnArcher(world, playerSpawn.x + 4, playerSpawn.y, 1);
    const raider = spawnSpearman(world, playerSpawn.x + 5, playerSpawn.y, AI_PLAYER_ID);
    const homeDefender = spawnArcher(world, aiSpawn.x + 2, aiSpawn.y, AI_PLAYER_ID);
    AttackTarget.targetEid[enemy] = raider;
    AttackTarget.retainGoal[enemy] = 1;

    step(world);

    expect(world.aiPlayers[AI_PLAYER_ID]?.plan).not.toBe('defending');
    expect(AttackTarget.targetEid[homeDefender]).not.toBe(enemy);
    expect(world.paths.has(homeDefender)).toBe(false);
  });

  it('stages a mixed attack before sending it across the map', () => {
    const world = createLateGameTestWorld();
    const ai = world.aiPlayers[AI_PLAYER_ID];
    expect(ai).not.toBeNull();
    if (!ai) return;
    ai.nextAttackTick = world.tick;
    ai.plan = 'massing';
    world.aiEvents.length = 0;

    step(world);

    expect(ai.plan).toBe('staging');
    expect(ai.waveUnitEids.length).toBeGreaterThanOrEqual(8);
    expect(world.aiEvents.some((event) => event.message.includes('gathering'))).toBe(true);
  });
});
