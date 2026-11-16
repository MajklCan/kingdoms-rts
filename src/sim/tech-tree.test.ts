import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { Building, Owner, Producer, ResourceKindId, ResourceWorksite, UnitKind } from './components';
import { AgeId, BUILDING_TABLE, BuildingDefId, UNIT_TABLE, UnitDefId } from './defs';
import {
  EARLY_HOUSE_ALLOWANCE,
  buildingQuery,
  createSimWorld,
  remainingHouseAllowance,
  revealMapForPlayer,
  findBuildingAt,
  findResourceAt,
  getBuildingPopProvided,
  getWorksiteWorkerSlots,
  spawnCompletedBuilding,
  step,
  type SimWorld,
  unitQuery,
} from './world';
import {
  BUILDING_UNLOCK_TECH,
  TECH_TREE,
  TechId,
  type TechIdValue,
  UNIT_UNLOCK_TECH,
  createStartingTechSetForAge,
  isBuildingUnlocked,
  isUnitUnlocked,
  techStatus,
  type TechStateWorld,
} from './tech-tree';

function countPlayerBuildings(world: SimWorld, playerId: number): number {
  let count = 0;
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] === playerId) count++;
  }
  return count;
}

function findOpenBuildingTile(world: SimWorld, footprint = 1): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 8; y++) {
    for (let x = 6; x < MAP.WIDTH - 8; x++) {
      let open = true;
      const x0 = x - Math.floor(footprint / 2);
      const y0 = y - Math.floor(footprint / 2);
      for (let dy = 0; dy < footprint; dy++) {
        for (let dx = 0; dx < footprint; dx++) {
          const tx = x0 + dx;
          const ty = y0 + dy;
          if (world.map.walkability[ty][tx] !== 0) open = false;
          if (findBuildingAt(world, tx, ty, 1.5) !== null) open = false;
          if (findResourceAt(world, tx, ty, 0.8) !== null) open = false;
        }
      }
      if (open) return { x, y };
    }
  }
  throw new Error('No open building tile found');
}

function findOpenTileNear(
  world: SimWorld,
  cx: number,
  cy: number,
  minR: number,
  maxR: number,
  reachableFrom?: { x: number; y: number }
): { x: number; y: number } {
  for (let r = minR; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (world.map.walkability[y][x] !== 0) continue;
        if (findBuildingAt(world, x, y, 1.5) !== null) continue;
        if (findResourceAt(world, x, y, 0.8) !== null) continue;
        if (reachableFrom && !world.pathfinder.findPath(reachableFrom, { x, y })) continue;
        return { x, y };
      }
    }
  }
  throw new Error('No open rally tile found');
}

