import { describe, expect, it } from 'vitest';
import { Building, ConstructionSite, Health, Owner, Position, Producer, TownCenterTag } from '../components';
import { hasComponent } from 'bitecs';
import { checksumWorld } from '../checksum';
import { BUILDING_TABLE, BuildingDefId, UnitDefId, getBuildingDef, getUnitDef } from '../defs';
import { loadSimWorldSnapshot, migrateSavedGame, serializeSimWorld, type SavedGameV1 } from '../save-load';
import { TECH_TREE, isBuildingUnlocked, techStatus } from '../tech-tree';
import {
  buildingQuery,
  canPlaceBuildingAt,
  createSimWorld,
  createLateGameTestWorld,
  spawnFoundation,
  spawnSpearman,
  spawnVillager,
  step,
  worksiteUsesResourceNodes,
  type GameEvent,
  type SimWorld,
} from '../world';
import { applyDamage } from './match-stats';

const P1 = 1;
const P2 = 2;

function townCenterOf(world: SimWorld, playerId: number): number {
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] === playerId && hasComponent(world.ecs, TownCenterTag, eid)) return eid;
  }
  throw new Error(`no town center for player ${playerId}`);
}

function richWorld(seed = 7): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  // Keep the computer opponent out of these unit tests.
  world.aiPlayers = [];
  world.resources[P1] = Int32Array.of(5000, 5000, 5000, 5000);
  world.resources[P2] = Int32Array.of(5000, 5000, 5000, 5000);
  // Room to queue several units without building houses first.
  world.population[P1]!.cap += 20;
  return world;
}

/** Late-game fixture (everything unlocked) with player 1's barracks. */
function armedWorld(): { world: SimWorld; barracks: number } {
  const world = createLateGameTestWorld();
  world.paused = false;
  world.aiPlayers = [];
  world.resources[P1] = Int32Array.of(5000, 5000, 5000, 5000);
  world.population[P1]!.cap = world.population[P1]!.current + 20;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] === P1 && Building.defId[eid] === BuildingDefId.BARRACKS) {
      world.productionQueues.delete(eid);
      return { world, barracks: eid };
    }
  }
  throw new Error('fixture has no barracks');
}

function stepUntil(world: SimWorld, done: () => boolean, maxTicks = 4000): void {
  for (let i = 0; i < maxTicks && !done(); i++) step(world);
  if (!done()) throw new Error('condition not reached');
}

function events(world: SimWorld, kind: GameEvent['kind']): GameEvent[] {
  return world.gameEvents.filter((e) => e.kind === kind);
}

