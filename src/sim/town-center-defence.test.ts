import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { AttackTarget, Combat, ConstructionSite, Cooldown, Health, Owner, Position } from './components';
import { BuildingDefId, BUILDING_TABLE, TOWN_CENTER_RANGE_BONUS } from './defs';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import { finaliseBuilding } from './systems/construction';
import {
  AI_PLAYER_ID,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnCompletedBuilding,
  spawnFoundation,
  spawnVillager,
  step,
  townCenterQuery,
  type SimWorld,
} from './world';

const TC = BUILDING_TABLE[BuildingDefId.TOWN_CENTER];
const TOWER = BUILDING_TABLE[BuildingDefId.DEFENSIVE_TOWER];

/** A skirmish world without the AI brain, so nothing moves unless a test says so. */
function quietWorld(seed = 4242): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.aiPlayers[AI_PLAYER_ID] = null;
  return world;
}

function townCenterOf(world: SimWorld, playerId: number): number {
  const tc = [...townCenterQuery(world.ecs)].find((eid) => Owner.player[eid] === playerId);
  if (tc === undefined) throw new Error(`player ${playerId} has no town center`);
  return tc;
}

function isOpen(world: SimWorld, x: number, y: number): boolean {
  if (x < 2 || y < 2 || x >= MAP.WIDTH - 2 || y >= MAP.HEIGHT - 2) return false;
  if (world.map.walkability[y][x] !== 0) return false;
  return findBuildingAt(world, x, y, 1.5) === null && findResourceAt(world, x, y, 0.8) === null;
}

/** An open tile whose distance from (cx, cy) lies in [min, max]. */
function tileAtDistance(world: SimWorld, cx: number, cy: number, min: number, max: number): { x: number; y: number } {
  const reach = Math.ceil(max);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist < min || dist > max) continue;
      if (isOpen(world, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
    }
  }
  throw new Error(`no open tile ${min}-${max} tiles from (${cx},${cy})`);
}

/** An open tile with nothing of either player within `clear` tiles. */
function remoteTile(world: SimWorld, clear: number): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 6; y++) {
    for (let x = 6; x < MAP.WIDTH - 6; x++) {
      if (!isOpen(world, x, y)) continue;
      const far = world.map.spawns.every((s) => Math.hypot(s.x - x, s.y - y) > clear);
      if (far) return { x, y };
    }
  }
  throw new Error('no remote tile');
}

/** Steps until `attacker` fires; returns the shot or null after `ticks`. */
function firstShot(world: SimWorld, attacker: number, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    step(world);
    const shot = world.combatEvents.find((event) => event.attackerEid === attacker);
    if (shot) return shot;
  }
  return null;
}

