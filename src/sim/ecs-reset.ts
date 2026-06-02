/**
 * bitECS global-state reset for starting a fresh, cross-client-identical world.
 *
 * bitECS 0.3.40 keeps a PROCESS-GLOBAL entity-id cursor (plus removed/recycled
 * free-lists) and SHARED component typed-array stores. A client that has already
 * built a throwaway world (e.g. the `Date.now()`-seeded menu/background world)
 * has therefore advanced that cursor by an amount that depends on per-client
 * state — so a later `createSimWorld(seed)` would hand out DIFFERENT absolute
 * eids on each client even from the same seed. In lockstep that is fatal: command
 * packets carry raw eids, so `cmdMove`/`trainUnit` would target the wrong entity
 * on a peer and desync the match instantly.
 *
 * Calling {@link resetEcsGlobals} right before building the match world resets the
 * cursor to a known base AND zeroes the shared stores, so every client allocates
 * the SAME absolute eids and starts from the SAME clean memory — exactly the
 * fresh-process state a real second client begins from. This is the same
 * mechanism the in-process desync oracle (`src/net/full-feature-1v1.test.ts`)
 * uses to make its replay a byte-identical clone.
 */

import * as bitecsNs from 'bitecs';
import {
  AttackMoveGoal,
  AttackTarget,
  BuildOrder,
  Building,
  Combat,
  ConstructionSite,
  Cooldown,
  DropOff,
  Gatherer,
  Health,
  MachineGunDeployment,
  Owner,
  PathTarget,
  PopulationCost,
  Position,
  PrevPosition,
  Producer,
  Resource,
  ResourceCarry,
  ResourceWorksite,
  Speed,
  UnitKind,
  UnitStance,
  Velocity,
  WorksiteWorker,
} from './components';

/** bitECS exports `resetGlobals` (resets the process-global entity cursor +
 *  removed/recycled lists) but omits it from its `.d.ts`; reach it through the
 *  namespace. */
const resetBitecsGlobals = (bitecsNs as unknown as { resetGlobals: () => void }).resetGlobals;

/** Every data-bearing component whose shared store must be cleared. Tag
 *  components carry no fields, so their membership is handled by the cursor reset
 *  alone. This mirrors the checksummed set in `checksum.ts` — the determinism-
 *  relevant state — which the desync oracle has proven sufficient for a full
 *  match (combat, deaths, construction included). */
const DATA_COMPONENTS = [
  AttackMoveGoal, AttackTarget, BuildOrder, Building, Combat, ConstructionSite,
  Cooldown, DropOff, Gatherer, Health, MachineGunDeployment, Owner, PathTarget,
  PopulationCost, Position, PrevPosition, Producer, Resource, ResourceCarry,
  ResourceWorksite, Speed, UnitKind, UnitStance, Velocity, WorksiteWorker,
] as const;

/** Reset the bitECS global cursor and zero all shared data stores. Call this
 *  immediately before `createSimWorld(seed)` for a networked match so every
 *  client builds an identical world in an identical eid space. */
export function resetEcsGlobals(): void {
  resetBitecsGlobals();
  for (const comp of DATA_COMPONENTS) {
    for (const key of Object.keys(comp)) {
      const field = (comp as Record<string, unknown>)[key];
      if (ArrayBuffer.isView(field) && typeof (field as { fill?: unknown }).fill === 'function') {
        (field as unknown as { fill: (v: number) => void }).fill(0);
      }
    }
  }
}
