import { describe, expect, it } from 'vitest';
import { AgeId, BuildingDefId, ENDLESS_WORKSITE_RATE_TICKS, UnitDefId } from './defs';
import { Resource, ResourceKindId, ResourceWorksite, type ResourceKind } from './components';
import { AI_PLAYER_ID, createSimWorld, removeSimEntity, resourceQuery, spawnCompletedBuilding, step, type SimWorld } from './world';
import { isBuildingUnlocked, isRingOpen, techDef, techIdsInRing } from './tech-tree';
import { SIM } from '../config';

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function removeResources(world: SimWorld, kind: ResourceKind): void {
  for (const eid of [...resourceQuery(world.ecs)]) {
    if (Resource.kind[eid] === kind) removeSimEntity(world, eid);
  }
}

const SITES: Array<{ name: string; defId: number; kind: ResourceKind }> = [
  { name: 'mint', defId: BuildingDefId.MINT, kind: ResourceKindId.GOLD },
  { name: 'brickworks', defId: BuildingDefId.BRICKWORKS, kind: ResourceKindId.STONE },
  { name: "forester's lodge", defId: BuildingDefId.FORESTER, kind: ResourceKindId.WOOD },
];

/**
 * A completed site of `defId` on a map with none of its resource left, full
 * crew of three. No crews research: the endless sites take three without it.
 */
function crewedSiteOnBareMap(defId: number, kind: ResourceKind): { world: SimWorld; site: number } {
  const world = createSimWorld(7);
  world.paused = false;
  // No computer player: nothing raids the site during the long run.
  world.aiPlayers[AI_PLAYER_ID] = null;
  removeResources(world, kind);
  expect(resourceQuery(world.ecs).some((eid) => Resource.kind[eid] === kind)).toBe(false);
  world.population[1].cap += 10;
  world.resources[1].set([1000, 1000, 1000, 1000]);
  const spawn = world.map.spawns[1];
  const site = spawnCompletedBuilding(world, defId, spawn.x + 6, spawn.y + 4, 1);
  world.inputs.push(
    { type: 'trainUnit', atEid: site, defId: UnitDefId.VILLAGER },
    { type: 'trainUnit', atEid: site, defId: UnitDefId.VILLAGER }
  );
  // Training both extra workers and walking the crew in.
  stepN(world, SIM.TICK_HZ * 60);
  return { world, site };
}

describe('endless worksites (mint, brickworks, forester lodge)', () => {
  for (const { name, defId, kind } of SITES) {
    it(`the ${name} makes its resource with none on the map, 60 a minute with no crews research`, () => {
      const { world, site } = crewedSiteOnBareMap(defId, kind);
      expect(ResourceWorksite.assignedWorkers[site]).toBe(3);

      const before = world.resources[1][kind];
      const minute = SIM.TICK_HZ * 60;
      stepN(world, minute);
      const perMinute = world.resources[1][kind] - before;
      expect(perMinute).toBe((minute * 3) / ENDLESS_WORKSITE_RATE_TICKS);
      expect(perMinute).toBe(60);

      // Still the same pace minutes later (the skirmish itself ends around
      // minute ten, which stops every worksite).
      stepN(world, minute * 4);
      const later = world.resources[1][kind];
      stepN(world, minute);
      expect(world.outcome.state).toBe('playing');
      expect(world.resources[1][kind] - later).toBe(60);
    });

    it(`the ${name} opens with ring II, with no research of its own`, () => {
      const world = createSimWorld(7);
      expect(isBuildingUnlocked(world, 1, defId)).toBe(false);
      // Ring I's timber and land paths maxed: ring II (Castle Age) opens.
      for (const tech of techIdsInRing(1)) {
        const path = techDef(tech)?.path;
        if (path === 'timber' || path === 'land') world.researchedTechs[1].add(tech);
      }
      expect(isRingOpen(world, 1, 2)).toBe(true);
      expect(isBuildingUnlocked(world, 1, defId)).toBe(true);
    });

    it(`the ${name} is open from a Castle Age start`, () => {
      const world = createSimWorld(7, { startingAge: AgeId.CASTLE });
      expect(isBuildingUnlocked(world, 1, defId)).toBe(true);
    });
  }
});
