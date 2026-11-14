/**
 * The scope one AI think runs in: whose turn it is, at which difficulty, and
 * how its decisions reach the world.
 *
 * In the sim the AI acts directly (the direct actuator below: spend, spawn
 * foundations, write orders). A headless harness can run the same brain as a
 * "player" that only issues SimInput commands, which then travel the real
 * multiplayer path; it passes its own actuator (see scripts/sim). The scope is
 * synchronous and set for exactly one think, so it cannot leak across ticks.
 */

import type { GridPos } from '../pathfinding';
import type { TechIdValue } from '../tech-tree';
import type { AiDifficulty, SimWorld } from '../core/types';

/** Every world mutation the AI brain makes goes through one of these. */
export interface AiActuator {
  /** Queue `defId` at `atEid` (already validated and affordable): spend + push. */
  commitQueueUnit(world: SimWorld, atEid: number, defId: number): void;
  /** Place a foundation at a validated, affordable spot. */
  commitPlaceBuilding(world: SimWorld, defId: number, x: number, y: number, playerId: number): void;
  /** True when this actuator wants a spot skipped (it already claimed it this think). */
  isSpotClaimed(defId: number, x: number, y: number): boolean;
  /** Research `techId`; true when it was (or will be) researched. */
  researchTech(world: SimWorld, playerId: number, techId: TechIdValue): boolean;
  /** Start the next age; true when the advance started (or was ordered). */
  advanceAge(world: SimWorld, playerId: number): boolean;
  /** Walk `eid` to `to`, dropping its fight and work. */
  move(world: SimWorld, eid: number, to: GridPos): void;
  /** Attack-move `eid` to `to`; false when it cannot get there. */
  attackMove(world: SimWorld, eid: number, to: GridPos): boolean;
  /** Attack `target` with `eid` (validated by the caller). */
  attack(world: SimWorld, eid: number, target: number, inRange: boolean): void;
  /** Player-facing AI message (render only). */
  event(world: SimWorld, playerId: number, message: string): void;
}

export interface AiThinkScope {
  playerId: number;
  difficulty: AiDifficulty;
  actuator: AiActuator;
  /** Gold and stone held back for the next age-up; army training may not
   *  spend below it. Set by the brain each think. */
  reserve?: { gold: number; stone: number } | null;
}

let current: AiThinkScope | null = null;

/** Run `fn` as `scope`'s think. Nested scopes restore the outer one. */
export function withAiThinkScope<T>(scope: AiThinkScope, fn: () => T): T {
  const previous = current;
  current = scope;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** The scope of the think in progress, or null outside one. */
export function currentAiThinkScope(): AiThinkScope | null {
  return current;
}
