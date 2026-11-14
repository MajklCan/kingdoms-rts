/**
 * Action grid (bottom HUD): which buttons the current selection offers, and
 * what clicking one does. Building buttons arm placement, everything else
 * goes through PlayerCommands.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  ArcherTag,
  Building,
  CannonTag,
  GunmanTag,
  MachineGunTag,
  Owner,
  Producer,
  ResourceWorksite,
  ScoutCavalryTag,
  SpearmanTag,
  TownCenterTag,
  UnitStance,
  UnitStanceId,
  VillagerTag,
  WorksiteWorker,
} from '@sim/components';
import { AgeId, BUILDING_TABLE, BuildingDefId, UNIT_TABLE, UnitDefId, getAgeDef } from '@sim/defs';
import { isBuildingUnlocked, isUnitUnlocked, techDef, techStatus } from '@sim/tech-tree';
import {
  getBuildingBuildTicks,
  getBuildingCost,
  getBuildingDisplayName,
  getWorksiteWorkerSlots,
  selectedQuery,
} from '@sim/world';
import {
  canAffordCost,
  countOwnedArmyProducers,
  formatCost,
  formatTrainTime,
  hasPopulationRoomForUnit,
  nextAgeTechId,
  type Cost,
} from '../commands/economy';
import {
  clampFormationMode,
  formationFacingLabel,
  type PlayerCommands,
} from '../commands/player-commands';
import { BUILD_MODE_TO_DEF, type BuildMode, type BuildPlacement } from '../placement/build-placement';
import type { SceneContext } from '../scene-context';

export type ActionKind = 'build' | 'train' | 'tech' | 'command';

export interface ActionGridAction {
  id: string;
  label: string;
  key: string;
  glyph: string;
  hudIcon?: string;
  cost?: string;
  enabled: boolean;
  kind: ActionKind;
  meta?: string;
  queue?: number;
  active?: boolean;
  disabledReason?: string;
}

/** Build buttons in grid order: [action id, mode, hotkey, glyph, HUD icon]. */
const BUILD_BUTTONS: Array<[string, Exclude<BuildMode, 'none'>, string, string, string]> = [
  ['build-lumber-camp', 'LUMBER_CAMP', 'L', '▥', 'lumberCamp'],
  ['build-stone-quarry', 'STONE_QUARRY', 'C', '▣', 'stoneQuarry'],
  ['build-house', 'HOUSE', 'H', '⌂', 'house'],
  ['build-barracks', 'BARRACKS', 'R', '⚒', 'barracks'],
  ['build-archery-range', 'ARCHERY_RANGE', 'A', '🏹', 'archeryRange'],
  ['build-gold-mine', 'GOLD_MINE', 'G', '⛏', 'goldMine'],
  ['build-stable', 'STABLE', 'T', '♞', 'stable'],
  ['build-farm', 'FARM', 'M', '🌾', 'farm'],
  ['build-mill', 'MILL', 'I', '◈', 'mill'],
  ['build-foundry', 'FOUNDRY', 'F', '●', 'foundry'],
  ['build-defensive-tower', 'DEFENSIVE_TOWER', 'Y', '♜', 'defensiveTower'],
  ['build-wall', 'WALL', 'W', '▬', 'wall'],
];

/** Placement prompt shown when a build button is clicked. */
const BUILD_BUTTON_MESSAGE: Record<string, [Exclude<BuildMode, 'none'>, string]> = {
  'build-house': ['HOUSE', 'build HOUSE - click to place'],
  'build-farm': ['FARM', 'build FARM - click to place'],
  'build-mill': ['MILL', 'build MILL - click to place'],
  'build-lumber-camp': ['LUMBER_CAMP', 'build LUMBER HUT - click near trees'],
  'build-gold-mine': ['GOLD_MINE', 'build GOLD MINE - click near gold'],
  'build-stone-quarry': ['STONE_QUARRY', 'build STONE QUARRY - click near stone'],
  'build-barracks': ['BARRACKS', 'build BARRACKS - click to place'],
  'build-archery-range': ['ARCHERY_RANGE', 'build ARCHERY RANGE - click to place'],
  'build-stable': ['STABLE', 'build STABLE - click to place'],
  'build-foundry': ['FOUNDRY', 'build FOUNDRY - click to place'],
  'build-defensive-tower': ['DEFENSIVE_TOWER', 'build DEFENSIVE TOWER - click to place'],
  'build-wall': ['WALL', 'build WALL - drag from the start tile to the end tile, or click both'],
};

