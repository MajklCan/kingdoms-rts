import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../config';
import { CommanderTag, DeadTag, Health, Owner, PopulationCost, UnitKind, UnitKindId } from './components';
import { UNIT_TABLE, BUILDING_TABLE, BuildingDefId, UnitDefId } from './defs';
import { aiMaybeTrainCommander } from './ai/commander';
import { collectAiSnapshot } from './ai/snapshot';
import { countAliveCommanders, unitLimitReached, unitLimitReason } from './core/unit-limits';
import { TechId, isUnitUnlocked } from './tech-tree';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import { spawnCommander } from './factories/units';
import {
  AI_PLAYER_ID,
  LOCAL_PLAYER_ID,
  createAiPlayerState,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnCompletedBuilding,
  spawnSpearman,
  step,
  unitQuery,
  type SimWorld,
} from './world';

function openTile(world: SimWorld, from = 6): { x: number; y: number } {
  for (let y = from; y < MAP.HEIGHT - 8; y++) {
    for (let x = from; x < MAP.WIDTH - 8; x++) {
      if (world.map.walkability[y][x] !== 0) continue;
      if (findBuildingAt(world, x, y, 1.5) !== null) continue;
      if (findResourceAt(world, x, y, 0.8) !== null) continue;
      return { x, y };
    }
  }
  throw new Error('no open tile');
}

function barracksWorld(playerId: number): { world: SimWorld; barracks: number } {
  const world = createSimWorld(31);
  world.paused = false;
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.researchedTechs[playerId].add(TechId.BARRACKS_PIKEMEN);
  world.resources[playerId].set([5000, 5000, 5000, 5000]);
  world.population[playerId].cap = 75;
  const spot = openTile(world);
  const barracks = spawnCompletedBuilding(world, BuildingDefId.BARRACKS, spot.x, spot.y, playerId);
  return { world, barracks };
}

function train(world: SimWorld, barracks: number, playerId: number, count = 1): void {
  world.inputs.push({ type: 'trainUnit', atEid: barracks, defId: UnitDefId.COMMANDER, count, playerId });
  step(world);
}

function queuedCommanders(world: SimWorld, barracks: number): number {
  return (world.productionQueues.get(barracks) ?? []).filter((d) => d === UnitDefId.COMMANDER).length;
}

