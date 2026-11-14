import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import {
  Building,
  Owner,
  Position,
  Producer,
  Resource,
  ResourceKindId,
  UnitKind,
  UnitKindId,
  WorksiteWorker,
} from './components';
import { AgeId, BUILDING_TABLE, BuildingDefId, UNIT_TABLE, UnitDefId } from './defs';
import { TechId, isBuildingUnlocked } from './tech-tree';
import {
  AI_PLAYER_ID,
  buildingQuery,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  resourceQuery,
  spawnCompletedBuilding,
  step,
  townCenterQuery,
  unitQuery,
  type SimWorld,
} from './world';

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function quietWorld(seed: number, startingAge: number = AgeId.DARK): SimWorld {
  const world = createSimWorld(seed, { startingAge: startingAge as never });
  world.paused = false;
  world.aiPlayers[AI_PLAYER_ID] = null;
  return world;
}

function ownTownCenter(world: SimWorld, playerId: number): number {
  const tc = townCenterQuery(world.ecs).find((eid) => Owner.player[eid] === playerId);
  if (tc === undefined) throw new Error('no town center');
  return tc;
}

function freeVillagers(world: SimWorld, playerId: number): number[] {
  return unitQuery(world.ecs).filter(
    (eid) =>
      Owner.player[eid] === playerId &&
      UnitKind.kind[eid] === UnitKindId.VILLAGER &&
      !hasComponent(world.ecs, WorksiteWorker, eid)
  );
}

function unitsOfKind(world: SimWorld, playerId: number, kind: number): number[] {
  return unitQuery(world.ecs).filter(
    (eid) => Owner.player[eid] === playerId && UnitKind.kind[eid] === kind
  );
}

/** An open 2x2 spot a few tiles from the player's town center. */
function openSpotNear(world: SimWorld, cx: number, cy: number): { x: number; y: number } {
  for (let r = 5; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        let free = true;
        for (let oy = -1; oy <= 1 && free; oy++) {
          for (let ox = -1; ox <= 1 && free; ox++) {
            const tx = x + ox;
            const ty = y + oy;
            if (world.map.walkability[ty]?.[tx] !== 0) free = false;
            else if (findResourceAt(world, tx, ty, 0.6) !== null) free = false;
            else if (findBuildingAt(world, tx, ty, 1.5) !== null) free = false;
          }
        }
        if (free) return { x, y };
      }
    }
  }
  throw new Error('no open spot');
}

describe('town center villagers', () => {
  it('trains a free, commandable villager next to the town center', () => {
    const world = quietWorld(4242);
    const tc = ownTownCenter(world, 1);
    expect(hasComponent(world.ecs, Producer, tc)).toBe(true);
    expect(BUILDING_TABLE[BuildingDefId.TOWN_CENTER].trains).toContain('VILLAGER');

    const before = freeVillagers(world, 1).length;
    const woodBefore = world.resources[1][ResourceKindId.WOOD];
    world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.VILLAGER, playerId: 1 });
    step(world);
    const cost = UNIT_TABLE[UnitDefId.VILLAGER].cost;
    expect(world.resources[1][ResourceKindId.WOOD]).toBe(woodBefore - cost.wood);
    expect(world.productionQueues.get(tc)).toEqual([UnitDefId.VILLAGER]);

    stepN(world, UNIT_TABLE[UnitDefId.VILLAGER].trainTimeTicks + 2);
    const villagers = freeVillagers(world, 1);
    expect(villagers.length).toBe(before + 1);
    const v = villagers[villagers.length - 1];
    expect(Math.hypot(Position.x[v] - Position.x[tc], Position.y[v] - Position.y[tc])).toBeLessThan(5);
    expect(world.gameEvents.some((e) => e.kind === 'unitTrained' && e.unitDefId === UnitDefId.VILLAGER)).toBe(true);
  });

  it('counts town center villagers against the population cap', () => {
    const world = quietWorld(4242);
    const tc = ownTownCenter(world, 1);
    world.resources[1][ResourceKindId.WOOD] = 10_000;
    const pop = world.population[1];
    pop.current = pop.cap;
    world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.VILLAGER, playerId: 1 });
    step(world);
    expect(world.productionQueues.get(tc) ?? []).toEqual([]);
    expect(world.resources[1][ResourceKindId.WOOD]).toBe(10_000);
  });

  it('a trained villager forages berries and drops the food at the town center', () => {
    const world = quietWorld(4242);
    const tc = ownTownCenter(world, 1);
    world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.VILLAGER, playerId: 1 });
    stepN(world, UNIT_TABLE[UnitDefId.VILLAGER].trainTimeTicks + 3);
    const [villager] = freeVillagers(world, 1);
    expect(villager).toBeDefined();

    const bush = [...resourceQuery(world.ecs)]
      .filter((eid) => Resource.kind[eid] === ResourceKindId.FOOD)
      .sort(
        (a, b) =>
          Math.hypot(Position.x[a] - Position.x[tc], Position.y[a] - Position.y[tc]) -
          Math.hypot(Position.x[b] - Position.x[tc], Position.y[b] - Position.y[tc])
      )[0];
    const amountBefore = Resource.amount[bush];
    const foodBefore = world.resources[1][ResourceKindId.FOOD];
    world.inputs.push({ type: 'cmdGather', playerId: 1, eids: [villager], targetEid: bush });
    for (let i = 0; i < 3000 && world.resources[1][ResourceKindId.FOOD] < foodBefore + 10; i++) step(world);
    expect(world.resources[1][ResourceKindId.FOOD]).toBeGreaterThanOrEqual(foodBefore + 10);
    expect(Resource.amount[bush]).toBeLessThan(amountBefore);
  });
});

