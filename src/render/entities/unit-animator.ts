/**
 * Render-only unit animation state: which way each unit faces, which anim it
 * plays and which frame. Nothing here is written back to the sim.
 *
 * - Facing follows velocity while moving, else the attack / gather / build
 *   target, else the last known facing.
 * - Pre-rendered (atlas) units are timed from their art: walks advance with
 *   the distance actually travelled (feet do not skate), idles and work loops
 *   run on time with a per-unit phase, and attacks are lined up so the art's
 *   hit frame lands on the sim tick that deals the damage: the swing starts
 *   early from the attacker's cooldown, the follow-through plays after the
 *   combat event, and cannons aim through the sim's windup.
 * - Voxel units keep the older tick-driven scheme: `attack` for a short
 *   window after a combat event, `move` while moving, else `idle`.
 * - Frame counts come from the sprite source, so art with more frames
 *   animates without touching this file.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  AttackTarget,
  BuildOrder,
  Building,
  Combat,
  Cooldown,
  Gatherer,
  GathererStateId,
  Health,
  Position,
  Resource,
  ResourceCarry,
  ResourceKindId,
  UnitKind,
  Velocity,
} from '@sim/components';
import { UnitDefId } from '@sim/defs';
import type { CombatEvent } from '@sim/world';
import { DEFAULT_FACING, facingFromVector, type Facing } from '../sprites/facing';
import type { UnitAnimInfo, UnitArtInfo } from '../sprites/sprite-source';
import type { SceneContext } from '../scene-context';

/** Length of the attack anim window after a combat event, in sim ticks. */
export const COMBAT_ATTACK_ANIM_TICKS = 10;

/** Sim ticks per walk-cycle frame, per unit kind. Kinds absent here are not animated. */
const MOVE_FRAME_TICKS: Readonly<Partial<Record<number, number>>> = {
  [UnitDefId.VILLAGER]: 6,
  [UnitDefId.ARCHER]: 6,
  [UnitDefId.SPEARMAN]: 6,
  [UnitDefId.SCOUT_CAVALRY]: 5,
  [UnitDefId.GUNMAN]: 6,
  [UnitDefId.CANNON]: 8,
  [UnitDefId.MACHINE_GUN]: 7,
  [UnitDefId.MORTAR]: 8,
};

/** Sim ticks per frame of the villager harvest / build loops. */
const VILLAGER_WORK_FRAME_TICKS = 5;

/** Attacker kinds that have an attack animation. */
const ANIMATED_ATTACKERS: ReadonlySet<number> = new Set([
  UnitDefId.SCOUT_CAVALRY,
  UnitDefId.ARCHER,
  UnitDefId.SPEARMAN,
  UnitDefId.GUNMAN,
  UnitDefId.CANNON,
  UnitDefId.MACHINE_GUN,
  UnitDefId.MORTAR,
]);

/** Carry anim per carried resource kind (atlas art). */
const CARRY_ANIM: Readonly<Record<number, string>> = {
  [ResourceKindId.FOOD]: 'carry_food',
  [ResourceKindId.WOOD]: 'carry_wood',
  [ResourceKindId.GOLD]: 'carry_gold',
  [ResourceKindId.STONE]: 'carry_stone',
};

/** A walk step longer than this (tiles per frame) is a teleport, not a stride. */
const MAX_STEP = 1.5;
/** Extra reach (tiles) on top of the attack range when guessing "in range". */
const RANGE_SLACK = 0.75;

export interface UnitPose {
  facing: Facing;
  anim: string;
  frame: number;
}

export type FrameCountLookup = (unitDefId: number, anim: string) => number;
export type UnitArtLookup = (unitDefId: number) => UnitArtInfo | null;

interface WalkState {
  x: number;
  y: number;
  /** Tiles walked so far (drives the walk cycle). */
  dist: number;
}

export class UnitAnimator {
  private readonly facing = new Map<number, Facing>();
  private readonly attackUntilTick = new Map<number, number>();
  /** Atlas units: sim-time ms of the last hit / shot, and of a pending artillery shot. */
  private readonly lastHitMs = new Map<number, number>();
  private readonly windupEndMs = new Map<number, number>();
  private readonly walk = new Map<number, WalkState>();

  constructor(
    private readonly ctx: SceneContext,
    private readonly frameCount: FrameCountLookup,
    private readonly art: UnitArtLookup = () => null
  ) {}