export class ActionGrid {
  constructor(
    private readonly ctx: SceneContext,
    private readonly commands: PlayerCommands,
    private readonly placement: BuildPlacement
  ) {}

  /** Trigger an action by id (action grid click). */
  trigger(actionId: string, trainCount = 1): void {
    if (actionId.startsWith('train-unit-')) {
      const defId = Number(actionId.slice('train-unit-'.length));
      this.commands.trainAtSelectedProducer(defId, trainCount);
      return;
    }
    const build = BUILD_BUTTON_MESSAGE[actionId];
    if (build) {
      this.placement.startBuildMode(build[0], build[1]);
      return;
    }
    switch (actionId) {
      case 'set-army-rally': this.placement.startArmyRallyMode(); return;
      case 'remove-building': this.commands.removeSelectedBuildings(); return;
      case 'stance-hold-position': this.commands.setStance(UnitStanceId.HOLD_POSITION); return;
      case 'stance-auto-defend': this.commands.setStance(UnitStanceId.AUTO_DEFEND); return;
      case 'formation-free': this.commands.setFormationMode(0); return;
      case 'formation-line': this.commands.setFormationMode(1); return;
      case 'formation-compact': this.commands.setFormationMode(2); return;
      case 'formation-rotate-ccw': this.commands.rotateFormation(-1); return;
      case 'formation-rotate-cw': this.commands.rotateFormation(1); return;
      case 'stop': this.commands.dispatch({ type: 'stopSelected' }); return;
      case 'advance-age': this.commands.advanceAge(); return;
    }
  }

