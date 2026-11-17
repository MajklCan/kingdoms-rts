import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { Building, Gatherer, GathererStateId, Owner, Position, Resource, ResourceKindId, UnitKind, WorksiteWorker } from './components';
import { BuildingDefId, UnitDefId } from './defs';
import { TechId } from './tech-tree';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import { checksumWorld } from './checksum';
import { staffFoundations } from './testing/staff-foundations';
import {
  AI_PLAYER_ID,
  buildingQuery,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  housingAtMaximum,
  pendingPopCapGain,
  POP_CAP_HARD_LIMIT,
  removeSimEntity,
  resourceQuery,
  revealMapForPlayer,
  step,
  townCenterQuery,
  unitQuery,
  type SimWorld,
} from './world';

const P1 = 1;

function townCenterOf(world: SimWorld, playerId: number): number {
  const tc = townCenterQuery(world.ecs).find((eid) => Owner.player[eid] === playerId);
  if (tc === undefined) throw new Error('no town center');
  return tc;
}

function ownUnits(world: SimWorld, playerId: number): Set<number> {
  return new Set(unitQuery(world.ecs).filter((eid) => Owner.player[eid] === playerId));
}

/** Queue one unit at the town center and step until it walks out; returns its eid. */
function trainAtTownCenter(world: SimWorld, playerId: number, defId: number): number {
  const tc = townCenterOf(world, playerId);
  world.resources[playerId].set([1000, 1000, 0, 0]);
  const before = ownUnits(world, playerId);
  world.inputs.push({ type: 'trainUnit', atEid: tc, defId, playerId });
  for (let i = 0; i < 2000; i++) {
    step(world);
    const fresh = [...ownUnits(world, playerId)].find((eid) => !before.has(eid));
    if (fresh !== undefined) return fresh;
  }
  throw new Error('unit never trained');
}

function newWorld(seed: number): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  return world;
}

function nearestResource(world: SimWorld, kind: number, x: number, y: number): number {
  const eids = resourceQuery(world.ecs)
    .filter((eid) => Resource.kind[eid] === kind && Resource.amount[eid] > 0)
    .sort((a, b) =>
      Math.hypot(Position.x[a] - x, Position.y[a] - y) - Math.hypot(Position.x[b] - x, Position.y[b] - y));
  if (eids.length === 0) throw new Error('no resource');
  return eids[0];
}

