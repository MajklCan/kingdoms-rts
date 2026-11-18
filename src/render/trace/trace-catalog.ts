/**
 * Which features a match can use, and which feature a sim command counts as.
 * Built from the game tables (buildings on the build buttons, the units they
 * train, the tech tree), so a building taken out of play drops out of the
 * catalog with it. Pure: imports only the sim tables.
 */

import { UnitStanceId } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId, UNIT_TABLE } from '@sim/defs';
import { TECH_TREE } from '@sim/tech-tree';
import type { SimInput } from '@sim/world';
import type { TraceFeature } from './player-trace';

/** UI features no sim command stands for (camera, selection, panels, ...). */
export const UI_FEATURES = {
  'build-menu:open': 'Build key (B, then a letter)',
  'rally-arm:army': 'Pick army rally point',
  'rally-arm:villager': 'Pick villager rally point',
  'attack-move:arm': 'Attack-move button (touch)',
  'select:click': 'Click a unit or building',
  'select:box': 'Box select',
  'select:double-click': 'Double-click: same kind on screen',
  'select:all-villagers': 'All villagers (F1)',
  'select:all-military': 'All military (F2)',
  'select:idle-villager': 'Next idle villager',
  'select:from-panel': 'Pick from the selection panel',
  'group:assign': 'Assign control group (Ctrl+digit)',
  'group:add': 'Add to control group (Shift+digit)',
  'group:recall': 'Recall control group',
  'group:jump': 'Jump to control group',
  'camera:pan-keys': 'Pan with WASD',
  'camera:pan-drag': 'Pan by dragging (touch)',
  'camera:zoom-wheel': 'Zoom with the wheel',
  'camera:zoom-pinch': 'Pinch zoom',
  'camera:zoom-step': 'Zoom keys (+ / -)',
  'camera:minimap': 'Jump via the minimap',
  'camera:alert': 'Jump to an alert',
  'camera:event-log': 'Jump from the event log',
  'minimap:order': 'Order via the minimap',
  'game:pause': 'Pause',
  'game:speed': 'Game speed',
  'panel:tech-tree-panel': 'Technology panel',
  'panel:pause-menu': 'Pause menu',
  'panel:settings-panel': 'Settings',
  'panel:save-load-panel': 'Save / load',
} as const satisfies Record<string, string>;

export type UiFeatureId = keyof typeof UI_FEATURES;

/** Features of the sim commands the HUD can send (not the per-kind ones). */
const COMMAND_FEATURES: Record<string, string> = {
  'order:move': 'Move',
  'order:attack': 'Attack a target',
  'order:attack-move': 'Attack-move',
  'order:gather': 'Gather',
  'order:help-build': 'Help build a foundation',
  'order:worksite': 'Send workers to a worksite',
  'order:stop': 'Stop',
  'order:shift-queue': 'Shift-queued order',
  'stance:hold': 'Hold position',
  'stance:auto-defend': 'Auto defend',
  'formation:free': 'Free formation',
  'formation:line': 'Line formation',
  'formation:compact': 'Compact formation',
  'formation:rotate': 'Rotate formation',
  'rally:army': 'Army rally point',
  'rally:villager': 'Villager rally point',
  'rally:villager-clear': 'Clear villager rally',
  'building:remove': 'Demolish a building',
  'production:cancel': 'Cancel production',
};

const FORMATION_NAMES = ['free', 'line', 'compact'];

function buildingKey(defId: number): string {
  return BUILDING_TABLE[defId]?.id ?? `building-${defId}`;
}

function unitKey(defId: number): string {
  return UNIT_TABLE[defId]?.id ?? `unit-${defId}`;
}

/**
 * Every feature this build offers. `buildModes`: the building keys on the
 * build buttons (the action grid's list), e.g. ['HOUSE', 'FARM', ...].
 */
export function buildTraceCatalog(buildModes: readonly string[]): TraceFeature[] {
  const out: TraceFeature[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label });
  };
  const buildings = buildModes
    .map((key) => BUILDING_TABLE.find((b) => b.id === key))
    .filter((b): b is (typeof BUILDING_TABLE)[number] => b !== undefined);
  for (const b of buildings) add(`build-arm:${b.id}`, b.name);
  for (const b of buildings) add(`build:${b.id}`, b.name);
  const trainers = [BUILDING_TABLE[BuildingDefId.TOWN_CENTER], ...buildings];
  for (const b of trainers) {
    for (const unit of b?.trains ?? []) {
      const def = UNIT_TABLE.find((u) => u.id === unit);
      if (def) add(`train:${def.id}`, def.name);
    }
  }
  for (const tech of TECH_TREE) add(`research:${tech.id}`, tech.name);
  for (const [id, label] of Object.entries(COMMAND_FEATURES)) add(id, label);
  for (const [id, label] of Object.entries(UI_FEATURES)) add(id, label);
  return out;
}

export interface CommandFeature {
  feature: string;
  detail?: string;
  /** Shift held: the order goes behind the current one. */
  queued: boolean;
}

/** The feature a sim command counts as. Every SimInput type is named here. */
export function commandFeature(input: SimInput): CommandFeature {
  const queued = 'queue' in input && input.queue === true;
  const f = (feature: string, detail?: string): CommandFeature => (detail ? { feature, detail, queued } : { feature, queued });
  switch (input.type) {
    case 'moveSelected':
    case 'cmdMove':
      return f('order:move');
    case 'gatherSelected':
    case 'cmdGather':
      return f('order:gather');
    case 'buildSelected':
    case 'cmdBuild':
      return f('order:help-build');
    case 'assignWorksiteSelected':
    case 'cmdAssignWorksite':
      return f('order:worksite');
    case 'stopSelected':
    case 'cmdStop':
      return f('order:stop');
    case 'attackSelected':
    case 'cmdAttack':
      return f('order:attack');
    case 'attackMoveSelected':
    case 'cmdAttackMove':
      return f('order:attack-move');
    case 'toggleSelectedUnitStance':
    case 'cmdToggleStance':
      return f('stance:toggle');
    case 'setSelectedUnitStance':
    case 'cmdSetStance':
      return f(input.stance === UnitStanceId.HOLD_POSITION ? 'stance:hold' : 'stance:auto-defend');
    case 'setFormationMode':
    case 'cmdSetFormationMode':
      return f(`formation:${FORMATION_NAMES[input.mode] ?? input.mode}`);
    case 'adjustFormationMode':
    case 'cmdAdjustFormationMode':
      return f('formation:cycle');
    case 'rotateSelectedFormation':
    case 'cmdRotateFormation':
      return f('formation:rotate');
    case 'reformSelectedFormation':
    case 'cmdReformFormation':
      return f('formation:reform');
    case 'removeSelectedBuildings':
    case 'cmdRemoveBuildings':
      return f('building:remove');
    case 'setArmyRallyPoint':
      return f('rally:army');
    case 'setVillagerRally':
      return f('rally:villager');
    case 'clearVillagerRally':
      return f('rally:villager-clear');
    case 'placeBuilding':
      return f(`build:${buildingKey(input.defId)}`);
    case 'placeWallLine':
      return f(`build:${buildingKey(BuildingDefId.WALL)}`);
    case 'trainUnit':
      return f(`train:${unitKey(input.defId)}`, (input.count ?? 1) > 1 ? `x${input.count}` : undefined);
    case 'cancelProduction':
      return f('production:cancel');
    case 'researchTech':
      return f(`research:${input.techId}`);
    default: {
      const unknown: never = input;
      return f(`cmd:${(unknown as { type: string }).type}`);
    }
  }
}
