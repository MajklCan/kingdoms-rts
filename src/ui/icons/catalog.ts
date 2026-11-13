/**
 * Icon + copy catalog for everything the HUD shows: command-grid actions,
 * selection kinds, unit/building definitions and tech nodes. Pure data so it
 * can be unit-tested and tweaked without touching layout code.
 */

import type { IconName } from './icon-names';

export interface ActionCopy {
  icon: IconName;
  description: string;
  /** Key sequence shown in the tooltip when the badge alone is misleading. */
  keyHint?: string;
}

const BUILD_HINT = (key: string) => `B then ${key}`;

export const ACTION_COPY: Record<string, ActionCopy> = {
  'build-house': { icon: 'house', description: 'Raises the population cap so you can train more units.', keyHint: BUILD_HINT('H') },
  'build-farm': { icon: 'farm', description: 'Worksite that turns assigned villagers into a steady food income.', keyHint: BUILD_HINT('M') },
  'build-mill': { icon: 'mill', description: 'Food drop-off that boosts farm deliveries by half.', keyHint: BUILD_HINT('I') },
  'build-lumber-camp': { icon: 'lumber-camp', description: 'Worksite placed near trees. Spawns woodcutters that harvest automatically.', keyHint: BUILD_HINT('L') },
  'build-stone-quarry': { icon: 'stone-quarry', description: 'Worksite placed near stone. Quarrymen cut stone for keeps and towers.', keyHint: BUILD_HINT('C') },
  'build-gold-mine': { icon: 'gold-mine', description: 'Worksite placed on a gold vein. Miners bring in gold for the army.', keyHint: BUILD_HINT('G') },
  'build-barracks': { icon: 'barracks', description: 'Trains pikemen and archers, the backbone of a medieval host.', keyHint: BUILD_HINT('R') },
  'build-stable': { icon: 'stable', description: 'Trains fast scout cavalry for raids and reconnaissance.', keyHint: BUILD_HINT('T') },
  'build-foundry': { icon: 'foundry', description: 'Casts gunpowder weapons: gunmen, field cannon and later artillery.', keyHint: BUILD_HINT('F') },
  'build-defensive-tower': { icon: 'defensive-tower', description: 'Stone tower that shoots at enemies in range.', keyHint: BUILD_HINT('Y') },
  'build-wall': { icon: 'wall', description: 'Wall line: click the start tile, then the end tile. Cost is per tile. Palisade now, stone in the Castle Age, brick with gunpowder.', keyHint: 'click start, then end' },
  'advance-age': { icon: 'advance-age', description: 'Advance your realm to the next age, unlocking new buildings, units and research.' },
  'set-army-rally': { icon: 'rally', description: 'Pick a gathering point for newly trained soldiers.' },
  'remove-building': { icon: 'demolish', description: 'Tear down the selected buildings. Nothing is refunded.' },
  'stance-hold-position': { icon: 'hold', description: 'Units stand their ground and only fight what comes into range.' },
  'stance-auto-defend': { icon: 'auto-defend', description: 'Units chase and engage enemies that come near.' },
  'formation-free': { icon: 'formation-free', description: 'Move as a loose group without keeping ranks.' },
  'formation-line': { icon: 'formation-line', description: 'Spread into a wide battle line, good for ranged units.' },
  'formation-compact': { icon: 'formation-compact', description: 'Pack into a dense block, good for holding a choke.' },
  'formation-rotate-ccw': { icon: 'rotate-ccw', description: 'Turn the formation facing counter-clockwise.' },
  'formation-rotate-cw': { icon: 'rotate-cw', description: 'Turn the formation facing clockwise.' },
  stop: { icon: 'stop', description: 'Cancel current orders.' },
};

export const UNIT_ICON_BY_DEF: Record<number, IconName> = {
  0: 'villager',
  1: 'pikeman',
  2: 'archer',
  3: 'pikeman',
  4: 'scout-cavalry',
  5: 'gunman',
  6: 'cannon',
  7: 'machine-gun',
  8: 'mortar',
};

export const UNIT_COPY_BY_DEF: Record<number, string> = {
  0: 'Gathers resources and raises buildings. The heart of every economy.',
  1: 'Basic infantry from older chronicles.',
  2: 'Ranged foot soldier. Strong behind a pike wall, weak in melee.',
  3: 'Pike infantry. Holds the line and punishes cavalry charges.',
  4: 'Fast mounted scout. Great for raiding and spotting.',
  5: 'Early firearm infantry with a heavy, slow-loading shot.',
  6: 'Field cannon. Smashes buildings and packed formations from range.',
  7: 'Deploys before firing, then shreds infantry in its arc.',
  8: 'Indirect artillery that lobs shells over cover and walls.',
};

export const BUILDING_ICON_BY_DEF: Record<number, IconName> = {
  0: 'town-center',
  1: 'house',
  2: 'farm',
  3: 'barracks',
  4: 'archery-range',
  5: 'stable',
  6: 'lumber-camp',
  7: 'gold-mine',
  8: 'stone-quarry',
  9: 'defensive-tower',
  10: 'foundry',
  11: 'wall',
  12: 'mill',
};

/** Selection kinds as reported by GameScene.getSelectionInfo(). */
export const SELECTION_ICON: Record<string, IconName> = {
  villager: 'villager',
  archer: 'archer',
  spearman: 'pikeman',
  scoutCavalry: 'scout-cavalry',
  gunman: 'gunman',
  cannon: 'cannon',
  machineGun: 'machine-gun',
  mortar: 'mortar',
  tc: 'town-center',
  house: 'house',
  farm: 'farm',
  mill: 'mill',
  lumberCamp: 'lumber-camp',
  goldMine: 'gold-mine',
  stoneQuarry: 'stone-quarry',
  barracks: 'barracks',
  archeryRange: 'archery-range',
  stable: 'stable',
  foundry: 'foundry',
  defensiveTower: 'defensive-tower',
  foundation: 'foundation',
  mixed: 'banners',
  none: 'shield',
};

/** Tech node `icon` keys from src/sim/tech-tree.ts. */
export const TECH_ICON: Record<string, IconName> = {
  lumber: 'lumber-camp',
  stone: 'stone-quarry',
  barracks: 'barracks',
  archer: 'archer',
  house: 'house',
  axe: 'wood',
  pick: 'gold-mine',
  castle: 'crown',
  mill: 'mill',
  farm: 'farm',
  gunpowder: 'cannon',
};

export function actionIcon(id: string): IconName {
  const copy = ACTION_COPY[id];
  if (copy) return copy.icon;
  const train = /^train-unit-(\d+)$/.exec(id);
  if (train) return UNIT_ICON_BY_DEF[Number(train[1])] ?? 'person';
  if (id.startsWith('research-') || id.startsWith('tech-')) return 'research';
  return 'info';
}

export function actionDescription(id: string): string {
  const copy = ACTION_COPY[id];
  if (copy) return copy.description;
  const train = /^train-unit-(\d+)$/.exec(id);
  if (train) return UNIT_COPY_BY_DEF[Number(train[1])] ?? '';
  return '';
}

export function actionKeyHint(id: string, key: string): string {
  return ACTION_COPY[id]?.keyHint ?? key;
}
