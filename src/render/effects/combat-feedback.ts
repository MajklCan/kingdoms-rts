/**
 * Drains `world.combatEvents` once per frame and fans each event out to the
 * render-side consumers: minimap alert, fire sound + adaptive music, unit
 * attack animation and (for ranged attacks in view) a projectile effect.
 */

import { hasComponent } from 'bitecs';
import { ISO, SIM } from '../../config';
import { Building } from '@sim/components';
import { UnitDefId } from '@sim/defs';
import type { CombatEvent } from '@sim/world';
import type { UnitAnimator } from '../entities/unit-animator';
import type { GameAudio } from '../game-audio';
import type { MinimapAlerts } from '../hud/minimap-data';
import type { SceneContext } from '../scene-context';
import type { EffectsLayer } from './effects-layer';
import { PROJECTILE_EFFECT, type ProjectileKind } from './projectile-effects';

export class CombatFeedback {
  private readonly listeners: Array<(event: CombatEvent) => void> = [];

  constructor(
    private readonly ctx: SceneContext,
    private readonly deps: {
      alerts: MinimapAlerts;
      audio: GameAudio;
      animator: UnitAnimator;
      effects: EffectsLayer;
    }
  ) {}

  /** Extra render-side consumer of every drained combat event (world VFX). */
  onEvent(listener: (event: CombatEvent) => void): void {
    this.listeners.push(listener);
  }

  consume(): void {
    const world = this.ctx.world;
    if (world.combatEvents.length === 0) return;
    const events = world.combatEvents.splice(0);
    for (const event of events) {
      for (const listener of this.listeners) listener(event);
      this.deps.alerts.record(event);
      this.deps.audio.onCombatEvent(event);
      this.deps.animator.noteCombatEvent(event);
      if (isArtilleryWindup(event)) continue;
      if (event.range <= 1) continue;
      if (
        !this.ctx.isTileVisible(event.fromX, event.fromY) &&
        !this.ctx.isTileVisible(event.toX, event.toY)
      ) {
        continue;
      }
      const kind = this.projectileKind(event);
      if (kind) this.spawnProjectile(event, kind);
    }
  }

  private projectileKind(event: CombatEvent): ProjectileKind | null {
    switch (event.attackerKind) {
      case UnitDefId.GUNMAN:
      case UnitDefId.MACHINE_GUN:
        return 'bullet';
      case UnitDefId.CANNON:
        return 'cannon';
      case UnitDefId.MORTAR:
        return 'mortar';
      case UnitDefId.ARCHER:
        return 'arrow';
      default:
        // Towers and town centres shoot arrows.
        return hasComponent(this.ctx.world.ecs, Building, event.attackerEid) ? 'arrow' : null;
    }
  }

  private spawnProjectile(event: CombatEvent, kind: ProjectileKind): void {
    const ecs = this.ctx.world.ecs;
    const attackerIsBuilding = hasComponent(ecs, Building, event.attackerEid);
    let startLift = attackerIsBuilding ? 68 : kind === 'cannon' ? 18 : kind === 'mortar' ? 34 : 28;
    let fromX = event.fromX;
    let fromY = event.fromY;
    // Pre-rendered units: leave from the bow / muzzle of the drawn frame. A
    // screen x offset is a tile shift along (1, -1), which keeps screen y.
    const muzzle = attackerIsBuilding ? null : this.deps.animator.muzzleOffset(event.attackerEid);
    if (muzzle) {
      startLift = -muzzle.dy;
      fromX += muzzle.dx / ISO.TILE_W;
      fromY -= muzzle.dx / ISO.TILE_W;
    }
    const targetLift = hasComponent(ecs, Building, event.targetEid)
      ? 42
      : kind === 'cannon' || kind === 'mortar' ? 16 : 22;
    this.deps.effects.spawn(
      PROJECTILE_EFFECT[kind],
      { x: fromX, y: fromY, lift: startLift },
      {
        to: { x: event.toX, y: event.toY, lift: targetLift },
        durationMs: projectileDurationMs(event, kind),
      }
    );
  }
}

function isArtilleryWindup(event: CombatEvent): boolean {
  return (
    (event.attackerKind === UnitDefId.CANNON || event.attackerKind === UnitDefId.MORTAR) &&
    event.phase === 'windup'
  );
}

/** Sim-provided flight time when present, else a distance-scaled default. */
function projectileDurationMs(event: CombatEvent, kind: ProjectileKind): number {
  const ticks = event.projectileTicks ?? 0;
  if (ticks > 0) return ticks * SIM.TICK_MS;
  const distTiles = Math.hypot(event.fromX - event.toX, event.fromY - event.toY);
  switch (kind) {
    case 'bullet':
      return clamp(distTiles * 24, 70, 160);
    case 'cannon':
      return clamp(distTiles * 72, 240, 620);
    case 'mortar':
      return clamp(distTiles * 95, 300, 760);
    case 'arrow':
      return clamp(distTiles * 70, 180, 520);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