  /** Start (or extend) the attack anim of the event's attacker. */
  noteCombatEvent(event: CombatEvent): void {
    const eventMs = (event.tick + 1) * SIM.TICK_MS;
    if (this.art(event.attackerKind)) {
      if (event.phase === 'windup') {
        this.windupEndMs.set(event.attackerEid, eventMs + (event.windupTicks ?? 0) * SIM.TICK_MS);
      } else {
        this.lastHitMs.set(event.attackerEid, eventMs);
        this.windupEndMs.delete(event.attackerEid);
      }
      return;
    }
    if (!ANIMATED_ATTACKERS.has(event.attackerKind)) return;
    const isWindup =
      (event.attackerKind === UnitDefId.CANNON || event.attackerKind === UnitDefId.MORTAR) &&
      event.phase === 'windup';
    const animTicks = isWindup
      ? Math.max(COMBAT_ATTACK_ANIM_TICKS, event.windupTicks ?? 0)
      : COMBAT_ATTACK_ANIM_TICKS;
    this.attackUntilTick.set(event.attackerEid, this.ctx.world.tick + animTicks);
  }

  /**
   * Pose for a unit this frame, or null when its kind has no animation set.
   * `x` / `y` are the unit's interpolated tile position this frame (walk cycles
   * of atlas units advance with the distance between calls).
   */
  pose(eid: number, x?: number, y?: number): UnitPose | null {
    const kind = UnitKind.kind[eid];
    const art = this.art(kind);
    const moving = this.isMoving(eid);
    if (art) return this.atlasPose(eid, kind, art, moving, x, y);
    const moveTicks = MOVE_FRAME_TICKS[kind];
    if (moveTicks === undefined) return null;
    return kind === UnitDefId.VILLAGER
      ? this.villagerPose(eid, moving, moveTicks)
      : this.combatPose(eid, kind, moving, moveTicks);
  }

  /** Last facing a unit was drawn with. */
  facingOf(eid: number): Facing {
    return this.facing.get(eid) ?? DEFAULT_FACING;
  }

  /**
   * Screen offset from a unit's feet where its shots leave (bow, muzzle), for
   * its current facing; null when the art has no such point.
   */
  muzzleOffset(eid: number): { dx: number; dy: number } | null {
    return this.art(UnitKind.kind[eid])?.projectile(this.facingOf(eid)) ?? null;
  }

  forget(eid: number): void {
    this.facing.delete(eid);
    this.attackUntilTick.delete(eid);
    this.lastHitMs.delete(eid);
    this.windupEndMs.delete(eid);
    this.walk.delete(eid);
  }

  clear(): void {
    this.facing.clear();
    this.attackUntilTick.clear();
    this.lastHitMs.clear();
    this.windupEndMs.clear();
    this.walk.clear();
  }

  // -- atlas units ---------------------------------------------------------------

  private atlasPose(
    eid: number,
    kind: number,
    art: UnitArtInfo,
    moving: boolean,
    x: number | undefined,
    y: number | undefined
  ): UnitPose {
    const now = this.simTimeMs();
    const villager = kind === UnitDefId.VILLAGER;
    const facing = villager ? this.villagerFacing(eid, moving) : this.combatFacing(eid, moving);
    const walked = this.trackWalk(eid, x, y);
    const attack = art.anim('attack');
    const attackFrame = attack ? this.attackFrame(eid, attack, moving, now) : -1;
    if (attackFrame >= 0) return { facing, anim: 'attack', frame: attackFrame };
    const anim = villager ? this.villagerAtlasAnim(eid, moving, art) : moving ? 'move' : 'idle';
    const info = art.anim(anim) ?? art.anim('idle');
    if (!info) return { facing, anim, frame: 0 };
    let frame: number;
    if (info.stride > 0) {
      frame = Math.floor((walked / info.stride) * info.frames) % info.frames;
    } else {
      // Per-unit phase so a crowd does not breathe or chop in lockstep.
      const phase = (eid * 7) % info.frames;
      frame = (Math.floor(now / info.ms) + phase) % info.frames;
    }
    return { facing, anim, frame };
  }

