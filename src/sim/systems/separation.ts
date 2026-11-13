/**
 * Soft unit separation (runs inside the movement system).
 */

import { hasComponent } from 'bitecs';
import { Health, Owner, Position, VillagerTag, WorksiteWorker } from '../components';
import { deterministicEidKey, sortedEids } from '../core/entities';
import { canUnitOccupy } from '../core/grid';
import { unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';

const UNIT_SEPARATION_RADIUS = 0.42;
const WORKER_SEPARATION_RADIUS = 0.58;
const UNIT_SEPARATION_MAX_NUDGE = 0.08;
const WORKER_SEPARATION_MAX_NUDGE = 0.12;
const UNIT_SEPARATION_PASSES = 2;

export function unitSeparationSystem(world: SimWorld): void {
  const ents = sortedEids(world, unitQuery(world.ecs)).filter((eid) => Health.hp[eid] > 0);
  for (let pass = 0; pass < UNIT_SEPARATION_PASSES; pass++) {
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j];
        if (areVillagersMutuallyNonBlocking(world, a, b)) continue;
        const radius = unitSeparationRadius(world, a, b);
        let dx = Position.x[b] - Position.x[a];
        let dy = Position.y[b] - Position.y[a];
        let dist = Math.hypot(dx, dy);
        if (dist >= radius) continue;

        const overlapDist = dist;
        if (dist < 0.001) {
          const angle = deterministicPairAngle(world, a, b);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        } else {
          dx /= dist;
          dy /= dist;
        }

        const push = Math.min(
          unitSeparationMaxNudge(world, a, b),
          (radius - overlapDist) * 0.5
        );
        if (push <= 0) continue;
        const weights = unitSeparationWeights(world, a, b);
        tryNudgeUnit(world, a, -dx * push * weights.a, -dy * push * weights.a);
        tryNudgeUnit(world, b, dx * push * weights.b, dy * push * weights.b);
      }
    }
  }
}

function areVillagersMutuallyNonBlocking(world: SimWorld, a: number, b: number): boolean {
  return hasComponent(world.ecs, VillagerTag, a) && hasComponent(world.ecs, VillagerTag, b);
}

function unitSeparationWeights(world: SimWorld, a: number, b: number): { a: number; b: number } {
  if (Owner.player[a] !== Owner.player[b]) return { a: 0.5, b: 0.5 };

  const aMoving = world.paths.has(a);
  const bMoving = world.paths.has(b);
  if (aMoving && bMoving) return { a: 0.15, b: 0.15 };
  if (aMoving) return { a: 0.15, b: 0.85 };
  if (bMoving) return { a: 0.85, b: 0.15 };
  return { a: 0.5, b: 0.5 };
}

function unitSeparationRadius(world: SimWorld, a: number, b: number): number {
  return isEconomicWorker(world, a) || isEconomicWorker(world, b)
    ? WORKER_SEPARATION_RADIUS
    : UNIT_SEPARATION_RADIUS;
}

function unitSeparationMaxNudge(world: SimWorld, a: number, b: number): number {
  return isEconomicWorker(world, a) || isEconomicWorker(world, b)
    ? WORKER_SEPARATION_MAX_NUDGE
    : UNIT_SEPARATION_MAX_NUDGE;
}

export function isEconomicWorker(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, WorksiteWorker, eid) ||
    hasComponent(world.ecs, VillagerTag, eid);
}

export function deterministicPairAngle(world: SimWorld, a: number, b: number): number {
  const ak = deterministicEidKey(world, a);
  const bk = deterministicEidKey(world, b);
  const hash = Math.imul(ak + 1, 73856093) ^ Math.imul(bk + 1, 19349663);
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function tryNudgeUnit(world: SimWorld, eid: number, dx: number, dy: number): void {
  const nx = Position.x[eid] + dx;
  const ny = Position.y[eid] + dy;
  if (!canUnitOccupy(world, nx, ny)) return;
  Position.x[eid] = nx;
  Position.y[eid] = ny;
}
