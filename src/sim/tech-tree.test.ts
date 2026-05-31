import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { Owner, Producer, ResourceKindId, ResourceWorksite, UnitKind } from './components';
import { AGE_TABLE, AgeId, BuildingDefId, UNIT_TABLE, UnitDefId } from './defs';
import {
  buildingQuery,
  createSimWorld,
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
  TECH_TREE,
  TechId,
  createStartingTechSet,
  createStartingTechSetForAge,
  isBuildingUnlocked,
  isUnitUnlocked,
  techStatus,
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
  it('starts with only lumber huts and stone mines researched and 300 wood', () => {
    const world = createSimWorld(501);

    expect(Array.from(world.resources[1])).toEqual([0, 300, 0, 0]);
    expect(world.researchedTechs[1]).toEqual(createStartingTechSet());
    expect(isBuildingUnlocked(world, 1, BuildingDefId.LUMBER_CAMP)).toBe(true);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.STONE_QUARRY)).toBe(true);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.FARM)).toBe(true);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.MILL)).toBe(false);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.BARRACKS)).toBe(false);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.DEFENSIVE_TOWER)).toBe(false);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.GOLD_MINE)).toBe(false);
  });

  it('can start a new world in later ages with matching techs and resources', () => {
    const castle = createSimWorld(508, { startingAge: AgeId.CASTLE });

    expect(castle.ages[1].current).toBe(AgeId.CASTLE);
    expect(castle.ages[2].current).toBe(AgeId.CASTLE);
    expect(Array.from(castle.resources[1])).toEqual([600, 1800, 0, 1600]);
    expect(castle.researchedTechs[1]).toEqual(createStartingTechSetForAge(AgeId.CASTLE));
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.ARCHERY_RANGE)).toBe(false);
    expect(isUnitUnlocked(castle, 1, UnitDefId.ARCHER)).toBe(true);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.DEFENSIVE_TOWER)).toBe(true);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.GOLD_MINE)).toBe(true);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.STABLE)).toBe(true);
    expect(isBuildingUnlocked(castle, 1, BuildingDefId.MILL)).toBe(true);
    expect(isUnitUnlocked(castle, 1, UnitDefId.SCOUT_CAVALRY)).toBe(true);

    const gunpowder = createSimWorld(509, { startingAge: AgeId.GUNPOWDER });

    expect(gunpowder.ages[1].current).toBe(AgeId.GUNPOWDER);
    expect(gunpowder.ages[2].current).toBe(AgeId.GUNPOWDER);
    expect(gunpowder.resources[1][ResourceKindId.WOOD]).toBeGreaterThan(castle.resources[1][ResourceKindId.WOOD]);
    expect(gunpowder.resources[1][ResourceKindId.GOLD]).toBeGreaterThan(castle.resources[1][ResourceKindId.GOLD]);
    expect(gunpowder.researchedTechs[1]).toEqual(createStartingTechSetForAge(AgeId.GUNPOWDER));
    expect(isBuildingUnlocked(gunpowder, 1, BuildingDefId.STABLE)).toBe(true);
    expect(isBuildingUnlocked(gunpowder, 1, BuildingDefId.MILL)).toBe(true);
    expect(isBuildingUnlocked(gunpowder, 1, BuildingDefId.FOUNDRY)).toBe(true);
    expect(isUnitUnlocked(gunpowder, 1, UnitDefId.CANNON)).toBe(true);

    const totalWar = createSimWorld(511, { startingAge: AgeId.TOTAL_WAR });

    expect(totalWar.ages[1].current).toBe(AgeId.TOTAL_WAR);
    expect(totalWar.resources[1][ResourceKindId.WOOD]).toBeGreaterThan(gunpowder.resources[1][ResourceKindId.WOOD]);
    expect(totalWar.resources[1][ResourceKindId.GOLD]).toBeGreaterThan(gunpowder.resources[1][ResourceKindId.GOLD]);
    expect(createStartingTechSetForAge(AgeId.GUNPOWDER).has(TechId.FARMS_II)).toBe(false);
    expect(createStartingTechSetForAge(AgeId.TOTAL_WAR).has(TechId.FARMS_II)).toBe(true);
    expect(UNIT_TABLE[UnitDefId.MACHINE_GUN].name).toBe('Machine Gun');
    expect(isUnitUnlocked(totalWar, 1, UnitDefId.MACHINE_GUN)).toBe(false);
  });

  it('blocks locked buildings and unlocks barracks with pikemen research', () => {
    const world = createSimWorld(502);
    world.paused = false;
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

    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.BARRACKS, x: spot.x, y: spot.y, playerId: 1 });
    step(world);
    expect(countPlayerBuildings(world, 1)).toBe(before + 1);
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

  it('allows Castle Age after either complete early path, then folds gold and cavalry into the age unlock', () => {
    const military = createSimWorld(504);
    military.researchedTechs[1].add(TechId.BARRACKS_PIKEMEN);
    expect(techStatus(military, 1, TechId.CASTLE_AGE)).toBe('locked');
    expect(isBuildingUnlocked(military, 1, BuildingDefId.DEFENSIVE_TOWER)).toBe(false);
    military.researchedTechs[1].add(TechId.ARCHERS);
    expect(techStatus(military, 1, TechId.CASTLE_AGE)).toBe('available');
    expect(isBuildingUnlocked(military, 1, BuildingDefId.DEFENSIVE_TOWER)).toBe(true);

    const economy = createSimWorld(505);
    economy.researchedTechs[1].add(TechId.LUMBER_CREWS);
    economy.researchedTechs[1].add(TechId.MINING_CREWS);
    expect(techStatus(economy, 1, TechId.CASTLE_AGE)).toBe('available');

    expect(TECH_TREE.some((tech) => tech.id === TechId.GOLD_MINES)).toBe(false);
    expect(TECH_TREE.some((tech) => tech.id === TechId.KNIGHTS)).toBe(false);
    economy.ages[1].current = AgeId.CASTLE;
    expect(isBuildingUnlocked(economy, 1, BuildingDefId.GOLD_MINE)).toBe(true);
    expect(isBuildingUnlocked(economy, 1, BuildingDefId.STABLE)).toBe(true);
    expect(isUnitUnlocked(economy, 1, UnitDefId.SCOUT_CAVALRY)).toBe(true);
  });

  it('upgrades houses through an independent housing path', () => {
    const world = createSimWorld(511);
    world.paused = false;
    world.researchedTechs[1].add(TechId.BARRACKS_PIKEMEN);
    const spot = findOpenBuildingTile(world);
    spawnCompletedBuilding(world, BuildingDefId.HOUSE, spot.x, spot.y, 1);
    const capAfterHouse = world.population[1].cap;

    expect(getBuildingPopProvided(world, 1, BuildingDefId.HOUSE)).toBe(3);
    expect(capAfterHouse).toBe(8);
    expect(techStatus(world, 1, TechId.HOUSING_I)).toBe('available');
    expect(techStatus(world, 1, TechId.HOUSING_II)).toBe('locked');
    expect(techStatus(world, 1, TechId.CASTLE_AGE)).toBe('locked');

    world.resources[1].set([0, 1000, 0, 1000]);
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.HOUSING_I });
    step(world);

    expect(getBuildingPopProvided(world, 1, BuildingDefId.HOUSE)).toBe(5);
    expect(world.population[1].cap).toBe(capAfterHouse + 2);
    expect(techStatus(world, 1, TechId.HOUSING_II)).toBe('locked');
    expect(techStatus(world, 1, TechId.CASTLE_AGE)).toBe('locked');

    world.ages[1].current = AgeId.CASTLE;
    expect(techStatus(world, 1, TechId.HOUSING_II)).toBe('available');
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.HOUSING_II });
    step(world);

    expect(getBuildingPopProvided(world, 1, BuildingDefId.HOUSE)).toBe(8);
    expect(world.population[1].cap).toBe(capAfterHouse + 5);
  });

  it('unlocks mills and farm productivity through the age-gated food path', () => {
    const world = createSimWorld(512);
    world.paused = false;
    world.researchedTechs[1].add(TechId.BARRACKS_PIKEMEN);

    expect(techStatus(world, 1, TechId.MILLS)).toBe('available');
    expect(techStatus(world, 1, TechId.FARMS)).toBe('locked');
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('locked');
    expect(techStatus(world, 1, TechId.GUNPOWDER_AGE)).toBe('locked');
    expect(isBuildingUnlocked(world, 1, BuildingDefId.MILL)).toBe(false);

    world.resources[1].set([0, 2000, 1000, 1000]);
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.MILLS });
    step(world);
    expect(isBuildingUnlocked(world, 1, BuildingDefId.MILL)).toBe(true);
    expect(techStatus(world, 1, TechId.FARMS)).toBe('locked');
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('locked');
    expect(techStatus(world, 1, TechId.GUNPOWDER_AGE)).toBe('locked');

    world.ages[1].current = AgeId.CASTLE;
    expect(techStatus(world, 1, TechId.FARMS)).toBe('available');
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.FARMS });
    step(world);
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('locked');
    expect(techStatus(world, 1, TechId.GUNPOWDER_AGE)).toBe('available');

    world.ages[1].current = AgeId.GUNPOWDER;
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('available');
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.FARMS_II });
    step(world);
    expect(techStatus(world, 1, TechId.FARMS_II)).toBe('researched');
  });

  it('advances from Castle Age into Gunpowder Age and unlocks the foundry line', () => {
    const world = createSimWorld(506);
    world.paused = false;
    world.ages[1].current = AgeId.CASTLE;

    expect(techStatus(world, 1, TechId.GUNPOWDER_AGE)).toBe('available');
    expect(isBuildingUnlocked(world, 1, BuildingDefId.FOUNDRY)).toBe(false);
    expect(isUnitUnlocked(world, 1, UnitDefId.GUNMAN)).toBe(false);

    world.resources[1].set([
      0,
      AGE_TABLE[AgeId.GUNPOWDER].advanceCost.wood,
      AGE_TABLE[AgeId.GUNPOWDER].advanceCost.gold,
      AGE_TABLE[AgeId.GUNPOWDER].advanceCost.stone,
    ]);
    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.GUNPOWDER_AGE });
    step(world);
    expect(techStatus(world, 1, TechId.GUNPOWDER_AGE)).toBe('researching');

    for (let i = 0; i < AGE_TABLE[AgeId.GUNPOWDER].advanceTicks; i++) step(world);

    expect(world.ages[1].current).toBe(AgeId.GUNPOWDER);
    expect(techStatus(world, 1, TechId.GUNPOWDER_AGE)).toBe('researched');
    expect(isBuildingUnlocked(world, 1, BuildingDefId.FOUNDRY)).toBe(true);
    expect(isUnitUnlocked(world, 1, UnitDefId.GUNMAN)).toBe(true);
    expect(isUnitUnlocked(world, 1, UnitDefId.CANNON)).toBe(true);
  });

  it('trains gunmen and field cannons from a completed foundry', () => {
    const world = createSimWorld(507);
    world.paused = false;
    world.ages[1].current = AgeId.GUNPOWDER;
    world.resources[1].set([1000, 1000, 1000, 1000]);
    world.population[1].cap = 20;
    const spot = findOpenBuildingTile(world, 2);
    const foundry = spawnCompletedBuilding(world, BuildingDefId.FOUNDRY, spot.x, spot.y, 1);

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
    world.ages[1].current = AgeId.GUNPOWDER;
    world.resources[1].set([45 * 3, 1000, 75 * 3, 1000]);
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
});