describe('match statistics', () => {
  it('starts at zero with peak population seeded from the starting units', () => {
    const world = createSimWorld(3);
    for (const playerId of [P1, P2]) {
      const s = world.matchStats[playerId]!;
      expect(s.unitsTrained).toBe(0);
      expect(s.unitsLost).toBe(0);
      expect(s.unitsKilled).toBe(0);
      expect(s.buildingsBuilt).toBe(0);
      expect(s.gathered).toEqual([0, 0, 0, 0]);
      expect(s.peakPopulation).toBe(world.population[playerId]!.current);
    }
  });

  it('counts a trained unit once and raises a unitTrained event', () => {
    const { world, barracks } = armedWorld();
    world.inputs.push({ type: 'trainUnit', atEid: barracks, defId: UnitDefId.SPEARMAN, count: 1, playerId: P1 });
    stepUntil(world, () => world.matchStats[P1]!.unitsTrained > 0);
    expect(world.matchStats[P1]!.unitsTrained).toBe(1);
    expect(world.matchStats[P1]!.buildingsBuilt).toBe(0); // spawned complete, not built
    const trained = events(world, 'unitTrained').filter((e) => e.kind === 'unitTrained' && e.playerId === P1);
    expect(trained).toHaveLength(1);
    expect(trained[0]).toMatchObject({ playerId: P1, unitDefId: UnitDefId.SPEARMAN });
    expect(world.matchStats[P1]!.peakPopulation).toBe(world.population[P1]!.current);
  });

  it('cancels any queue slot, refunds it, and refunds do not count as gathered', () => {
    const { world, barracks: tc } = armedWorld();
    const cost = getUnitDef(UnitDefId.SPEARMAN)!.cost;
    const before = [...world.resources[P1]!];
    world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.SPEARMAN, count: 3, playerId: P1 });
    step(world);
    expect(world.productionQueues.get(tc)).toHaveLength(3);
    expect(world.resources[P1]![0]).toBe(before[0]! - 3 * cost.food);
    const progressBefore = Producer.currentProgress[tc];
    expect(progressBefore).toBeGreaterThan(0);

    // Middle slot: the unit in training keeps its progress.
    world.inputs.push({ type: 'cancelProduction', atEid: tc, playerId: P1, slot: 1 });
    step(world);
    expect(world.productionQueues.get(tc)).toHaveLength(2);
    expect(world.resources[P1]![0]).toBe(before[0]! - 2 * cost.food);
    expect(Producer.currentProgress[tc]).toBe(progressBefore + 1);

    // Front slot: the next unit starts from scratch.
    world.inputs.push({ type: 'cancelProduction', atEid: tc, playerId: P1, slot: 0 });
    step(world);
    expect(world.productionQueues.get(tc)).toHaveLength(1);
    expect(world.resources[P1]![0]).toBe(before[0]! - cost.food);
    expect(Producer.currentProgress[tc]).toBeLessThanOrEqual(1);

    // Out of range and another player's building are ignored.
    world.inputs.push({ type: 'cancelProduction', atEid: tc, playerId: P1, slot: 5 });
    world.inputs.push({ type: 'cancelProduction', atEid: tc, playerId: P2, slot: 0 });
    step(world);
    expect(world.productionQueues.get(tc)).toHaveLength(1);
    expect(world.matchStats[P1]!.gathered).toEqual([0, 0, 0, 0]);
  });

  it('credits a kill exactly once to the attacker and a loss to the victim', () => {
    const world = richWorld();
    const victim = spawnVillager(world, 10, 10, P2);
    Health.hp[victim] = 5;
    applyDamage(world, victim, 3, P1);
    expect(world.matchStats[P1]!.unitsKilled).toBe(0);
    applyDamage(world, victim, 10, P1);
    applyDamage(world, victim, 10, P1); // already dead: no second credit
    expect(world.matchStats[P1]!.unitsKilled).toBe(1);
    step(world);
    expect(world.matchStats[P2]!.unitsLost).toBe(1);
    const destroyed = events(world, 'entityDestroyed');
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({
      eid: victim,
      ownerId: P2,
      isBuilding: false,
      defId: UnitDefId.VILLAGER,
      x: 10,
      y: 10,
      footprint: { w: 1, h: 1 },
      wasFoundation: false,
      killerOwnerId: P1,
    });
    expect(world.killingBlows.size).toBe(0);
  });

  it('reports no killer for a scripted removal and a foundation flag for unfinished buildings', () => {
    const world = richWorld();
    const unit = spawnVillager(world, 12, 12, P2);
    Health.hp[unit] = 0; // scripted: nobody dealt the blow
    const tc = townCenterOf(world, P1);
    const def = getBuildingDef(BuildingDefId.HOUSE)!;
    let foundation = -1;
    for (let r = 4; r < 14 && foundation < 0; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]] as const) {
        const x = Position.x[tc] + dx;
        const y = Position.y[tc] + dy;
        if (!canPlaceBuildingAt(world, def, x, y)) continue;
        foundation = spawnFoundation(world, BuildingDefId.HOUSE, x, y, P1);
        break;
      }
    }
    expect(foundation).toBeGreaterThanOrEqual(0);
    // Well past zero: the construction step keeps raising a foundation's hp.
    applyDamage(world, foundation, def.hp * 2, P2);
    step(world);
    const destroyed = events(world, 'entityDestroyed') as Array<Extract<GameEvent, { kind: 'entityDestroyed' }>>;
    expect(destroyed.find((e) => e.eid === unit)).toMatchObject({ killerOwnerId: -1, isBuilding: false });
    expect(destroyed.find((e) => e.eid === foundation)).toMatchObject({
      isBuilding: true,
      defId: BuildingDefId.HOUSE,
      footprint: { w: def.footprint.w, h: def.footprint.h },
      wasFoundation: true,
      killerOwnerId: P2,
    });
  });

  it('keeps damage on a growing foundation instead of healing it the next tick', () => {
    const world = richWorld();
    const tc = townCenterOf(world, P1);
    const def = getBuildingDef(BuildingDefId.HOUSE)!;
    let site = -1;
    for (let r = 4; r < 14 && site < 0; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]] as const) {
        if (!canPlaceBuildingAt(world, def, Position.x[tc] + dx, Position.y[tc] + dy)) continue;
        site = spawnFoundation(world, BuildingDefId.HOUSE, Position.x[tc] + dx, Position.y[tc] + dy, P1);
        break;
      }
    }
    expect(site).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < Math.floor(def.buildTimeTicks / 2); i++) step(world);
    const halfway = Health.hp[site];
    expect(halfway).toBeGreaterThan(10);
    applyDamage(world, site, 10, P2);
    step(world);
    // One more tick of growth, minus the 10 it took.
    expect(Health.hp[site]).toBeLessThan(halfway);
    stepUntil(world, () => !hasComponent(world.ecs, ConstructionSite, site), def.buildTimeTicks + 5);
    expect(Health.hp[site]).toBe(def.hp - 10);
  });

  it('counts a real fight: the spearman kills, the villager is lost', () => {
    const world = richWorld();
    // Next to our own town center, so nothing of theirs interferes.
    const tc = townCenterOf(world, P1);
    const x = Position.x[tc] + 4;
    const y = Position.y[tc] + 3;
    const victim = spawnVillager(world, x, y, P2);
    const spear = spawnSpearman(world, x + 1, y, P1);
    world.inputs.push({ type: 'cmdAttack', playerId: P1, eids: [spear], targetEid: victim });
    stepUntil(world, () => world.matchStats[P2]!.unitsLost > 0, 2000);
    expect(world.matchStats[P1]!.unitsKilled).toBe(1);
    expect(world.matchStats[P2]!.unitsLost).toBe(1);
    expect(world.matchStats[P1]!.unitsLost).toBe(0);
  });

  it('counts razed and lost buildings', () => {
    const world = richWorld();
    let house = -1;
    for (const eid of buildingQuery(world.ecs)) {
      if (Owner.player[eid] === P2 && !hasComponent(world.ecs, TownCenterTag, eid)) {
        house = eid;
        break;
      }
    }
    const target = house >= 0 ? house : townCenterOf(world, P2);
    applyDamage(world, target, Health.hp[target] + 1, P1);
    step(world);
    expect(world.matchStats[P1]!.buildingsRazed).toBe(1);
    expect(world.matchStats[P2]!.buildingsLost).toBe(1);
    const targetDef = getBuildingDef(Building.defId[target])!;
    expect(events(world, 'entityDestroyed')[0]).toMatchObject({
      eid: target,
      ownerId: P2,
      isBuilding: true,
      defId: Building.defId[target],
      footprint: { w: targetDef.footprint.w, h: targetDef.footprint.h },
      wasFoundation: false,
      killerOwnerId: P1,
    });
  });

  it('counts a building once its foundation completes', () => {
    const world = richWorld();
    const tc = townCenterOf(world, P1);
    // Any building player 1 may raise right now that does not need a resource node.
    const def = Object.values(BuildingDefId)
      .filter((id) => id !== BuildingDefId.TOWN_CENTER && isBuildingUnlocked(world, P1, id))
      .map((id) => getBuildingDef(id)!)
      .find((d) => !worksiteUsesResourceNodes(d));
    expect(def).toBeDefined();
    let spot: { x: number; y: number } | null = null;
    for (let r = 4; r < 14 && !spot; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]] as const) {
        const x = Position.x[tc] + dx;
        const y = Position.y[tc] + dy;
        if (canPlaceBuildingAt(world, def!, x, y)) {
          spot = { x, y };
          break;
        }
      }
    }
    expect(spot).not.toBeNull();
    const defId = BUILDING_TABLE.indexOf(def!);
    world.inputs.push({ type: 'placeBuilding', defId, x: spot!.x, y: spot!.y, playerId: P1 });
    stepUntil(world, () => world.matchStats[P1]!.buildingsBuilt > 0, def!.buildTimeTicks + 50);
    expect(world.matchStats[P1]!.buildingsBuilt).toBe(1);
    expect(events(world, 'buildingCompleted').filter((e) => e.kind === 'buildingCompleted' && e.playerId === P1)[0])
      .toMatchObject({ playerId: P1, buildingDefId: defId });
  });

  it('counts researched technologies', () => {
    const world = richWorld();
    const tech = TECH_TREE.find((t) => !/age$/i.test(t.name) && techStatus(world, P1, t.id) === 'available');
    expect(tech).toBeDefined();
    world.inputs.push({ type: 'researchTech', playerId: P1, techId: tech!.id });
    stepUntil(world, () => world.matchStats[P1]!.techsResearched > 0, 6000);
    expect(world.matchStats[P1]!.techsResearched).toBe(1);
    expect(events(world, 'researchCompleted')[0]).toMatchObject({ playerId: P1, techId: tech!.id });
  });

  it('records income per resource while the economy runs', () => {
    const world = createSimWorld(11);
    world.paused = false;
    for (let i = 0; i < 3000; i++) step(world);
    const total = (playerId: number) => world.matchStats[playerId]!.gathered.reduce((a, b) => a + b, 0);
    // The computer player works its economy from the start.
    expect(total(P2)).toBeGreaterThan(0);
  });

  it('keeps stats out of the checksum', () => {
    const world = richWorld();
    const before = checksumWorld(world);
    world.matchStats[P1]!.unitsKilled += 7;
    world.matchStats[P1]!.gathered[2] += 100;
    expect(checksumWorld(world)).toBe(before);
  });

  it('round-trips stats through a save and migrates version 1 saves', () => {
    const world = richWorld();
    world.matchStats[P1]!.unitsTrained = 4;
    world.matchStats[P1]!.gathered = [10, 20, 30, 40];
    world.matchStats[P2]!.buildingsRazed = 2;
    const save = JSON.parse(JSON.stringify(serializeSimWorld(world, 'stats'))) as ReturnType<typeof serializeSimWorld>;
    expect(save.version).toBe(2);

    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, save);
    expect(restored.matchStats[P1]).toEqual(world.matchStats[P1]);
    expect(restored.matchStats[P2]!.buildingsRazed).toBe(2);

    const { matchStats: _dropped, ...rest } = save;
    const v1: SavedGameV1 = { ...rest, version: 1 };
    const migrated = migrateSavedGame(v1);
    expect(migrated?.version).toBe(2);
    const fromV1 = createSimWorld(1);
    loadSimWorldSnapshot(fromV1, v1);
    expect(fromV1.matchStats[P1]!.unitsTrained).toBe(0);
    expect(fromV1.matchStats[P1]!.gathered).toEqual([0, 0, 0, 0]);
    expect(fromV1.matchStats[P1]!.peakPopulation).toBe(fromV1.population[P1]!.current);
  });
});