  /** Attack frame for this instant, or -1 when the unit is not mid-attack. */
  private attackFrame(eid: number, a: UnitAnimInfo, moving: boolean, now: number): number {
    const hit = Math.max(0, a.hit);
    // Follow-through after the blow / shot.
    const last = this.lastHitMs.get(eid);
    if (last !== undefined) {
      const since = now - last;
      if (since >= 0 && since < (a.frames - hit) * a.ms) return hit + Math.floor(since / a.ms);
    }
    // Artillery: aim through the sim's windup, the fire frame lands on the shot.
    const windupEnd = this.windupEndMs.get(eid);
    if (windupEnd !== undefined) {
      const to = windupEnd - now;
      if (to > -SIM.TICK_MS * 2) return clampFrame(hit - Math.ceil(Math.max(0, to) / a.ms), hit);
      this.windupEndMs.delete(eid);
    }
    // Wind-up before a blow the cooldown says is coming.
    if (moving || hit === 0 || !this.engaged(eid)) return -1;
    const ticks = Math.max(1, hasComponent(this.ctx.world.ecs, Cooldown, eid) ? Cooldown.ticksRemaining[eid] : 1);
    const to = (this.ctx.world.tick + ticks) * SIM.TICK_MS - now;
    if (to <= 0 || to > hit * a.ms) return -1;
    return clampFrame(hit - Math.ceil(to / a.ms), hit);
  }

  /** Has a live target in (roughly) attack range. */
  private engaged(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    if (!hasComponent(ecs, AttackTarget, eid) || !hasComponent(ecs, Combat, eid)) return false;
    const target = AttackTarget.targetEid[eid];
    if (target < 0 || !hasComponent(ecs, Position, target)) return false;
    if (hasComponent(ecs, Health, target) && Health.hp[target] <= 0) return false;
    if (hasComponent(ecs, Building, target)) return true; // edge distance: trust "standing still"
    const d = Math.hypot(Position.x[target] - Position.x[eid], Position.y[target] - Position.y[eid]);
    return d <= Combat.range[eid] + RANGE_SLACK;
  }

  private villagerAtlasAnim(eid: number, moving: boolean, art: UnitArtInfo): string {
    const ecs = this.ctx.world.ecs;
    const carryAmt = hasComponent(ecs, ResourceCarry, eid) ? ResourceCarry.amount[eid] : 0;
    const carry = carryAmt > 0 ? CARRY_ANIM[ResourceCarry.kind[eid]] ?? 'carry' : 'carry';
    if (hasComponent(ecs, Gatherer, eid)) {
      const state = Gatherer.state[eid];
      if (state === GathererStateId.GATHERING) {
        const work = this.workAnim(Gatherer.targetEid[eid]);
        return art.anim(work) ? work : 'harvest';
      }
      if (state === GathererStateId.BUILDING) return 'build';
      if ((moving || state === GathererStateId.DEPOSITING) && carryAmt > 0) return carry;
    }
    return moving ? 'move' : 'idle';
  }

  /** Work loop for a gather target: chop trees, mine rock, hoe farms, pick berries. */
  private workAnim(target: number): string {
    const ecs = this.ctx.world.ecs;
    if (target < 0 || !hasComponent(ecs, Resource, target)) return 'harvest';
    switch (Resource.kind[target]) {
      case ResourceKindId.WOOD:
        return 'chop';
      case ResourceKindId.GOLD:
      case ResourceKindId.STONE:
        return 'mine';
      default:
        return hasComponent(ecs, Building, target) ? 'farm' : 'forage';
    }
  }

  /** Accumulate the distance walked since the last frame (tiles). */
  private trackWalk(eid: number, x: number | undefined, y: number | undefined): number {
    const px = x ?? Position.x[eid];
    const py = y ?? Position.y[eid];
    const w = this.walk.get(eid);
    if (!w) {
      // Start mid-stride at a per-unit offset so a formation does not march in step.
      const state = { x: px, y: py, dist: ((eid * 0.37) % 1) * 2 };
      this.walk.set(eid, state);
      return state.dist;
    }
    const step = Math.hypot(px - w.x, py - w.y);
    if (step < MAX_STEP) w.dist += step;
    w.x = px;
    w.y = py;
    return w.dist;
  }

  /** Sim time of what is on screen (interpolated), ms. */
  private simTimeMs(): number {
    const alpha = Math.min(1, this.ctx.accumulatorMs / SIM.TICK_MS);
    return (this.ctx.world.tick + alpha) * SIM.TICK_MS;
  }

  // -- voxel units (tick driven) -----------------------------------------------------

  private villagerPose(eid: number, moving: boolean, moveTicks: number): UnitPose {
    const facing = this.villagerFacing(eid, moving);
    const anim = this.villagerAnim(eid, moving);
    const tick = this.ctx.world.tick;
    let frame = 0;
    if (anim === 'move' || anim === 'carry') {
      frame = cycleFrame(tick, moveTicks, this.frameCount(UnitDefId.VILLAGER, anim));
    } else if (anim === 'harvest' || anim === 'build') {
      frame = cycleFrame(tick, VILLAGER_WORK_FRAME_TICKS, this.frameCount(UnitDefId.VILLAGER, anim));
    }
    return { facing, anim, frame };
  }

