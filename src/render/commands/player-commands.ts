/**
 * Player intents that need validation + feedback before they become sim
 * inputs: training, cancelling, research / age advance, stances, formations,
 * demolition and building placement checks. Every command leaves through
 * {@link dispatchCommand}; refusals are reported as typed failures through
 * {@link CommandFeedback} so the HUD can say exactly what was missing.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  Owner,
  Producer,
  ResourceWorksite,
  UnitKind,
  UnitStance,
  UnitStanceId,
  type UnitStanceValue,
} from '@sim/components';
import { BUILDING_TABLE, BuildingDefId, UNIT_TABLE, UnitDefId, getBuildingDef, type CostTuple } from '@sim/defs';
import { isBuildingUnlocked, isUnitUnlocked, techDef, techStatus, type TechIdValue } from '@sim/tech-tree';
import {
  canPlaceBuildingAt,
  getWorksiteWorkerSlots,
  selectedCommandableEids,
  selectedQuery,
  worksiteUsesResourceNodes,
  type SimInput,
} from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import { ERROR as SFX_ERROR } from '../audio/sound-map';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import { isInsideMap } from '../world-projection';
import { dispatchCommand } from './command-dispatch';
import {
  RESOURCE_NAMES,
  describeFailure,
  type CommandFailure,
  type CommandFeedback,
  type ResourceName,
} from './feedback';
import {
  affordableCountForCost,
  canAffordCost,
  nextAgeTechId,
  populationRoomForUnitCount,
} from './economy';

/** Shift-click on a train button queues up to this many. */
export const TRAIN_BATCH_COUNT = 5;

const FORMATION_FACING_LABELS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

export class PlayerCommands {
  private feedback: CommandFeedback | null = null;

  constructor(
    private readonly ctx: SceneContext,
    private readonly audio: GameAudio
  ) {}

  /** Where refusals and confirmations go (wired by the UI API). */
  setFeedback(feedback: CommandFeedback): void {
    this.feedback = feedback;
  }

  dispatch(input: SimInput): void {
    dispatchCommand(this.ctx, input);
  }

  /** Own selected units an order would move (buildings and worksite crews excluded). */
  selectedCommandableCount(): number {
    const ecs = this.ctx.world.ecs;
    return selectedCommandableEids(this.ctx.world, this.ctx.perspectivePlayerId).filter((eid) =>
      hasComponent(ecs, UnitKind, eid)
    ).length;
  }

  /** Report a refused command: error sound + typed notice for the HUD. */
  fail(failure: CommandFailure): void {
    setLastEvent(describeFailure(failure));
    if (this.feedback) this.feedback.fail(failure);
    else this.audio.playUi(SFX_ERROR);
  }

  /** A short player-facing confirmation for the event log. */
  confirm(text: string): void {
    setLastEvent(text);
    this.feedback?.info(text);
  }

  /** Which resources the perspective player is short of for `count` x `cost`. */
  missingResources(cost: CostTuple, count = 1): ResourceName[] {
    const bank = this.ctx.world.resources[this.ctx.perspectivePlayerId];
    const need = [cost.food, cost.wood, cost.gold, cost.stone];
    return RESOURCE_NAMES.filter((_, i) => (need[i] ?? 0) * count > (bank?.[i] ?? 0));
  }

  // ── Production queue ──────────────────────────────────────────────────────

