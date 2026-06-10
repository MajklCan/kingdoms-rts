import { describe, expect, it } from 'vitest';
import { addComponent } from 'bitecs';
import { MAP } from '../config';
import { AttackTarget, Position, Selected } from './components';
import { checksumWorld } from './checksum';
import {
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnSpearman,
  spawnVillager,
  step,
  updatePlayerVisibility,
  type SimInput,
  type SimWorld,
} from './world';
import { serializeSimWorld, loadSimWorldSnapshot } from './save-load';

function findOpenTile(world: SimWorld, startX = 6, startY = 6): { x: number; y: number } {
  for (let y = startY; y < MAP.HEIGHT - 4; y++) {
    for (let x = startX; x < MAP.WIDTH - 4; x++) {
      if (world.map.walkability[y][x] !== 0) continue;
      if (findBuildingAt(world, x, y, 1.2) !== null) continue;
      if (findResourceAt(world, x, y, 0.8) !== null) continue;
      return { x, y };
    }
  }
  throw new Error('No open tile found');
}

function stepN(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) step(world);
}

function expectChecksumChange(mutator: (world: SimWorld) => void): void {
  const a = createSimWorld(2026);
  const b = createSimWorld(2026);
  expect(checksumWorld(a)).toBe(checksumWorld(b));
  mutator(b);
  expect(checksumWorld(a)).not.toBe(checksumWorld(b));
}

function expectChecksumChangeWithUnit(mutator: (world: SimWorld, eid: number) => void): void {
  const a = createSimWorld(2027);
  const b = createSimWorld(2027);
  const spot = findOpenTile(a);
  spawnSpearman(a, spot.x, spot.y, 1);
  const eid = spawnSpearman(b, spot.x, spot.y, 1);
  expect(checksumWorld(a)).toBe(checksumWorld(b));
  mutator(b, eid);
  expect(checksumWorld(a)).not.toBe(checksumWorld(b));
}

