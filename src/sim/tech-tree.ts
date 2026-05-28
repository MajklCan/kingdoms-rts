import { AgeId, BuildingDefId, UnitDefId, type CostTuple } from './defs';
import { ResourceKindId } from './components';

export const TechId = {
  LUMBER_HUTS: 'lumber_huts',
  STONE_MINES: 'stone_mines',
  BARRACKS_PIKEMEN: 'barracks_pikemen',
  ARCHERS: 'archers',
  HOUSING_I: 'housing_i',
  HOUSING_II: 'housing_ii',
  LUMBER_CREWS: 'lumber_crews',
  MINING_CREWS: 'mining_crews',
  CASTLE_AGE: 'castle_age',
  GOLD_MINES: 'gold_mines',
  KNIGHTS: 'knights',
  FARMS: 'farms',
  FARMS_II: 'farms_ii',
  MILLS: 'mills',
  GUNPOWDER_AGE: 'gunpowder_age',
} as const;

export type TechIdValue = (typeof TechId)[keyof typeof TechId];
export type TechStatus = 'researched' | 'researching' | 'available' | 'locked';

export interface TechDef {
  id: TechIdValue;
  name: string;
  description: string;
  cost: CostTuple;
  path: 'start' | 'military' | 'housing' | 'economy' | 'food' | 'age' | 'castle' | 'gunpowder';
  icon: string;
  x: number;
  y: number;
  requires?: TechIdValue[];
  requiresAny?: TechIdValue[][];
  requiresAge?: number;
  unlocks: string[];
}

export interface TechStateWorld {
  researchedTechs: Array<Set<TechIdValue>>;
  ages: Array<{ current: number; progress: number; totalTicks: number }>;
  campaign?: { lockedTechs: TechIdValue[] } | null;
}

export const STARTING_TECHS: TechIdValue[] = [
  TechId.LUMBER_HUTS,
  TechId.STONE_MINES,
];

