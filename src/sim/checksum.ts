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

  return h.value;
}

/** Hex string form, handy for logs and wire frames. */
export function checksumHex(world: SimWorld): string {
  return checksumWorld(world).toString(16).padStart(8, '0');
}