describe('commander stats', () => {
  it('is a costly barracks unit worth about four pikemen of hit points', () => {
    const def = UNIT_TABLE[UnitDefId.COMMANDER];
    const pike = UNIT_TABLE[UnitDefId.SPEARMAN];
    expect(def.id).toBe('COMMANDER');
    expect(def.trainAt).toBe('BARRACKS');
    expect(def.popCost).toBe(1);
    expect(def.cost.food).toBeGreaterThan(0);
    expect(def.cost.gold).toBeGreaterThan(0);
    expect(def.hp / pike.hp).toBeGreaterThanOrEqual(3);
    expect(def.hp / pike.hp).toBeLessThanOrEqual(4.5);
    expect(BUILDING_TABLE[BuildingDefId.BARRACKS].trains).toContain('COMMANDER');
  });

  it('spawns with his own tag, kind and the table hit points', () => {
    const world = createSimWorld(5);
    const eid = spawnCommander(world, 20, 20, LOCAL_PLAYER_ID);
    expect(hasComponent(world.ecs, CommanderTag, eid)).toBe(true);
    expect(UnitKind.kind[eid]).toBe(UnitKindId.COMMANDER);
    expect(Health.hp[eid]).toBe(UNIT_TABLE[UnitDefId.COMMANDER].hp);
    expect(PopulationCost.value[eid]).toBe(1);
  });

  it('unlocks with the barracks research, like the pikeman', () => {
    const world = createSimWorld(6);
    expect(isUnitUnlocked(world, LOCAL_PLAYER_ID, UnitDefId.COMMANDER)).toBe(
      isUnitUnlocked(world, LOCAL_PLAYER_ID, UnitDefId.SPEARMAN)
    );
    world.researchedTechs[LOCAL_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    expect(isUnitUnlocked(world, LOCAL_PLAYER_ID, UnitDefId.COMMANDER)).toBe(true);
  });
});

describe('one commander per player', () => {
  it('rejects a second while the first is queued, even in a batch', () => {
    const { world, barracks } = barracksWorld(LOCAL_PLAYER_ID);
    const food = world.resources[LOCAL_PLAYER_ID][0];
    train(world, barracks, LOCAL_PLAYER_ID, 5);
    expect(queuedCommanders(world, barracks)).toBe(1);
    // Only one was paid for.
    expect(food - world.resources[LOCAL_PLAYER_ID][0]).toBe(UNIT_TABLE[UnitDefId.COMMANDER].cost.food);
    train(world, barracks, LOCAL_PLAYER_ID);
    expect(queuedCommanders(world, barracks)).toBe(1);
    expect(unitLimitReason(world, LOCAL_PLAYER_ID, UnitDefId.COMMANDER)).toMatch(/training/i);
  });

  it('rejects a second while the first is alive and allows one after he dies', () => {
    const { world, barracks } = barracksWorld(LOCAL_PLAYER_ID);
    train(world, barracks, LOCAL_PLAYER_ID);
    for (let i = 0; i < UNIT_TABLE[UnitDefId.COMMANDER].trainTimeTicks + 5; i++) step(world);
    expect(countAliveCommanders(world, LOCAL_PLAYER_ID)).toBe(1);
    expect(queuedCommanders(world, barracks)).toBe(0);
    train(world, barracks, LOCAL_PLAYER_ID);
    expect(queuedCommanders(world, barracks)).toBe(0);
    expect(unitLimitReason(world, LOCAL_PLAYER_ID, UnitDefId.COMMANDER)).toMatch(/field/i);

    const commander = unitQuery(world.ecs).find((e) => hasComponent(world.ecs, CommanderTag, e));
    expect(commander).toBeDefined();
    Health.hp[commander as number] = 0;
    for (let i = 0; i < 40; i++) step(world);
    expect(countAliveCommanders(world, LOCAL_PLAYER_ID)).toBe(0);
    train(world, barracks, LOCAL_PLAYER_ID);
    expect(queuedCommanders(world, barracks)).toBe(1);
  });

  it('counts per player and never limits other units', () => {
    const world = createSimWorld(8);
    spawnCommander(world, 20, 20, LOCAL_PLAYER_ID);
    expect(unitLimitReached(world, LOCAL_PLAYER_ID, UnitDefId.COMMANDER)).toBe(true);
    expect(unitLimitReached(world, AI_PLAYER_ID, UnitDefId.COMMANDER)).toBe(false);
    expect(unitLimitReached(world, LOCAL_PLAYER_ID, UnitDefId.SPEARMAN)).toBe(false);
  });

  it('ignores a commander already marked dead', () => {
    const world = createSimWorld(9);
    const eid = spawnCommander(world, 20, 20, LOCAL_PLAYER_ID);
    expect(hasComponent(world.ecs, Owner, eid)).toBe(true);
    expect(countAliveCommanders(world, LOCAL_PLAYER_ID)).toBe(1);
    expect(hasComponent(world.ecs, DeadTag, eid)).toBe(false);
  });
});

describe('commander save and load', () => {
  it('survives a round trip with his tag', () => {
    const world = createSimWorld(11);
    spawnCommander(world, 22, 22, LOCAL_PLAYER_ID);
    const saved = JSON.parse(JSON.stringify(serializeSimWorld(world)));
    const fresh = createSimWorld(11);
    loadSimWorldSnapshot(fresh, saved);
    expect(countAliveCommanders(fresh, LOCAL_PLAYER_ID)).toBe(1);
  });
});

describe('AI commander', () => {
  function aiWorld(): { world: SimWorld; barracks: number } {
    const world = createSimWorld(202);
    world.paused = false;
    world.aiDifficulty = 'medium';
    world.resources[AI_PLAYER_ID].set([5000, 5000, 5000, 5000]);
    world.population[AI_PLAYER_ID].cap = 75;
    world.researchedTechs[AI_PLAYER_ID].add(TechId.BARRACKS_PIKEMEN);
    const spot = openTile(world, 10);
    const barracks = spawnCompletedBuilding(world, BuildingDefId.BARRACKS, spot.x, spot.y, AI_PLAYER_ID);
    for (let i = 0; i < 8; i++) spawnSpearman(world, spot.x + i * 0.5, spot.y + 3, AI_PLAYER_ID);
    world.aiPlayers[AI_PLAYER_ID] = { ...createAiPlayerState(0, 'medium'), plan: 'massing' };
    return { world, barracks };
  }

  it('trains one commander while massing and never a second', () => {
    const { world, barracks } = aiWorld();
    for (let i = 0; i < 5; i++) {
      const snap = collectAiSnapshot(world, AI_PLAYER_ID);
      if (snap) aiMaybeTrainCommander(world, AI_PLAYER_ID, snap);
    }
    expect(queuedCommanders(world, barracks)).toBe(1);
    for (let i = 0; i < UNIT_TABLE[UnitDefId.COMMANDER].trainTimeTicks + 5; i++) step(world);
    for (let i = 0; i < 5; i++) {
      const snap = collectAiSnapshot(world, AI_PLAYER_ID);
      if (snap) aiMaybeTrainCommander(world, AI_PLAYER_ID, snap);
    }
    expect(countAliveCommanders(world, AI_PLAYER_ID)).toBe(1);
    expect(queuedCommanders(world, barracks)).toBe(0);
  });

  it('waits for a real army and for the massing plan', () => {
    const { world, barracks } = aiWorld();
    world.aiPlayers[AI_PLAYER_ID] = { ...createAiPlayerState(0, 'medium'), plan: 'opening' };
    const snap = collectAiSnapshot(world, AI_PLAYER_ID);
    if (snap) aiMaybeTrainCommander(world, AI_PLAYER_ID, snap);
    expect(queuedCommanders(world, barracks)).toBe(0);
  });
});