export const TECH_TREE: TechDef[] = [
  {
    id: TechId.LUMBER_HUTS,
    name: 'Lumber Huts',
    description: 'Basic wood worksites. Each hut starts with one worker.',
    cost: { food: 0, wood: 0, gold: 0, stone: 0 },
    path: 'start',
    icon: 'lumber',
    x: 8.3,
    y: 18,
    unlocks: ['Lumber Hut'],
  },
  {
    id: TechId.STONE_MINES,
    name: 'Stone Mines',
    description: 'Basic stone worksites. Each mine starts with one worker.',
    cost: { food: 0, wood: 0, gold: 0, stone: 0 },
    path: 'start',
    icon: 'stone',
    x: 8.3,
    y: 82,
    unlocks: ['Stone Mine'],
  },
  {
    id: TechId.BARRACKS_PIKEMEN,
    name: 'Barracks',
    description: 'Unlocks barracks, houses, and pikemen as the first military line.',
    cost: { food: 0, wood: 250, gold: 0, stone: 0 },
    path: 'military',
    icon: 'barracks',
    x: 9.5,
    y: 18,
    requires: [TechId.LUMBER_HUTS, TechId.STONE_MINES],
    unlocks: ['Barracks', 'Houses', 'Pikemen'],
  },
  {
    id: TechId.ARCHERS,
    name: 'Archers',
    description: 'Unlocks ranged infantry and defensive towers.',
    cost: { food: 0, wood: 300, gold: 0, stone: 200 },
    path: 'military',
    icon: 'archer',
    x: 29.5,
    y: 18,
    requires: [TechId.BARRACKS_PIKEMEN],
    unlocks: ['Barracks Archers', 'Defensive Towers'],
  },
  {
    id: TechId.HOUSING_I,
    name: 'Timber Housing',
    description: 'Improves house layouts so each house supports five population.',
    cost: { food: 0, wood: 250, gold: 0, stone: 150 },
    path: 'housing',
    icon: 'house',
    x: 9.5,
    y: 90,
    requires: [TechId.BARRACKS_PIKEMEN],
    unlocks: ['Houses +5 pop'],
  },
  {
    id: TechId.HOUSING_II,
    name: 'Manor Housing',
    description: 'Upgrades housing compounds so each house supports eight population.',
    cost: { food: 0, wood: 600, gold: 0, stone: 400 },
    path: 'housing',
    icon: 'house',
    x: 29.5,
    y: 90,
    requires: [TechId.HOUSING_I],
    unlocks: ['Houses +8 pop'],
  },
  {
    id: TechId.LUMBER_CREWS,
    name: 'Lumber Crews',
    description: 'Lumber huts can train up to three workers.',
    cost: { food: 0, wood: 250, gold: 0, stone: 0 },
    path: 'economy',
    icon: 'axe',
    x: 9.5,
    y: 54,
    requires: [TechId.LUMBER_HUTS, TechId.STONE_MINES],
    unlocks: ['3 wood workers'],
  },
  {
    id: TechId.MINING_CREWS,
    name: 'Mining Crews',
    description: 'Stone and gold worksites can train up to three workers.',
    cost: { food: 0, wood: 300, gold: 0, stone: 250 },
    path: 'economy',
    icon: 'pick',
    x: 29.5,
    y: 54,
    requires: [TechId.LUMBER_CREWS],
    unlocks: ['3 mine workers'],
  },
  {
    id: TechId.CASTLE_AGE,
    name: 'Castle Age',
    description: 'Advance the town center into the Castle Age.',
    cost: { food: 0, wood: 1000, gold: 0, stone: 800 },
    path: 'age',
    icon: 'castle',
    x: 49.5,
    y: 18,
    requiresAny: [
      [TechId.BARRACKS_PIKEMEN, TechId.ARCHERS],
      [TechId.LUMBER_CREWS, TechId.MINING_CREWS],
    ],
    unlocks: ['Castle Town Center'],
  },
  {
    id: TechId.GOLD_MINES,
    name: 'Gold Mines',
    description: 'Unlocks gold extraction. Further Castle research costs gold.',
    cost: { food: 0, wood: 500, gold: 0, stone: 500 },
    path: 'castle',
    icon: 'gold',
    x: 69.5,
    y: 18,
    requiresAge: AgeId.CASTLE,
    unlocks: ['Gold Mine'],
  },
  {
    id: TechId.KNIGHTS,
    name: 'Knights',
    description: 'Unlocks the stable and mounted heavy cavalry.',
    cost: { food: 0, wood: 0, gold: 700, stone: 0 },
    path: 'castle',
    icon: 'horse',
    x: 89.5,
    y: 18,
    requires: [TechId.GOLD_MINES],
    requiresAge: AgeId.CASTLE,
    unlocks: ['Stable', 'Knights'],
  },
  {
    id: TechId.FARMS,
    name: 'Farm Yields',
    description: 'Improves farm harvests so each work cycle produces more food.',
    cost: { food: 0, wood: 300, gold: 0, stone: 150 },
    path: 'food',
    icon: 'farm',
    x: 9.5,
    y: 126,
    requires: [TechId.BARRACKS_PIKEMEN],
    unlocks: ['Farms +3 food'],
  },
  {
    id: TechId.FARMS_II,
    name: 'Crop Rotation',
    description: 'A second farm upgrade for stronger sustained food income.',
    cost: { food: 0, wood: 600, gold: 0, stone: 350 },
    path: 'food',
    icon: 'farm',
    x: 29.5,
    y: 126,
    requires: [TechId.FARMS],
    unlocks: ['Farms +4 food'],
  },
  {
    id: TechId.MILLS,
    name: 'Mills',
    description: 'Unlocks food drop-off mills that increase delivered farm food.',
    cost: { food: 0, wood: 450, gold: 0, stone: 300 },
    path: 'food',
    icon: 'mill',
    x: 49.5,
    y: 126,
    requires: [TechId.FARMS_II],
    unlocks: ['Mill', 'Food drop-off bonus'],
  },
  {
    id: TechId.GUNPOWDER_AGE,
    name: 'Gunpowder Age',
    description: 'Advance past Castle Age and unlock foundries, gunmen, and field cannons.',
    cost: { food: 0, wood: 1400, gold: 1200, stone: 1000 },
    path: 'age',
    icon: 'gunpowder',
    x: 109.5,
    y: 18,
    requires: [TechId.GOLD_MINES, TechId.KNIGHTS],
    requiresAge: AgeId.CASTLE,
    unlocks: ['Foundry', 'Gunmen', 'Field Cannons'],
  },
];

export function techDef(techId: TechIdValue): TechDef | null {
  return TECH_TREE.find((tech) => tech.id === techId) ?? null;
}

export function createStartingTechSet(): Set<TechIdValue> {
  return new Set(STARTING_TECHS);
}

export function createStartingTechSetForAge(ageId: number): Set<TechIdValue> {
  const techs = createStartingTechSet();
  if (ageId >= AgeId.CASTLE) {
    techs.add(TechId.BARRACKS_PIKEMEN);
    techs.add(TechId.ARCHERS);
    techs.add(TechId.HOUSING_I);
    techs.add(TechId.LUMBER_CREWS);
    techs.add(TechId.MINING_CREWS);
  }
  if (ageId >= AgeId.GUNPOWDER) {
    techs.add(TechId.GOLD_MINES);
    techs.add(TechId.KNIGHTS);
    techs.add(TechId.FARMS);
    techs.add(TechId.FARMS_II);
    techs.add(TechId.MILLS);
    techs.add(TechId.HOUSING_II);
  }
  return techs;
}

