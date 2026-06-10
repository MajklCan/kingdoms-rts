/**
 * Deterministic world checksum — the desync oracle for lockstep multiplayer.
 *
 * Lockstep clients each run their own sim; if any client's state differs by a
 * single bit they silently diverge ("desync") and the match is ruined. This
 * module hashes the full sim-relevant state into one 32-bit number so peers can
 * compare a periodic hash and detect divergence the instant it happens.
 *
 * Rules:
 *  - Hash ONLY sim-deterministic state. The `Selected` component is client-local
 *    (each player selects different units) and is deliberately EXCLUDED — it is
 *    not part of the shared simulation.
 *  - Entities are visited in ascending eid order so the hash is independent of
 *    query iteration order.
 *  - Absolute entity ids are NOT hashed. bitECS 0.3.40 uses a process-global eid
 *    cursor, so two worlds (or a save reloaded into a fresh world) get different
 *    absolute eids for identical state. We hash each entity's CANONICAL index
 *    (its rank in ascending-eid order) instead, and remap stored eid references
 *    (targets, sites) through the same canonical map. The checksum is therefore
 *    invariant to eid allocation — true for both in-process comparisons and
 *    real cross-machine lockstep.
 *  - Floats are hashed by their exact IEEE-754 bits, not their decimal value.
 */

import { hasComponent } from 'bitecs';
import {
  ArcherTag,
  AttackMoveGoal,
  AttackTarget,
  Building,
  BuildOrder,
  CannonTag,
  Combat,
  ConstructionSite,
  Cooldown,
  DeadTag,
  DropOff,
  FoundationTag,
  Gatherer,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MilitiaTag,
  MortarTag,
  NetId,
  Owner,
  PathTarget,
  Position,
  PrevPosition,
  PopulationCost,
  Producer,
  Resource,
  ResourceCarry,
  ResourceWorksite,
  ScoutCavalryTag,
  Speed,
  SpearmanTag,
  TownCenterTag,
  UnitKind,
  UnitStance,
  Velocity,
  VillagerTag,
  WorksiteWorker,
} from './components';
import { positionQuery, type SimWorld } from './world';

// FNV-1a 32-bit. Cheap, good dispersion, deterministic across engines for
// integer inputs (only uses *, ^, >>> on 32-bit ints via Math.imul).
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Shared buffer to extract exact float bits without allocation per call.
const f32buf = new Float32Array(1);
const u32view = new Uint32Array(f32buf.buffer);

class Hasher {
  private h = FNV_OFFSET;

  /** Mix a 32-bit integer (coerced via >>> 0). */
  u32(n: number): void {
    let h = this.h ^ (n >>> 0);
    h = Math.imul(h, FNV_PRIME);
    this.h = h >>> 0;
  }

  /** Mix a float by its exact 32-bit IEEE-754 representation. */
  f32(n: number): void {
    f32buf[0] = n;
    this.u32(u32view[0]);
  }

  /** Mix a possibly-large integer as two 32-bit halves (safe to ~2^53). */
  int(n: number): void {
    this.u32(n | 0);
    this.u32(Math.floor(n / 0x100000000));
  }

  /** Mix a string by char codes (used for tech ids). */
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.u32(s.charCodeAt(i));
    this.u32(0x1f); // separator
  }

  /** Mix a tag's presence as a single bit. */
  bit(present: boolean): void {
    this.u32(present ? 1 : 0);
  }

  get value(): number {
    return this.h >>> 0;
  }
}

function hashU8Array(h: Hasher, values: Uint8Array): void {
  h.u32(values.length);
  for (let i = 0; i < values.length; i++) h.u32(values[i]);
}

function hashNumberArray(h: Hasher, values: readonly number[]): void {
  h.u32(values.length);
  for (const value of values) h.u32(value);
}

function hashTick(h: Hasher, value: number): void {
  h.int(Number.isFinite(value) ? value : -1);
}

function hashEntityMap<T>(
  h: Hasher,
  map: Map<number, T>,
  canon: (ref: number) => number,
  writeValue: (value: T) => void
): void {
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
  h.u32(entries.length);
  for (const [eid, value] of entries) {
    h.u32(canon(eid));
    writeValue(value);
  }
}

/**
 * Compute a 32-bit checksum of the simulation state. Two worlds that have
 * stepped identically from the same seed + inputs return the same value.
 */