  private combatPose(eid: number, kind: number, moving: boolean, moveTicks: number): UnitPose {
    const facing = this.combatFacing(eid, moving);
    const tick = this.ctx.world.tick;
    const attackUntil = this.attackUntilTick.get(eid) ?? -1;
    const anim = attackUntil > tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = cycleFrame(tick, moveTicks, this.frameCount(kind, 'move'));
    } else if (anim === 'attack') {
      // Frames spread evenly over the anim window. Long windups (mortar) start
      // before the window, so the age is negative there: hold frame 0.
      const count = this.frameCount(kind, 'attack');
      const age = COMBAT_ATTACK_ANIM_TICKS - (attackUntil - tick);
      const raw = Math.floor(age / Math.max(1, COMBAT_ATTACK_ANIM_TICKS / Math.max(1, count)));
      frame = Math.max(0, Math.min(count - 1, raw));
    }
    return { facing, anim, frame };
  }

  private villagerAnim(eid: number, moving: boolean): string {
    const ecs = this.ctx.world.ecs;
    const carryAmt = hasComponent(ecs, ResourceCarry, eid) ? ResourceCarry.amount[eid] : 0;
    if (hasComponent(ecs, Gatherer, eid)) {
      const state = Gatherer.state[eid];
      if (state === GathererStateId.GATHERING) return 'harvest';
      if (state === GathererStateId.BUILDING) return 'build';
      if (moving && carryAmt > 0) return 'carry';
      if (state === GathererStateId.DEPOSITING && carryAmt > 0) return 'carry';
    }
    return moving ? 'move' : 'idle';
  }

  private villagerFacing(eid: number, moving: boolean): Facing {
    const ecs = this.ctx.world.ecs;
    let dx = 0;
    let dy = 0;
    if (moving) {
      dx = Velocity.x[eid];
      dy = Velocity.y[eid];
    } else if (hasComponent(ecs, Gatherer, eid)) {
      const gatherTarget = Gatherer.targetEid[eid];
      if (gatherTarget >= 0 && hasComponent(ecs, Position, gatherTarget)) {
        dx = Position.x[gatherTarget] - Position.x[eid];
        dy = Position.y[gatherTarget] - Position.y[eid];
      }
    }
    if (
      Math.hypot(dx, dy) <= 0.01 &&
      hasComponent(ecs, BuildOrder, eid) &&
      BuildOrder.targetEid[eid] >= 0 &&
      hasComponent(ecs, Position, BuildOrder.targetEid[eid])
    ) {
      const target = BuildOrder.targetEid[eid];
      dx = Position.x[target] - Position.x[eid];
      dy = Position.y[target] - Position.y[eid];
    }
    return this.rememberFacing(eid, dx, dy);
  }

  private combatFacing(eid: number, moving: boolean): Facing {
    const ecs = this.ctx.world.ecs;
    let dx = 0;
    let dy = 0;
    if (moving) {
      dx = Velocity.x[eid];
      dy = Velocity.y[eid];
    } else if (hasComponent(ecs, AttackTarget, eid) && AttackTarget.targetEid[eid] >= 0) {
      const target = AttackTarget.targetEid[eid];
      if (hasComponent(ecs, Position, target)) {
        dx = Position.x[target] - Position.x[eid];
        dy = Position.y[target] - Position.y[eid];
      }
    }
    return this.rememberFacing(eid, dx, dy);
  }

  private rememberFacing(eid: number, dx: number, dy: number): Facing {
    if (Math.hypot(dx, dy) > 0.01) {
      const facing = facingFromVector(dx, dy);
      this.facing.set(eid, facing);
      return facing;
    }
    return this.facing.get(eid) ?? DEFAULT_FACING;
  }

  private isMoving(eid: number): boolean {
    if (!hasComponent(this.ctx.world.ecs, Velocity, eid)) return false;
    return Math.hypot(Velocity.x[eid], Velocity.y[eid]) > 0.05;
  }
}

function cycleFrame(tick: number, ticksPerFrame: number, count: number): number {
  return count > 0 ? Math.floor(tick / ticksPerFrame) % count : 0;
}

/** Wind-up frame in [0, hit - 1]. */
function clampFrame(frame: number, hit: number): number {
  return Math.max(0, Math.min(Math.max(0, hit - 1), frame));
}