export function createAllTechSet(): Set<TechIdValue> {
  return new Set(TECH_TREE.map((tech) => tech.id));
}

export function hasTech(world: TechStateWorld, playerId: number, techId: TechIdValue): boolean {
  if (techId === TechId.CASTLE_AGE) {
    return (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.CASTLE;
  }
  if (techId === TechId.GUNPOWDER_AGE) {
    return (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.GUNPOWDER;
  }
  return world.researchedTechs[playerId]?.has(techId) ?? false;
}

export function techPrereqsMet(
  world: TechStateWorld,
  playerId: number,
  tech: TechDef
): boolean {
  if (tech.requiresAge !== undefined && (world.ages[playerId]?.current ?? 0) < tech.requiresAge) {
    return false;
  }
  if (tech.requires?.some((id) => !hasTech(world, playerId, id))) return false;
  if (tech.requiresAny) {
    return tech.requiresAny.some((group) => group.every((id) => hasTech(world, playerId, id)));
  }
  return true;
}

export function techStatus(
  world: TechStateWorld,
  playerId: number,
  techId: TechIdValue
): TechStatus {
  const tech = techDef(techId);
  if (!tech) return 'locked';
  if (world.campaign?.lockedTechs.includes(techId)) return 'locked';
  if (techId === TechId.CASTLE_AGE || techId === TechId.GUNPOWDER_AGE) {
    const age = world.ages[playerId];
    if (!age) return 'locked';
    const targetAge = techId === TechId.CASTLE_AGE ? AgeId.CASTLE : AgeId.GUNPOWDER;
    if (age.current >= targetAge) return 'researched';
    if (age.progress >= 0 && age.current === targetAge - 1) return 'researching';
  } else if (hasTech(world, playerId, techId)) {
    return 'researched';
  }
  return techPrereqsMet(world, playerId, tech) ? 'available' : 'locked';
}

export function isBuildingUnlocked(
  world: TechStateWorld,
  playerId: number,
  defId: number
): boolean {
  switch (defId) {
    case BuildingDefId.TOWN_CENTER:
      return true;
    case BuildingDefId.LUMBER_CAMP:
      return hasTech(world, playerId, TechId.LUMBER_HUTS);
    case BuildingDefId.STONE_QUARRY:
      return hasTech(world, playerId, TechId.STONE_MINES);
    case BuildingDefId.HOUSE:
    case BuildingDefId.BARRACKS:
      return hasTech(world, playerId, TechId.BARRACKS_PIKEMEN);
    case BuildingDefId.ARCHERY_RANGE:
      return false;
    case BuildingDefId.DEFENSIVE_TOWER:
      return hasTech(world, playerId, TechId.ARCHERS) ||
        (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.CASTLE;
    case BuildingDefId.GOLD_MINE:
      return hasTech(world, playerId, TechId.GOLD_MINES);
    case BuildingDefId.STABLE:
      return hasTech(world, playerId, TechId.KNIGHTS);
    case BuildingDefId.FARM:
      return hasTech(world, playerId, TechId.LUMBER_HUTS);
    case BuildingDefId.MILL:
      return hasTech(world, playerId, TechId.MILLS);
    case BuildingDefId.FOUNDRY:
      return (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.GUNPOWDER;
    default:
      return false;
  }
}

export function isUnitUnlocked(
  world: TechStateWorld,
  playerId: number,
  defId: number
): boolean {
  switch (defId) {
    case UnitDefId.VILLAGER:
      return true;
    case UnitDefId.SPEARMAN:
      return hasTech(world, playerId, TechId.BARRACKS_PIKEMEN);
    case UnitDefId.ARCHER:
      return hasTech(world, playerId, TechId.ARCHERS);
    case UnitDefId.SCOUT_CAVALRY:
      return hasTech(world, playerId, TechId.KNIGHTS);
    case UnitDefId.GUNMAN:
    case UnitDefId.CANNON:
      return (world.ages[playerId]?.current ?? AgeId.DARK) >= AgeId.GUNPOWDER;
    case UnitDefId.MACHINE_GUN:
      return false;
    default:
      return false;
  }
}

export function worksiteWorkerSlotsForKind(
  world: TechStateWorld,
  playerId: number,
  kind: number
): number {
  if (kind === ResourceKindId.WOOD) {
    return hasTech(world, playerId, TechId.LUMBER_CREWS) ? 3 : 1;
  }
  if (kind === ResourceKindId.STONE || kind === ResourceKindId.GOLD) {
    return hasTech(world, playerId, TechId.MINING_CREWS) ? 3 : 1;
  }
  if (kind === ResourceKindId.FOOD) {
    return 1;
  }
  return 1;
}