describe('town center villagers', () => {
  it('a new villager goes to work on its own', () => {
    const world = newWorld(701);
    const villager = trainAtTownCenter(world, P1, UnitDefId.VILLAGER);
    const target = Gatherer.targetEid[villager];
    expect(target).toBeGreaterThanOrEqual(0);
    expect(hasComponent(world.ecs, Resource, target)).toBe(true);
    expect(Gatherer.state[villager]).not.toBe(GathererStateId.IDLE);
  });

  it('spreads new villagers over food and wood', () => {
    const world = newWorld(702);
    const kinds = new Set<number>();
    for (let i = 0; i < 2; i++) { // start pop 3/5: room for two
      const villager = trainAtTownCenter(world, P1, UnitDefId.VILLAGER);
      kinds.add(Resource.kind[Gatherer.targetEid[villager]]);
    }
    expect(kinds.has(ResourceKindId.FOOD)).toBe(true);
    expect(kinds.has(ResourceKindId.WOOD)).toBe(true);
  });

  it('a rally on a resource sends new villagers to gather it', () => {
    const world = newWorld(703);
    const tc = townCenterOf(world, P1);
    const tree = nearestResource(world, ResourceKindId.WOOD, Position.x[tc], Position.y[tc]);
    world.inputs.push({
      type: 'setVillagerRally', playerId: P1, atEid: tc,
      x: Position.x[tree], y: Position.y[tree], targetEid: tree,
    });
    step(world);
    expect(world.villagerRallies.get(tc)).toMatchObject({ targetEid: tree, kind: ResourceKindId.WOOD });

    const villager = trainAtTownCenter(world, P1, UnitDefId.VILLAGER);
    expect(Gatherer.targetEid[villager]).toBe(tree);
  });

  it('a rally on the ground walks new villagers there, and clearing it restores auto work', () => {
    const world = newWorld(704);
    const tc = townCenterOf(world, P1);
    let spot: { x: number; y: number } | null = null;
    for (let r = 5; r < 9 && !spot; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) {
        const x = Math.round(Position.x[tc]) + dx;
        const y = Math.round(Position.y[tc]) + dy;
        if (world.map.walkability[y]?.[x] !== 0) continue;
        if (findResourceAt(world, x, y, 0.8) !== null || findBuildingAt(world, x, y, 1.5) !== null) continue;
        spot = { x, y };
        break;
      }
    }
    if (!spot) throw new Error('no open spot');
    world.inputs.push({ type: 'setVillagerRally', playerId: P1, atEid: tc, x: spot.x, y: spot.y });
    step(world);
    const rally = world.villagerRallies.get(tc);
    expect(rally).toMatchObject({ targetEid: -1, kind: -1 });

    const walker = trainAtTownCenter(world, P1, UnitDefId.VILLAGER);
    expect(Gatherer.state[walker]).toBe(GathererStateId.IDLE);
    for (let i = 0; i < 400; i++) step(world);
    expect(Math.hypot(Position.x[walker] - rally!.x, Position.y[walker] - rally!.y)).toBeLessThan(1.5);

    world.inputs.push({ type: 'clearVillagerRally', playerId: P1, atEid: tc });
    step(world);
    expect(world.villagerRallies.has(tc)).toBe(false);
    const worker = trainAtTownCenter(world, P1, UnitDefId.VILLAGER);
    expect(Gatherer.targetEid[worker]).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the nearest node of the same kind once the rally resource is gone', () => {
    const world = newWorld(705);
    const tc = townCenterOf(world, P1);
    const tree = nearestResource(world, ResourceKindId.WOOD, Position.x[tc], Position.y[tc]);
    world.inputs.push({
      type: 'setVillagerRally', playerId: P1, atEid: tc,
      x: Position.x[tree], y: Position.y[tree], targetEid: tree,
    });
    step(world);
    removeSimEntity(world, tree);
    expect(world.villagerRallies.get(tc)?.targetEid).toBe(-1);

    const villager = trainAtTownCenter(world, P1, UnitDefId.VILLAGER);
    const target = Gatherer.targetEid[villager];
    expect(target).not.toBe(tree);
    expect(Resource.kind[target]).toBe(ResourceKindId.WOOD);
  });

  it('only the owner can set a town center rally', () => {
    const world = newWorld(706);
    const tc = townCenterOf(world, P1);
    world.inputs.push({ type: 'setVillagerRally', playerId: AI_PLAYER_ID, atEid: tc, x: 5, y: 5 });
    step(world);
    expect(world.villagerRallies.has(tc)).toBe(false);
  });

  it('keeps rallies through save and load, and in the lockstep checksum', () => {
    const world = newWorld(707);
    const tc = townCenterOf(world, P1);
    const tree = nearestResource(world, ResourceKindId.WOOD, Position.x[tc], Position.y[tc]);
    const before = checksumWorld(world);
    world.inputs.push({
      type: 'setVillagerRally', playerId: P1, atEid: tc,
      x: Position.x[tree], y: Position.y[tree], targetEid: tree,
    });
    step(world);
    const control = newWorld(707);
    step(control);
    expect(checksumWorld(world)).not.toBe(checksumWorld(control));
    expect(before).toBe(checksumWorld(newWorld(707)));

    const restored = createSimWorld(707);
    loadSimWorldSnapshot(restored, serializeSimWorld(world));
    const restoredTc = townCenterOf(restored, P1);
    const rally = restored.villagerRallies.get(restoredTc);
    expect(rally?.kind).toBe(ResourceKindId.WOOD);
    expect(Position.x[rally!.targetEid]).toBe(Position.x[tree]);
    expect(Position.y[rally!.targetEid]).toBe(Position.y[tree]);
    expect(checksumWorld(restored)).toBe(checksumWorld(world));
  });
});

describe('worksite crews and population', () => {
  function lumberHutWithFreeWorker(world: SimWorld): number {
    revealMapForPlayer(world, P1);
    world.resources[P1].set([0, 2000, 0, 0]);
    const tc = townCenterOf(world, P1);
    const tree = nearestResource(world, ResourceKindId.WOOD, Position.x[tc], Position.y[tc]);
    for (let r = 1; r < 6; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const x = Math.round(Position.x[tree]) + dx;
        const y = Math.round(Position.y[tree]) + dy;
        world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.LUMBER_CAMP, x, y, playerId: P1 });
        step(world);
        const hut = findBuildingAt(world, x, y, 0.5);
        if (hut !== null && Building.defId[hut] === BuildingDefId.LUMBER_CAMP) {
          staffFoundations(world, P1);
          return hut;
        }
      }
    }
    throw new Error('no lumber hut spot');
  }

  it('a worksite worker takes a population place', () => {
    const world = newWorld(711);
    lumberHutWithFreeWorker(world);
    for (let i = 0; i < 20 * 30; i++) step(world);
    const workers = unitQuery(world.ecs).filter((e) => Owner.player[e] === P1 && hasComponent(world.ecs, WorksiteWorker, e));
    expect(workers.length).toBe(1);
    expect(world.population[P1].current).toBe(4); // the rider, 2 starter villagers + the worker
  });

  it('a full population holds back worksite workers until there is room', () => {
    const world = newWorld(712);
    world.population[P1].cap = 3; // the rider and the 2 starter villagers fill it
    const hut = lumberHutWithFreeWorker(world);
    for (let i = 0; i < 20 * 30; i++) step(world);
    const crew = () => unitQuery(world.ecs).filter((e) => Owner.player[e] === P1 && hasComponent(world.ecs, WorksiteWorker, e)).length;
    expect(crew()).toBe(0);
    world.inputs.push({ type: 'trainUnit', atEid: hut, defId: UnitDefId.VILLAGER, playerId: P1 });
    step(world);
    expect(world.productionQueues.get(hut) ?? []).toEqual([]);

    world.population[P1].cap = 5; // a house went up
    step(world);
    expect(crew()).toBe(1);
  });
});

