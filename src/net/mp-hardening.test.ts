/**
 * Multiplayer hardening: AI bots play each other through the real lockstep
 * path (session, NetId wire encoding, sanitize, JSON relay) on a virtual
 * network, with both worlds' checksums compared after every tick. Short runs
 * here; scripts/sim/mp-soak.ts plays whole games across seeds, maps and ages.
 *
 * Every run pollutes bitECS's eid allocator between the two worlds, so the
 * clients hold the same entities under different raw eids in a different raw
 * order, as two browsers with different histories do.
 */

import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { checksumWorld } from '@sim/checksum';
import { Building, Health, Owner, Position } from '@sim/components';
import { AgeId, BuildingDefId, UnitDefId } from '@sim/defs';
import { MapId } from '@sim/map-gen';
import {
  buildingQuery,
  createSimWorld,
  netIdForEntity,
  removeSimEntity,
  spawnSpearman,
  step,
  townCenterQuery,
  unitQuery,
  type SimInput,
  type SimWorld,
} from '@sim/world';
import { decodeInputFromWire } from './commands';
import { MAX_SEND_AHEAD_TICKS } from './lockstep';
import { DEFAULT_INPUT_DELAY } from './protocol';
import { injectCommand, runMpMatch, type MpClient, type MpMatchConfig } from './testing/mp-match';
import { PERFECT_LINK, type LinkConditions } from './testing/virtual-net';

const CHAOS: [LinkConditions, LinkConditions] = [
  { latencyMs: 30, jitterMs: 150, reorderChance: 0.25, duplicateChance: 0.1 },
  { latencyMs: 110, jitterMs: 250, reorderChance: 0.3, duplicateChance: 0.1 },
];

function config(overrides: Partial<MpMatchConfig> = {}): MpMatchConfig {
  return {
    seed: 7,
    mapId: MapId.RIVERLANDS,
    startingAge: AgeId.CASTLE,
    clients: [
      { difficulty: 'hard', link: CHAOS[0], frameJitterMs: 12 },
      { difficulty: 'medium', link: CHAOS[1], frameMs: 33, frameJitterMs: 20 },
    ],
    maxTicks: 900,
    ...overrides,
  };
}

function expectLockstep(result: ReturnType<typeof runMpMatch>, ticks: number): void {
  expect(result.desyncTick).toBeNull();
  expect(result.sessionDesync).toBe(false);
  expect(result.hang).toBe(false);
  expect(Math.min(...result.ticks)).toBeGreaterThanOrEqual(ticks);
  expect(result.ticksCompared).toBeGreaterThanOrEqual(ticks - 40);
}

function ownedBy(world: SimWorld, playerId: number, eids: readonly number[]): number[] {
  return eids.filter((eid) => hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId && Health.hp[eid] > 0);
}

describe('multiplayer hardening: AI bots over a hostile network', () => {
  it('stays in lockstep every tick through latency, jitter, reordering and duplicate frames', () => {
    const result = runMpMatch(config());
    expectLockstep(result, 900);
    expect(result.commands[0]?.commands ?? 0).toBeGreaterThan(5);
    expect(result.commands[1]?.commands ?? 0).toBeGreaterThan(5);
  });

  it('a client whose world is reloaded from its own save mid-match keeps lockstep', () => {
    const result = runMpMatch(config({ reloadAt: { client: 1, tick: 450 } }));
    expectLockstep(result, 900);
  });

  it('a local pause on one client cannot desync the match', () => {
    const result = runMpMatch(
      config({
        clients: [
          { difficulty: 'medium', link: PERFECT_LINK },
          { difficulty: 'medium', link: PERFECT_LINK },
        ],
        maxTicks: 400,
        onTick: (_ctx, client, tick) => {
          // window.__GAME__.pause() or a stray UI path flips the flag.
          if (client.index === 0 && tick === 200) client.session.world!.paused = true;
        },
      })
    );
    expectLockstep(result, 400);
  });

  it('a stray local input pushed outside the session cannot desync the match', () => {
    const result = runMpMatch(
      config({
        clients: [
          { difficulty: 'medium', link: PERFECT_LINK },
          { difficulty: 'medium', link: PERFECT_LINK },
        ],
        maxTicks: 400,
        onTick: (_ctx, client, tick) => {
          if (client.index !== 0 || tick !== 200) return;
          const world = client.session.world!;
          const tc = ownedBy(world, 1, townCenterQuery(world.ecs))[0];
          world.inputs.push({ type: 'trainUnit', atEid: tc, defId: UnitDefId.VILLAGER, playerId: 1 });
        },
      })
    );
    expectLockstep(result, 400);
  });

  it('very different frame rates (fast tab vs throttled tab) stay in lockstep', () => {
    const result = runMpMatch(
      config({
        clients: [
          { difficulty: 'medium', link: CHAOS[0], frameMs: 7 },
          { difficulty: 'medium', link: CHAOS[1], frameMs: 250, frameJitterMs: 400 },
        ],
        maxTicks: 600,
      })
    );
    expectLockstep(result, 600);
  });

  it('caps local command lag under very high latency', () => {
    let maxLead = 0;
    const result = runMpMatch(
      config({
        clients: [
          { difficulty: 'medium', link: { latencyMs: 700, jitterMs: 300, reorderChance: 0, duplicateChance: 0 } },
          { difficulty: 'medium', link: { latencyMs: 700, jitterMs: 300, reorderChance: 0, duplicateChance: 0 } },
        ],
        maxTicks: 300,
        hangMs: 60_000,
        onTick: (_ctx, client, tick) => {
          if (tick % 10 !== 0) return;
          const lockstep = client.session.debugSnapshot().lockstep!;
          maxLead = Math.max(maxLead, lockstep.sendTick - lockstep.execTick);
        },
      })
    );
    expectLockstep(result, 300);
    expect(maxLead).toBeGreaterThan(DEFAULT_INPUT_DELAY);
    expect(maxLead).toBeLessThanOrEqual(DEFAULT_INPUT_DELAY + MAX_SEND_AHEAD_TICKS);
  });
});

