import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { MAP, SIM } from '../config';
import {
  ArcherTag,
  AttackMoveGoal,
  Building,
  CannonTag,
  GunmanTag,
  Health,
  MachineGunTag,
  MortarTag,
  Owner,
  Position,
  Resource,
  ResourceKindId,
  ScoutCavalryTag,
  SpearmanTag,
  VillagerTag,
} from './components';
import { AgeId, BuildingDefId } from './defs';
import { CampaignMissionId } from './campaign';
import { TileType } from './map-gen';
import { TechId, techStatus } from './tech-tree';
import {
  AI_PLAYER_ID,
  LOCAL_PLAYER_ID,
  buildingQuery,
  createCampaignWorld,
  resourceQuery,
  step,
  unitQuery,
} from './world';

const BILA_HORA_WAIT_TEST_TICKS = SIM.TICK_HZ * 15;
const KUTNA_HORA_FIRST_WAVE_TEST_TICKS = SIM.TICK_HZ * 30;
const SUDOMER_FIRST_WAVE_TEST_TICKS = SIM.TICK_HZ * 300;
const ZBOROV_REINFORCE_TEST_INTERVAL = SIM.TICK_HZ * 40;
const ZBOROV_PLAYER_REINFORCE_TARGET = 10;

describe('campaign missions', () => {
  it('sets up Siege of Brno as a Dark Age assault against a built Castle Age city', () => {
    const world = createCampaignWorld(700, CampaignMissionId.SIEGE_OF_BRNO);

    expect(world.campaign?.missionId).toBe(CampaignMissionId.SIEGE_OF_BRNO);
    expect(world.ages[LOCAL_PLAYER_ID].current).toBe(AgeId.DARK);
    expect(world.ages[AI_PLAYER_ID].current).toBe(AgeId.CASTLE);
    expect(world.campaign?.lockedTechs).toContain(TechId.GUNPOWDER_AGE);

    const playerBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    expect(playerBuildings).toHaveLength(1);
    expect(Building.defId[playerBuildings[0]]).toBe(BuildingDefId.TOWN_CENTER);

    const playerUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    expect(playerUnits).toHaveLength(1);
    expect(hasComponent(world.ecs, ScoutCavalryTag, playerUnits[0])).toBe(true);

    const enemyBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(enemyBuildings.length).toBeGreaterThanOrEqual(20);
    expect(enemyBuildings.some((eid) => Building.defId[eid] === BuildingDefId.DEFENSIVE_TOWER))
      .toBe(true);
    expect(enemyBuildings.some((eid) => Building.defId[eid] === BuildingDefId.STABLE))
      .toBe(true);

    const enemyUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(enemyUnits.length).toBeGreaterThanOrEqual(35);
  });

  it('places Brno side objectives away from the main city base', () => {
    const world = createCampaignWorld(703, CampaignMissionId.SIEGE_OF_BRNO);
    const brnoTc = world.campaign?.trackedObjectiveEids.destroy_brno_tc?.[0];
    const lumberCamp = world.campaign?.trackedObjectiveEids.destroy_outer_lumber?.[0];
    const miningCamp = world.campaign?.trackedObjectiveEids.destroy_outer_mine?.[0];
    expect(brnoTc).toBeDefined();
    expect(lumberCamp).toBeDefined();
    expect(miningCamp).toBeDefined();

    const lumberDistance = Math.hypot(Position.x[lumberCamp!] - Position.x[brnoTc!], Position.y[lumberCamp!] - Position.y[brnoTc!]);
    const mineDistance = Math.hypot(Position.x[miningCamp!] - Position.x[brnoTc!], Position.y[miningCamp!] - Position.y[brnoTc!]);
    expect(lumberDistance).toBeGreaterThanOrEqual(20);
    expect(mineDistance).toBeGreaterThanOrEqual(20);
  });

  it('builds walls around Brno without enclosing the outer camps', () => {
    const world = createCampaignWorld(704, CampaignMissionId.SIEGE_OF_BRNO);
    const brnoTc = world.campaign?.trackedObjectiveEids.destroy_brno_tc?.[0];
    const lumberCamp = world.campaign?.trackedObjectiveEids.destroy_outer_lumber?.[0];
    const miningCamp = world.campaign?.trackedObjectiveEids.destroy_outer_mine?.[0];
    expect(brnoTc).toBeDefined();
    expect(lumberCamp).toBeDefined();
    expect(miningCamp).toBeDefined();

    const walls = buildingQuery(world.ecs)
      .filter((eid) =>
        Owner.player[eid] === AI_PLAYER_ID &&
        Health.hp[eid] > 0 &&
        Building.defId[eid] === BuildingDefId.WALL
      );
    expect(walls.length).toBeGreaterThanOrEqual(50);
    for (const wall of walls) {
      const distanceToBrno = Math.hypot(Position.x[wall] - Position.x[brnoTc!], Position.y[wall] - Position.y[brnoTc!]);
      expect(distanceToBrno).toBeGreaterThanOrEqual(10);
      expect(distanceToBrno).toBeLessThanOrEqual(18);
    }

    const nearestWallDistance = (eid: number) =>
      Math.min(...walls.map((wall) => Math.hypot(Position.x[wall] - Position.x[eid], Position.y[wall] - Position.y[eid])));
    expect(nearestWallDistance(lumberCamp!)).toBeGreaterThan(10);
    expect(nearestWallDistance(miningCamp!)).toBeGreaterThan(10);

    const wallTowers = buildingQuery(world.ecs)
      .filter((eid) =>
        Owner.player[eid] === AI_PLAYER_ID &&
        Health.hp[eid] > 0 &&
        Building.defId[eid] === BuildingDefId.DEFENSIVE_TOWER &&
        Math.hypot(Position.x[eid] - Position.x[brnoTc!], Position.y[eid] - Position.y[brnoTc!]) >= 9
      );
    expect(wallTowers.length).toBeGreaterThanOrEqual(6);
    for (const tower of wallTowers) {
      const nearestWall = Math.min(...walls.map((wall) => Math.hypot(Position.x[wall] - Position.x[tower], Position.y[wall] - Position.y[tower])));
      expect(nearestWall).toBeLessThanOrEqual(1.5);
    }
  });

  it('blocks Gunpowder Age research in Siege of Brno', () => {
    const world = createCampaignWorld(701, CampaignMissionId.SIEGE_OF_BRNO);
    world.paused = false;
    world.ages[LOCAL_PLAYER_ID].current = AgeId.CASTLE;
    world.researchedTechs[LOCAL_PLAYER_ID].add(TechId.GOLD_MINES);
    world.researchedTechs[LOCAL_PLAYER_ID].add(TechId.KNIGHTS);
    world.researchedTechs[LOCAL_PLAYER_ID].add(TechId.FARMS);
    world.resources[LOCAL_PLAYER_ID].set([9999, 9999, 9999, 9999]);

    expect(techStatus(world, LOCAL_PLAYER_ID, TechId.GUNPOWDER_AGE)).toBe('locked');
    world.inputs.push({
      type: 'researchTech',
      playerId: LOCAL_PLAYER_ID,
      techId: TechId.GUNPOWDER_AGE,
    });
    step(world);

    expect(world.ages[LOCAL_PLAYER_ID].current).toBe(AgeId.CASTLE);
    expect(world.ages[LOCAL_PLAYER_ID].progress).toBe(-1);
  });

  it('tracks the outer camp side objectives', () => {
    const world = createCampaignWorld(702, CampaignMissionId.SIEGE_OF_BRNO);
    world.paused = false;
    const lumberCamp = world.campaign?.trackedObjectiveEids.destroy_outer_lumber?.[0];
    const miningCamp = world.campaign?.trackedObjectiveEids.destroy_outer_mine?.[0];
    expect(lumberCamp).toBeDefined();
    expect(miningCamp).toBeDefined();

    Health.hp[lumberCamp!] = 0;
    step(world);

    const lumberObjective = world.campaign?.objectives.find((objective) => objective.id === 'destroy_outer_lumber');
    const mineObjective = world.campaign?.objectives.find((objective) => objective.id === 'destroy_outer_mine');
    expect(lumberObjective?.completed).toBe(true);
    expect(mineObjective?.completed).toBe(false);
  });

  it('sets up Battle of Bílá Hora as a town-center-less gunpowder field battle', () => {
    const world = createCampaignWorld(705, CampaignMissionId.BATTLE_OF_BILA_HORA);

    expect(world.campaign?.missionId).toBe(CampaignMissionId.BATTLE_OF_BILA_HORA);
    expect(world.ages[LOCAL_PLAYER_ID].current).toBe(AgeId.GUNPOWDER);
    expect(world.ages[AI_PLAYER_ID].current).toBe(AgeId.GUNPOWDER);
    expect(world.campaign?.lockedTechs).toHaveLength(0);

    const buildings = buildingQuery(world.ecs)
      .filter((eid) => Health.hp[eid] > 0 && Owner.player[eid] !== 0);
    expect(buildings).toHaveLength(0);

    const playerUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    const enemyUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(playerUnits.length).toBe(50);
    expect(enemyUnits.length).toBe(60);
    expect([...playerUnits, ...enemyUnits].some((eid) => hasComponent(world.ecs, ArcherTag, eid)))
      .toBe(false);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, SpearmanTag, eid)).length)
      .toBe(16);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, GunmanTag, eid)).length)
      .toBe(24);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, ScoutCavalryTag, eid)).length)
      .toBe(8);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, ScoutCavalryTag, eid)).length)
      .toBe(24);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, GunmanTag, eid)).length)
      .toBe(26);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, SpearmanTag, eid)).length)
      .toBe(8);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, CannonTag, eid)).length)
      .toBe(2);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, CannonTag, eid)).length)
      .toBe(2);

    const trees = resourceQuery(world.ecs)
      .filter((eid) => Resource.kind[eid] === ResourceKindId.WOOD && Resource.amount[eid] > 0);
    expect(trees.length).toBeGreaterThan(20);

    const playerAvgY = playerUnits.reduce((sum, eid) => sum + Position.y[eid], 0) / playerUnits.length;
    const enemyAvgY = enemyUnits.reduce((sum, eid) => sum + Position.y[eid], 0) / enemyUnits.length;
    expect(playerAvgY).toBeGreaterThan(enemyAvgY);

    const playerCenter = {
      x: playerUnits.reduce((sum, eid) => sum + Position.x[eid], 0) / playerUnits.length,
      y: playerAvgY,
    };
    const enemyCenter = {
      x: enemyUnits.reduce((sum, eid) => sum + Position.x[eid], 0) / enemyUnits.length,
      y: enemyAvgY,
    };
    expect(Math.hypot(enemyCenter.x - playerCenter.x, enemyCenter.y - playerCenter.y))
      .toBeGreaterThan(24);
    expect(enemyUnits.filter((eid) => AttackMoveGoal.active[eid] === 1 || world.paths.has(eid)).length)
      .toBe(0);

    world.paused = false;
    for (let i = 0; i < BILA_HORA_WAIT_TEST_TICKS; i++) step(world);
    expect(enemyUnits.filter((eid) => AttackMoveGoal.active[eid] === 1 || world.paths.has(eid)).length)
      .toBe(0);
    step(world);
    expect(enemyUnits.filter((eid) => AttackMoveGoal.active[eid] === 1 && world.paths.has(eid)).length)
      .toBeGreaterThanOrEqual(enemyUnits.length - 2);

    const tracked = world.campaign?.trackedObjectiveEids.destroy_imperial_field_army ?? [];
    expect(tracked.length).toBe(enemyUnits.length);
  });

  it('wins Battle of Bílá Hora by killing all enemy units', () => {
    const world = createCampaignWorld(706, CampaignMissionId.BATTLE_OF_BILA_HORA);
    world.paused = false;

    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] === AI_PLAYER_ID) Health.hp[eid] = 0;
    }
    step(world);

    const objective = world.campaign?.objectives.find((entry) =>
      entry.id === 'destroy_imperial_field_army'
    );
    expect(objective?.completed).toBe(true);
    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: LOCAL_PLAYER_ID,
      mode: 'conquest',
    });
  });

  it('sets up Battle of Kutná Hora as a prebuilt city defense mission', () => {
    const world = createCampaignWorld(707, CampaignMissionId.BATTLE_OF_KUTNA_HORA);

    expect(world.campaign?.missionId).toBe(CampaignMissionId.BATTLE_OF_KUTNA_HORA);
    expect(world.ages[LOCAL_PLAYER_ID].current).toBe(AgeId.GUNPOWDER);
    expect(world.ages[AI_PLAYER_ID].current).toBe(AgeId.GUNPOWDER);
    expect(world.campaign?.lockedTechs).toHaveLength(0);
    expect(world.campaign?.scriptedWaveIndex).toBe(0);
    expect(world.campaign?.scriptedWaveCount).toBe(5);
    expect(world.campaign?.nextReinforcementTick).toBe(KUTNA_HORA_FIRST_WAVE_TEST_TICKS);
    expect(world.revealedMapPlayers[LOCAL_PLAYER_ID]).toBe(false);

    const playerBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    const enemyBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    const countPlayerBuilding = (defId: number) =>
      playerBuildings.filter((eid) => Building.defId[eid] === defId).length;

    expect(countPlayerBuilding(BuildingDefId.TOWN_CENTER)).toBe(1);
    const townCenter = playerBuildings.find((eid) => Building.defId[eid] === BuildingDefId.TOWN_CENTER);
    expect(Math.hypot(Position.x[townCenter!] - MAP.WIDTH / 2, Position.y[townCenter!] - MAP.HEIGHT / 2))
      .toBeLessThanOrEqual(1);
    expect(countPlayerBuilding(BuildingDefId.BARRACKS)).toBeGreaterThanOrEqual(2);
    expect(countPlayerBuilding(BuildingDefId.STABLE)).toBeGreaterThanOrEqual(1);
    expect(countPlayerBuilding(BuildingDefId.FOUNDRY)).toBeGreaterThanOrEqual(1);
    expect(countPlayerBuilding(BuildingDefId.FARM)).toBeGreaterThanOrEqual(4);
    expect(countPlayerBuilding(BuildingDefId.MILL)).toBeGreaterThanOrEqual(1);
    expect(countPlayerBuilding(BuildingDefId.DEFENSIVE_TOWER)).toBeGreaterThanOrEqual(10);
    expect(countPlayerBuilding(BuildingDefId.WALL)).toBeGreaterThanOrEqual(140);
    expect(enemyBuildings).toHaveLength(0);
    const centerBuildings = playerBuildings.filter((eid) =>
      Math.hypot(Position.x[eid] - Position.x[townCenter!], Position.y[eid] - Position.y[townCenter!]) <= 10
    );
    expect(centerBuildings.length).toBeGreaterThanOrEqual(20);
    const nearbyWoods = resourceQuery(world.ecs).filter((eid) =>
      Resource.kind[eid] === ResourceKindId.WOOD &&
      Resource.amount[eid] > 0 &&
      Math.hypot(Position.x[eid] - Position.x[townCenter!], Position.y[eid] - Position.y[townCenter!]) <= 24
    );
    expect(nearbyWoods.length).toBeGreaterThanOrEqual(20);
    const visibleTiles = world.visibility[LOCAL_PLAYER_ID].visible.reduce((sum, value) => sum + value, 0);
    expect(visibleTiles).toBeLessThan(MAP.WIDTH * MAP.HEIGHT);

    const playerUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    const enemyUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, SpearmanTag, eid)).length)
      .toBe(8);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, GunmanTag, eid)).length)
      .toBe(8);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, ScoutCavalryTag, eid)).length)
      .toBe(4);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, ArcherTag, eid)).length)
      .toBe(2);
    expect(playerUnits.filter((eid) => hasComponent(world.ecs, CannonTag, eid)).length)
      .toBe(1);
    expect(enemyUnits).toHaveLength(0);
    expect(world.population[LOCAL_PLAYER_ID].cap).toBeGreaterThanOrEqual(70);
    expect(Array.from(world.resources[LOCAL_PLAYER_ID])).toEqual([300, 300, 300, 300]);
  });

  it('starts Kutná Hora assault waves after the opening defense window', () => {
    const world = createCampaignWorld(708, CampaignMissionId.BATTLE_OF_KUTNA_HORA);
    world.paused = false;

    for (let i = 0; i < KUTNA_HORA_FIRST_WAVE_TEST_TICKS; i++) step(world);
    expect(unitQuery(world.ecs).filter((eid) =>
      Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0
    )).toHaveLength(0);

    step(world);
    const enemyUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(enemyUnits).toHaveLength(18);
    expect(world.campaign?.scriptedWaveIndex).toBe(1);
    expect(world.campaign?.trackedObjectiveEids.kutna_hora_attackers).toHaveLength(18);
    expect(enemyUnits.filter((eid) => AttackMoveGoal.active[eid] === 1 && world.paths.has(eid)).length)
      .toBeGreaterThanOrEqual(14);

    const firstWaveCenter = {
      x: enemyUnits.reduce((sum, eid) => sum + Position.x[eid], 0) / enemyUnits.length,
      y: enemyUnits.reduce((sum, eid) => sum + Position.y[eid], 0) / enemyUnits.length,
    };
    for (const eid of enemyUnits) Health.hp[eid] = 0;
    step(world);
    world.campaign!.nextReinforcementTick = world.tick;
    step(world);
    const secondWaveUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(secondWaveUnits.length).toBeGreaterThan(0);
    const secondWaveCenter = {
      x: secondWaveUnits.reduce((sum, eid) => sum + Position.x[eid], 0) / secondWaveUnits.length,
      y: secondWaveUnits.reduce((sum, eid) => sum + Position.y[eid], 0) / secondWaveUnits.length,
    };
    expect(
      Math.abs(secondWaveCenter.x - firstWaveCenter.x) +
      Math.abs(secondWaveCenter.y - firstWaveCenter.y)
    ).toBeGreaterThan(20);
  });

  it('wins Kutná Hora after all assault waves are destroyed', () => {
    const world = createCampaignWorld(709, CampaignMissionId.BATTLE_OF_KUTNA_HORA);
    world.paused = false;

    for (let wave = 0; wave < 5; wave++) {
      world.campaign!.nextReinforcementTick = world.tick;
      step(world);
      const enemies = unitQuery(world.ecs)
        .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
      expect(enemies.length).toBeGreaterThan(0);
      for (const eid of enemies) Health.hp[eid] = 0;
      step(world);
    }

    expect(world.campaign?.objectives.find((objective) =>
      objective.id === 'survive_kutna_hora'
    )?.completed).toBe(true);
    expect(world.campaign?.objectives.find((objective) =>
      objective.id === 'hold_kutna_hora_tc'
    )?.completed).toBe(true);
    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: LOCAL_PLAYER_ID,
      mode: 'conquest',
    });
  });

  it('loses Kutná Hora if the town center falls', () => {
    const world = createCampaignWorld(710, CampaignMissionId.BATTLE_OF_KUTNA_HORA);
    world.paused = false;
    const townCenter = buildingQuery(world.ecs).find((eid) =>
      Owner.player[eid] === LOCAL_PLAYER_ID &&
      Building.defId[eid] === BuildingDefId.TOWN_CENTER
    );
    expect(townCenter).toBeDefined();

    Health.hp[townCenter!] = 0;
    step(world);

    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: AI_PLAYER_ID,
      mode: 'conquest',
    });
  });

  it('sets up Battle of Sudoměř as an upper-left town with a real economy and a small guard', () => {
    const world = createCampaignWorld(711, CampaignMissionId.BATTLE_OF_SUDOMER);

    expect(world.campaign?.missionId).toBe(CampaignMissionId.BATTLE_OF_SUDOMER);
    expect(world.ages[LOCAL_PLAYER_ID].current).toBe(AgeId.GUNPOWDER);
    expect(world.ages[AI_PLAYER_ID].current).toBe(AgeId.GUNPOWDER);
    expect(world.campaign?.scriptedWaveIndex).toBe(0);
    expect(world.campaign?.scriptedWaveCount).toBe(5);
    expect(world.campaign?.nextReinforcementTick).toBe(SUDOMER_FIRST_WAVE_TEST_TICKS);
    expect(world.revealedMapPlayers[LOCAL_PLAYER_ID]).toBe(true);
    expect(world.map.tiles.reduce((count, tile) => count + (tile === TileType.MUD ? 1 : 0), 0))
      .toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT * 0.08);

    const playerBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    const countBuilding = (defId: number) =>
      playerBuildings.filter((eid) => Building.defId[eid] === defId).length;
    expect(countBuilding(BuildingDefId.TOWN_CENTER)).toBe(1);
    expect(countBuilding(BuildingDefId.BARRACKS)).toBe(1);
    expect(countBuilding(BuildingDefId.FOUNDRY)).toBe(1);
    expect(countBuilding(BuildingDefId.LUMBER_CAMP)).toBe(1);
    expect(countBuilding(BuildingDefId.STONE_QUARRY)).toBe(1);
    // Gold is mandatory for the gunman rebuild loop — the base must ship a mine.
    expect(countBuilding(BuildingDefId.GOLD_MINE)).toBe(1);
    expect(countBuilding(BuildingDefId.HOUSE)).toBeGreaterThanOrEqual(6);
    expect(countBuilding(BuildingDefId.FARM)).toBeGreaterThanOrEqual(2);
    expect(countBuilding(BuildingDefId.MILL)).toBeGreaterThanOrEqual(1);

    const townCenter = playerBuildings.find((eid) => Building.defId[eid] === BuildingDefId.TOWN_CENTER)!;
    expect(Position.x[townCenter]).toBeLessThan(MAP.WIDTH * 0.36);
    expect(Position.y[townCenter]).toBeLessThan(MAP.HEIGHT * 0.32);

    const playerUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    const countTag = (tag: Parameters<typeof hasComponent>[1]) =>
      playerUnits.filter((eid) => hasComponent(world.ecs, tag, eid)).length;
    // A modest starting guard: ~12 pikemen + ~6 gunmen, nothing else.
    expect(countTag(SpearmanTag)).toBeGreaterThanOrEqual(10);
    expect(countTag(SpearmanTag)).toBeLessThanOrEqual(12);
    expect(countTag(GunmanTag)).toBeGreaterThanOrEqual(5);
    expect(countTag(GunmanTag)).toBeLessThanOrEqual(6);
    expect(countTag(ArcherTag)).toBe(0);
    expect(countTag(ScoutCavalryTag)).toBe(0);
    expect(countTag(CannonTag)).toBe(0);
    // Villagers to put to work (pre-placed idle + worksite auto-workers).
    expect(countTag(VillagerTag)).toBeGreaterThanOrEqual(10);

    const enemyUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(enemyUnits).toHaveLength(0);
  });

  it('runs five escalating Sudoměř waves and resolves the town defense to victory', () => {
    const world = createCampaignWorld(712, CampaignMissionId.BATTLE_OF_SUDOMER);
    world.paused = false;

    const liveEnemies = () =>
      unitQuery(world.ecs).filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    const countTag = (eids: number[], tag: Parameters<typeof hasComponent>[1]) =>
      eids.filter((eid) => hasComponent(world.ecs, tag, eid)).length;
    const forceNextWave = () => {
      world.campaign!.nextReinforcementTick = world.tick;
      step(world);
    };

    // No assault during the prep window.
    for (let i = 0; i < SIM.TICK_HZ * 5; i++) step(world);
    expect(liveEnemies()).toHaveLength(0);
    expect(world.campaign?.scriptedWaveIndex).toBe(0);

    // Wave 1 — infantry through the dry central gap (no cavalry yet).
    forceNextWave();
    expect(world.campaign?.scriptedWaveIndex).toBe(1);
    let enemies = liveEnemies();
    expect(countTag(enemies, SpearmanTag)).toBeGreaterThanOrEqual(12);
    expect(countTag(enemies, ScoutCavalryTag)).toBe(0);
    // Attackers receive an attack-move order with a path toward the town.
    expect(enemies.filter((eid) => AttackMoveGoal.active[eid] === 1 && world.paths.has(eid)).length)
      .toBeGreaterThanOrEqual(enemies.length - 3);

    // Wave 2 — cavalry through the muddy flank.
    forceNextWave();
    expect(world.campaign?.scriptedWaveIndex).toBe(2);
    expect(countTag(liveEnemies(), ScoutCavalryTag)).toBeGreaterThanOrEqual(16);

    // Wave 3 — heavier middle push that now includes hand-gunners.
    forceNextWave();
    expect(world.campaign?.scriptedWaveIndex).toBe(3);
    expect(countTag(liveEnemies(), GunmanTag)).toBeGreaterThanOrEqual(4);

    // Wave 4 — the squeeze: both fronts at once (more cavalry AND more pikemen).
    const beforeW4 = liveEnemies();
    const cavBefore = countTag(beforeW4, ScoutCavalryTag);
    const spearBefore = countTag(beforeW4, SpearmanTag);
    forceNextWave();
    expect(world.campaign?.scriptedWaveIndex).toBe(4);
    const afterW4 = liveEnemies();
    expect(countTag(afterW4, ScoutCavalryTag)).toBeGreaterThan(cavBefore);
    expect(countTag(afterW4, SpearmanTag)).toBeGreaterThan(spearBefore);

    // Wave 5 — final combined assault; no further reinforcements scheduled.
    forceNextWave();
    expect(world.campaign?.scriptedWaveIndex).toBe(5);
    expect(world.campaign?.nextReinforcementTick).toBe(Number.MAX_SAFE_INTEGER);

    const tracked = world.campaign?.trackedObjectiveEids.sudomer_attackers ?? [];
    expect(tracked.length).toBeGreaterThan(100);

    // Town Hall still stands and crusaders remain → mission still in progress.
    expect(world.outcome.state).toBe('playing');

    // Wipe the crusaders → victory with the Town Hall intact.
    for (const eid of liveEnemies()) Health.hp[eid] = 0;
    step(world);
    const done = (id: string) =>
      world.campaign?.objectives.find((objective) => objective.id === id)?.completed;
    expect(done('survive_sudomer_assault')).toBe(true);
    expect(done('hold_sudomer_town')).toBe(true);
    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: LOCAL_PLAYER_ID,
      mode: 'conquest',
    });
  });

  it('loses Battle of Sudoměř if the Town Hall is destroyed', () => {
    const world = createCampaignWorld(713, CampaignMissionId.BATTLE_OF_SUDOMER);
    world.paused = false;

    step(world);
    expect(world.outcome.state).toBe('playing');

    const townCenter = buildingQuery(world.ecs).find(
      (eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Building.defId[eid] === BuildingDefId.TOWN_CENTER
    );
    expect(townCenter).toBeDefined();
    Health.hp[townCenter!] = 0;
    step(world);

    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: AI_PLAYER_ID,
      mode: 'conquest',
    });
  });

  it('sets up Battle of Zborov as a Total War rifle clash with a gunmen-and-mortars kit', () => {
    const world = createCampaignWorld(720, CampaignMissionId.BATTLE_OF_ZBOROV);

    expect(world.campaign?.missionId).toBe(CampaignMissionId.BATTLE_OF_ZBOROV);
    expect(world.ages[LOCAL_PLAYER_ID].current).toBe(AgeId.TOTAL_WAR);
    expect(world.ages[AI_PLAYER_ID].current).toBe(AgeId.TOTAL_WAR);
    expect(world.campaign?.nextReinforcementTick).toBe(ZBOROV_REINFORCE_TEST_INTERVAL);
    expect(world.revealedMapPlayers[LOCAL_PLAYER_ID]).toBe(true);

    const playerUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    const enemyUnits = unitQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    const count = (eids: number[], tag: Parameters<typeof hasComponent>[1]) =>
      eids.filter((eid) => hasComponent(world.ecs, tag, eid)).length;

    // Barbed-wire belts replace the old walls — walkable slow tiles strung across the field.
    expect(world.map.tiles.reduce((n, t) => n + (t === TileType.BARBED_WIRE ? 1 : 0), 0))
      .toBeGreaterThan(MAP.WIDTH);

    // Player fields ONLY a lean rifle line + a single mortar — nothing else.
    expect(count(playerUnits, GunmanTag)).toBeGreaterThanOrEqual(8);
    expect(count(playerUnits, MortarTag)).toBe(1);
    expect(count(playerUnits, MachineGunTag)).toBe(0);
    expect(count(playerUnits, CannonTag)).toBe(0);
    expect(count(playerUnits, ScoutCavalryTag)).toBe(0);
    expect(count(playerUnits, SpearmanTag)).toBe(0);
    expect(count(playerUnits, ArcherTag)).toBe(0);
    expect(count(playerUnits, VillagerTag)).toBe(0);

    // Enemy holds three rifle lines with machine-gun nests forward + rear mortars.
    expect(count(enemyUnits, GunmanTag)).toBeGreaterThanOrEqual(24);
    expect(count(enemyUnits, MachineGunTag)).toBeGreaterThanOrEqual(4);
    expect(count(enemyUnits, MortarTag)).toBeGreaterThanOrEqual(2);
    expect(count(enemyUnits, CannonTag)).toBe(0);

    // No player Town Center; no defense towers anywhere; just the command bunker.
    const playerBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === LOCAL_PLAYER_ID && Health.hp[eid] > 0);
    expect(playerBuildings.some((eid) => Building.defId[eid] === BuildingDefId.TOWN_CENTER)).toBe(false);
    const enemyBuildings = buildingQuery(world.ecs)
      .filter((eid) => Owner.player[eid] === AI_PLAYER_ID && Health.hp[eid] > 0);
    expect(enemyBuildings.filter((eid) => Building.defId[eid] === BuildingDefId.DEFENSIVE_TOWER).length).toBe(0);
    expect(enemyBuildings.filter((eid) => Building.defId[eid] === BuildingDefId.FOUNDRY).length).toBe(1);

    // The MG nests (forward machine-gun units) are the silence objective.
    const nests = world.campaign?.trackedObjectiveEids.silence_mg_nests ?? [];
    expect(nests.length).toBeGreaterThanOrEqual(4);
    expect(nests.every((eid) => hasComponent(world.ecs, MachineGunTag, eid))).toBe(true);
    expect((world.campaign?.trackedObjectiveEids.take_command_bunker ?? []).length).toBe(1);

    // Bite-and-hold: each of the three trench lines is a tracked capture group,
    // and the assault starts with none taken.
    expect((world.campaign?.trackedObjectiveEids.take_trench_1 ?? []).length).toBeGreaterThan(0);
    expect((world.campaign?.trackedObjectiveEids.take_trench_2 ?? []).length).toBeGreaterThan(0);
    expect((world.campaign?.trackedObjectiveEids.take_trench_3 ?? []).length).toBeGreaterThan(0);
    expect(world.campaign?.zborovLinesTaken).toBe(0);

    // The flanks are sealed woods — there is NOTHING walkable outside the central
    // corridor, so the assault can't simply skirt the lines and rush the bunker.
    // (walkability: 1 = blocked, 0 = walkable.)
    const cx = Math.round(MAP.WIDTH * 0.5);
    const corridorHalf = Math.round(MAP.WIDTH * 0.24);
    let flankWalkable = 0;
    let corridorWalkable = 0;
    for (let y = 0; y < MAP.HEIGHT; y++) {
      for (let x = 0; x < MAP.WIDTH; x++) {
        if (world.map.walkability[y][x] !== 0) continue; // skip blocked tiles
        if (x < cx - corridorHalf || x > cx + corridorHalf) flankWalkable++;
        else corridorWalkable++;
      }
    }
    expect(flankWalkable).toBe(0);
    expect(corridorWalkable).toBeGreaterThan(0); // the corridor itself stays open
  });

  it('maintains Zborov rifle numbers by floor/trigger and never lets the player stack up', () => {
    const world = createCampaignWorld(721, CampaignMissionId.BATTLE_OF_ZBOROV);
    world.paused = false;

    const gunmen = (player: number) =>
      unitQuery(world.ecs).filter((eid) =>
        Owner.player[eid] === player &&
        Health.hp[eid] > 0 &&
        hasComponent(world.ecs, GunmanTag, eid)
      ).length;
    const forceTick = () => {
      world.campaign!.nextReinforcementTick = world.tick;
      step(world);
    };

    // At spawn the player is above the reinforce trigger and the enemy is above
    // its floor → a reinforcement tick adds nobody (no stacking, no enemy pile-on).
    const p0 = gunmen(LOCAL_PLAYER_ID);
    const e0 = gunmen(AI_PLAYER_ID);
    forceTick();
    expect(gunmen(LOCAL_PLAYER_ID)).toBeLessThanOrEqual(p0);
    expect(gunmen(AI_PLAYER_ID)).toBeLessThanOrEqual(e0);

    // Deplete the player's rifles below the trigger → next tick tops him back up,
    // but never past the target floor.
    const playerGuns = unitQuery(world.ecs).filter((eid) =>
      Owner.player[eid] === LOCAL_PLAYER_ID && hasComponent(world.ecs, GunmanTag, eid)
    );
    for (const eid of playerGuns.slice(2)) Health.hp[eid] = 0; // leave ~2 alive (< trigger)
    forceTick();
    const playerAfter = gunmen(LOCAL_PLAYER_ID);
    expect(playerAfter).toBeGreaterThan(2);
    expect(playerAfter).toBeLessThanOrEqual(ZBOROV_PLAYER_REINFORCE_TARGET);

    // Wipe the enemy rifles below the floor → next tick sends a matching wave
    // that is thrown forward to attack.
    for (const eid of unitQuery(world.ecs).filter((eid) =>
      Owner.player[eid] === AI_PLAYER_ID && hasComponent(world.ecs, GunmanTag, eid)
    )) {
      Health.hp[eid] = 0;
    }
    forceTick();
    const enemyFresh = world.campaign?.trackedObjectiveEids.zborov_enemy_reinforcements ?? [];
    expect(enemyFresh.length).toBeGreaterThan(0);
    expect(enemyFresh.every((eid) => hasComponent(world.ecs, GunmanTag, eid))).toBe(true);
    expect(enemyFresh.filter((eid) => AttackMoveGoal.active[eid] === 1).length).toBeGreaterThan(0);
  });

  it('advances bite-and-hold: clearing a trench line completes it and triggers ONE measured counterattack, not a whole-map charge', () => {
    const world = createCampaignWorld(724, CampaignMissionId.BATTLE_OF_ZBOROV);
    world.paused = false;

    // Garrison riflemen "charging" = attack-moving to a destination deep in the
    // player's half (south). Holding units' attack-move goal is their own
    // northern trench tile, well short of this.
    const garrisonGuns = (world.campaign?.trackedObjectiveEids.zborov_garrison ?? [])
      .filter((eid) => hasComponent(world.ecs, GunmanTag, eid));
    const chargingDeep = () =>
      garrisonGuns.filter((eid) =>
        Health.hp[eid] > 0 &&
        AttackMoveGoal.active[eid] === 1 &&
        AttackMoveGoal.y[eid] > MAP.HEIGHT * 0.6
      ).length;

    step(world);

    // Bug-fix guard: merely shelling a single forward MG nest must NOT make the
    // whole garrison break cover and charge (the old hair-trigger behaviour).
    const nest = (world.campaign?.trackedObjectiveEids.silence_mg_nests ?? [])[0];
    Health.hp[nest] = Math.max(1, Health.hp[nest] - 20);
    step(world);
    expect(chargingDeep()).toBe(0);
    expect(world.campaign?.zborovLinesTaken ?? 0).toBe(0);

    const forwardYBefore = world.campaign?.zborovForwardY ?? 0;
    const enemyReinforceBefore =
      (world.campaign?.trackedObjectiveEids.zborov_enemy_reinforcements ?? []).length;

    // Clear the ENTIRE forward line (its riflemen AND the MG nests dug in front
    // of it) → that trench is taken.
    for (const eid of world.campaign?.trackedObjectiveEids.take_trench_1 ?? []) {
      Health.hp[eid] = 0;
    }
    step(world);

    // The forward-trench objective completes and the line counter advances.
    expect(world.campaign?.objectives.find((o) => o.id === 'take_trench_1')?.completed).toBe(true);
    expect(world.campaign?.zborovLinesTaken).toBe(1);
    // The player's reinforcement muster point advances forward (north → smaller y).
    expect(world.campaign?.zborovForwardY ?? 99).toBeLessThan(forwardYBefore);
    // Exactly one measured reserve company is thrown forward (attack-moving south);
    // the rear lines do NOT all charge at once.
    const enemyFresh = world.campaign?.trackedObjectiveEids.zborov_enemy_reinforcements ?? [];
    expect(enemyFresh.length).toBeGreaterThan(enemyReinforceBefore);
    expect(enemyFresh.some((eid) => AttackMoveGoal.active[eid] === 1)).toBe(true);
    expect(chargingDeep()).toBe(0);
  });

  it('wins Battle of Zborov by taking the command bunker', () => {
    const world = createCampaignWorld(722, CampaignMissionId.BATTLE_OF_ZBOROV);
    world.paused = false;

    step(world);
    expect(world.outcome.state).toBe('playing');

    for (const eid of world.campaign?.trackedObjectiveEids.silence_mg_nests ?? []) {
      Health.hp[eid] = 0;
    }
    for (const eid of world.campaign?.trackedObjectiveEids.take_command_bunker ?? []) {
      Health.hp[eid] = 0;
    }
    step(world);

    expect(world.campaign?.objectives.find((o) => o.id === 'silence_mg_nests')?.completed).toBe(true);
    expect(world.campaign?.objectives.find((o) => o.id === 'take_command_bunker')?.completed).toBe(true);
    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: LOCAL_PLAYER_ID,
      mode: 'conquest',
    });
  });

  it('loses Battle of Zborov if the assault force is wiped out', () => {
    const world = createCampaignWorld(723, CampaignMissionId.BATTLE_OF_ZBOROV);
    world.paused = false;

    step(world);
    expect(world.outcome.state).toBe('playing');

    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] === LOCAL_PLAYER_ID && !hasComponent(world.ecs, VillagerTag, eid)) {
        Health.hp[eid] = 0;
      }
    }
    step(world);

    expect(world.outcome).toEqual({
      state: 'victory',
      winnerPlayerId: AI_PLAYER_ID,
      mode: 'conquest',
    });
  });
});