describe('determinism', () => {
  it('two worlds from the same seed have identical checksums at tick 0', () => {
    const a = createSimWorld(1234);
    const b = createSimWorld(1234);
    expect(checksumWorld(a)).toBe(checksumWorld(b));
  });

  it('identical seed + identical inputs → identical checksum every tick', () => {
    // NOTE: bitECS 0.3.40 has a process-global eid cursor, so the two worlds
    // get DIFFERENT absolute eids. The checksum is eid-canonical, so it still
    // matches; but each world's commands must reference that world's own eids.
    const a = createSimWorld(77);
    const b = createSimWorld(77);
    a.paused = false;
    b.paused = false;

    const spot = findOpenTile(a);
    const ua = [spawnSpearman(a, spot.x, spot.y, 1), spawnSpearman(a, spot.x + 1, spot.y, 1)];
    const ub = [spawnSpearman(b, spot.x, spot.y, 1), spawnSpearman(b, spot.x + 1, spot.y, 1)];

    expect(checksumWorld(a)).toBe(checksumWorld(b)); // identical state, different eids

    const dest = findOpenTile(a, spot.x + 10, spot.y + 6);
    const scriptFor = (eids: number[]): Array<{ atTick: number; input: SimInput }> => [
      { atTick: 2, input: { type: 'cmdMove', playerId: 1, eids, to: dest } },
      { atTick: 8, input: { type: 'cmdStop', playerId: 1, eids } },
    ];
    const sa = scriptFor(ua);
    const sb = scriptFor(ub);

    for (let tick = 0; tick < 40; tick++) {
      for (const s of sa) if (s.atTick === tick) a.inputs.push(s.input);
      for (const s of sb) if (s.atTick === tick) b.inputs.push(s.input);
      step(a);
      step(b);
      expect(checksumWorld(a)).toBe(checksumWorld(b));
    }
  });

  it('a divergent command produces a different checksum (desync detected)', () => {
    const a = createSimWorld(55);
    const b = createSimWorld(55);
    a.paused = false;
    b.paused = false;

    const spot = findOpenTile(a);
    const ea = spawnSpearman(a, spot.x, spot.y, 1);
    spawnSpearman(b, spot.x, spot.y, 1);
    expect(checksumWorld(a)).toBe(checksumWorld(b)); // identical before divergence

    const dest = findOpenTile(a, spot.x + 12, spot.y + 8);
    // Only world A gets the move command.
    a.inputs.push({ type: 'cmdMove', playerId: 1, eids: [ea], to: dest });

    stepN(a, 6);
    stepN(b, 6);

    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  it('checksum includes delayed auxiliary state that can affect future ticks', () => {
    expectChecksumChange((world) => {
      world.formationModes[2] = 2;
    });
    expectChecksumChange((world) => {
      world.formationFacings[2] = 4;
    });
    expectChecksumChange((world) => {
      world.armyRallyPoints[2] = { x: 12, y: 18 };
    });
    expectChecksumChange((world) => {
      world.humanPlayers.add(2);
      world.revealedMapPlayers[2] = true;
    });
    expectChecksumChangeWithUnit((world, eid) => {
      world.movementStuck.set(eid, {
        lastDist: 2.5,
        waypointX: 10,
        waypointY: 11,
        noProgressTicks: 3,
        cooldownTicks: 1,
        attempts: 2,
      });
    });
    expectChecksumChangeWithUnit((world, eid) => {
      world.formationSpeedCaps.set(eid, 0.75);
    });
    expectChecksumChangeWithUnit((world, eid) => {
      world.cannonWindups.set(eid, {
        targetEid: eid,
        ticksRemaining: 5,
      });
    });
    expectChecksumChangeWithUnit((world, eid) => {
      world.pendingProjectileImpacts.push({
        impactTick: world.tick + 3,
        attackerEid: eid,
        attackerOwner: 1,
        targetEid: eid,
        damage: 4,
      });
    });
    expectChecksumChangeWithUnit((world, eid) => {
      world.pendingCannonImpacts.push({
        impactTick: world.tick + 4,
        attackerEid: eid,
        attackerOwner: 1,
        impactX: 14,
        impactY: 15,
        damage: 8,
      });
    });
  });

  it('snapshot preserves checksummed auxiliary state', () => {
    const world = createSimWorld(909);
    world.paused = false;
    world.humanPlayers = new Set([1, 2]);
    world.formationModes[2] = 2;
    world.formationFacings[2] = 5;
    world.armyRallyPoints[2] = { x: 22, y: 23 };
    world.revealedMapPlayers[2] = true;

    const spot = findOpenTile(world);
    const p1Unit = spawnSpearman(world, spot.x, spot.y, 1);
    const p2Unit = spawnSpearman(world, spot.x + 3, spot.y, 2);
    world.movementStuck.set(p2Unit, {
      lastDist: 1.5,
      waypointX: spot.x + 5,
      waypointY: spot.y,
      noProgressTicks: 2,
      cooldownTicks: 1,
      attempts: 1,
    });
    world.formationSpeedCaps.set(p2Unit, 0.9);
    world.cannonWindups.set(p2Unit, { targetEid: p1Unit, ticksRemaining: 4 });
    world.pendingProjectileImpacts.push({
      impactTick: world.tick + 2,
      attackerEid: p2Unit,
      attackerOwner: 2,
      targetEid: p1Unit,
      damage: 3,
    });
    world.pendingCannonImpacts.push({
      impactTick: world.tick + 3,
      attackerEid: p2Unit,
      attackerOwner: 2,
      impactX: Position.x[p1Unit],
      impactY: Position.y[p1Unit],
      damage: 5,
    });
    if (world.aiPlayers[2]) {
      world.aiPlayers[2].waveUnitEids = [p2Unit];
    }
    updatePlayerVisibility(world, 1);
    updatePlayerVisibility(world, 2);

    const snapshot = serializeSimWorld(world, 'aux-state');
    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, snapshot);
    restored.paused = false;

    expect(checksumWorld(restored)).toBe(checksumWorld(world));
  });

  it('human player 2 combat uses player 2 visibility when validating targets', () => {
    const world = createSimWorld(808);
    world.paused = false;
    world.humanPlayers = new Set([1, 2]);

    const p2Spot = findOpenTile(world);
    const p1Spot = findOpenTile(world, p2Spot.x + 30, p2Spot.y + 20);
    const p2Unit = spawnSpearman(world, p2Spot.x, p2Spot.y, 2);
    const hiddenP1Unit = spawnSpearman(world, p1Spot.x, p1Spot.y, 1);

    AttackTarget.targetEid[p2Unit] = hiddenP1Unit;
    AttackTarget.retainGoal[p2Unit] = 1;

    step(world);

    expect(AttackTarget.targetEid[p2Unit]).toBe(-1);
  });
});

describe('self-describing commands', () => {
  it('cmdMove only moves units the commanding player owns', () => {
    const world = createSimWorld(9);
    world.paused = false;
    // Villagers (no auto-aggro) placed far apart so neither separation nor
    // combat confounds the ownership check.
    const spot = findOpenTile(world);
    const mine = spawnVillager(world, spot.x, spot.y, 1);
    const enemySpot = findOpenTile(world, spot.x + 20, spot.y + 14);
    const enemy = spawnVillager(world, enemySpot.x, enemySpot.y, 2);

    const dest = findOpenTile(world, spot.x + 12, spot.y + 8);
    const distTo = (eid: number, t: { x: number; y: number }) =>
      Math.hypot(Position.x[eid] - t.x, Position.y[eid] - t.y);

    const mineStartDist = distTo(mine, dest);
    const enemyStart = { x: Position.x[enemy], y: Position.y[enemy] };

    // Player 1 tries to command BOTH their own unit and the enemy's.
    world.inputs.push({ type: 'cmdMove', playerId: 1, eids: [mine, enemy], to: dest });

    for (let i = 0; i < 30; i++) step(world);

    // Own unit advanced meaningfully toward the destination.
    expect(distTo(mine, dest)).toBeLessThan(mineStartDist - 1);
    // Enemy unit ignored the command — stayed put.
    const enemyMoved = Math.hypot(
      Position.x[enemy] - enemyStart.x,
      Position.y[enemy] - enemyStart.y
    );
    expect(enemyMoved).toBeLessThan(0.05);
  });

  it('cmdMove matches the legacy selection-relative path', () => {
    const explicit = createSimWorld(321);
    const selectBased = createSimWorld(321);
    explicit.paused = false;
    selectBased.paused = false;

    const spot = findOpenTile(explicit);
    const e1 = spawnVillager(explicit, spot.x, spot.y, 1);
    const s1 = spawnVillager(selectBased, spot.x, spot.y, 1);

    const dest = findOpenTile(explicit, spot.x + 10, spot.y + 7);

    // explicit world: self-describing command (network path)
    explicit.inputs.push({ type: 'cmdMove', playerId: 1, eids: [e1], to: dest });
    // select-based world: mark unit Selected, then legacy selection-relative
    // command — this resolves to the same eid + LOCAL_PLAYER_ID internally.
    addComponent(selectBased.ecs, Selected, s1);
    selectBased.inputs.push({ type: 'moveSelected', to: dest });

    for (let i = 0; i < 20; i++) {
      step(explicit);
      step(selectBased);
    }
    expect(checksumWorld(explicit)).toBe(checksumWorld(selectBased));
  });
});

describe('rng state in snapshot', () => {
  it('round-trips and reproduces future rng draws', () => {
    const world = createSimWorld(2024);
    world.paused = false;
    const spot = findOpenTile(world);
    spawnSpearman(world, spot.x, spot.y, 1);
    stepN(world, 25);

    const snapshot = serializeSimWorld(world, 'test');
    expect(snapshot.rngState).toBe(world.rng.getState());

    const restored = createSimWorld(999); // different seed on purpose
    loadSimWorldSnapshot(restored, snapshot);
    restored.paused = false;

    // Same checksum right after load.
    expect(checksumWorld(restored)).toBe(checksumWorld(world));

    // ...and they keep matching as both step forward (proves rng continuity).
    for (let i = 0; i < 30; i++) {
      step(world);
      step(restored);
      expect(checksumWorld(restored)).toBe(checksumWorld(world));
    }
  });
});