export function checksumWorld(world: SimWorld): number {
  const h = new Hasher();
  const { ecs } = world;

  h.u32(0xc0de);
  h.int(world.tick);
  h.u32(world.rng.getState());
  h.int(world.nextNetId);
  h.bit(world.paused);

  // Resource banks, population, ages, techs — ascending player order.
  for (const bank of world.resources) {
    for (let i = 0; i < bank.length; i++) h.u32(bank[i]);
  }
  for (const pop of world.population) {
    h.u32(pop.current);
    h.u32(pop.cap);
  }
  for (const age of world.ages) {
    h.u32(age.current);
    h.int(age.progress);
    h.u32(age.totalTicks);
  }
  for (const set of world.researchedTechs) {
    const sorted = [...set].sort();
    h.u32(sorted.length);
    for (const tech of sorted) h.str(tech);
  }
  hashNumberArray(h, world.formationModes);
  hashNumberArray(h, world.formationFacings);
  h.u32(world.armyRallyPoints.length);
  for (const point of world.armyRallyPoints) {
    h.bit(point !== null);
    if (!point) continue;
    h.u32(point.x);
    h.u32(point.y);
  }
  hashNumberArray(h, world.revealedMapPlayers.map((revealed) => revealed ? 1 : 0));
  const humanPlayers = [...world.humanPlayers].sort((a, b) => a - b);
  h.u32(humanPlayers.length);
  for (const playerId of humanPlayers) h.u32(playerId);
  h.str(world.aiDifficulty);
  h.str(world.outcome.state);
  if (world.outcome.state === 'victory') {
    h.u32(world.outcome.winnerPlayerId);
    h.str(world.outcome.mode);
  }

  // Static map data affects pathing, vision, movement speed, and spawn geometry.
  h.u32(world.map.tiles.length);
  for (const tile of world.map.tiles) h.u32(tile);
  h.u32(world.map.elevation.length);
  for (const elevation of world.map.elevation) h.u32(elevation);
  h.u32(world.map.bridgePositions.length);
  for (const bridge of world.map.bridgePositions) {
    h.u32(bridge.x);
    h.u32(bridge.y);
  }
  h.u32(world.map.walkability.length);
  for (const row of world.map.walkability) {
    h.u32(row.length);
    for (const value of row) h.u32(value);
  }
  h.u32(world.map.spawns.length);
  for (const spawn of world.map.spawns) {
    h.u32(spawn.x);
    h.u32(spawn.y);
  }
  h.u32(world.map.features.length);
  for (const feature of world.map.features) {
    h.u32(feature.x);
    h.u32(feature.y);
    h.str(feature.kind);
    h.u32(feature.size ?? 0);
  }

  // Entities — ascending eid so the order is query-independent. Hash canonical
  // index (rank), not the absolute eid (see header note). `canon` remaps a
  // stored eid reference to its rank; missing/invalid refs hash to a sentinel.
  const eids = [...positionQuery(ecs)].sort((a, b) => a - b);
  const rank = new Map<number, number>();
  for (let i = 0; i < eids.length; i++) rank.set(eids[i], i);
  const canon = (ref: number): number => {
    const r = rank.get(ref);
    return r === undefined ? 0xffffffff : r;
  };
  for (const eid of eids) {
    h.u32(canon(eid));
    if (hasComponent(ecs, NetId, eid)) h.u32(NetId.value[eid]);
    h.f32(Position.x[eid]);
    h.f32(Position.y[eid]);
    if (hasComponent(ecs, PrevPosition, eid)) {
      h.f32(PrevPosition.x[eid]);
      h.f32(PrevPosition.y[eid]);
    }
    if (hasComponent(ecs, Velocity, eid)) {
      h.f32(Velocity.x[eid]);
      h.f32(Velocity.y[eid]);
    }
    if (hasComponent(ecs, Speed, eid)) h.f32(Speed.value[eid]);
    if (hasComponent(ecs, PathTarget, eid)) {
      h.u32(PathTarget.x[eid]);
      h.u32(PathTarget.y[eid]);
    }
    if (hasComponent(ecs, UnitKind, eid)) h.u32(UnitKind.kind[eid]);
    if (hasComponent(ecs, PopulationCost, eid)) h.u32(PopulationCost.value[eid]);
    if (hasComponent(ecs, Owner, eid)) h.u32(Owner.player[eid]);
    // NOTE: Selected is intentionally excluded (client-local, not sim state).
    h.bit(hasComponent(ecs, VillagerTag, eid));
    h.bit(hasComponent(ecs, MilitiaTag, eid));
    h.bit(hasComponent(ecs, ArcherTag, eid));
    h.bit(hasComponent(ecs, SpearmanTag, eid));
    h.bit(hasComponent(ecs, ScoutCavalryTag, eid));
    h.bit(hasComponent(ecs, GunmanTag, eid));
    h.bit(hasComponent(ecs, CannonTag, eid));
    h.bit(hasComponent(ecs, MortarTag, eid));
    h.bit(hasComponent(ecs, MachineGunTag, eid));
    h.bit(hasComponent(ecs, TownCenterTag, eid));
    h.bit(hasComponent(ecs, FoundationTag, eid));
    h.bit(hasComponent(ecs, DeadTag, eid));
    if (hasComponent(ecs, MachineGunDeployment, eid)) {
      h.u32(MachineGunDeployment.deployed[eid]);
      h.u32(MachineGunDeployment.setupTicks[eid]);
    }
    if (hasComponent(ecs, Resource, eid)) {
      h.u32(Resource.kind[eid]);
      h.u32(Resource.amount[eid]);
    }
    if (hasComponent(ecs, ResourceCarry, eid)) {
      h.u32(ResourceCarry.kind[eid]);
      h.u32(ResourceCarry.amount[eid]);
    }
    if (hasComponent(ecs, Gatherer, eid)) {
      h.u32(canon(Gatherer.targetEid[eid]));
      h.u32(Gatherer.state[eid]);
      h.u32(Gatherer.cooldown[eid]);
    }
    if (hasComponent(ecs, DropOff, eid)) h.u32(DropOff.acceptsMask[eid]);
    if (hasComponent(ecs, Building, eid)) h.u32(Building.defId[eid]);
    if (hasComponent(ecs, ConstructionSite, eid)) {
      h.u32(ConstructionSite.defId[eid]);
      h.u32(ConstructionSite.progress[eid]);
      h.u32(ConstructionSite.totalTicks[eid]);
    }
    if (hasComponent(ecs, BuildOrder, eid)) h.u32(canon(BuildOrder.targetEid[eid]));
    if (hasComponent(ecs, Producer, eid)) h.u32(Producer.currentProgress[eid]);
    if (hasComponent(ecs, ResourceWorksite, eid)) {
      h.u32(ResourceWorksite.kind[eid]);
      h.u32(ResourceWorksite.assignedWorkers[eid]);
      h.u32(ResourceWorksite.freeWorkersSpawned[eid]);
      h.u32(ResourceWorksite.progress[eid]);
    }
    if (hasComponent(ecs, WorksiteWorker, eid)) h.u32(canon(WorksiteWorker.siteEid[eid]));
    if (hasComponent(ecs, Health, eid)) {
      h.u32(Health.hp[eid]);
      h.u32(Health.hpMax[eid]);
      h.u32(Health.armor[eid]);
    }
    if (hasComponent(ecs, Combat, eid)) {
      h.u32(Combat.atk[eid]);
      h.f32(Combat.range[eid]);
      h.u32(Combat.attackSpeedTicks[eid]);
      h.u32(Combat.aggroRadius[eid]);
    }
    if (hasComponent(ecs, AttackTarget, eid)) {
      h.u32(canon(AttackTarget.targetEid[eid]));
      h.u32(AttackTarget.retainGoal[eid]);
    }
    if (hasComponent(ecs, AttackMoveGoal, eid)) {
      h.u32(AttackMoveGoal.active[eid]);
      h.u32(AttackMoveGoal.x[eid]);
      h.u32(AttackMoveGoal.y[eid]);
    }
    if (hasComponent(ecs, UnitStance, eid)) {
      h.u32(UnitStance.stance[eid]);
      h.f32(UnitStance.anchorX[eid]);
      h.f32(UnitStance.anchorY[eid]);
    }
    if (hasComponent(ecs, Cooldown, eid)) h.u32(Cooldown.ticksRemaining[eid] & 0xffff);
  }

  // Production queues + paths (ascending eid; keys hashed via canonical rank).
  const queueEids = [...world.productionQueues.keys()].sort((a, b) => a - b);
  for (const eid of queueEids) {
    h.u32(canon(eid));
    const q = world.productionQueues.get(eid)!;
    h.u32(q.length);
    for (const item of q) h.u32(item);
  }
  const pathEids = [...world.paths.keys()].sort((a, b) => a - b);
  for (const eid of pathEids) {
    h.u32(canon(eid));
    const wp = world.paths.get(eid)!;
    h.u32(wp.length);
    for (const p of wp) {
      h.u32(p.x);
      h.u32(p.y);
    }
  }

  // NetId mapping is redundant with the component state while entities exist,
  // but next future wire translation depends on it.
  const netIds = [...world.netIdToEid.entries()].sort((a, b) => a[0] - b[0]);
  h.u32(netIds.length);
  for (const [netId, eid] of netIds) {
    h.u32(netId);
    h.u32(canon(eid));
  }

  hashEntityMap(h, world.movementStuck, canon, (state) => {
    h.f32(state.lastDist);
    h.u32(state.waypointX);
    h.u32(state.waypointY);
    h.u32(state.noProgressTicks);
    h.u32(state.cooldownTicks);
    h.u32(state.attempts);
  });
  hashEntityMap(h, world.formationSpeedCaps, canon, (speedCap) => {
    h.f32(speedCap);
  });
  hashEntityMap(h, world.cannonWindups, canon, (windup) => {
    h.u32(canon(windup.targetEid));
    h.u32(windup.ticksRemaining);
  });

  h.u32(world.pendingProjectileImpacts.length);
  for (const impact of world.pendingProjectileImpacts) {
    h.int(impact.impactTick);
    h.u32(canon(impact.attackerEid));
    h.u32(impact.attackerOwner);
    h.u32(canon(impact.targetEid));
    h.u32(impact.damage);
  }
  h.u32(world.pendingCannonImpacts.length);
  for (const impact of world.pendingCannonImpacts) {
    h.int(impact.impactTick);
    h.u32(canon(impact.attackerEid));
    h.u32(impact.attackerOwner);
    h.f32(impact.impactX);
    h.f32(impact.impactY);
    h.u32(impact.damage);
  }

  h.u32(world.aiPlayers.length);
  for (const ai of world.aiPlayers) {
    h.bit(ai !== null);
    if (!ai) continue;
    h.str(ai.plan);
    hashTick(h, ai.nextAttackTick);
    hashTick(h, ai.lastAttackTick);
    hashTick(h, ai.stageStartedTick);
    h.bit(ai.rallyPoint !== null);
    if (ai.rallyPoint) {
      h.u32(ai.rallyPoint.x);
      h.u32(ai.rallyPoint.y);
    }
    h.u32(ai.waveUnitEids.length);
    for (const eid of ai.waveUnitEids) h.u32(canon(eid));
    hashTick(h, ai.lastAttackEventTick);
    hashTick(h, ai.lastDefenseEventTick);
  }

  h.bit(world.campaign !== null);
  if (world.campaign) {
    h.str(world.campaign.missionId);
    h.u32(world.campaign.lockedTechs.length);
    for (const tech of world.campaign.lockedTechs) h.str(tech);
    h.u32(world.campaign.objectives.length);
    for (const objective of world.campaign.objectives) {
      h.str(objective.id);
      h.bit(objective.optional);
      h.bit(objective.completed);
    }
    const tracked = Object.entries(world.campaign.trackedObjectiveEids)
      .sort(([a], [b]) => a.localeCompare(b));
    h.u32(tracked.length);
    for (const [id, eidsForObjective] of tracked) {
      h.str(id);
      h.u32(eidsForObjective.length);
      for (const eid of eidsForObjective) h.u32(canon(eid));
    }
    h.str(world.campaign.enemyAiMode);
    h.int(world.campaign.nextReinforcementTick);
    h.int(world.campaign.scriptedWaveIndex ?? -1);
    h.int(world.campaign.scriptedWaveCount ?? -1);
    h.int(world.campaign.zborovLinesTaken ?? -1);
    h.int(world.campaign.zborovForwardY ?? -1);
  }

  h.u32(humanPlayers.length);
  for (const playerId of humanPlayers) {
    const vis = world.visibility[playerId];
    h.u32(playerId);
    h.bit(vis !== undefined);
    if (!vis) continue;
    hashU8Array(h, vis.visible);
    hashU8Array(h, vis.explored);
  }

  return h.value;
}

/** Hex string form, handy for logs and wire frames. */
export function checksumHex(world: SimWorld): string {
  return checksumWorld(world).toString(16).padStart(8, '0');
}
