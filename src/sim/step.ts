/**
 * One fixed simulation tick. System order here IS the determinism contract.
 */

import { aiSystem } from './ai/brain';
import type { SimWorld } from './core/types';
import { applyInput } from './input/apply-input';
import { campaignSystem } from './missions/campaign-world';
import { ageProgressionSystem } from './systems/age-tech';
import { combatSystem } from './systems/combat';
import { constructionSystem } from './systems/construction';
import { cleanupSystem, deathSystem } from './systems/death';
import { dropoffSystem } from './systems/dropoff';
import { forestRegrowthSystem } from './systems/forest-regrowth';
import { gatheringSystem } from './systems/gathering';
import { movementSystem } from './systems/movement';
import { productionSystem } from './systems/production';
import { cannonImpactSystem, projectileImpactSystem } from './systems/projectiles';
import { targetingSystem } from './systems/targeting';
import { visibilitySystem } from './systems/visibility';
import { winConditionSystem } from './systems/win-condition';
import { resourceWorksiteSystem } from './systems/worksites';

/**
 * Advance the sim by one fixed tick. Inputs queued since the last tick are applied first,
 * then the gatherer state machine ticks, then movement applies any pending paths.
 *
 * Pure relative to the SimWorld it receives — same world + same inputs → same next state.
 */
export function step(world: SimWorld): void {
  if (world.paused) {
    // Inputs collected while paused are deferred until unpause.
    return;
  }
  if (world.outcome.state !== 'playing') {
    world.inputs.length = 0;
    return;
  }

  // 00 — refresh vision before commands; tests and debug tools can reposition
  // entities directly between ticks.
  visibilitySystem(world);

  // 01 — drain inputs.
  for (const input of world.inputs) {
    applyInput(world, input);
  }
  world.inputs.length = 0;

  // 10 — AI brain tick (player 2 only for now). Throttled inside.
  aiSystem(world);

  // 20 — age progression (one tick of any in-flight advances).
  ageProgressionSystem(world);

  // 21 — production tick (TC / Barracks queues).
  productionSystem(world);

  // 22 — construction tick (foundations gain progress from adjacent builders).
  constructionSystem(world);

  // 23 — assign workers and convert nearby resource nodes into income.
  resourceWorksiteSystem(world);

  // 40 — gatherer state machine.
  gatheringSystem(world);

  // 41 — credit player banks for any RETURNING villager that just reached drop-off.
  dropoffSystem(world);

  // 50 — auto-acquire targets via aggro radius.
  targetingSystem(world);

  // 51 — combat: in-range attackers fire, ticked-down cooldowns reset.
  combatSystem(world);

  // 52 — projectiles resolve damage only when their visual projectile lands.
  projectileImpactSystem(world);
  cannonImpactSystem(world);

  // 70 — death: hp<=0 entities flagged.
  deathSystem(world);

  // 71 — cleanup: remove flagged entities + decrement pop / cap.
  cleanupSystem(world);

  // 72 — campaign objectives and scripted defensive reinforcement.
  campaignSystem(world);

  // 72 — slow forest regrowth on empty grass near existing trees.
  forestRegrowthSystem(world);

  // 31 — movement.
  movementSystem(world);

  // 73 — rebuild local player vision after movement resolves.
  visibilitySystem(world);

  // 80 — win condition check.
  winConditionSystem(world);

  world.tick += 1;
}
