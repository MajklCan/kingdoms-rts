import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CannonTag,
  GunmanTag,
  Health,
  Owner,
  Position,
  Resource,
  ResourceKindId,
  ScoutCavalryTag,
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
    expect(playerUnits.length).toBeGreaterThanOrEqual(50);
    expect(enemyUnits.length).toBeGreaterThanOrEqual(60);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, ScoutCavalryTag, eid)).length)
      .toBeGreaterThanOrEqual(24);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, GunmanTag, eid)).length)
      .toBeGreaterThanOrEqual(16);
    expect(enemyUnits.filter((eid) => hasComponent(world.ecs, CannonTag, eid)).length)
      .toBeGreaterThanOrEqual(5);

    const trees = resourceQuery(world.ecs)
      .filter((eid) => Resource.kind[eid] === ResourceKindId.WOOD && Resource.amount[eid] > 0);
    expect(trees.length).toBeGreaterThan(20);

    const playerAvgY = playerUnits.reduce((sum, eid) => sum + Position.y[eid], 0) / playerUnits.length;
    const enemyAvgY = enemyUnits.reduce((sum, eid) => sum + Position.y[eid], 0) / enemyUnits.length;
    expect(playerAvgY).toBeGreaterThan(enemyAvgY);

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
});
