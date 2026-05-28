import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../config';
import {
  AttackMoveGoal,
  AttackTarget,
  Combat,
  Cooldown,
  Health,
  MachineGunDeployment,
  Position,
  Speed,
  UnitStance,
  UnitStanceId,
  Velocity,
} from './components';
import {
  buildingQuery,
  clearSelection,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  setSelected,
  spawnArcher,
  spawnCannon,
  spawnCompletedBuilding,
  spawnGunman,
  spawnMachineGun,
  spawnScoutCavalry,
  spawnSpearman,
  step,
  type SimWorld,
} from './world';
import { BuildingDefId } from './defs';
import { Owner, TownCenterTag } from './components';

function findOpenTile(world: SimWorld): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 16; y++) {
    for (let x = 6; x < MAP.WIDTH - 16; x++) {
      if (!isOpen(world, x, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No open tile found');
}

function findFormationTile(world: SimWorld): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 16; y++) {
    for (let x = 6; x < MAP.WIDTH - 18; x++) {
      if (!isOpen(world, x, y)) continue;
      if (!isOpen(world, x + 10, y)) continue;
      if (!isOpen(world, x + 11, y)) continue;
      if (!isOpen(world, x + 9, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No formation tile found');
}

function findPriorityTile(world: SimWorld): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 16; y++) {
    for (let x = 6; x < MAP.WIDTH - 16; x++) {
      if (!isOpen(world, x, y)) continue;
      if (!isOpen(world, x + 2, y)) continue;
      if (!isOpen(world, x + 4, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No target-priority tile found');
}

function isOpen(world: SimWorld, x: number, y: number): boolean {
  if (world.map.walkability[y][x] !== 0) return false;
  if (findBuildingAt(world, x, y, 1.5) !== null) return false;
  if (findResourceAt(world, x, y, 0.8) !== null) return false;
  return true;
}

function playerTownCenter(world: SimWorld): number {
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] !== 1) continue;
    if (!hasComponent(world.ecs, TownCenterTag, eid)) continue;
    return eid;
  }
  throw new Error('No player town center');
}

function finalWaypoint(world: SimWorld, eid: number): { x: number; y: number } {
  const path = world.paths.get(eid);
  if (!path || path.length === 0) {
    return { x: Math.round(Position.x[eid]), y: Math.round(Position.y[eid]) };
  }
  return path[path.length - 1];
}

function stepN(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world);
}

function stepUntilCannonFire(
  world: SimWorld,
  cannon: number,
  maxTicks = 80
): SimWorld['combatEvents'][number] {
  for (let i = 0; i < maxTicks; i++) {
    step(world);
    const event = [...world.combatEvents]
      .reverse()
      .find((combatEvent) => combatEvent.attackerEid === cannon && combatEvent.phase === 'fire');
    if (event) return event;
  }
  throw new Error('Cannon did not fire');
}

describe('combat engagement and formations', () => {
  it('keeps the pikeman, scout cavalry, and archer counter triangle sharp', () => {
    {
      const world = createSimWorld(140);
      world.paused = false;
      const spot = findOpenTile(world);
      const pikeman = spawnSpearman(world, spot.x, spot.y, 1);
      const scout = spawnScoutCavalry(world, spot.x + 1, spot.y, 2);
      AttackTarget.targetEid[pikeman] = scout;
      AttackTarget.retainGoal[pikeman] = 1;
      const hpBefore = Health.hp[scout];

      step(world);

      expect(Health.hp[scout]).toBe(hpBefore - 18);
    }

    {
      const world = createSimWorld(141);
      world.paused = false;
      const spot = findOpenTile(world);
      const scout = spawnScoutCavalry(world, spot.x, spot.y, 1);
      const archer = spawnArcher(world, spot.x + 1, spot.y, 2);
      AttackTarget.targetEid[scout] = archer;
      AttackTarget.retainGoal[scout] = 1;
      const hpBefore = Health.hp[archer];

      step(world);

      expect(Health.hp[archer]).toBe(hpBefore - 10);
    }

    {
      const world = createSimWorld(142);
      world.paused = false;
      const spot = findOpenTile(world);
      const archer = spawnArcher(world, spot.x, spot.y, 1);
      const pikeman = spawnSpearman(world, spot.x + 3, spot.y, 2);
      AttackTarget.targetEid[archer] = pikeman;
      AttackTarget.retainGoal[archer] = 1;
      const hpBefore = Health.hp[pikeman];

      step(world);
      const shot = world.combatEvents.find((event) => event.attackerEid === archer);
      stepN(world, shot?.projectileTicks ?? 0);

      expect(Health.hp[pikeman]).toBe(hpBefore - 7);
    }
  });

  it('retaliates against a unit that attacks while marching toward a building', () => {
    const world = createSimWorld(123);
    world.paused = false;
    const spot = findOpenTile(world);
    const attacker = spawnArcher(world, spot.x, spot.y, 1);
    const defender = spawnSpearman(world, spot.x + 1, spot.y, 2);
    const tc = playerTownCenter(world);

    AttackTarget.targetEid[defender] = tc;
    AttackTarget.retainGoal[defender] = 1;
    AttackTarget.targetEid[attacker] = defender;
    AttackTarget.retainGoal[attacker] = 1;
    const hpBefore = Health.hp[defender];

    step(world);

    expect(Health.hp[defender]).toBe(hpBefore);
    const shot = world.combatEvents.find((event) => event.attackerEid === attacker);
    expect(shot?.projectileTicks).toBeGreaterThan(0);

    stepN(world, shot?.projectileTicks ?? 0);

    expect(Health.hp[defender]).toBeLessThan(hpBefore);
    expect(AttackTarget.targetEid[defender]).toBe(attacker);
  });

  it('gives multi-unit moves spaced formation destinations with cavalry ahead of archers', () => {
    const world = createSimWorld(124);
    world.paused = false;
    clearSelection(world);
    const spot = findFormationTile(world);
    const scout = spawnScoutCavalry(world, spot.x, spot.y, 1);
    const spearman = spawnSpearman(world, spot.x, spot.y + 1, 1);
    const archer = spawnArcher(world, spot.x, spot.y + 2, 1);

    setSelected(world, archer, true);
    setSelected(world, scout, true);
    setSelected(world, spearman, true);
    world.inputs.push({ type: 'moveSelected', to: { x: spot.x + 10, y: spot.y } });

    step(world);

    const scoutDest = finalWaypoint(world, scout);
    const archerDest = finalWaypoint(world, archer);
    expect(scoutDest.x).toBeGreaterThan(archerDest.x);
    expect(
      new Set([
        `${finalWaypoint(world, scout).x},${finalWaypoint(world, scout).y}`,
        `${finalWaypoint(world, spearman).x},${finalWaypoint(world, spearman).y}`,
        `${finalWaypoint(world, archer).x},${finalWaypoint(world, archer).y}`,
      ]).size
    ).toBe(3);
  });

  it('keeps the previous attack order when attack-move cannot path', () => {
    const world = createSimWorld(125);
    world.paused = false;
    clearSelection(world);
    const spot = findOpenTile(world);
    const archer = spawnArcher(world, spot.x, spot.y, 1);
    const enemy = spawnSpearman(world, spot.x + 3, spot.y, 2);
    AttackTarget.targetEid[archer] = enemy;
    AttackTarget.retainGoal[archer] = 1;
    setSelected(world, archer, true);

    world.inputs.push({ type: 'attackMoveSelected', to: { x: -1, y: -1 } });
    step(world);

    expect(AttackTarget.targetEid[archer]).toBe(enemy);
    expect(AttackMoveGoal.active[archer]).toBe(0);
  });

  it('auto-targets hostile units before closer passive buildings', () => {
    const world = createSimWorld(126);
    world.paused = false;
    const spot = findPriorityTile(world);
    const archer = spawnArcher(world, spot.x, spot.y, 1);
    const house = spawnCompletedBuilding(world, BuildingDefId.HOUSE, spot.x + 2, spot.y, 2);
    const spearman = spawnSpearman(world, spot.x + 4, spot.y, 2);

    step(world);

    expect(AttackTarget.targetEid[archer]).toBe(spearman);
    expect(AttackTarget.targetEid[archer]).not.toBe(house);
  });

  it('hold position suppresses chasing and retaliation movement', () => {
    const world = createSimWorld(135);
    world.paused = false;
    const spot = findFormationTile(world);
    const heldArcher = spawnArcher(world, spot.x, spot.y, 1);
    spawnSpearman(world, spot.x + 6, spot.y, 2);
    UnitStance.stance[heldArcher] = UnitStanceId.HOLD_POSITION;

    step(world);

    expect(AttackTarget.targetEid[heldArcher]).toBe(-1);
    expect(world.paths.has(heldArcher)).toBe(false);

    const heldSpearman = spawnSpearman(world, spot.x, spot.y + 3, 1);
    const enemyArcher = spawnArcher(world, spot.x + 3, spot.y + 3, 2);
    UnitStance.stance[heldSpearman] = UnitStanceId.HOLD_POSITION;
    AttackTarget.targetEid[enemyArcher] = heldSpearman;
    AttackTarget.retainGoal[enemyArcher] = 1;

    step(world);
    const shot = world.combatEvents.find((event) => event.attackerEid === enemyArcher);
    stepN(world, shot?.projectileTicks ?? 0);

    expect(AttackTarget.targetEid[heldSpearman]).toBe(-1);
  });

  it('hold position still attacks enemies already in weapon range', () => {
    const world = createSimWorld(137);
    world.paused = false;
    const spot = findOpenTile(world);
    const heldArcher = spawnArcher(world, spot.x, spot.y, 1);
    const enemy = spawnSpearman(world, spot.x + 3, spot.y, 2);
    UnitStance.stance[heldArcher] = UnitStanceId.HOLD_POSITION;

    step(world);

    expect(AttackTarget.targetEid[heldArcher]).toBe(enemy);
    expect(world.paths.has(heldArcher)).toBe(false);
  });

  it('lets held melee step into nearby fights without open chasing', () => {
    const world = createSimWorld(138);
    world.paused = false;
    const spot = findPriorityTile(world);
    const heldSpearman = spawnSpearman(world, spot.x, spot.y, 1);
    const nearbyEnemy = spawnSpearman(world, spot.x + 2, spot.y, 2);
    Speed.value[nearbyEnemy] = 0;
    UnitStance.stance[heldSpearman] = UnitStanceId.HOLD_POSITION;
    UnitStance.anchorX[heldSpearman] = Position.x[heldSpearman];
    UnitStance.anchorY[heldSpearman] = Position.y[heldSpearman];

    step(world);

    expect(AttackTarget.targetEid[heldSpearman]).toBe(nearbyEnemy);
    expect(world.paths.has(heldSpearman)).toBe(true);
  });

  it('keeps held melee from chasing past its leash', () => {
    const world = createSimWorld(139);
    world.paused = false;
    const spot = findPriorityTile(world);
    const heldSpearman = spawnSpearman(world, spot.x, spot.y, 1);
    spawnSpearman(world, spot.x + 4, spot.y, 2);
    UnitStance.stance[heldSpearman] = UnitStanceId.HOLD_POSITION;
    UnitStance.anchorX[heldSpearman] = Position.x[heldSpearman];
    UnitStance.anchorY[heldSpearman] = Position.y[heldSpearman];

    step(world);

    expect(AttackTarget.targetEid[heldSpearman]).toBe(-1);
    expect(world.paths.has(heldSpearman)).toBe(false);
  });

  it('still honors direct attack orders while holding position', () => {
    const world = createSimWorld(136);
    world.paused = false;
    clearSelection(world);
    const spot = findOpenTile(world);
    const archer = spawnArcher(world, spot.x, spot.y, 1);
    const target = spawnSpearman(world, spot.x + 3, spot.y, 2);
    UnitStance.stance[archer] = UnitStanceId.HOLD_POSITION;
    setSelected(world, archer, true);

    world.inputs.push({ type: 'attackSelected', targetEid: target });
    step(world);

    expect(AttackTarget.targetEid[archer]).toBe(target);
    expect(AttackTarget.retainGoal[archer]).toBe(1);
  });

  it('does not let a killed attacker still deal damage later in the same combat tick', () => {
    const world = createSimWorld(127);
    world.paused = false;
    const spot = findOpenTile(world);
    const defender = spawnSpearman(world, spot.x, spot.y, 2);
    const attacker = spawnArcher(world, spot.x + 1, spot.y, 1);
    Health.hp[attacker] = 1;
    AttackTarget.targetEid[defender] = attacker;
    AttackTarget.retainGoal[defender] = 1;
    AttackTarget.targetEid[attacker] = defender;
    AttackTarget.retainGoal[attacker] = 1;
    const defenderHpBefore = Health.hp[defender];

    step(world);

    expect(Health.hp[attacker]).toBeLessThanOrEqual(0);
    expect(Health.hp[defender]).toBe(defenderHpBefore);
  });

  it('keeps spearman reach close to melee contact', () => {
    const world = createSimWorld(130);
    world.paused = false;
    const spot = findOpenTile(world);
    const attacker = spawnSpearman(world, spot.x, spot.y, 1);
    const target = spawnSpearman(world, spot.x + 1.25, spot.y, 2);
    AttackTarget.targetEid[attacker] = target;
    AttackTarget.retainGoal[attacker] = 1;
    const targetHpBefore = Health.hp[target];

    step(world);

    expect(Combat.range[attacker]).toBeCloseTo(0.65, 2);
    expect(Health.hp[target]).toBe(targetHpBefore);
  });

  it('applies cannon splash with direct damage and steep outer falloff', () => {
    const world = createSimWorld(131);
    world.paused = false;
    const spot = findOpenTile(world);
    const cannon = spawnCannon(world, spot.x, spot.y, 1);
    const target = spawnSpearman(world, spot.x + 4, spot.y, 2);
    const nearby = spawnArcher(world, spot.x + 4.25, spot.y, 2);
    const grouped = spawnSpearman(world, spot.x + 5.15, spot.y, 2);
    const outer = spawnSpearman(world, spot.x + 6.05, spot.y, 2);
    const friendly = spawnSpearman(world, spot.x + 4.4, spot.y, 1);
    for (const eid of [target, nearby, grouped, outer, friendly]) {
      Cooldown.ticksRemaining[eid] = 999;
      Speed.value[eid] = 0;
    }

    AttackTarget.targetEid[cannon] = target;
    AttackTarget.retainGoal[cannon] = 1;
    const groupedHpBefore = Health.hp[grouped];
    const outerHpBefore = Health.hp[outer];
    const friendlyHpBefore = Health.hp[friendly];

    step(world);

    expect(world.pendingCannonImpacts.length).toBe(0);
    expect(world.combatEvents.some((event) => event.phase === 'windup')).toBe(true);
    expect(Health.hp[target]).toBeGreaterThan(0);
    expect(Health.hp[nearby]).toBeGreaterThan(0);

    stepN(world, 30);

    expect(Health.hp[target]).toBeLessThanOrEqual(0);
    expect(Health.hp[nearby]).toBeLessThanOrEqual(0);
    expect(groupedHpBefore - Health.hp[grouped]).toBeGreaterThanOrEqual(30);
    expect(groupedHpBefore - Health.hp[grouped]).toBeLessThanOrEqual(35);
    expect(Health.hp[grouped]).toBeGreaterThan(0);
    expect(Health.hp[outer]).toBeLessThan(outerHpBefore);
    expect(Health.hp[outer]).toBeGreaterThan(0);
    expect(outerHpBefore - Health.hp[outer]).toBeLessThanOrEqual(14);
    expect(Health.hp[friendly]).toBe(friendlyHpBefore);
  });

  it('fires cannonballs at the target location instead of locking onto moving units', () => {
    const world = createSimWorld(134);
    world.paused = false;
    const spot = findOpenTile(world);
    const cannon = spawnCannon(world, spot.x, spot.y, 1);
    const target = spawnSpearman(world, spot.x + 4, spot.y, 2);
    Speed.value[target] = 0;
    Cooldown.ticksRemaining[target] = 999;
    AttackTarget.targetEid[cannon] = target;
    AttackTarget.retainGoal[cannon] = 1;
    const hpBefore = Health.hp[target];

    const shot = stepUntilCannonFire(world, cannon);
    Position.x[target] = shot.toX + 1.6;
    Position.y[target] = shot.toY;

    stepN(world, shot.projectileTicks ?? 0);

    expect(Health.hp[target]).toBeLessThan(hpBefore);
    expect(Health.hp[target]).toBeGreaterThan(0);
  });

  it('requires two direct cannon hits to destroy another cannon', () => {
    const world = createSimWorld(132);
    world.paused = false;
    const spot = findOpenTile(world);
    const attacker = spawnCannon(world, spot.x, spot.y, 1);
    const target = spawnCannon(world, spot.x + 4, spot.y, 2);
    Cooldown.ticksRemaining[target] = 999;
    AttackTarget.targetEid[attacker] = target;
    AttackTarget.retainGoal[attacker] = 1;

    stepN(world, 30);

    expect(Health.hp[target]).toBeGreaterThan(0);
    expect(Health.hp[target]).toBeLessThan(Health.hpMax[target]);

    Cooldown.ticksRemaining[attacker] = 0;
    stepN(world, 30);

    expect(Health.hp[target]).toBeLessThanOrEqual(0);
  });

  it('delays gunman projectile impact, then applies 14 direct damage', () => {
    const world = createSimWorld(133);
    world.paused = false;
    const spot = findOpenTile(world);
    const gunman = spawnGunman(world, spot.x, spot.y, 1);
    const target = spawnSpearman(world, spot.x + 3, spot.y, 2);
    AttackTarget.targetEid[gunman] = target;
    AttackTarget.retainGoal[gunman] = 1;
    const targetHpBefore = Health.hp[target];

    step(world);

    expect(Health.hp[target]).toBe(targetHpBefore);
    const shot = world.combatEvents.find((event) => event.attackerEid === gunman);
    expect(shot?.projectileTicks).toBeGreaterThan(0);

    stepN(world, shot?.projectileTicks ?? 0);

    expect(targetHpBefore - Health.hp[target]).toBe(14);
  });

  it('keeps ranged units from walking toward attackers already in weapon range', () => {
    const world = createSimWorld(136);
    world.paused = false;
    const spot = findOpenTile(world);
    const defender = spawnArcher(world, spot.x, spot.y, 1);
    const attacker = spawnArcher(world, spot.x + 4, spot.y, 2);
    Combat.aggroRadius[defender] = 0;
    AttackTarget.targetEid[attacker] = defender;
    AttackTarget.retainGoal[attacker] = 1;

    step(world);
    const shot = world.combatEvents.find((event) => event.attackerEid === attacker);
    expect(shot?.projectileTicks).toBeGreaterThan(0);

    stepN(world, shot?.projectileTicks ?? 0);

    expect(AttackTarget.targetEid[defender]).toBe(attacker);
    expect(world.paths.has(defender)).toBe(false);
  });

  it('lets machine guns deploy instead of pathing into range when hit by an in-range attacker', () => {
    const world = createSimWorld(137);
    world.paused = false;
    const spot = findOpenTile(world);
    const machineGun = spawnMachineGun(world, spot.x, spot.y, 1);
    const attacker = spawnArcher(world, spot.x + 4, spot.y, 2);
    Combat.aggroRadius[machineGun] = 0;
    AttackTarget.targetEid[attacker] = machineGun;
    AttackTarget.retainGoal[attacker] = 1;

    step(world);
    const shot = world.combatEvents.find((event) => event.attackerEid === attacker);
    expect(shot?.projectileTicks).toBeGreaterThan(0);

    stepN(world, shot?.projectileTicks ?? 0);

    expect(AttackTarget.targetEid[machineGun]).toBe(attacker);
    expect(world.paths.has(machineGun)).toBe(false);

    step(world);

    expect(MachineGunDeployment.deployed[machineGun]).toBe(1);
    expect(world.combatEvents.some((event) => event.attackerEid === machineGun)).toBe(true);
  });

  it('requires a machine gun to deploy after movement before firing', () => {
    const world = createSimWorld(134);
    world.paused = false;
    const spot = findOpenTile(world);
    const machineGun = spawnMachineGun(world, spot.x, spot.y, 1);
    const target = spawnSpearman(world, spot.x + 4, spot.y, 2);
    Velocity.x[machineGun] = 1;
    AttackTarget.targetEid[machineGun] = target;
    AttackTarget.retainGoal[machineGun] = 1;

    step(world);

    expect(MachineGunDeployment.deployed[machineGun]).toBe(0);
    expect(MachineGunDeployment.setupTicks[machineGun]).toBeGreaterThan(0);
    expect(world.combatEvents.some((event) => event.attackerEid === machineGun)).toBe(false);

    const setupTicks = MachineGunDeployment.setupTicks[machineGun];
    stepN(world, setupTicks);

    expect(world.combatEvents.some((event) => event.attackerEid === machineGun)).toBe(false);

    step(world);

    expect(MachineGunDeployment.deployed[machineGun]).toBe(1);
    expect(world.combatEvents.some((event) => event.attackerEid === machineGun)).toBe(true);
  });

  it('fires machine gun bursts every three ticks once deployed', () => {
    const world = createSimWorld(135);
    world.paused = false;
    const spot = findOpenTile(world);
    const machineGun = spawnMachineGun(world, spot.x, spot.y, 1);
    const target = spawnCannon(world, spot.x + 4, spot.y, 2);
    Cooldown.ticksRemaining[target] = 999;
    AttackTarget.targetEid[machineGun] = target;
    AttackTarget.retainGoal[machineGun] = 1;

    expect(Combat.attackSpeedTicks[machineGun]).toBe(3);

    step(world);
    expect(world.combatEvents.filter((event) => event.attackerEid === machineGun)).toHaveLength(1);
    world.combatEvents.length = 0;

    stepN(world, 2);
    expect(world.combatEvents.filter((event) => event.attackerEid === machineGun)).toHaveLength(0);

    step(world);
    expect(world.combatEvents.filter((event) => event.attackerEid === machineGun)).toHaveLength(1);
  });

  it('caps faster units to the slowest selected formation member while marching', () => {
    const world = createSimWorld(128);
    world.paused = false;
    clearSelection(world);
    const spot = findFormationTile(world);
    const scout = spawnScoutCavalry(world, spot.x, spot.y, 1);
    const archer = spawnArcher(world, spot.x, spot.y + 1, 1);

    setSelected(world, scout, true);
    setSelected(world, archer, true);
    world.inputs.push({ type: 'moveSelected', to: { x: spot.x + 10, y: spot.y } });

    step(world);

    expect(world.formationSpeedCaps.get(scout)).toBe(Speed.value[archer]);
    expect(world.formationSpeedCaps.has(archer)).toBe(false);
  });
});
