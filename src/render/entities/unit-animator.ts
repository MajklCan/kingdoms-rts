/**
 * Render-only unit animation state: which way each unit faces, which anim it
 * plays and which frame. Nothing here is written back to the sim.
 *
 * - Facing follows velocity while moving, else the attack / gather / build
 *   target, else the last known facing.
 * - Combat units play `attack` for a short window after a matching combat
 *   event (longer for cannon / mortar windups), `move` while moving, else
 *   `idle`. Villagers pick harvest / build / carry / move / idle from their
 *   gatherer state.
 * - Frame counts come from the sprite source, so atlas art with more frames
 *   animates without touching this file.
 */

import { hasComponent } from 'bitecs';
import {
  AttackTarget,
  BuildOrder,
  Gatherer,
  GathererStateId,
  Position,
  ResourceCarry,
  UnitKind,
  Velocity,
} from '@sim/components';
import { UnitDefId } from '@sim/defs';
import type { CombatEvent } from '@sim/world';
import { DEFAULT_FACING, facingFromVector, type Facing } from '../sprites/facing';
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

export interface UnitPose {
  facing: Facing;
  anim: string;
  frame: number;
}

export type FrameCountLookup = (unitDefId: number, anim: string) => number;

export class UnitAnimator {
  private readonly facing = new Map<number, Facing>();
  private readonly attackUntilTick = new Map<number, number>();

  constructor(
    private readonly ctx: SceneContext,
    private readonly frameCount: FrameCountLookup
  ) {}

  /** Start (or extend) the attack anim window for the event's attacker. */
  noteCombatEvent(event: CombatEvent): void {
    if (!ANIMATED_ATTACKERS.has(event.attackerKind)) return;
    const isWindup =
      (event.attackerKind === UnitDefId.CANNON || event.attackerKind === UnitDefId.MORTAR) &&
      event.phase === 'windup';
    const animTicks = isWindup
      ? Math.max(COMBAT_ATTACK_ANIM_TICKS, event.windupTicks ?? 0)
      : COMBAT_ATTACK_ANIM_TICKS;
    this.attackUntilTick.set(event.attackerEid, this.ctx.world.tick + animTicks);
  }

  /** Pose for a unit this frame, or null when its kind has no animation set. */
  pose(eid: number): UnitPose | null {
    const kind = UnitKind.kind[eid];
    const moveTicks = MOVE_FRAME_TICKS[kind];
    if (moveTicks === undefined) return null;
    const moving = this.isMoving(eid);
    return kind === UnitDefId.VILLAGER
      ? this.villagerPose(eid, moving, moveTicks)
      : this.combatPose(eid, kind, moving, moveTicks);
  }

  forget(eid: number): void {
    this.facing.delete(eid);
    this.attackUntilTick.delete(eid);
  }

  clear(): void {
    this.facing.clear();
    this.attackUntilTick.clear();
  }

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