describe('multiplayer hardening: leaving and finishing', () => {
  it('a player who leaves mid-game ends the match cleanly for the other, with no hang', () => {
    let leftAt = -1;
    const result = runMpMatch(
      config({
        maxTicks: 2000,
        onTick: (_ctx, client, tick) => {
          if (client.index === 1 && tick === 300) {
            leftAt = tick;
            client.session.leave();
          }
        },
      })
    );
    expect(leftAt).toBe(300);
    expect(result.desyncTick).toBeNull();
    expect(result.states).toEqual(['peer-left', 'left']);
    expect(result.hang).toBe(false);
    // Neither side kept stepping after the leave (the stayer may finish the
    // few ticks it already had every packet for).
    expect(Math.max(...result.ticks)).toBeLessThan(300 + DEFAULT_INPUT_DELAY + MAX_SEND_AHEAD_TICKS + 2);
  });

  it('a connection that drops without a goodbye ends the match for both sides', () => {
    const result = runMpMatch(
      config({
        maxTicks: 2000,
        onTick: (ctx, client, tick) => {
          if (client.index === 0 && tick === 250) ctx.clients[0].transport.sever();
        },
      })
    );
    expect(result.states).toEqual(['disconnected', 'peer-left']);
    expect(result.hang).toBe(false);
    expect(result.desyncTick).toBeNull();
  });

  it('both clients see the same winner and stay in lockstep after the end', () => {
    // Player 2's town center is nearly dead with player 1 spearmen beside it.
    const prepareWorld = (world: SimWorld): void => {
      const tc2 = ownedBy(world, 2, townCenterQuery(world.ecs))[0];
      Health.hp[tc2] = 1;
      for (let i = 0; i < 4; i++) spawnSpearman(world, Position.x[tc2] + 2 + (i % 2), Position.y[tc2] + 2 + (i >> 1), 1);
    };
    const result = runMpMatch(config({ prepareWorld, maxTicks: 3000, tailTicks: 60 }));
    expect(result.desyncTick).toBeNull();
    expect(result.outcomes).toEqual(['victory', 'victory']);
    expect(result.winners).toEqual([1, 1]);
    expect(result.worldTicks[0]).toBe(result.worldTicks[1]);
    expect(result.finalChecksums[0]).toBe(result.finalChecksums[1]);
    expect(Math.min(...result.ticks)).toBeLessThan(3000);
  });
});

