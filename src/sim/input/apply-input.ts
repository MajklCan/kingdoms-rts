/**
 * SimInput dispatch. Every command enters the sim through applyInput().
 */

import { hasComponent } from 'bitecs';
import { DeadTag, Owner, WorksiteWorker } from '../components';
import { LOCAL_PLAYER_ID } from '../core/constants';
import { selectedQuery } from '../core/queries';
import type { SimInput, SimWorld } from '../core/types';
import { applyAdvanceAge, applyResearchTech } from '../systems/age-tech';
import { applyCancelProduction, applyTrainUnit } from '../systems/production';
import {
  applyPlaceBuilding,
  applyRemoveBuildingsCommand,
  applyRemoveSelectedBuildings,
} from './buildings';
import {
  applyAdjustFormationMode,
  applyAdjustFormationModeCommand,
  applyReformFormationCommand,
  applyReformSelectedFormation,
  applyRotateFormationCommand,
  applyRotateSelectedFormation,
  applySetFormationMode,
  applySetFormationModeCommand,
} from './formation';
import {
  applyAttackCommand,
  applyAttackMoveCommand,
  applyAttackMoveSelected,
  applyAttackSelected,
  applyGatherCommand,
  applyGatherSelected,
  applyMoveCommand,
  applyMoveSelected,
  applySetArmyRallyPoint,
  applySetSelectedUnitStance,
  applySetStanceCommand,
  applyStopCommand,
  applyStopSelected,
  applyToggleSelectedUnitStance,
  applyToggleStanceCommand,
} from './unit-orders';

export function applyInput(world: SimWorld, input: SimInput): void {
  switch (input.type) {
    case 'moveSelected':
      applyMoveSelected(world, input.to);
      return;
    case 'gatherSelected':
      applyGatherSelected(world, input.targetEid);
      return;
    case 'stopSelected':
      applyStopSelected(world);
      return;
    case 'toggleSelectedUnitStance':
      applyToggleSelectedUnitStance(world);
      return;
    case 'setSelectedUnitStance':
      applySetSelectedUnitStance(world, input.stance);
      return;
    case 'setFormationMode':
      applySetFormationMode(world, input.mode);
      return;
    case 'adjustFormationMode':
      applyAdjustFormationMode(world, input.delta);
      return;
    case 'rotateSelectedFormation':
      applyRotateSelectedFormation(world, input.delta);
      return;
    case 'reformSelectedFormation':
      applyReformSelectedFormation(world);
      return;
    case 'attackSelected':
      applyAttackSelected(world, input.targetEid);
      return;
    case 'attackMoveSelected':
      applyAttackMoveSelected(world, input.to);
      return;
    case 'cmdMove':
      applyMoveCommand(world, input.playerId, input.eids, input.to);
      return;
    case 'cmdGather':
      applyGatherCommand(world, input.playerId, input.eids, input.targetEid);
      return;
    case 'cmdStop':
      applyStopCommand(world, input.playerId, input.eids);
      return;
    case 'cmdToggleStance':
      applyToggleStanceCommand(world, input.playerId, input.eids);
      return;
    case 'cmdAttack':
      applyAttackCommand(world, input.playerId, input.eids, input.targetEid);
      return;
    case 'cmdAttackMove':
      applyAttackMoveCommand(world, input.playerId, input.eids, input.to);
      return;
    case 'setArmyRallyPoint':
      applySetArmyRallyPoint(world, input.playerId, input.x, input.y);
      return;
    case 'placeBuilding':
      applyPlaceBuilding(world, input.defId, input.x, input.y, input.playerId);
      return;
    case 'removeSelectedBuildings':
      applyRemoveSelectedBuildings(world, input.playerId);
      return;
    case 'cmdRemoveBuildings':
      applyRemoveBuildingsCommand(world, input.playerId, input.eids);
      return;
    case 'cmdSetStance':
      applySetStanceCommand(world, input.playerId, input.eids, input.stance);
      return;
    case 'cmdSetFormationMode':
      applySetFormationModeCommand(world, input.playerId, input.eids, input.mode);
      return;
    case 'cmdAdjustFormationMode':
      applyAdjustFormationModeCommand(world, input.playerId, input.eids, input.delta);
      return;
    case 'cmdRotateFormation':
      applyRotateFormationCommand(world, input.playerId, input.eids, input.delta);
      return;
    case 'cmdReformFormation':
      applyReformFormationCommand(world, input.playerId, input.eids);
      return;
    case 'trainUnit':
      if (input.playerId !== undefined && !ownsCommandTarget(world, input.playerId, input.atEid)) return;
      applyTrainUnit(world, input.atEid, input.defId, input.count);
      return;
    case 'cancelProduction':
      if (input.playerId !== undefined && !ownsCommandTarget(world, input.playerId, input.atEid)) return;
      applyCancelProduction(world, input.atEid, input.slot);
      return;
    case 'advanceAge':
      applyAdvanceAge(world, input.playerId);
      return;
    case 'researchTech':
      applyResearchTech(world, input.playerId, input.techId);
      return;
  }
}

/** Selected entities the local player owns. All command handlers route
 *  through this so the player can't command enemy or gaia units. */
export function commandableSelection(world: SimWorld): number[] {
  const out: number[] = [];
  for (const eid of selectedQuery(world.ecs)) {
    if (hasComponent(world.ecs, WorksiteWorker, eid)) continue;
    if (Owner.player[eid] === LOCAL_PLAYER_ID) out.push(eid);
  }
  return out;
}

/** Validate a network/explicit eid list: keep only live entities the
 *  commanding player owns and that are commandable (not worksite workers, not
 *  dead). This is the trust boundary for commands arriving over the wire - a
 *  peer must not be able to move another player's units. Iteration order
 *  follows the supplied list, then is unused for ordering-sensitive mutations
 *  because callers that care re-sort (e.g. formationDestinations). */
export function ownedCommandableEids(world: SimWorld, playerId: number, eids: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const eid of eids) {
    if (seen.has(eid)) continue;
    seen.add(eid);
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, WorksiteWorker, eid)) continue;
    if (hasComponent(world.ecs, DeadTag, eid)) continue;
    out.push(eid);
  }
  return out;
}

/** Does `playerId` own building/unit `eid`? Trust boundary for commands that
 *  target a single global eid (trainUnit, cancelProduction). */
function ownsCommandTarget(world: SimWorld, playerId: number, eid: number): boolean {
  return hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId;
}