  /** Cancel queue slot `slot` (0 = training now; omitted = last queued). */
  cancelProduction(producerEid: number, slot?: number): boolean {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    if (!hasComponent(world.ecs, Producer, producerEid)) return false;
    if (!hasComponent(world.ecs, Owner, producerEid) || Owner.player[producerEid] !== playerId) return false;
    const queue = world.productionQueues.get(producerEid) ?? [];
    const index = slot ?? queue.length - 1;
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) return false;
    const unitName = UNIT_TABLE[queue[index]]?.name ?? 'Unit';
    this.dispatch({ type: 'cancelProduction', atEid: producerEid, playerId, slot: index });
    this.confirm(`${unitName} cancelled, cost refunded`);
    return true;
  }

  // ── Placement ─────────────────────────────────────────────────────────────

  /** Why `defId` cannot be placed at tile (tx, ty) right now, or null if it can. */
  placementFailure(defId: number, tx: number, ty: number): CommandFailure | null {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    const def = getBuildingDef(defId);
    if (!def) return { reason: 'unavailable', text: 'Unknown building' };
    if (!isInsideMap(tx, ty)) return { reason: 'placement', subject: def.name, detail: 'outside-map' };
    if (!isBuildingUnlocked(world, playerId, defId)) return { reason: 'locked', subject: def.name };
    const missing = this.missingResources(def.cost);
    if (missing.length > 0) return { reason: 'resources', subject: def.name, missing };
    if (!canPlaceBuildingAt(world, def, tx, ty)) {
      const footprintFree = canPlaceBuildingAt(world, { ...def, harvestKind: undefined }, tx, ty);
      const needsResource = worksiteUsesResourceNodes(def) && footprintFree;
      return { reason: 'placement', subject: def.name, detail: needsResource ? 'needs-resource' : 'blocked' };
    }
    return null;
  }

  // ── Production ────────────────────────────────────────────────────────────

  /** Q (slot 0) / E (slot 1): train from the first selected own producer. */
  trainHotkey(slot = 0, quiet = false): boolean {
    const world = this.ctx.world;
    for (const eid of selectedQuery(world.ecs)) {
      if (!hasComponent(world.ecs, Producer, eid)) continue;
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      const buildingDef = BUILDING_TABLE[Building.defId[eid]];
      if (hasComponent(world.ecs, ResourceWorksite, eid)) {
        if (slot === 0) {
          this.trainAtSelectedProducer(UnitDefId.VILLAGER);
          return true;
        }
        if (!quiet) this.fail({ reason: 'unavailable', text: 'Nothing to train in that slot' });
        return false;
      }
      const trainIds = buildingDef?.trains ?? [];
      if (trainIds.length === 0) {
        if (!quiet) this.fail({ reason: 'unavailable', text: `${buildingDef?.name ?? 'This building'} trains nothing` });
        return false;
      }
      const idStr = trainIds[slot];
      if (!idStr) {
        if (!quiet) this.fail({ reason: 'unavailable', text: 'Nothing to train in that slot' });
        return false;
      }
      const unitDefId = UNIT_TABLE.findIndex((u) => u.id === idStr);
      if (unitDefId < 0) return false;
      const unitDef = UNIT_TABLE[unitDefId];
      if (!unitDef) return false;
      if (!isUnitUnlocked(world, this.ctx.perspectivePlayerId, unitDefId)) {
        if (!quiet) this.fail({ reason: 'locked', subject: unitDef.name });
        return false;
      }
      this.trainAtSelectedProducer(unitDefId);
      return true;
    }
    if (!quiet) this.fail({ reason: 'unavailable', text: 'Select a building that trains units first' });
    return false;
  }

  /** E: second train slot if the selection has one, else advance age. */
  secondaryHotkey(): void {
    if (this.trainHotkey(1, true)) return;
    this.advanceAge();
  }

  trainAtSelectedProducer(unitDefId: number, requestedCount = 1): void {
    const world = this.ctx.world;
    const unitDef = UNIT_TABLE[unitDefId];
    if (!unitDef) return;
    const numericCount = Number.isFinite(requestedCount) ? requestedCount : 1;
    const targetCount = Math.max(1, Math.min(TRAIN_BATCH_COUNT, Math.trunc(numericCount)));
    for (const eid of selectedQuery(world.ecs)) {
      if (!hasComponent(world.ecs, Producer, eid)) continue;
      if (!hasComponent(world.ecs, Building, eid)) continue;
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      const playerId = Owner.player[eid];
      const buildingDef = BUILDING_TABLE[Building.defId[eid]];
      if (unitDefId === UnitDefId.VILLAGER && hasComponent(world.ecs, ResourceWorksite, eid)) {
        const siteName = buildingDef?.name ?? 'Worksite';
        const queue = world.productionQueues.get(eid) ?? [];
        const queuedWorkers = queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
        const slots = getWorksiteWorkerSlots(world, eid);
        const slotRoom = slots - ResourceWorksite.assignedWorkers[eid] - queuedWorkers;
        if (slotRoom <= 0) {
          this.fail({ reason: 'unavailable', text: `${siteName} has no free worker slots` });
          return;
        }
        const queueRoom = Math.max(0, 2 - queue.length);
        if (queueRoom <= 0) {
          this.fail({ reason: 'queue-full', subject: siteName });
          return;
        }
        const affordable = affordableCountForCost(world, playerId, unitDef.cost, targetCount);
        if (affordable <= 0) {
          this.fail({ reason: 'resources', subject: 'a worker', missing: this.missingResources(unitDef.cost) });
          return;
        }
        const trainCount = Math.min(targetCount, slotRoom, queueRoom, affordable);
        this.dispatch({
          type: 'trainUnit',
          atEid: eid,
          defId: unitDefId,
          count: trainCount,
          playerId: this.ctx.perspectivePlayerId,
        });
        setLastEvent(`queued ${trainCount}x worker at eid=${eid}`);
        return;
      }
      if (!buildingDef?.trains.includes(unitDef.id)) continue;
      if (!isUnitUnlocked(world, playerId, unitDefId)) {
        this.fail({ reason: 'locked', subject: unitDef.name });
        return;
      }
      const affordable = affordableCountForCost(world, playerId, unitDef.cost, targetCount);
      if (affordable <= 0) {
        this.fail({ reason: 'resources', subject: unitDef.name, missing: this.missingResources(unitDef.cost) });
        return;
      }
      const popRoom = populationRoomForUnitCount(world, playerId, unitDefId, targetCount);
      if (popRoom <= 0) {
        this.fail({ reason: 'population', subject: unitDef.name });
        return;
      }
      const trainCount = Math.min(targetCount, affordable, popRoom);
      this.dispatch({
        type: 'trainUnit',
        atEid: eid,
        defId: unitDefId,
        count: trainCount,
        playerId: this.ctx.perspectivePlayerId,
      });
      setLastEvent(`queued ${trainCount}x ${unitDef.name} at eid=${eid}`);
      return;
    }
    this.fail({
      reason: 'unavailable',
      text: `Select a ${unitDef.trainAt.toLowerCase().replace('_', ' ')} to train ${unitDef.name}`,
    });
  }

  // ── Research ──────────────────────────────────────────────────────────────

  advanceAge(): void {
    const techId = nextAgeTechId(this.ctx.world, this.ctx.perspectivePlayerId);
    if (!techId) {
      this.fail({ reason: 'unavailable', text: 'Your realm has reached its final age' });
      return;
    }
    this.research(techId, this.ctx.perspectivePlayerId);
  }

  research(techId: TechIdValue, playerId = this.ctx.perspectivePlayerId): void {
    const world = this.ctx.world;
    const tech = techDef(techId);
    if (!tech) return;
    const status = techStatus(world, playerId, techId);
    if (status === 'researched') {
      this.fail({ reason: 'unavailable', text: `${tech.name} is already researched` });
      return;
    }
    if (status === 'researching') {
      this.fail({ reason: 'unavailable', text: `${tech.name} is already under way` });
      return;
    }
    if (status === 'locked') {
      const text = world.campaign?.lockedTechs.includes(techId)
        ? `${tech.name} is locked for this mission`
        : `${tech.name} needs earlier research first`;
      this.fail({ reason: 'unavailable', text });
      return;
    }
    if (!canAffordCost(world, playerId, tech.cost)) {
      this.fail({ reason: 'resources', subject: tech.name, missing: this.missingResources(tech.cost) });
      return;
    }
    this.dispatch({ type: 'researchTech', playerId, techId });
    setLastEvent(`research ${tech.name}`);
  }

  // ── Military ──────────────────────────────────────────────────────────────

  /** Selected own units that have a stance (i.e. military). */
  selectedStanceUnits(): number[] {
    const world = this.ctx.world;
    return selectedQuery(world.ecs).filter((eid) =>
      hasComponent(world.ecs, UnitStance, eid) &&
      Owner.player[eid] === this.ctx.perspectivePlayerId
    );
  }

  setStance(stance: UnitStanceValue): void {
    if (this.selectedStanceUnits().length === 0) return;
    this.dispatch({ type: 'setSelectedUnitStance', stance });
    this.confirm(stance === UnitStanceId.HOLD_POSITION ? 'Holding position' : 'Units will defend themselves');
  }

  setFormationMode(mode: number): void {
    if (this.selectedStanceUnits().length <= 1) return;
    const nextMode = clampFormationMode(mode);
    this.dispatch({ type: 'setFormationMode', mode: nextMode });
    this.confirm(`Formation: ${formationModeLabel(nextMode)}`);
  }

  rotateFormation(delta: number): void {
    if (this.selectedStanceUnits().length <= 1) return;
    if (clampFormationMode(this.formationMode()) === 0) return;
    const nextFacing = normalizeFormationFacing(this.formationFacing() + delta);
    this.dispatch({ type: 'rotateSelectedFormation', delta });
    setLastEvent(`formation facing: ${formationFacingLabel(nextFacing)}`);
  }

  /** This client's own formation shape (perspective player). */
  formationMode(): number {
    return this.ctx.world.formationModes[this.ctx.perspectivePlayerId] ?? 0;
  }

  /** This client's own formation facing (0..7). */
  formationFacing(): number {
    return this.ctx.world.formationFacings[this.ctx.perspectivePlayerId] ?? 0;
  }

  // ── Buildings ─────────────────────────────────────────────────────────────

  removeSelectedBuildings(): void {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    const selectedBuildings = selectedQuery(world.ecs).filter((eid) =>
      hasComponent(world.ecs, Building, eid) &&
      Owner.player[eid] === playerId &&
      Building.defId[eid] !== BuildingDefId.TOWN_CENTER
    );
    if (selectedBuildings.length === 0) {
      this.fail({ reason: 'unavailable', text: 'Select one of your buildings to demolish it' });
      return;
    }
    this.dispatch({ type: 'cmdRemoveBuildings', playerId, eids: selectedBuildings });
    this.confirm(
      selectedBuildings.length === 1 ? 'Building demolished' : `${selectedBuildings.length} buildings demolished`
    );
  }
}

export function clampFormationMode(mode: number): number {
  if (!Number.isFinite(mode)) return 0;
  return Math.max(0, Math.min(2, Math.trunc(mode)));
}

function normalizeFormationFacing(facing: number): number {
  return ((Math.trunc(facing) % 8) + 8) % 8;
}

function formationModeLabel(mode: number): string {
  switch (clampFormationMode(mode)) {
    case 1: return 'line';
    case 2: return 'compact';
    default: return 'free';
  }
}

export function formationFacingLabel(facing: number): string {
  return FORMATION_FACING_LABELS[normalizeFormationFacing(facing)];
}