  /** Buttons for the current selection. */
  available(): ActionGridAction[] {
    const world = this.ctx.world;
    const ecs = world.ecs;
    const playerId = this.ctx.perspectivePlayerId;
    const sel = selectedQuery(ecs);
    const canAfford = (cost: Cost) => canAffordCost(world, playerId, cost);

    let hasVillager = false;
    let hasMilitary = false;
    let hasTc = false;
    let removableBuildingCount = 0;
    const selectedProducerDefs = new Set<number>();
    const selectedProducerEids: number[] = [];
    const selectedWorksiteEids: number[] = [];
    const selectedMilitaryEids: number[] = [];
    for (const eid of sel) {
      if (!(hasComponent(ecs, Owner, eid) && Owner.player[eid] === playerId)) continue;
      // Worksite workers are autonomous: they do not unlock villager actions.
      if (hasComponent(ecs, VillagerTag, eid) && !hasComponent(ecs, WorksiteWorker, eid)) {
        hasVillager = true;
      }
      if (
        hasComponent(ecs, ArcherTag, eid) ||
        hasComponent(ecs, SpearmanTag, eid) ||
        hasComponent(ecs, ScoutCavalryTag, eid) ||
        hasComponent(ecs, GunmanTag, eid) ||
        hasComponent(ecs, CannonTag, eid) ||
        hasComponent(ecs, MachineGunTag, eid)
      ) {
        hasMilitary = true;
        if (hasComponent(ecs, UnitStance, eid)) selectedMilitaryEids.push(eid);
      }
      if (hasComponent(ecs, TownCenterTag, eid)) hasTc = true;
      if (hasComponent(ecs, Building, eid) && Building.defId[eid] !== BuildingDefId.TOWN_CENTER) {
        removableBuildingCount++;
      }
      if (hasComponent(ecs, Producer, eid) && hasComponent(ecs, Building, eid)) {
        selectedProducerDefs.add(Building.defId[eid]);
        selectedProducerEids.push(eid);
        if (hasComponent(ecs, ResourceWorksite, eid)) selectedWorksiteEids.push(eid);
      }
    }

    const actions: ActionGridAction[] = [];
    const queuedAtSelectedProducers = (unitDefId: number) =>
      selectedProducerEids.reduce((sum, eid) => {
        const buildingDef = BUILDING_TABLE[Building.defId[eid]];
        const unit = UNIT_TABLE[unitDefId];
        if (!buildingDef || !unit) return sum;
        if (!buildingDef.trains.includes(unit.id) && unitDefId !== UnitDefId.VILLAGER) return sum;
        const queued = world.productionQueues.get(eid) ?? [];
        return sum + queued.filter((defId) => defId === unitDefId).length;
      }, 0);

    const addBuildActions = () => {
      for (const [id, mode, key, glyph, hudIcon] of BUILD_BUTTONS) {
        const defId = BUILD_MODE_TO_DEF[mode];
        if (!isBuildingUnlocked(world, playerId, defId)) continue;
        const def = BUILDING_TABLE[defId];
        if (!def) continue;
        // Walls follow the age tier (palisade, stone, brick); others use the def.
        const cost = getBuildingCost(world, playerId, defId);
        const affordable = canAfford(cost);
        actions.push({
          id,
          label: `Build ${getBuildingDisplayName(world, playerId, defId)}`,
          key,
          glyph,
          hudIcon,
          cost: formatCost(cost),
          enabled: affordable,
          kind: 'build',
          meta: `${Math.ceil(getBuildingBuildTicks(world, playerId, defId) / SIM.TICK_HZ)}s`,
          disabledReason: affordable ? undefined : `Needs ${formatCost(cost)}`,
        });
      }
    };

    const addTrainAction = (unitDefId: number, key: string, glyph: string) => {
      const unit = UNIT_TABLE[unitDefId];
      if (!unit) return;
      if (!isUnitUnlocked(world, playerId, unitDefId)) return;
      const affordable = canAfford(unit.cost);
      const hasPopRoom = hasPopulationRoomForUnit(world, playerId, unitDefId);
      actions.push({
        id: `train-unit-${unitDefId}`,
        label: `Train ${unit.name}`,
        key,
        glyph,
        cost: formatCost(unit.cost),
        enabled: affordable && hasPopRoom,
        kind: 'train',
        meta: `${formatTrainTime(unit.trainTimeTicks)} / Pop ${unit.popCost}`,
        queue: queuedAtSelectedProducers(unitDefId),
        disabledReason: affordable
          ? (hasPopRoom ? undefined : 'Population cap reached')
          : `Needs ${formatCost(unit.cost)}`,
      });
    };

    const hasOpenWorksiteWorkerSlot = (eid: number) => {
      const queue = world.productionQueues.get(eid) ?? [];
      const queuedWorkers = queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
      return ResourceWorksite.assignedWorkers[eid] + queuedWorkers < getWorksiteWorkerSlots(world, eid) &&
        queue.length < 2;
    };

    const addWorksiteWorkerAction = () => {
      const unit = UNIT_TABLE[UnitDefId.VILLAGER];
      const affordable = canAfford(unit.cost);
      const hasSlot = selectedWorksiteEids.some(hasOpenWorksiteWorkerSlot);
      actions.push({
        id: `train-unit-${UnitDefId.VILLAGER}`,
        label: 'Train Worker',
        key: 'Q',
        glyph: '🧑',
        cost: formatCost(unit.cost),
        enabled: affordable && hasSlot,
        kind: 'train',
        meta: `${formatTrainTime(unit.trainTimeTicks)} / Worksite`,
        queue: queuedAtSelectedProducers(UnitDefId.VILLAGER),
        disabledReason: affordable
          ? (hasSlot ? undefined : 'Worker slots full')
          : `Needs ${formatCost(unit.cost)}`,
      });
    };

    if (sel.length === 0 || hasVillager) addBuildActions();

    if (hasTc) {
      const ageTechId = nextAgeTechId(world, playerId);
      const nextAgeDef = getAgeDef((world.ages[playerId]?.current ?? AgeId.DARK) + 1);
      const nextAgeTech = ageTechId ? techDef(ageTechId) : null;
      const status = ageTechId ? techStatus(world, playerId, ageTechId) : 'locked';
      if (nextAgeTech && nextAgeDef) {
        const available = status === 'available';
        const affordable = canAfford(nextAgeTech.cost);
        actions.push({
          id: 'advance-age',
          label: nextAgeDef.name,
          key: 'E',
          glyph: '^',
          cost: formatCost(nextAgeTech.cost),
          enabled: available && affordable,
          kind: 'tech',
          meta: 'Research',
          disabledReason: available
            ? (affordable ? undefined : `Needs ${formatCost(nextAgeTech.cost)}`)
            : 'Locked',
        });
      }
    }

    if (selectedWorksiteEids.length > 0) addWorksiteWorkerAction();
    else if (hasTc) addTrainAction(UnitDefId.VILLAGER, 'Q', '🧑');
    if (selectedProducerDefs.has(BuildingDefId.BARRACKS)) {
      addTrainAction(UnitDefId.SPEARMAN, 'Q', '♜');
      addTrainAction(UnitDefId.ARCHER, 'E', '🏹');
    }
    if (selectedProducerDefs.has(BuildingDefId.ARCHERY_RANGE) && !selectedProducerDefs.has(BuildingDefId.BARRACKS)) {
      addTrainAction(UnitDefId.ARCHER, 'Q', '🏹');
    }
    if (selectedProducerDefs.has(BuildingDefId.STABLE)) {
      addTrainAction(UnitDefId.SCOUT_CAVALRY, 'Q', '♞');
    }
    if (selectedProducerDefs.has(BuildingDefId.FOUNDRY)) {
      addTrainAction(UnitDefId.GUNMAN, 'Q', '•');
      addTrainAction(UnitDefId.CANNON, 'E', '●');
    }

    const ownedArmyProducerCount = countOwnedArmyProducers(world, playerId);
    if (ownedArmyProducerCount > 0) {
      const rally = world.armyRallyPoints[playerId];
      actions.push({
        id: 'set-army-rally',
        label: 'Army Rally Point',
        key: 'V',
        glyph: '⚑',
        enabled: true,
        kind: 'command',
        meta: `${rally ? 'Set' : 'Not set'} / ${ownedArmyProducerCount} building${ownedArmyProducerCount === 1 ? '' : 's'}`,
        active: this.placement.armyRallyMode,
      });
    }

    if (removableBuildingCount > 0) {
      actions.push({
        id: 'remove-building',
        label: removableBuildingCount === 1 ? 'Remove Building' : 'Remove Buildings',
        key: 'Del',
        glyph: '⌫',
        enabled: true,
        kind: 'command',
        meta: removableBuildingCount === 1 ? 'Delete selected' : `${removableBuildingCount} selected`,
      });
    }

    if (hasMilitary && !hasVillager) {
      actions.push(...this.militaryActions(selectedMilitaryEids));
    }
    return actions;
  }

