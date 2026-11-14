/**
 * Exact per-player match statistics, kept as counters on the world.
 *
 * Why counters in the sim instead of deriving them in render: render only
 * sees sampled state and drained event buffers, so it cannot tell income from
 * a refund, misses entities that are born and die between two frames and
 * would start from zero after a save is loaded. The system that causes each
 * change knows exactly what happened, so it bumps the counter at the source.
 *
 * Determinism: the counters are write-only for the sim. No system reads them
 * to decide anything, so they cannot steer a match, and they are bumped in the
 * fixed system order on every client.
 *
 * Checksum: deliberately excluded (see checksum.ts). They are a pure function
 * of the hashed gameplay history, so hashing them would detect nothing new,
 * while leaving them out means a statistics bug can never end a lockstep match.
 *
 * Save/load: persisted since SAVE_VERSION 2; v1 saves load with zeroed counters.
 */

import { hasComponent } from 'bitecs';
import { Building, Health, Owner } from '../components';
import { MAX_PLAYERS } from './constants';
import type { PlayerMatchStats, SimWorld } from './types';

export function emptyPlayerStats(): PlayerMatchStats {
  return {
    unitsTrained: 0,
    unitsLost: 0,
    unitsKilled: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    buildingsRazed: 0,
    gathered: [0, 0, 0, 0],
    techsResearched: 0,
    peakPopulation: 0,
  };
}

export function createMatchStats(): PlayerMatchStats[] {
  return Array.from({ length: MAX_PLAYERS }, () => emptyPlayerStats());
}

export function clonePlayerStats(stats: PlayerMatchStats): PlayerMatchStats {
  return { ...stats, gathered: [...stats.gathered] };
}

/** Zero every counter, seeding peak population from the starting army. Called
 *  once a match world is fully set up, so setup spawns do not count. */
export function resetMatchStats(world: SimWorld): void {
  world.matchStats = createMatchStats();
  for (let playerId = 0; playerId < world.matchStats.length; playerId++) {
    world.matchStats[playerId].peakPopulation = world.population[playerId]?.current ?? 0;
  }
}

function statsOf(world: SimWorld, playerId: number): PlayerMatchStats | null {
  if (!Number.isInteger(playerId) || playerId <= 0) return null;
  return world.matchStats[playerId] ?? null;
}

export function recordUnitTrained(world: SimWorld, playerId: number): void {
  const stats = statsOf(world, playerId);
  if (stats) stats.unitsTrained += 1;
}

export function recordBuildingBuilt(world: SimWorld, playerId: number): void {
  const stats = statsOf(world, playerId);
  if (stats) stats.buildingsBuilt += 1;
}

export function recordTechResearched(world: SimWorld, playerId: number): void {
  const stats = statsOf(world, playerId);
  if (stats) stats.techsResearched += 1;
}

/** Income only: villager deliveries (with the mill bonus) and worksite output. */
export function recordGathered(world: SimWorld, playerId: number, kind: number, amount: number): void {
  const stats = statsOf(world, playerId);
  if (!stats || amount <= 0 || kind < 0 || kind > 3) return;
  stats.gathered[kind as 0 | 1 | 2 | 3] += amount;
}

/** Call right after population.current grew. */
export function recordPopulation(world: SimWorld, playerId: number): void {
  const stats = statsOf(world, playerId);
  const current = world.population[playerId]?.current ?? 0;
  if (stats && current > stats.peakPopulation) stats.peakPopulation = current;
}

/**
 * Apply `damage` to `targetEid` on behalf of `attackerOwner` and credit the
 * killing blow. The first hit that takes a living target to zero gets the
 * credit; every damage source skips targets already at zero, so each kill is
 * credited exactly once. Same integer arithmetic as the old inline `-=`.
 */
export function applyDamage(world: SimWorld, targetEid: number, damage: number, attackerOwner: number): void {
  const hpBefore = Health.hp[targetEid];
  Health.hp[targetEid] -= damage;
  if (hpBefore <= 0 || Health.hp[targetEid] > 0) return;
  world.killingBlows.set(targetEid, attackerOwner);
  if (!hasComponent(world.ecs, Owner, targetEid)) return;
  const victimOwner = Owner.player[targetEid];
  if (victimOwner === 0 || victimOwner === attackerOwner) return;
  const stats = statsOf(world, attackerOwner);
  if (!stats) return;
  if (hasComponent(world.ecs, Building, targetEid)) stats.buildingsRazed += 1;
  else stats.unitsKilled += 1;
}

/** An owned entity's health reached zero (called once, when it is flagged dead). */
export function recordDeath(world: SimWorld, eid: number): void {
  if (!hasComponent(world.ecs, Owner, eid)) return;
  const stats = statsOf(world, Owner.player[eid]);
  if (!stats) return;
  if (hasComponent(world.ecs, Building, eid)) stats.buildingsLost += 1;
  else stats.unitsLost += 1;
}