describe('archery range', () => {
  it('unlocks with the Archers tech', () => {
    const world = quietWorld(501);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.ARCHERY_RANGE)).toBe(false);
    world.researchedTechs[1].add(TechId.BARRACKS_PIKEMEN);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.ARCHERY_RANGE)).toBe(false);
    world.researchedTechs[1].add(TechId.ARCHERS);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.ARCHERY_RANGE)).toBe(true);
  });

  it('can be placed by the player once Archers is researched', () => {
    const world = quietWorld(501, AgeId.CASTLE);
    const tc = ownTownCenter(world, 1);
    world.resources[1][ResourceKindId.WOOD] = 5_000;
    const spot = openSpotNear(world, Position.x[tc], Position.y[tc]);
    const count = () =>
      buildingQuery(world.ecs).filter(
        (eid) => Owner.player[eid] === 1 && Building.defId[eid] === BuildingDefId.ARCHERY_RANGE
      ).length;
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.ARCHERY_RANGE, x: spot.x, y: spot.y, playerId: 1 });
    step(world);
    expect(count()).toBe(1);
  });

  it('trains archers, and the barracks still does too', () => {
    const world = quietWorld(501, AgeId.CASTLE);
    const tc = ownTownCenter(world, 1);
    world.resources[1][ResourceKindId.FOOD] = 5_000;
    world.resources[1][ResourceKindId.WOOD] = 5_000;
    const rangeSpot = openSpotNear(world, Position.x[tc], Position.y[tc]);
    const range = spawnCompletedBuilding(world, BuildingDefId.ARCHERY_RANGE, rangeSpot.x, rangeSpot.y, 1);
    step(world);
    expect(hasComponent(world.ecs, Producer, range)).toBe(true);

    const before = unitsOfKind(world, 1, UnitKindId.ARCHER).length;
    world.inputs.push({ type: 'trainUnit', atEid: range, defId: UnitDefId.ARCHER, playerId: 1 });
    stepN(world, UNIT_TABLE[UnitDefId.ARCHER].trainTimeTicks + 3);
    expect(unitsOfKind(world, 1, UnitKindId.ARCHER).length).toBe(before + 1);

    // Nothing else comes out of a range.
    world.inputs.push({ type: 'trainUnit', atEid: range, defId: UnitDefId.SPEARMAN, playerId: 1 });
    step(world);
    expect(world.productionQueues.get(range) ?? []).toEqual([]);

    const barracksSpot = openSpotNear(world, Position.x[tc] - 4, Position.y[tc] + 4);
    const barracks = spawnCompletedBuilding(world, BuildingDefId.BARRACKS, barracksSpot.x, barracksSpot.y, 1);
    step(world);
    world.inputs.push({ type: 'trainUnit', atEid: barracks, defId: UnitDefId.ARCHER, playerId: 1 });
    step(world);
    expect(world.productionQueues.get(barracks)).toEqual([UnitDefId.ARCHER]);
  });
});