describe('houses under construction and the population maximum', () => {
  function openTiles(world: SimWorld, count: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    const taken = new Set<string>();
    for (let y = 4; y < world.map.walkability.length - 4 && out.length < count; y += 2) {
      for (let x = 4; x < world.map.walkability[0].length - 4 && out.length < count; x += 2) {
        if (world.map.walkability[y][x] !== 0) continue;
        if (findResourceAt(world, x, y, 0.8) !== null || findBuildingAt(world, x, y, 1.5) !== null) continue;
        if (taken.has(`${x},${y}`)) continue;
        taken.add(`${x},${y}`);
        out.push({ x, y });
      }
    }
    return out;
  }

  it('rising houses only add cap once finished, and the HUD gain says how much', () => {
    const world = newWorld(713);
    revealMapForPlayer(world, P1);
    world.resources[P1].set([0, 2000, 0, 0]);
    const [spot] = openTiles(world, 1);
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: P1 });
    step(world);
    expect(world.population[P1].cap).toBe(5);
    expect(pendingPopCapGain(world, P1)).toBe(3);
    staffFoundations(world, P1);
    for (let i = 0; i < 20 * 16; i++) step(world);
    expect(world.population[P1].cap).toBe(8);
    expect(pendingPopCapGain(world, P1)).toBe(0);
  });

  it('refuses a house once finished plus rising houses reach the maximum', () => {
    const world = newWorld(714);
    revealMapForPlayer(world, P1);
    world.researchedTechs[P1].add(TechId.BARRACKS_PIKEMEN); // no early allowance
    world.resources[P1].set([0, 50000, 0, 0]);
    world.population[P1].cap = POP_CAP_HARD_LIMIT - 4;
    const spots = openTiles(world, 3);
    const houses = () => buildingQuery(world.ecs)
      .filter((e) => Owner.player[e] === P1 && Building.defId[e] === BuildingDefId.HOUSE).length;
    for (const spot of spots) {
      world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: P1 });
      step(world);
    }
    // 71 + 3 = 74 < 75 lets the second in; 71 + 6 >= 75 stops the third.
    expect(houses()).toBe(2);
    expect(housingAtMaximum(world, P1)).toBe(true);
    expect(pendingPopCapGain(world, P1)).toBe(4);
  });
});

describe('Start, town center units and building sight', () => {
  it('each side starts with the town center, a single scout rider and 2 villagers', () => {
    const world = createSimWorld(710);
    for (const playerId of [P1, AI_PLAYER_ID]) {
      const kinds = [...ownUnits(world, playerId)].map((eid) => UnitKind.kind[eid]).sort();
      expect(kinds).toEqual([UnitDefId.VILLAGER, UnitDefId.VILLAGER, UnitDefId.SCOUT_CAVALRY].sort());
      expect(world.population[playerId]).toEqual({ current: 3, cap: 5 });
    }
  });

  it('the town center trains villagers only; pikemen come from the barracks', () => {
    const world = newWorld(708);
    const tc = townCenterOf(world, P1);
    world.resources[P1].set([1000, 1000, 0, 0]);
    world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.SPEARMAN, playerId: P1 });
    step(world);
    expect(world.productionQueues.get(tc) ?? []).toEqual([]);
  });

  it('refuses a building where the player cannot see, allows one in sight', () => {
    const world = newWorld(709);
    step(world); // sight around the starting units
    world.resources[P1].set([0, 2000, 0, 0]);
    const count = () => buildingQuery(world.ecs).filter((eid) => Owner.player[eid] === P1).length;
    const vis = world.visibility[P1];
    const open = (wantVisible: boolean): { x: number; y: number } => {
      for (let y = 4; y < world.map.walkability.length - 4; y++) {
        for (let x = 4; x < world.map.walkability[0].length - 4; x++) {
          if (world.map.walkability[y][x] !== 0) continue;
          if (findResourceAt(world, x, y, 0.8) !== null || findBuildingAt(world, x, y, 1.5) !== null) continue;
          const visible = vis.visible[y * world.map.walkability[0].length + x] === 1;
          if (visible === wantVisible) return { x, y };
        }
      }
      throw new Error('no tile');
    };

    const dark = open(false);
    const before = count();
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: dark.x, y: dark.y, playerId: P1 });
    step(world);
    expect(count()).toBe(before);

    const lit = open(true);
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: lit.x, y: lit.y, playerId: P1 });
    step(world);
    expect(count()).toBe(before + 1);
  });
});
