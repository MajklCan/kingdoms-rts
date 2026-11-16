/**
 * Shift-queued orders through the real lockstep path: two clients on a
 * hostile virtual network, each queueing moves, attack-moves, attacks and
 * gathers for its own units (as cmd* inputs carrying `queue`) while the AI
 * bots keep giving plain orders around them. Both worlds' checksums are
 * compared after every tick, and one client reloads its own save while
 * orders are still queued.
 */

import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { Gatherer, Health, Owner, Position, Resource } from '@sim/components';
import { AgeId } from '@sim/defs';
import { MapId } from '@sim/map-gen';
import { compareDeterministicEids } from '@sim/core/entities';
import {
  resourceQuery,
  spawnSpearman,
  spawnVillager,
  townCenterQuery,
  unitQuery,
  type SimInput,
  type SimWorld,
} from '@sim/world';
import { sanitizeWireCommand } from './commands';
import { injectCommand, runMpMatch, type MpClient, type MpMatchConfig } from './testing/mp-match';
import type { LinkConditions } from './testing/virtual-net';

const CHAOS: [LinkConditions, LinkConditions] = [
  { latencyMs: 30, jitterMs: 150, reorderChance: 0.25, duplicateChance: 0.1 },
  { latencyMs: 110, jitterMs: 250, reorderChance: 0.3, duplicateChance: 0.1 },
];

function ownLive(world: SimWorld, playerId: number, eids: readonly number[]): number[] {
  return eids
    .filter((eid) => hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId && Health.hp[eid] > 0)
    .sort((a, b) => compareDeterministicEids(world, a, b));
}

/** Six extra soldiers and two villagers beside each town center, on both clients alike. */
function addQueueTroops(world: SimWorld): void {
  for (const playerId of [1, 2]) {
    const tc = ownLive(world, playerId, townCenterQuery(world.ecs))[0];
    if (tc === undefined) continue;
    const side = playerId === 1 ? 1 : -1;
    for (let i = 0; i < 6; i++) spawnSpearman(world, Position.x[tc] + side * (4 + (i % 3)), Position.y[tc] - side * (4 + Math.floor(i / 3)), playerId);
    for (let i = 0; i < 2; i++) spawnVillager(world, Position.x[tc] - side * (4 + i), Position.y[tc] + side * 4, playerId);
  }
}

/** What a player holding Shift would send on this tick, for the client's own units. */
function queuedOrders(client: MpClient, tick: number): SimInput[] {
  const world = client.session.world;
  if (!world) return [];
  const playerId = client.session.localPlayerId;
  const units = ownLive(world, playerId, unitQuery(world.ecs));
  const tc = ownLive(world, playerId, townCenterQuery(world.ecs))[0];
  if (units.length === 0 || tc === undefined) return [];
  const round = Math.floor(tick / 25);
  const soldiers = units.filter((eid) => !hasComponent(world.ecs, Gatherer, eid));
  const villagers = units.filter((eid) => hasComponent(world.ecs, Gatherer, eid));
  const spot = (i: number) => ({
    x: Math.round(Position.x[tc]) + ((round * 5 + i * 3) % 13) - 6,
    y: Math.round(Position.y[tc]) + ((round * 3 + i * 7) % 13) - 6,
  });
  const enemy = ownLive(world, 3 - playerId, unitQuery(world.ecs))[round % 3];
  const tree = [...resourceQuery(world.ecs)]
    .filter((eid) => Resource.amount[eid] > 0)
    .sort((a, b) =>
      Math.hypot(Position.x[a] - Position.x[tc], Position.y[a] - Position.y[tc]) -
      Math.hypot(Position.x[b] - Position.x[tc], Position.y[b] - Position.y[tc]) ||
      compareDeterministicEids(world, a, b)
    )[round % 4];

  const out: SimInput[] = [
    { type: 'cmdMove', playerId, eids: soldiers, to: spot(0), queue: true },
    { type: 'cmdAttackMove', playerId, eids: soldiers.slice(0, 4), to: spot(1), queue: true },
    { type: 'cmdMove', playerId, eids: villagers.slice(0, 2), to: spot(2), queue: true },
  ];
  if (enemy !== undefined) out.push({ type: 'cmdAttack', playerId, eids: soldiers, targetEid: enemy, queue: true });
  if (tree !== undefined && round % 2 === 1) {
    out.push({ type: 'cmdGather', playerId, eids: villagers.slice(0, 2), targetEid: tree, queue: true });
  }
  // Now and then a plain order or a Stop in the middle of the queues.
  if (round % 4 === 2) out.push({ type: 'cmdMove', playerId, eids: soldiers.slice(0, 2), to: spot(3) });
  if (round % 5 === 3) out.push({ type: 'cmdStop', playerId, eids: soldiers.slice(2, 3) });
  return out;
}

