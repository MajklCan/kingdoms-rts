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
  Owner,
  Position,
  Resource,
  ResourceKindId,
  ScoutCavalryTag,
  SpearmanTag,
} from './components';
import { AgeId, BuildingDefId } from './defs';
import { CampaignMissionId } from './campaign';
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
});
