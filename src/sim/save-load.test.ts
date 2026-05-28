import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import {
  Building,
  MachineGunDeployment,
  MachineGunTag,
  Owner,
  Position,
  ResourceWorksite,
  UnitKind,
  UnitKindId,
  WorksiteWorker,
} from './components';
import { AgeId, BuildingDefId } from './defs';
import { CampaignMissionId } from './campaign';
import { MapFeatureKind, MapId, TileType } from './map-gen';
import { TECH_TREE } from './tech-tree';
import {
  buildingQuery,
  AI_PLAYER_ID,
  createLateGameTestWorld,
  createCampaignWorld,
  createSimWorld,
  resourceQuery,
  spawnMachineGun,
  unitQuery,
  worksiteWorkerQuery,
} from './world';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';

function countOwnedBuildingsByDef(world: ReturnType<typeof createSimWorld>, playerId: number): Set<number> {
  const defs = new Set<number>();
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] === playerId) defs.add(Building.defId[eid]);
  }
  return defs;
}

function nearWaterOrBridge(world: ReturnType<typeof createSimWorld>, x: number, y: number, radius: number): boolean {
  for (let ny = y - radius; ny <= y + radius; ny++) {
    for (let nx = x - radius; nx <= x + radius; nx++) {
      if (nx < 0 || ny < 0 || nx >= MAP.WIDTH || ny >= MAP.HEIGHT) continue;
      const tile = world.map.tiles[ny * MAP.WIDTH + nx];
      if (
        tile === TileType.WATER ||
        tile === TileType.WATER_SHALLOW ||
        tile === TileType.BRIDGE
      ) {
        return true;
      }
    }
  }
  return false;
}