function config(overrides: Partial<MpMatchConfig> = {}): MpMatchConfig {
  return {
    seed: 23,
    mapId: MapId.RIVERLANDS,
    startingAge: AgeId.CASTLE,
    clients: [
      { difficulty: 'medium', link: CHAOS[0], frameJitterMs: 12 },
      { difficulty: 'medium', link: CHAOS[1], frameMs: 33, frameJitterMs: 20 },
    ],
    maxTicks: 700,
    prepareWorld: addQueueTroops,
    ...overrides,
  };
}

describe('order queue over lockstep', () => {
  it('queued orders from both players keep the clients in lockstep, through a mid-queue reload', () => {
    const queuedTicks = [0, 0];
    let longest = 0;
    let sent = 0;
    let queuedAtReload = 0;
    const reloadTick = 330;
    const result = runMpMatch(
      config({
        reloadAt: { client: 1, tick: reloadTick },
        onTick: (_ctx, client, tick) => {
          const world = client.session.world;
          if (!world) return;
          if (world.orderQueues.size > 0) queuedTicks[client.index]++;
          for (const queue of world.orderQueues.values()) longest = Math.max(longest, queue.length);
          if (client.index === 1 && tick === reloadTick) queuedAtReload = world.orderQueues.size;
          if (tick % 25 !== 5) return;
          for (const input of queuedOrders(client, tick)) {
            if (injectCommand(client, input)) sent++;
          }
        },
      })
    );
    expect(result.desyncTick).toBeNull();
    expect(result.sessionDesync).toBe(false);
    expect(result.hang).toBe(false);
    expect(result.ticks[0]).toBeGreaterThanOrEqual(700);
    expect(result.ticksCompared).toBeGreaterThanOrEqual(660);
    // The queues were really in use on both clients, also across the reload.
    expect(sent).toBeGreaterThan(100);
    expect(queuedTicks[0]).toBeGreaterThan(300);
    expect(queuedTicks[1]).toBeGreaterThan(300);
    expect(longest).toBeGreaterThanOrEqual(3);
    expect(queuedAtReload).toBeGreaterThan(0);
  });

  it('the queue flag is optional on the wire and must be a boolean', () => {
    const plain = { type: 'cmdMove', playerId: 2, eids: [4, 5], to: { x: 3, y: 4 } };
    expect(sanitizeWireCommand(2, plain)).toEqual(plain);
    for (const type of ['cmdMove', 'cmdAttackMove']) {
      const queued = { type, playerId: 2, eids: [4], to: { x: 3, y: 4 }, queue: true };
      expect(sanitizeWireCommand(2, queued)).toEqual(queued);
      expect(sanitizeWireCommand(2, { ...queued, queue: 1 })).toBeNull();
      expect(sanitizeWireCommand(2, { ...queued, queue: 'yes' })).toBeNull();
    }
    for (const type of ['cmdAttack', 'cmdGather']) {
      const queued = { type, playerId: 2, eids: [4], targetEid: 9, queue: true };
      expect(sanitizeWireCommand(2, queued)).toEqual(queued);
      expect(sanitizeWireCommand(2, { ...queued, queue: null })).toBeNull();
    }
    // Another player's queued order is dropped like any other.
    expect(sanitizeWireCommand(1, { type: 'cmdMove', playerId: 2, eids: [4], to: { x: 3, y: 4 }, queue: true })).toBeNull();
  });
});