describe('technology tree', () => {
  it('starts with nothing researched and 300 wood; only the settlement is built', () => {
    const world = createSimWorld(501);

    expect(Array.from(world.resources[1])).toEqual([0, 300, 0, 0]);
    expect(world.researchedTechs[1].size).toBe(0);
    for (const defId of [BuildingDefId.TOWN_CENTER, BuildingDefId.HOUSE, BuildingDefId.FARM, BuildingDefId.LUMBER_CAMP, BuildingDefId.STONE_QUARRY]) {
      expect(isBuildingUnlocked(world, 1, defId), BUILDING_TABLE[defId].id).toBe(true);
    }
    for (const defId of [BuildingDefId.BARRACKS, BuildingDefId.ARCHERY_RANGE, BuildingDefId.STABLE, BuildingDefId.GOLD_MINE, BuildingDefId.MILL, BuildingDefId.FOUNDRY, BuildingDefId.DEFENSIVE_TOWER, BuildingDefId.WALL]) {
      expect(isBuildingUnlocked(world, 1, defId), BUILDING_TABLE[defId].id).toBe(false);
    }
    expect(isUnitUnlocked(world, 1, UnitDefId.VILLAGER)).toBe(true);
    expect(isUnitUnlocked(world, 1, UnitDefId.SPEARMAN)).toBe(false);
  });

  it('has the 17 researches of the design with their rings, paths, parents and prices', () => {
    const rows = TECH_TREE.map((t) => [t.id, t.path, t.ring, t.parents.join('+'), t.cost.wood, t.cost.stone, t.cost.gold]);
    expect(rows).toEqual([
      ['barracks_pikemen', 'arms', 1, '', 250, 0, 0],
      ['archers', 'arms', 1, 'barracks_pikemen', 300, 200, 0],
      ['knights', 'arms', 2, 'archers+gold_mines', 400, 300, 0],
      ['lumber_crews', 'timber', 1, '', 250, 0, 0],
      ['housing_i', 'timber', 1, 'lumber_crews', 250, 150, 0],
      ['housing_ii', 'timber', 2, 'housing_i', 600, 400, 0],
      ['mining_crews', 'mines', 1, '', 300, 250, 0],
      ['gold_mines', 'mines', 2, 'mining_crews', 400, 300, 0],
      ['foundry', 'mines', 3, 'gold_mines', 800, 700, 800],
      ['houfnice', 'mines', 3, 'foundry', 500, 400, 600],
      ['palisades', 'walls', 1, '', 200, 0, 0],
      ['watchtowers', 'walls', 1, 'palisades', 200, 200, 0],
      ['stone_walls', 'walls', 2, 'watchtowers', 300, 600, 0],
      ['brick_walls', 'walls', 3, 'stone_walls', 400, 800, 300],
      ['mills', 'land', 1, '', 450, 300, 0],
      ['farms', 'land', 2, 'mills', 300, 150, 0],
      ['farms_ii', 'land', 3, 'farms', 600, 350, 0],
    ]);
    expect(TECH_TREE.every((t) => t.cost.food === 0)).toBe(true);
  });

  it('unlocks every unit and building past the settlement by exactly its research', () => {
    const expectedBuildings: Record<number, TechIdValue> = {
      [BuildingDefId.BARRACKS]: TechId.BARRACKS_PIKEMEN,
      [BuildingDefId.ARCHERY_RANGE]: TechId.ARCHERS,
      [BuildingDefId.STABLE]: TechId.KNIGHTS,
      [BuildingDefId.GOLD_MINE]: TechId.GOLD_MINES,
      [BuildingDefId.FOUNDRY]: TechId.FOUNDRY,
      [BuildingDefId.WALL]: TechId.PALISADES,
      [BuildingDefId.DEFENSIVE_TOWER]: TechId.WATCHTOWERS,
      [BuildingDefId.MILL]: TechId.MILLS,
    };
    const expectedUnits: Record<number, TechIdValue> = {
      [UnitDefId.SPEARMAN]: TechId.BARRACKS_PIKEMEN,
      [UnitDefId.ARCHER]: TechId.ARCHERS,
      [UnitDefId.SCOUT_CAVALRY]: TechId.KNIGHTS,
      [UnitDefId.GUNMAN]: TechId.FOUNDRY,
      [UnitDefId.CANNON]: TechId.HOUFNICE,
    };
    expect(BUILDING_UNLOCK_TECH).toEqual(expectedBuildings);
    expect(UNIT_UNLOCK_TECH).toEqual(expectedUnits);

    const one = (techId: TechIdValue): TechStateWorld => ({
      researchedTechs: [new Set(), new Set([techId])],
      ages: [{ current: 0 }, { current: AgeId.DARK }],
    });
    for (const [defId, techId] of Object.entries(expectedBuildings)) {
      expect(isBuildingUnlocked(one(techId), 1, Number(defId)), techId).toBe(true);
      expect(isBuildingUnlocked(one(TechId.FARMS_II), 1, Number(defId)), techId).toBe(false);
    }
    for (const [defId, techId] of Object.entries(expectedUnits)) {
      expect(isUnitUnlocked(one(techId), 1, Number(defId)), techId).toBe(true);
      expect(isUnitUnlocked(one(TechId.FARMS_II), 1, Number(defId)), techId).toBe(false);
    }
    // An age alone unlocks nothing any more.
    const castleWithoutResearch: TechStateWorld = { researchedTechs: [new Set(), new Set()], ages: [{ current: 0 }, { current: AgeId.GUNPOWDER }] };
    expect(isBuildingUnlocked(castleWithoutResearch, 1, BuildingDefId.STABLE)).toBe(false);
    expect(isUnitUnlocked(castleWithoutResearch, 1, UnitDefId.GUNMAN)).toBe(false);
  });

  it('starts later ages as research presets: Castle = ring I, Gunpowder = rings I and II', () => {
    const ringOf = (id: TechIdValue) => TECH_TREE.find((t) => t.id === id)?.ring;
    const castle = createSimWorld(508, { startingAge: AgeId.CASTLE });

    expect(castle.ages[1].current).toBe(AgeId.CASTLE);
    expect(castle.ages[2].current).toBe(AgeId.CASTLE);
    expect(Array.from(castle.resources[1])).toEqual([600, 1800, 0, 1600]);
    expect(castle.researchedTechs[1]).toEqual(createStartingTechSetForAge(AgeId.CASTLE));
    expect(castle.researchedTechs[1].size).toBe(8);
    expect([...castle.researchedTechs[1]].every((id) => ringOf(id) === 1)).toBe(true);
    expect(castle.researchedTechs[0].size).toBe(0);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.ARCHERY_RANGE)).toBe(true);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.DEFENSIVE_TOWER)).toBe(true);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.MILL)).toBe(true);
    // Gold mines, stables and stone walls are ring II research now.
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.GOLD_MINE)).toBe(false);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.STABLE)).toBe(false);
    expect(techStatus(castle, 1, TechId.GOLD_MINES)).toBe('available');
    expect(techStatus(castle, 1, TechId.FOUNDRY)).toBe('locked');

    const gunpowder = createSimWorld(509, { startingAge: AgeId.GUNPOWDER });

    expect(gunpowder.ages[1].current).toBe(AgeId.GUNPOWDER);
    expect(gunpowder.ages[2].current).toBe(AgeId.GUNPOWDER);
    expect(gunpowder.resources[1][ResourceKindId.WOOD]).toBeGreaterThan(castle.resources[1][ResourceKindId.WOOD]);
    expect(gunpowder.resources[1][ResourceKindId.GOLD]).toBeGreaterThan(castle.resources[1][ResourceKindId.GOLD]);
    expect(gunpowder.researchedTechs[1].size).toBe(13);
    expect([...gunpowder.researchedTechs[1]].every((id) => (ringOf(id) ?? 9) <= 2)).toBe(true);
    expect(isBuildingUnlocked(gunpowder, 1, BuildingDefId.STABLE)).toBe(true);
    expect(isBuildingUnlocked(gunpowder, 1, BuildingDefId.GOLD_MINE)).toBe(true);
    expect(isBuildingUnlocked(gunpowder, 1, BuildingDefId.FOUNDRY)).toBe(false);
    expect(techStatus(gunpowder, 1, TechId.FOUNDRY)).toBe('available');

    const totalWar = createSimWorld(511, { startingAge: AgeId.TOTAL_WAR });

    expect(totalWar.ages[1].current).toBe(AgeId.TOTAL_WAR);
    expect(totalWar.researchedTechs[1].size).toBe(TECH_TREE.length);
    expect(totalWar.resources[1][ResourceKindId.GOLD]).toBeGreaterThan(gunpowder.resources[1][ResourceKindId.GOLD]);
    expect(UNIT_TABLE[UnitDefId.MACHINE_GUN].name).toBe('Machine Gun');
    expect(isUnitUnlocked(totalWar, 1, UnitDefId.MACHINE_GUN)).toBe(false);
  });

  it('blocks locked buildings and unlocks barracks with the Levy research', () => {
    const world = createSimWorld(502);
    world.paused = false;
    revealMapForPlayer(world, 1); // building needs sight; the test tile is far from base
    world.resources[1].set([0, 2000, 0, 2000]);
    const spot = findOpenBuildingTile(world, 2);
    const before = countPlayerBuildings(world, 1);

    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.BARRACKS, x: spot.x, y: spot.y, playerId: 1 });
    step(world);
    expect(countPlayerBuildings(world, 1)).toBe(before);

    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.BARRACKS_PIKEMEN });
    step(world);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.BARRACKS)).toBe(true);
    expect(isUnitUnlocked(world, 1, UnitDefId.SPEARMAN)).toBe(true);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.WALL)).toBe(false);

    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.BARRACKS, x: spot.x, y: spot.y, playerId: 1 });
    step(world);
    expect(countPlayerBuildings(world, 1)).toBe(before + 1);
  });

  it('allows a few houses from the start and lifts the limit with Carpentry, not Levy', () => {
    const world = createSimWorld(512);
    world.paused = false;
    revealMapForPlayer(world, 1);
    world.resources[1].set([0, 5000, 0, 5000]);
    const countHouses = () => {
      let n = 0;
      for (const eid of buildingQuery(world.ecs)) {
        if (Owner.player[eid] === 1 && Building.defId[eid] === BuildingDefId.HOUSE) n++;
      }
      return n;
    };
    const placeHouse = () => {
      const spot = findOpenBuildingTile(world, 1);
      world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: spot.x, y: spot.y, playerId: 1 });
      step(world);
    };

    expect(isBuildingUnlocked(world, 1, BuildingDefId.HOUSE)).toBe(true);
    expect(remainingHouseAllowance(world, 1)).toBe(EARLY_HOUSE_ALLOWANCE);
    for (let i = 0; i < EARLY_HOUSE_ALLOWANCE + 2; i++) placeHouse();
    expect(countHouses()).toBe(EARLY_HOUSE_ALLOWANCE);
    expect(remainingHouseAllowance(world, 1)).toBe(0);

    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.BARRACKS_PIKEMEN });
    step(world);
    expect(remainingHouseAllowance(world, 1)).toBe(0);

    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.LUMBER_CREWS });
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.HOUSING_I });
    step(world);
    expect(remainingHouseAllowance(world, 1)).toBeNull();
    placeHouse();
    expect(countHouses()).toBe(EARLY_HOUSE_ALLOWANCE + 1);
  });

  it('raises worksite worker caps only after the matching economy upgrades', () => {
    const world = createSimWorld(503);
    const spawn = world.map.spawns[1];
    const lumber = spawnCompletedBuilding(world, BuildingDefId.LUMBER_CAMP, spawn.x + 6, spawn.y - 2, 1);
    const stone = spawnCompletedBuilding(world, BuildingDefId.STONE_QUARRY, spawn.x - 6, spawn.y + 3, 1);

    expect(ResourceWorksite.kind[lumber]).toBe(1);
    expect(getWorksiteWorkerSlots(world, lumber)).toBe(1);
    expect(getWorksiteWorkerSlots(world, stone)).toBe(1);

    world.researchedTechs[1].add(TechId.LUMBER_CREWS);
    expect(getWorksiteWorkerSlots(world, lumber)).toBe(3);
    expect(getWorksiteWorkerSlots(world, stone)).toBe(1);

    world.researchedTechs[1].add(TechId.MINING_CREWS);
    expect(getWorksiteWorkerSlots(world, stone)).toBe(3);
  });

  it('upgrades houses along the timber path: Carpentry, then Burgher Houses in ring II', () => {
    const world = createSimWorld(511);
    world.paused = false;
    const spot = findOpenBuildingTile(world);
    spawnCompletedBuilding(world, BuildingDefId.HOUSE, spot.x, spot.y, 1);
    const capAfterHouse = world.population[1].cap;

    expect(getBuildingPopProvided(world, 1, BuildingDefId.HOUSE)).toBe(3);
    expect(capAfterHouse).toBe(8);
    expect(techStatus(world, 1, TechId.HOUSING_I)).toBe('locked');
    world.researchedTechs[1].add(TechId.LUMBER_CREWS);
    expect(techStatus(world, 1, TechId.HOUSING_I)).toBe('available');

    world.resources[1].set([0, 5000, 0, 5000]);
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.HOUSING_I });
    step(world);

    expect(getBuildingPopProvided(world, 1, BuildingDefId.HOUSE)).toBe(5);
    expect(world.population[1].cap).toBe(capAfterHouse + 2);
    // Timber is maxed in ring I, but one path never opens ring II.
    expect(techStatus(world, 1, TechId.HOUSING_II)).toBe('locked');

    world.researchedTechs[1].add(TechId.PALISADES);
    world.researchedTechs[1].add(TechId.WATCHTOWERS);
    expect(techStatus(world, 1, TechId.HOUSING_II)).toBe('available');
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.HOUSING_II });
    step(world);

    expect(getBuildingPopProvided(world, 1, BuildingDefId.HOUSE)).toBe(8);
    expect(world.population[1].cap).toBe(capAfterHouse + 5);
  });

  it('unlocks mills and farm yields along the land path, ring by ring', () => {
    const world = createSimWorld(512);
    world.paused = false;

    expect(techStatus(world, 1, TechId.MILLS)).toBe('available');
    expect(techStatus(world, 1, TechId.FARMS)).toBe('locked');
    expect(isBuildingUnlocked(world, 1, BuildingDefId.MILL)).toBe(false);

    world.resources[1].set([0, 5000, 1000, 5000]);
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.MILLS });
    step(world);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.MILL)).toBe(true);
    expect(techStatus(world, 1, TechId.FARMS)).toBe('locked');

    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.MINING_CREWS });
    step(world);
    expect(techStatus(world, 1, TechId.FARMS)).toBe('available');
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.FARMS });
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.GOLD_MINES });
    step(world);
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('available');
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.FARMS_II });
    step(world);
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('researched');
  });

  it('trains gunmen after Foundry and field cannons only after Houfnice', () => {
    const world = createSimWorld(507);
    world.paused = false;
    world.researchedTechs[1] = createStartingTechSetForAge(AgeId.GUNPOWDER);
    world.researchedTechs[1].add(TechId.FOUNDRY);
    world.resources[1].set([1000, 1000, 1000, 1000]);
    world.population[1].cap = 20;
    const spot = findOpenBuildingTile(world, 2);
    const foundry = spawnCompletedBuilding(world, BuildingDefId.FOUNDRY, spot.x, spot.y, 1);

    world.inputs.push({ type: 'trainUnit', atEid: foundry, defId: UnitDefId.CANNON });
    step(world);
    expect(world.productionQueues.get(foundry) ?? []).toEqual([]);

    world.researchedTechs[1].add(TechId.HOUFNICE);
    world.inputs.push(
      { type: 'trainUnit', atEid: foundry, defId: UnitDefId.GUNMAN },
      { type: 'trainUnit', atEid: foundry, defId: UnitDefId.CANNON }
    );
    step(world);

    const trainTicks =
      UNIT_TABLE[UnitDefId.GUNMAN].trainTimeTicks +
      UNIT_TABLE[UnitDefId.CANNON].trainTimeTicks +
      10;
    for (let i = 0; i < trainTicks; i++) step(world);

    const playerKinds = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === 1)
      .map((eid) => UnitKind.kind[eid]);
    expect(playerKinds).toContain(UnitDefId.GUNMAN);
    expect(playerKinds).toContain(UnitDefId.CANNON);
  });

  it('batch queues train commands up to available resources', () => {
    const world = createSimWorld(513);
    world.paused = false;
    world.researchedTechs[1].add(TechId.FOUNDRY);
    const gunman = UNIT_TABLE[UnitDefId.GUNMAN].cost;
    world.resources[1].set([gunman.food * 3, 1000, gunman.gold * 3, 1000]);
    world.population[1].cap = world.population[1].current + 5;
    const spot = findOpenBuildingTile(world, 2);
    const foundry = spawnCompletedBuilding(world, BuildingDefId.FOUNDRY, spot.x, spot.y, 1);

    world.inputs.push({ type: 'trainUnit', atEid: foundry, defId: UnitDefId.GUNMAN, count: 5 });
    step(world);

    expect(world.productionQueues.get(foundry)).toEqual([
      UnitDefId.GUNMAN,
      UnitDefId.GUNMAN,
      UnitDefId.GUNMAN,
    ]);
    expect(world.resources[1][ResourceKindId.FOOD]).toBe(0);
    expect(world.resources[1][ResourceKindId.GOLD]).toBe(0);
  });

  it('sends newly trained army units to the global army rally point', () => {
    const world = createSimWorld(510, { startingAge: AgeId.GUNPOWDER });
    world.paused = false;
    world.resources[1].set([1000, 1000, 1000, 1000]);
    world.population[1].cap = 40;
    const barracksSpot = findOpenBuildingTile(world, 2);
    const barracks = spawnCompletedBuilding(
      world,
      BuildingDefId.BARRACKS,
      barracksSpot.x,
      barracksSpot.y,
      1
    );
    const expectedSpawn = world.pathfinder.nearestWalkable(barracksSpot.x + 1, barracksSpot.y + 1, 4);
    expect(expectedSpawn).not.toBeNull();
    const rally = findOpenTileNear(world, barracksSpot.x, barracksSpot.y, 6, 14, expectedSpawn!);
    const beforeUnits = new Set(unitQuery(world.ecs));

    world.inputs.push(
      { type: 'setArmyRallyPoint', playerId: 1, x: rally.x, y: rally.y },
      { type: 'trainUnit', atEid: barracks, defId: UnitDefId.SPEARMAN }
    );
    step(world);
    Producer.currentProgress[barracks] = UNIT_TABLE[UnitDefId.SPEARMAN].trainTimeTicks - 1;
    step(world);

    const spearman = unitQuery(world.ecs).find(
      (eid) => !beforeUnits.has(eid) && Owner.player[eid] === 1 && UnitKind.kind[eid] === UnitDefId.SPEARMAN
    );
    expect(spearman).toBeDefined();
    expect(world.armyRallyPoints[1]).toEqual(rally);
    const path = world.paths.get(spearman!);
    expect(path).toBeDefined();
    expect(path?.at(-1)).toEqual(rally);
  });

  it('can research every tech and train every unlocked unit', () => {
    const state: TechStateWorld = {
      researchedTechs: [new Set(), new Set()],
      ages: [{ current: AgeId.DARK }, { current: AgeId.DARK }],
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const tech of TECH_TREE) {
        if (techStatus(state, 1, tech.id) !== 'available') continue;
        state.researchedTechs[1].add(tech.id);
        changed = true;
      }
    }
    for (const tech of TECH_TREE) expect(techStatus(state, 1, tech.id), tech.id).toBe('researched');

    const trainable = new Set<string>();
    BUILDING_TABLE.forEach((building, defId) => {
      if (isBuildingUnlocked(state, 1, defId)) for (const unit of building.trains) trainable.add(unit);
    });
    const untrainable = UNIT_TABLE.filter(
      (unit, defId) => isUnitUnlocked(state, 1, defId) && !trainable.has(unit.id)
    ).map((unit) => unit.id);
    // The town center trains villagers; every unlocked unit has a producer.
    expect(untrainable).toEqual([]);
  });
});