describe('save/load', () => {
  it('builds the fixed late-game test save with all player-usable building types and an army', () => {
    const world = createLateGameTestWorld();
    const playerBuildings = countOwnedBuildingsByDef(world, 1);

    const playerUsableDefIds = Object.values(BuildingDefId)
      .filter((defId) => defId !== BuildingDefId.WALL && defId !== BuildingDefId.ARCHERY_RANGE);
    for (const defId of playerUsableDefIds) {
      expect(playerBuildings.has(defId)).toBe(true);
    }
    expect(world.ages[1].current).toBe(AgeId.GUNPOWDER);
    expect(world.researchedTechs[1].size).toBe(TECH_TREE.length);
    expect(world.resources[1][0]).toBeGreaterThanOrEqual(2000);

    let playerUnits = 0;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] === 1 && hasComponent(world.ecs, UnitKind, eid)) playerUnits++;
    }
    expect(playerUnits).toBeGreaterThanOrEqual(20);

    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== 1) continue;
      if (UnitKind.kind[eid] === UnitKindId.VILLAGER) continue;
      const x = Math.round(Position.x[eid]);
      const y = Math.round(Position.y[eid]);
      expect(world.map.tiles[y * MAP.WIDTH + x]).not.toBe(TileType.SAND);
      expect(nearWaterOrBridge(world, x, y, 2)).toBe(false);
    }

    const p1Combat: number[] = [];
    const p2Combat: number[] = [];
    for (const eid of unitQuery(world.ecs)) {
      if (UnitKind.kind[eid] === UnitKindId.VILLAGER) continue;
      if (Owner.player[eid] === 1) p1Combat.push(eid);
      if (Owner.player[eid] === 2) p2Combat.push(eid);
    }
    expect(p1Combat.length).toBeGreaterThanOrEqual(20);
    expect(p2Combat.length).toBeGreaterThanOrEqual(20);
    for (const a of p1Combat) {
      for (const b of p2Combat) {
        expect(Math.hypot(Position.x[a] - Position.x[b], Position.y[a] - Position.y[b])).toBeGreaterThanOrEqual(18);
      }
    }

    for (const eid of buildingQuery(world.ecs)) {
      if (Owner.player[eid] !== 1) continue;
      if (!hasComponent(world.ecs, ResourceWorksite, eid)) continue;
      let workers = 0;
      for (const worker of worksiteWorkerQuery(world.ecs)) {
        if (WorksiteWorker.siteEid[worker] === eid) workers++;
      }
      expect(workers).toBe(Building.defId[eid] === BuildingDefId.FARM ? 1 : 3);
    }
  });

  it('round-trips map, entities, banks, and worksite references', () => {
    const source = createLateGameTestWorld();
    const snapshot = serializeSimWorld(source, 'Round Trip');
    const target = createSimWorld(7);
    loadSimWorldSnapshot(target, snapshot);

    expect(target.tick).toBe(source.tick);
    expect(target.ages[1].current).toBe(source.ages[1].current);
    expect(target.aiDifficulty).toBe(source.aiDifficulty);
    expect([...target.researchedTechs[1]].sort()).toEqual([...source.researchedTechs[1]].sort());
    expect(Array.from(target.resources[1])).toEqual(Array.from(source.resources[1]));
    expect(target.aiPlayers[AI_PLAYER_ID]?.plan).toBe(source.aiPlayers[AI_PLAYER_ID]?.plan);
    expect(target.aiPlayers[AI_PLAYER_ID]?.nextAttackTick).toBe(source.aiPlayers[AI_PLAYER_ID]?.nextAttackTick);
    expect(buildingQuery(target.ecs).length).toBe(buildingQuery(source.ecs).length);
    expect(unitQuery(target.ecs).length).toBe(unitQuery(source.ecs).length);
    expect(resourceQuery(target.ecs).length).toBe(resourceQuery(source.ecs).length);

    for (const worker of worksiteWorkerQuery(target.ecs)) {
      const site = WorksiteWorker.siteEid[worker];
      expect(hasComponent(target.ecs, ResourceWorksite, site)).toBe(true);
      expect(Position.x[site]).toBeGreaterThanOrEqual(0);
    }
  });

  it('round-trips AI difficulty', () => {
    const source = createSimWorld(19, { aiDifficulty: 'hard' });
    const snapshot = serializeSimWorld(source, 'Hard AI');
    const target = createSimWorld(7, { aiDifficulty: 'easy' });
    loadSimWorldSnapshot(target, snapshot);

    expect(snapshot.aiDifficulty).toBe('hard');
    expect(target.aiDifficulty).toBe('hard');
    expect(target.aiPlayers[AI_PLAYER_ID]?.nextAttackTick)
      .toBe(source.aiPlayers[AI_PLAYER_ID]?.nextAttackTick);
  });

  it('round-trips machine gun teams', () => {
    const source = createSimWorld(20, { startingAge: AgeId.TOTAL_WAR });
    const machineGun = spawnMachineGun(source, 10, 10, 1);
    const snapshot = serializeSimWorld(source, 'Machine Gun Round Trip');
    const target = createSimWorld(7);
    loadSimWorldSnapshot(target, snapshot);

    const restored = unitQuery(target.ecs).find(
      (eid) => UnitKind.kind[eid] === UnitKindId.MACHINE_GUN && Owner.player[eid] === 1
    );
    expect(machineGun).toBeGreaterThan(0);
    expect(restored).toBeDefined();
    expect(hasComponent(target.ecs, MachineGunTag, restored!)).toBe(true);
    expect(hasComponent(target.ecs, MachineGunDeployment, restored!)).toBe(true);
    expect(MachineGunDeployment.deployed[restored!]).toBe(1);
  });

  it('round-trips authored map features', () => {
    const source = createSimWorld(17, { mapId: MapId.MACHOVO_JEZERO });
    const snapshot = serializeSimWorld(source, 'Feature Round Trip');
    const target = createSimWorld(7);
    loadSimWorldSnapshot(target, snapshot);

    expect(snapshot.map.features?.some((feature) => feature.kind === MapFeatureKind.LINDEN_TREE))
      .toBe(true);
    expect(target.map.features).toEqual(source.map.features);
  });

  it('round-trips campaign mission state', () => {
    const source = createCampaignWorld(18, CampaignMissionId.SIEGE_OF_BRNO);
    const snapshot = serializeSimWorld(source, 'Campaign Round Trip');
    const target = createSimWorld(7);
    loadSimWorldSnapshot(target, snapshot);

    expect(target.campaign?.missionId).toBe(CampaignMissionId.SIEGE_OF_BRNO);
    expect(target.campaign?.lockedTechs).toEqual(source.campaign?.lockedTechs);
    expect(target.campaign?.objectives).toEqual(source.campaign?.objectives);
    expect(target.campaign?.trackedObjectiveEids.destroy_brno_tc?.length).toBe(1);
  });
});
