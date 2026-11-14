/**
 * The in-sim AI actuator: decisions mutate the world right away. This is the
 * behaviour single-player has always had.
 */

import { hasComponent } from 'bitecs';
import { AttackMoveGoal, AttackTarget, Owner } from '../components';
import { getBuildingDef, getUnitDef, spend } from '../defs';
import { hasTech } from '../tech-tree';
import { pushAiEvent } from '../core/events';
import { pathTo, pathToAttackTarget } from '../core/navigation';
import { spawnFoundation } from '../factories/buildings';
import { isMovableEntity } from '../input/formation';
import { clearCombatOrders, clearFormationSpeedCap, clearWorkOrders } from '../input/unit-orders';
import { applyAdvanceAge, applyResearchTech } from '../systems/age-tech';
import { type AiActuator, currentAiThinkScope } from './context';

export const directAiActuator: AiActuator = {
  commitQueueUnit(world, atEid, defId) {
    const unitDef = getUnitDef(defId);
    const bank = world.resources[Owner.player[atEid]];
    if (!unitDef || !bank) return;
    spend(bank, unitDef.cost);
    const queue = world.productionQueues.get(atEid) ?? [];
    queue.push(defId);
    world.productionQueues.set(atEid, queue);
  },
  commitPlaceBuilding(world, defId, x, y, playerId) {
    const def = getBuildingDef(defId);
    const bank = world.resources[playerId];
    if (!def || !bank) return;
    spend(bank, def.cost);
    spawnFoundation(world, defId, x, y, playerId);
  },
  isSpotClaimed() {
    return false;
  },
  researchTech(world, playerId, techId) {
    applyResearchTech(world, playerId, techId);
    return hasTech(world, playerId, techId);
  },
  advanceAge(world, playerId) {
    const age = world.ages[playerId];
    if (!age) return false;
    const before = age.progress;
    applyAdvanceAge(world, playerId);
    return before < 0 && age.progress >= 0;
  },
  move(world, eid, to) {
    if (!isMovableEntity(world, eid)) return;
    if (!pathTo(world, eid, to.x, to.y)) return;
    clearCombatOrders(world, eid);
    clearWorkOrders(world, eid);
  },
  attackMove(world, eid, to) {
    if (!isMovableEntity(world, eid)) return false;
    if (!pathTo(world, eid, to.x, to.y)) return false;
    AttackTarget.targetEid[eid] = -1;
    AttackTarget.retainGoal[eid] = 0;
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
      AttackMoveGoal.active[eid] = 1;
      AttackMoveGoal.x[eid] = to.x;
      AttackMoveGoal.y[eid] = to.y;
    }
    clearWorkOrders(world, eid);
    clearFormationSpeedCap(world, eid);
    return true;
  },
  attack(world, eid, target, inRange) {
    if (!inRange && !(isMovableEntity(world, eid) && pathToAttackTarget(world, eid, target))) return;
    AttackTarget.targetEid[eid] = target;
    AttackTarget.retainGoal[eid] = 1;
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) AttackMoveGoal.active[eid] = 0;
    if (inRange) world.paths.delete(eid);
    clearWorkOrders(world, eid);
    clearFormationSpeedCap(world, eid);
  },
  event(world, playerId, message) {
    pushAiEvent(world, playerId, message);
  },
};

/** The actuator of the think in progress; the direct one outside a scope. */
export function activeAiActuator(): AiActuator {
  return currentAiThinkScope()?.actuator ?? directAiActuator;
}