describe('town center defence', () => {
  it('shoots with the tower\'s arrows, two tiles further', () => {
    expect(TC.combat).toBeDefined();
    expect(TC.combat!.atk).toBe(TOWER.combat!.atk);
    expect(TC.combat!.attackSpeedTicks).toBe(TOWER.combat!.attackSpeedTicks);
    expect(TOWN_CENTER_RANGE_BONUS).toBe(2);
    expect(TC.combat!.range).toBe(TOWER.combat!.range + 2);
  });

  it('every starting town center is armed', () => {
    const world = quietWorld();
    for (const playerId of [1, 2]) {
      const tc = townCenterOf(world, playerId);
      expect(hasComponent(world.ecs, Combat, tc)).toBe(true);
      expect(hasComponent(world.ecs, AttackTarget, tc)).toBe(true);
      expect(hasComponent(world.ecs, Cooldown, tc)).toBe(true);
      expect(Combat.range[tc]).toBe(TC.combat!.range);
    }
  });

  it('damages an enemy inside its range, beyond where a tower could reach', () => {
    // Player 1 is human and the map is not revealed: the shot also proves the
    // town center sees as far as it shoots.
    const world = quietWorld();
    const tc = townCenterOf(world, 1);
    const range = TC.combat!.range;
    const spot = tileAtDistance(world, Position.x[tc], Position.y[tc], TOWER.combat!.range + 1, range);
    const enemy = spawnVillager(world, spot.x, spot.y, 2);
    const hpBefore = Health.hp[enemy];

    const shot = firstShot(world, tc, 10);
    expect(shot?.projectileTicks).toBeGreaterThan(0);
    expect(Health.hp[enemy]).toBe(hpBefore);
    for (let i = 0; i < shot!.projectileTicks!; i++) step(world);
    expect(Health.hp[enemy]).toBe(hpBefore - TC.combat!.atk);
    // Next arrow only after the tower's reload.
    expect(Cooldown.ticksRemaining[tc]).toBeGreaterThan(0);
    expect(Cooldown.ticksRemaining[tc]).toBeLessThanOrEqual(TOWER.combat!.attackSpeedTicks);
  });

  it('does not reach an enemy beyond its range', () => {
    const world = quietWorld();
    const tc = townCenterOf(world, 1);
    const range = TC.combat!.range;
    const spot = tileAtDistance(world, Position.x[tc], Position.y[tc], range + 1, range + 2);
    const enemy = spawnVillager(world, spot.x, spot.y, 2);
    const hpBefore = Health.hp[enemy];

    expect(firstShot(world, tc, 80)).toBeNull();
    expect(AttackTarget.targetEid[tc]).toBe(-1);
    expect(Health.hp[enemy]).toBe(hpBefore);
  });

  it('out-ranges a tower: the same distance is safe from the tower', () => {
    const world = quietWorld();
    const site = remoteTile(world, 24);
    const tower = spawnCompletedBuilding(world, BuildingDefId.DEFENSIVE_TOWER, site.x, site.y, 1);
    const spot = tileAtDistance(world, site.x, site.y, TOWER.combat!.range + 1, TC.combat!.range);
    const enemy = spawnVillager(world, spot.x, spot.y, 2);
    const hpBefore = Health.hp[enemy];

    expect(firstShot(world, tower, 80)).toBeNull();
    expect(Health.hp[enemy]).toBe(hpBefore);
  });

  it('a town center foundation does not shoot', () => {
    const world = quietWorld();
    const site = remoteTile(world, 24);
    const foundation = spawnFoundation(world, BuildingDefId.TOWN_CENTER, site.x, site.y, 1);
    // The def has no build time (town centers are pre-placed), which would
    // finish the site on the first tick: give it real work left.
    ConstructionSite.totalTicks[foundation] = 400;
    const spot = tileAtDistance(world, site.x, site.y, 3, 5);
    const enemy = spawnVillager(world, spot.x, spot.y, 2);
    const hpBefore = Health.hp[enemy];

    expect(hasComponent(world.ecs, Combat, foundation)).toBe(false);
    expect(firstShot(world, foundation, 80)).toBeNull();
    expect(hasComponent(world.ecs, ConstructionSite, foundation)).toBe(true);
    expect(Health.hp[enemy]).toBe(hpBefore);

    // Finished, it opens fire like any other town center.
    ConstructionSite.progress[foundation] = ConstructionSite.totalTicks[foundation];
    finaliseBuilding(world, foundation);
    expect(firstShot(world, foundation, 10)).not.toBeNull();
  });

  it('a save from before the town center was armed loads with the attack', () => {
    const source = quietWorld();
    const save = serializeSimWorld(source, 'old');
    // What an older build wrote: town centers without combat data.
    let stripped = 0;
    for (const entity of save.entities) {
      if (!entity.townCenter) continue;
      delete entity.combat;
      delete entity.attackTarget;
      delete entity.cooldown;
      stripped++;
    }
    expect(stripped).toBe(2);

    const world = createSimWorld(1);
    loadSimWorldSnapshot(world, JSON.parse(JSON.stringify(save)));
    world.paused = false;
    world.aiPlayers[AI_PLAYER_ID] = null;
    const tc = townCenterOf(world, 1);
    expect(Combat.atk[tc]).toBe(TC.combat!.atk);
    expect(Combat.range[tc]).toBe(TC.combat!.range);
    expect(AttackTarget.targetEid[tc]).toBe(-1);

    const spot = tileAtDistance(world, Position.x[tc], Position.y[tc], 4, 6);
    const enemy = spawnVillager(world, spot.x, spot.y, 2);
    const hpBefore = Health.hp[enemy];
    const shot = firstShot(world, tc, 10);
    expect(shot).not.toBeNull();
    for (let i = 0; i < shot!.projectileTicks!; i++) step(world);
    expect(Health.hp[enemy]).toBeLessThan(hpBefore);
  });

  it('a current save keeps the town center\'s target and reload', () => {
    const source = quietWorld();
    const tc = townCenterOf(source, 1);
    const spot = tileAtDistance(source, Position.x[tc], Position.y[tc], 4, 6);
    spawnVillager(source, spot.x, spot.y, 2);
    expect(firstShot(source, tc, 10)).not.toBeNull();

    const world = createSimWorld(1);
    loadSimWorldSnapshot(world, JSON.parse(JSON.stringify(serializeSimWorld(source, 'now'))));
    const loaded = townCenterOf(world, 1);
    expect(Cooldown.ticksRemaining[loaded]).toBe(Cooldown.ticksRemaining[tc]);
    expect(AttackTarget.targetEid[loaded]).toBeGreaterThanOrEqual(0);
  });
});
