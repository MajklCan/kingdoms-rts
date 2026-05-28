import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { Cooldown, Health } from './components';
import { AgeId, BuildingDefId, AGE_TABLE, BUILDING_TABLE } from './defs';
import { TechId } from './tech-tree';
import {
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnArcher,
  spawnCompletedBuilding,
  step,
  type SimWorld,
} from './world';

function findTowerTestTile(world: SimWorld): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 8; y++) {
    for (let x = 6; x < MAP.WIDTH - 8; x++) {
      if (!isOpen(world, x, y)) continue;
      if (!isOpen(world, x + 3, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No tower test tile found');
}

function isOpen(world: SimWorld, x: number, y: number): boolean {
  if (world.map.walkability[y][x] !== 0) return false;
  if (findBuildingAt(world, x, y, 1.5) !== null) return false;
  if (findResourceAt(world, x, y, 0.8) !== null) return false;
  return true;
}

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

describe('age progression and towers', () => {
  it('sets defensive tower hp to 750', () => {
    expect(BUILDING_TABLE[BuildingDefId.DEFENSIVE_TOWER].hp).toBe(750);
  });

  it('advances from Dark Age directly to Castle Age when paid for', () => {
    const world = createSimWorld(321);
    world.paused = false;
    const castle = AGE_TABLE[AgeId.CASTLE];
    world.researchedTechs[1].add(TechId.BARRACKS_PIKEMEN);
    world.researchedTechs[1].add(TechId.ARCHERS);
    world.resources[1].set([
      castle.advanceCost.food,
      castle.advanceCost.wood,
      castle.advanceCost.gold,
      castle.advanceCost.stone,
    ]);

    world.inputs.push({ type: 'researchTech', playerId: 1, techId: TechId.CASTLE_AGE });
    for (let i = 0; i < castle.advanceTicks; i++) step(world);

    expect(world.ages[1].current).toBe(AgeId.CASTLE);
    expect(Array.from(world.resources[1])).toEqual([0, 0, 0, 0]);
  });

  it('lets defensive towers auto-engage enemies at range', () => {
    const world = createSimWorld(322);
    world.paused = false;
    const spot = findTowerTestTile(world);
    const tower = spawnCompletedBuilding(
      world,
      BuildingDefId.DEFENSIVE_TOWER,
      spot.x,
      spot.y,
      1
    );
    const target = spawnArcher(world, spot.x + 3, spot.y, 2);
    Cooldown.ticksRemaining[target] = 999;
    const hpBefore = Health.hp[target];

    step(world);

    expect(hasComponent(world.ecs, Health, tower)).toBe(true);
    expect(Health.hp[target]).toBe(hpBefore);
    const shot = world.combatEvents.find((event) => event.attackerEid === tower);
    expect(shot?.projectileTicks).toBeGreaterThan(0);

    stepN(world, shot?.projectileTicks ?? 0);

    expect(Health.hp[target]).toBeLessThan(hpBefore);
  });
});
