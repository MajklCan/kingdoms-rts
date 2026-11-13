/**
 * Icon + copy catalog for everything the HUD shows: command-grid actions,
 * selection kinds, unit/building definitions and tech nodes. Pure data so it
 * can be unit-tested and tweaked without touching layout code.
 */

import type { IconName } from './icon-names';
import { RASTER_ICONS } from './raster-icons';

export interface ActionCopy {
  icon: IconName;
  description: string;
  /** Key sequence shown in the tooltip when the badge alone is misleading. */
  keyHint?: string;
}

const BUILD_HINT = (key: string) => `B then ${key}`;

export const ACTION_COPY: Record<string, ActionCopy> = {
  'build-house': { icon: 'b-house', description: 'Raises the population cap so you can train more units.', keyHint: BUILD_HINT('H') },
  'build-farm': { icon: 'b-farm', description: 'Worksite that turns assigned villagers into a steady food income.', keyHint: BUILD_HINT('M') },
  'build-mill': { icon: 'b-mill', description: 'Food drop-off that boosts farm deliveries by half.', keyHint: BUILD_HINT('I') },
  'build-lumber-camp': { icon: 'b-lumber-camp', description: 'Worksite placed near trees. Spawns woodcutters that harvest automatically.', keyHint: BUILD_HINT('L') },
  'build-stone-quarry': { icon: 'b-stone-quarry', description: 'Worksite placed near stone. Quarrymen cut stone for keeps and towers.', keyHint: BUILD_HINT('C') },
  'build-gold-mine': { icon: 'b-gold-mine', description: 'Worksite placed on a gold vein. Miners bring in gold for the army.', keyHint: BUILD_HINT('G') },
  'build-barracks': { icon: 'b-barracks', description: 'Trains pikemen and archers, the backbone of a medieval host.', keyHint: BUILD_HINT('R') },
  'build-stable': { icon: 'b-stable', description: 'Trains fast scout cavalry for raids and reconnaissance.', keyHint: BUILD_HINT('T') },
  'build-foundry': { icon: 'b-foundry', description: 'Casts gunpowder weapons: gunmen, field cannon and later artillery.', keyHint: BUILD_HINT('F') },
  'build-defensive-tower': { icon: 'b-defensive-tower', description: 'Stone tower that shoots at enemies in range.', keyHint: BUILD_HINT('Y') },
  'build-wall': { icon: 'b-wall', description: 'Wall line: click the start tile, then the end tile. Cost is per tile. Palisade now, stone in the Castle Age, brick with gunpowder.', keyHint: 'click start, then end' },
  'advance-age': { icon: 'c-advance-age', description: 'Advance your realm to the next age, unlocking new buildings, units and research.' },
  'set-army-rally': { icon: 'c-rally', description: 'Pick a gathering point for newly trained soldiers.' },
  'remove-building': { icon: 'c-demolish', description: 'Tear down the selected buildings. Nothing is refunded.' },
  'stance-hold-position': { icon: 'c-hold', description: 'Units stand their ground and only fight what comes into range.' },
  'stance-auto-defend': { icon: 'c-auto-defend', description: 'Units chase and engage enemies that come near.' },
  'formation-free': { icon: 'c-formation-free', description: 'Move as a loose group without keeping ranks.' },
  'formation-line': { icon: 'c-formation-line', description: 'Spread into a wide battle line, good for ranged units.' },
  'formation-compact': { icon: 'c-formation-compact', description: 'Pack into a dense block, good for holding a choke.' },
  'formation-rotate-ccw': { icon: 'c-rotate-ccw', description: 'Turn the formation facing counter-clockwise.' },
  'formation-rotate-cw': { icon: 'c-rotate-cw', description: 'Turn the formation facing clockwise.' },
  stop: { icon: 'c-stop', description: 'Cancel current orders.' },
};

export const UNIT_ICON_BY_DEF: Record<number, IconName> = {
  0: 'u-villager',
  1: 'u-militia',
  2: 'u-archer',
  3: 'u-spearman',
  4: 'u-cavalry',
  5: 'u-gunman',
  6: 'u-cannon',
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
  0: 'b-town-center',
  1: 'b-house',
  2: 'b-farm',
  3: 'b-barracks',
  4: 'b-archery-range',
  5: 'b-stable',
  6: 'b-lumber-camp',
  7: 'b-gold-mine',
  8: 'b-stone-quarry',
  9: 'b-defensive-tower',
  10: 'b-foundry',
  11: 'b-wall',
  12: 'b-mill',
};

/** Selection kinds as reported by GameScene.getSelectionInfo(). */
export const SELECTION_ICON: Record<string, IconName> = {
  villager: 'u-villager',
  archer: 'u-archer',
  spearman: 'u-spearman',
  scoutCavalry: 'u-cavalry',
  gunman: 'u-gunman',
  cannon: 'u-cannon',
  machineGun: 'machine-gun',
  mortar: 'mortar',
  tc: 'b-town-center',
  house: 'b-house',
  farm: 'b-farm',
  mill: 'b-mill',
  lumberCamp: 'b-lumber-camp',
  goldMine: 'b-gold-mine',
  stoneQuarry: 'b-stone-quarry',
  barracks: 'b-barracks',
  archeryRange: 'b-archery-range',
  stable: 'b-stable',
  foundry: 'b-foundry',
  defensiveTower: 'b-defensive-tower',
  foundation: 'b-foundation',
  mixed: 'banners',
  none: 'shield',
};

/** Tech node `icon` keys from src/sim/tech-tree.ts. */
export const TECH_ICON: Record<string, IconName> = {
  lumber: 'b-lumber-camp',
  stone: 'b-stone-quarry',
  barracks: 'b-barracks',
  archer: 'u-archer',
  house: 'b-house',
  axe: 'tech-axe',
  pick: 'tech-pick',
  castle: 'tech-castle',
  mill: 'b-mill',
  farm: 'b-farm',
  gunpowder: 'tech-gunpowder',
};

/** Resource keys as the HUD names them, to their sheet icons. */
export const RESOURCE_ICON = {
  food: 'r-food',
  wood: 'r-wood',
  gold: 'r-gold',
  stone: 'r-stone',
} as const satisfies Record<string, IconName>;

/** The 16 px inline size of the same resource icons (costs, stats, carry). */
export const RESOURCE_ICON_SMALL = {
  food: 'r-food-s',
  wood: 'r-wood-s',
  gold: 'r-gold-s',
  stone: 'r-stone-s',
} as const satisfies Record<string, IconName>;

const ERA_SUFFIX = ['', '.castle', '.gunpowder', '.gunpowder'] as const;

/**
 * Building icons follow the owner's age like the buildings on the map: the
 * newest era variant at or below `age` that exists, else the base picture
 * (drawn in the age the building unlocks). Other icons pass through.
 */
export function eraIcon(name: IconName, age: number): IconName {
  if (!name.startsWith('b-')) return name;
  for (let a = Math.min(Math.max(0, Math.floor(age)), ERA_SUFFIX.length - 1); a > 0; a--) {
    const key = `${name}${ERA_SUFFIX[a]}`;
    if (Object.prototype.hasOwnProperty.call(RASTER_ICONS, key)) return key as IconName;
  }
  return name;
}

export function actionIcon(id: string): IconName {
  const copy = ACTION_COPY[id];
  if (copy) return copy.icon;
  const train = /^train-unit-(\d+)$/.exec(id);
  if (train) return UNIT_ICON_BY_DEF[Number(train[1])] ?? 'person';
  if (id.startsWith('research-') || id.startsWith('tech-')) return 'c-research';
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
