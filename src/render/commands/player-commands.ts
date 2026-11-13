/**
 * Player intents that need validation + feedback before they become sim
 * inputs: training, research / age advance, stances, formations, demolition.
 * Every command leaves through {@link dispatchCommand}.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  Owner,
  Producer,
  ResourceWorksite,
  UnitStance,
  UnitStanceId,
  type UnitStanceValue,
} from '@sim/components';
import { BUILDING_TABLE, BuildingDefId, UNIT_TABLE, UnitDefId } from '@sim/defs';
import { isUnitUnlocked, techDef, techStatus, type TechIdValue } from '@sim/tech-tree';
import { getWorksiteWorkerSlots, selectedQuery, type SimInput } from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import { ERROR as SFX_ERROR } from '../audio/sound-map';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import { dispatchCommand } from './command-dispatch';
import {
  affordableCountForCost,
  canAffordCost,
  formatCost,
  nextAgeTechId,
  populationRoomForUnitCount,
} from './economy';

/** Shift-click on a train button queues up to this many. */
export const TRAIN_BATCH_COUNT = 5;

const FORMATION_FACING_LABELS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

export class PlayerCommands {
  constructor(
    private readonly ctx: SceneContext,
    private readonly audio: GameAudio
  ) {}

  dispatch(input: SimInput): void {
    dispatchCommand(this.ctx, input);
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
        if (!quiet) setLastEvent(`no unit in slot ${slot + 1}`);
        return false;
      }
      const trainIds = buildingDef?.trains ?? [];
      if (trainIds.length === 0) {
        if (!quiet) setLastEvent(`Q: ${buildingDef?.name ?? 'building'} trains nothing`);
        return false;
      }
      const idStr = trainIds[slot];
      if (!idStr) {
        if (!quiet) setLastEvent(`no unit in slot ${slot + 1}`);
        return false;
      }
      const unitDefId = UNIT_TABLE.findIndex((u) => u.id === idStr);
      if (unitDefId < 0) {
        if (!quiet) setLastEvent(`Q: unknown unit ${idStr}`);
        return false;
      }
      const unitDef = UNIT_TABLE[unitDefId];
      if (!unitDef) return false;
      if (!isUnitUnlocked(world, this.ctx.perspectivePlayerId, unitDefId)) {
        if (!quiet) setLastEvent(`${unitDef.name} is locked`);
        return false;
      }
      this.trainAtSelectedProducer(unitDefId);
      return true;
    }
    if (!quiet) setLastEvent('Q: no producer selected');
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
        const queue = world.productionQueues.get(eid) ?? [];
        const queuedWorkers = queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
        const slots = getWorksiteWorkerSlots(world, eid);
        const slotRoom = slots - ResourceWorksite.assignedWorkers[eid] - queuedWorkers;
        if (slotRoom <= 0) {
          setLastEvent(`workers full (${slots}/${slots})`);
          return;
        }
        const queueRoom = Math.max(0, 2 - queue.length);
        if (queueRoom <= 0) {
          setLastEvent('worker queue full');
          return;
        }
        const affordable = affordableCountForCost(world, playerId, unitDef.cost, targetCount);
        if (affordable <= 0) {
          this.audio.playUi(SFX_ERROR);
          setLastEvent(`${unitDef.name} needs ${formatCost(unitDef.cost)}`);
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
        setLastEvent(
          trainCount === 1
            ? `queued worker at eid=${eid}`
            : `queued ${trainCount}x worker at eid=${eid}`
        );
        return;
      }
      if (!buildingDef?.trains.includes(unitDef.id)) continue;
      if (!isUnitUnlocked(world, playerId, unitDefId)) {
        this.audio.playUi(SFX_ERROR);
        setLastEvent(`${unitDef.name} is locked`);
        return;
      }
      const affordable = affordableCountForCost(world, playerId, unitDef.cost, targetCount);
      if (affordable <= 0) {
        this.audio.playUi(SFX_ERROR);
        setLastEvent(`${unitDef.name} needs ${formatCost(unitDef.cost)}`);
        return;
      }
      const popRoom = populationRoomForUnitCount(world, playerId, unitDefId, targetCount);
      if (popRoom <= 0) {
        this.audio.playUi(SFX_ERROR);
        const pop = world.population[playerId];
        setLastEvent(`${unitDef.name} needs pop space (${pop?.current ?? 0}/${pop?.cap ?? 0})`);
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
      setLastEvent(
        trainCount === 1
          ? `queued ${unitDef.name} at eid=${eid}`
          : `queued ${trainCount}x ${unitDef.name} at eid=${eid}`
      );
      return;
    }
    setLastEvent(`${unitDef.name}: no ${unitDef.trainAt.toLowerCase().replace('_', ' ')} selected`);
  }

  // ── Research ──────────────────────────────────────────────────────────────

  advanceAge(): void {
    const techId = nextAgeTechId(this.ctx.world, this.ctx.perspectivePlayerId);
    if (!techId) {
      setLastEvent('maximum age reached');
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
      setLastEvent(`${tech.name} already researched`);
      return;
    }
    if (status === 'researching') {
      setLastEvent(`${tech.name} already in progress`);
      return;
    }
    if (status === 'locked') {
      if (world.campaign?.lockedTechs.includes(techId)) {
        setLastEvent(`${tech.name} is locked for this mission`);
        return;
      }
      setLastEvent(`${tech.name} prerequisites missing`);
      return;
    }
    if (!canAffordCost(world, playerId, tech.cost)) {
      setLastEvent(`${tech.name} needs ${formatCost(tech.cost) || 'no resources'}`);
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
    setLastEvent(
      stance === UnitStanceId.HOLD_POSITION ? 'units holding position' : 'units set to auto-defend'
    );
  }

  setFormationMode(mode: number): void {
    if (this.selectedStanceUnits().length <= 1) return;
    const nextMode = clampFormationMode(mode);
    this.dispatch({ type: 'setFormationMode', mode: nextMode });
    setLastEvent(`formation: ${formationModeLabel(nextMode)}`);
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
      setLastEvent('no removable building selected');
      return;
    }
    this.dispatch({ type: 'cmdRemoveBuildings', playerId, eids: selectedBuildings });
    setLastEvent(
      selectedBuildings.length === 1
        ? 'removing selected building'
        : `removing ${selectedBuildings.length} selected buildings`
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