describe('multiplayer hardening: hostile commands', () => {
  /** The guest (player 2) orders player 1's units, production and buildings. */
  function attackOwnership(ctx: { clients: MpClient[] }, client: MpClient, tick: number): void {
    if (client.index !== 1 || tick !== 200) return;
    const world = client.session.world!;
    const p1Units = ownedBy(world, 1, unitQuery(world.ecs));
    const p1Buildings = ownedBy(world, 1, buildingQuery(world.ecs));
    const p1Tc = ownedBy(world, 1, townCenterQuery(world.ecs))[0];
    const p2Unit = ownedBy(world, 2, unitQuery(world.ecs))[0];
    const hostile: SimInput[] = [
      { type: 'cmdMove', playerId: 2, eids: p1Units, to: { x: 1, y: 1 } },
      { type: 'cmdStop', playerId: 2, eids: p1Units },
      { type: 'cmdAttack', playerId: 2, eids: p1Units, targetEid: p1Tc },
      { type: 'cmdAttackMove', playerId: 2, eids: p1Units, to: { x: 2, y: 2 } },
      { type: 'cmdSetStance', playerId: 2, eids: p1Units, stance: 1 },
      { type: 'cmdRemoveBuildings', playerId: 2, eids: p1Buildings },
      { type: 'trainUnit', atEid: p1Tc, defId: UnitDefId.VILLAGER, playerId: 2 },
      { type: 'cancelProduction', atEid: p1Tc, slot: 0, playerId: 2 },
      // Unknown entities: they encode to nothing / -1 on the wire.
      { type: 'cmdMove', playerId: 2, eids: [987654], to: { x: 3, y: 3 } },
      { type: 'cmdAttack', playerId: 2, eids: p2Unit !== undefined ? [p2Unit] : [], targetEid: 987654 },
      { type: 'trainUnit', atEid: 987654, defId: UnitDefId.VILLAGER, playerId: 2 },
    ];
    for (const input of hostile) injectCommand(client, input);
    // Claiming player 1's seat is refused before it reaches the wire.
    expect(injectCommand(client, { type: 'advanceAge', playerId: 1 })).toBe(false);
    expect(injectCommand(client, { type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: 10.5, y: 10, playerId: 2 })).toBe(false);
    void ctx;
  }

  it('orders for entities the sender does not own change nothing, on either client', () => {
    const base = config({ maxTicks: 500 });
    const control = runMpMatch(base);
    const hostile = runMpMatch({ ...base, onTick: attackOwnership });
    expectLockstep(hostile, 500);
    expect(hostile.finalChecksums).toEqual(control.finalChecksums);
  });

  it('a peer packet naming unknown or dead NetIds decodes to nothing and applies as a no-op', () => {
    const world = createSimWorld(11);
    world.paused = false;
    const control = createSimWorld(11);
    control.paused = false;
    const victim = ownedBy(world, 1, unitQuery(world.ecs))[0];
    const deadNetId = netIdForEntity(world, victim)!;
    const controlVictim = ownedBy(control, 1, unitQuery(control.ecs))[0];
    removeSimEntity(world, victim);
    removeSimEntity(control, controlVictim);
    const p1Tc = ownedBy(world, 1, townCenterQuery(world.ecs))[0];
    const tcNetId = netIdForEntity(world, p1Tc)!;
    const wire: SimInput[] = [
      { type: 'cmdMove', playerId: 1, eids: [deadNetId, 424242], to: { x: 5, y: 5 } },
      { type: 'cmdAttack', playerId: 1, eids: [deadNetId], targetEid: 424242 },
      { type: 'cmdGather', playerId: 1, eids: [424242], targetEid: deadNetId },
      { type: 'trainUnit', atEid: deadNetId, defId: UnitDefId.VILLAGER, playerId: 1 },
      { type: 'cancelProduction', atEid: 424242, playerId: 1 },
      { type: 'cmdRemoveBuildings', playerId: 1, eids: [424242, deadNetId] },
    ];
    for (const input of wire) world.inputs.push(decodeInputFromWire(world, input));
    expect(() => step(world)).not.toThrow();
    step(control);
    expect(checksumWorld(world)).toBe(checksumWorld(control));
    // The live town center still decodes.
    const decoded = decodeInputFromWire(world, { type: 'trainUnit', atEid: tcNetId, defId: UnitDefId.VILLAGER, playerId: 1 });
    expect(decoded).toMatchObject({ atEid: p1Tc });
  });

  it('a fractional building spot is refused by the wire schema and by the sim', () => {
    const world = createSimWorld(5);
    world.paused = false;
    const before = world.resources[1].slice();
    const tc = ownedBy(world, 1, townCenterQuery(world.ecs))[0];
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: Position.x[tc] + 4.5, y: Position.y[tc] + 0.25, playerId: 1 });
    expect(() => step(world)).not.toThrow();
    expect(Array.from(world.resources[1])).toEqual(Array.from(before));
    const houses = [...buildingQuery(world.ecs)].filter(
      (eid) => hasComponent(world.ecs, Building, eid) && Building.defId[eid] === BuildingDefId.HOUSE && Owner.player[eid] === 1
    );
    expect(houses).toHaveLength(0);
  });
});