  private militaryActions(military: number[]): ActionGridAction[] {
    const holdCount = military.filter((eid) =>
      UnitStance.stance[eid] === UnitStanceId.HOLD_POSITION
    ).length;
    const allHolding = military.length > 0 && holdCount === military.length;
    const allAutoDefending = military.length > 0 && holdCount === 0;
    const stanceMeta = allHolding || allAutoDefending ? 'Active' : 'Mixed';
    const formationMode = clampFormationMode(this.commands.formationMode());
    const facingLabel = `Face ${formationFacingLabel(this.commands.formationFacing())}`;
    const canStance = military.length > 0;
    const canForm = military.length > 1;
    return [
      {
        id: 'stance-hold-position', label: 'Hold Position', key: 'H', glyph: 'H',
        enabled: canStance, kind: 'command',
        meta: allHolding ? stanceMeta : 'No auto-chase', active: allHolding,
      },
      {
        id: 'stance-auto-defend', label: 'Auto Defend', key: '', glyph: 'A',
        enabled: canStance, kind: 'command',
        meta: allAutoDefending ? stanceMeta : 'Chase nearby', active: allAutoDefending,
      },
      {
        id: 'formation-free', label: 'Free Formation', key: '', glyph: '··',
        enabled: canForm, kind: 'command',
        meta: formationMode === 0 ? 'Active' : 'Loose movement', active: formationMode === 0,
      },
      {
        id: 'formation-line', label: 'Line Formation', key: '', glyph: '↔',
        enabled: canForm, kind: 'command',
        meta: formationMode === 1 ? 'Active' : 'Spread line', active: formationMode === 1,
      },
      {
        id: 'formation-compact', label: 'Compact Formation', key: '', glyph: '▦',
        enabled: canForm, kind: 'command',
        meta: formationMode === 2 ? 'Active' : 'Dense block', active: formationMode === 2,
      },
      {
        id: 'formation-rotate-ccw', label: 'Rotate CCW', key: '', glyph: '⟲',
        enabled: canForm && formationMode !== 0, kind: 'command', meta: facingLabel,
      },
      {
        id: 'formation-rotate-cw', label: 'Rotate CW', key: '', glyph: '⟳',
        enabled: canForm && formationMode !== 0, kind: 'command', meta: facingLabel,
      },
      { id: 'stop', label: 'Stop', key: 'S', glyph: 'X', enabled: true, kind: 'command' },
    ];
  }
}
