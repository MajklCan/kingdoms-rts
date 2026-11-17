/**
 * Static game definitions - buildings + units. Hard-coded TypeScript tables for now;
 * will migrate to JSON data files in Phase 9 (DataRegistry).
 *
 * Cost units: integer resource amounts.
 * Time units: simulation ticks (20 per second).
 */

import { SIM } from '../config';

export interface CostTuple {
  food: number;
  wood: number;
  gold: number;
  stone: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  hp: number;
  cost: CostTuple;
  buildTimeTicks: number;
  /** Pop slots added on completion. */
  popProvided: number;
  /** Footprint in tiles (1×1 for Phase 6; real 3×3 etc. comes later). */
  footprint: { w: number; h: number };
  /** Render half-width as a fraction of TILE_W/2 - visual scale. */
  visualScale: number;
  /** Fill color for the building body. */
  color: number;
  /** True if this building accepts resources for drop-off. */
  isDropOff: boolean;
  /** Bitmask of accepted resource kinds (1=F, 2=W, 4=G, 8=S). */
  dropOffMask: number;
  /** Unit defIds this building can train. */
  trains: string[];
  /** ResourceKindId harvested automatically by this specialist building. */
  harvestKind?: number;
  /** False for self-producing worksites such as farms. Default is true. */
  requiresNearbyResource?: boolean;
  /** Max worksite workers this building can employ. One is free; extras are trained. */
  workerSlots?: number;
  /** Nearby resource scan radius in tiles. */
  harvestRadius?: number;
  /** Progress ticks needed for one resource per assigned worker. */
  harvestRateTicks?: number;
  /** Optional static-defense combat stats. */
  combat?: {
    atk: number;
    range: number;
    attackSpeedTicks: number;
    aggroRadius: number;
  };
}

export interface UnitDef {
  id: string;
  name: string;
  hp: number;
  cost: CostTuple;
  trainTimeTicks: number;
  popCost: number;
  /** Building id named in "select a ... to train" hints. Producers are the
   *  buildings whose `trains` lists the unit (archers: barracks and range). */
  trainAt: string;
}

/** Building defIds - index into BUILDING_TABLE. Keep in sync. */
export const BuildingDefId = {
  TOWN_CENTER: 0,
  HOUSE: 1,
  FARM: 2,
  BARRACKS: 3,
  ARCHERY_RANGE: 4,
  STABLE: 5,
  LUMBER_CAMP: 6,
  GOLD_MINE: 7,
  STONE_QUARRY: 8,
  DEFENSIVE_TOWER: 9,
  FOUNDRY: 10,
  WALL: 11,
  MILL: 12,
} as const;

export type BuildingDefIdValue =
  (typeof BuildingDefId)[keyof typeof BuildingDefId];

/** The defensive tower's arrow fire. */
const TOWER_COMBAT = {
  atk: 10,
  range: 7,
  attackSpeedTicks: Math.round(SIM.TICK_HZ * 1.35),
  aggroRadius: 8,
} as const;

/** How much further than a tower the town center shoots, in tiles. */
export const TOWN_CENTER_RANGE_BONUS = 2;

/** The town center defends itself with the tower's arrows (same damage and
 *  rate of fire), from further out. Its sight (visibility.ts) covers the range. */
const TOWN_CENTER_COMBAT = {
  ...TOWER_COMBAT,
  range: TOWER_COMBAT.range + TOWN_CENTER_RANGE_BONUS,
  aggroRadius: TOWER_COMBAT.aggroRadius + TOWN_CENTER_RANGE_BONUS,
} as const;

export const BUILDING_TABLE: BuildingDef[] = [
  {
    id: 'TOWN_CENTER',
    name: 'Town Center',
    hp: 2400,
    cost: { food: 0, wood: 275, gold: 0, stone: 100 },
    buildTimeTicks: 0, // pre-placed in Phase 6
    popProvided: 5,
    /** 3×3 tiles - matches the rendered footprint of the voxel TC sprite. */
    footprint: { w: 3, h: 3 },
    visualScale: 1.8,
    color: 0x2e86de,
    isDropOff: true,
    dropOffMask: 0b1111,
    trains: ['VILLAGER'],
    combat: { ...TOWN_CENTER_COMBAT },
  },
  {
    id: 'HOUSE',
    name: 'House',
    hp: 550,
    cost: { food: 0, wood: 80, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 15),
    popProvided: 3,
    footprint: { w: 1, h: 1 },
    visualScale: 0.7,
    color: 0x8b6f47,
    isDropOff: false,
    dropOffMask: 0,
    trains: [],
  },
  {
    id: 'FARM',
    name: 'Farm',
    hp: 600,
    cost: { food: 0, wood: 50, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 12),
    popProvided: 0,
    footprint: { w: 2, h: 2 },
    visualScale: 0.9,
    color: 0x6bbf52,
    isDropOff: false,
    dropOffMask: 0,
    trains: [],
    harvestKind: 0,
    requiresNearbyResource: false,
    workerSlots: 1,
    harvestRadius: 0,
    harvestRateTicks: Math.round(SIM.TICK_HZ * 1.25),
  },
  {
    id: 'BARRACKS',
    name: 'Barracks',
    hp: 1200,
    cost: { food: 0, wood: 160, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 30),
    popProvided: 0,
    /** 2×2 tiles - the barracks sprite is wide. */
    footprint: { w: 2, h: 2 },
    visualScale: 1.1,
    color: 0x5d4037,
    isDropOff: false,
    dropOffMask: 0,
    trains: ['SPEARMAN', 'ARCHER', 'COMMANDER'],
  },
  {
    id: 'ARCHERY_RANGE',
    name: 'Archery Range',
    hp: 1500,
    cost: { food: 0, wood: 180, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 35),
    popProvided: 0,
    footprint: { w: 2, h: 2 },
    visualScale: 1.1,
    color: 0x8e6d3b,
    isDropOff: false,
    dropOffMask: 0,
    trains: ['ARCHER'],
  },
  {
    id: 'STABLE',
    name: 'Stable',
    hp: 1500,
    cost: { food: 0, wood: 180, gold: 0, stone: 80 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 40),
    popProvided: 0,
    footprint: { w: 2, h: 2 },
    visualScale: 1.15,
    color: 0x6f4a26,
    isDropOff: false,
    dropOffMask: 0,
    trains: ['SCOUT_CAVALRY'],
  },
  {
    id: 'LUMBER_CAMP',
    name: 'Lumber Hut',
    hp: 600,
    cost: { food: 0, wood: 80, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 8),
    popProvided: 0,
    footprint: { w: 1, h: 1 },
    visualScale: 0.95,
    color: 0x6f4a26,
    isDropOff: true,
    dropOffMask: 0b0010,
    trains: [],
    harvestKind: 1,
    workerSlots: 3,
    harvestRadius: 42,
    harvestRateTicks: Math.round(SIM.TICK_HZ * 1.15),
  },
  {
    id: 'GOLD_MINE',
    name: 'Gold Mine',
    hp: 700,
    cost: { food: 0, wood: 100, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 12),
    popProvided: 0,
    footprint: { w: 1, h: 1 },
    visualScale: 1.0,
    color: 0xc89c2c,
    isDropOff: true,
    dropOffMask: 0b0100,
    trains: [],
    harvestKind: 2,
    workerSlots: 3,
    harvestRadius: 6,
    harvestRateTicks: Math.round(SIM.TICK_HZ * 1.55),
  },
  {
    id: 'STONE_QUARRY',
    name: 'Stone Quarry',
    hp: 700,
    cost: { food: 0, wood: 90, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 12),
    popProvided: 0,
    footprint: { w: 1, h: 1 },
    visualScale: 1.0,
    color: 0x8c8a82,
    isDropOff: true,
    dropOffMask: 0b1000,
    trains: [],
    harvestKind: 3,
    workerSlots: 3,
    harvestRadius: 6,
    harvestRateTicks: Math.round(SIM.TICK_HZ * 1.45),
  },
  {
    id: 'DEFENSIVE_TOWER',
    name: 'Defensive Tower',
    hp: 750,
    cost: { food: 0, wood: 125, gold: 0, stone: 175 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 45),
    popProvided: 0,
    footprint: { w: 1, h: 1 },
    visualScale: 1.0,
    color: 0xb89e74,
    isDropOff: false,
    dropOffMask: 0,
    trains: [],
    combat: { ...TOWER_COMBAT },
  },
  {
    id: 'FOUNDRY',
    name: 'Foundry',
    hp: 1700,
    cost: { food: 0, wood: 250, gold: 150, stone: 200 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 50),
    popProvided: 0,
    footprint: { w: 2, h: 2 },
    visualScale: 1.15,
    color: 0x5f6569,
    isDropOff: false,
    dropOffMask: 0,
    trains: ['GUNMAN', 'CANNON'],
  },
  {
    id: 'WALL',
    name: 'Palisade Wall',
    hp: 400,
    cost: { food: 0, wood: 0, gold: 0, stone: 0 },
    buildTimeTicks: 0,
    popProvided: 0,
    footprint: { w: 1, h: 1 },
    visualScale: 0.95,
    color: 0x6f4a26,
    isDropOff: false,
    dropOffMask: 0,
    trains: [],
  },
  {
    id: 'MILL',
    name: 'Mill',
    hp: 850,
    cost: { food: 0, wood: 140, gold: 0, stone: 80 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 24),
    popProvided: 0,
    footprint: { w: 2, h: 2 },
    visualScale: 1.05,
    color: 0xb78343,
    isDropOff: true,
    dropOffMask: 0b0001,
    trains: [],
  },
];

/** Unit defIds - index into UNIT_TABLE. */
export const UnitDefId = {
  VILLAGER: 0,
  /** Legacy id retained for old saves; no current building trains it. */
  MILITIA: 1,
  ARCHER: 2,
  SPEARMAN: 3,
  SCOUT_CAVALRY: 4,
  GUNMAN: 5,
  CANNON: 6,
  MACHINE_GUN: 7,
  MORTAR: 8,
  COMMANDER: 9,
} as const;

export type UnitDefIdValue = (typeof UnitDefId)[keyof typeof UnitDefId];

export const UNIT_TABLE: UnitDef[] = [
  {
    id: 'VILLAGER',
    name: 'Villager',
    hp: 25,
    cost: { food: 0, wood: 50, gold: 0, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 20),
    popCost: 1,
    trainAt: 'TOWN_CENTER',
  },
  {
    id: 'MILITIA',
    name: 'Militia',
    hp: 40,
    cost: { food: 60, wood: 0, gold: 20, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 21),
    popCost: 1,
    trainAt: 'BARRACKS',
  },
  {
    id: 'ARCHER',
    name: 'Archer',
    hp: 35,
    cost: { food: 35, wood: 45, gold: 0, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 22),
    popCost: 1,
    trainAt: 'BARRACKS',
  },
  {
    id: 'SPEARMAN',
    name: 'Pikeman',
    hp: 55,
    cost: { food: 45, wood: 25, gold: 0, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 18),
    popCost: 1,
    trainAt: 'BARRACKS',
  },
  {
    id: 'SCOUT_CAVALRY',
    name: 'Scout Cavalry',
    hp: 60,
    // No gold: riders are a ring I unit now, and gold mines open in ring II.
    cost: { food: 80, wood: 40, gold: 0, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 28),
    popCost: 1,
    trainAt: 'STABLE',
  },
  {
    id: 'GUNMAN',
    name: 'Gunman',
    hp: 45,
    cost: { food: 40, wood: 0, gold: 55, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 32),
    popCost: 1,
    trainAt: 'FOUNDRY',
  },
  {
    id: 'CANNON',
    name: 'Field Cannon',
    hp: 120,
    cost: { food: 0, wood: 120, gold: 180, stone: 120 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 45),
    popCost: 3,
    trainAt: 'FOUNDRY',
  },
  {
    id: 'MACHINE_GUN',
    name: 'Machine Gun',
    hp: 70,
    cost: { food: 0, wood: 80, gold: 220, stone: 60 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 38),
    popCost: 2,
    trainAt: 'TOTAL_WAR_DEPOT',
  },
  {
    id: 'MORTAR',
    name: 'Mortar Team',
    hp: 55,
    cost: { food: 0, wood: 100, gold: 175, stone: 90 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 42),
    popCost: 2,
    trainAt: 'TOTAL_WAR_DEPOT',
  },
  {
    id: 'COMMANDER',
    name: 'Commander',
    hp: 200,
    cost: { food: 150, wood: 0, gold: 120, stone: 0 },
    trainTimeTicks: Math.round(SIM.TICK_HZ * 40),
    popCost: 1,
    trainAt: 'BARRACKS',
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Age progression.
// ────────────────────────────────────────────────────────────────────────────

export const AgeId = {
  DARK: 0,
  CASTLE: 1,
  GUNPOWDER: 2,
  TOTAL_WAR: 3,
} as const;

export type AgeIdValue = (typeof AgeId)[keyof typeof AgeId];

export interface AgeDef {
  id: AgeIdValue;
  name: string;
}

/**
 * Eras. No research advances them any more: the era is the highest tech ring
 * a player has opened (tech-tree.ts ringEra), and it drives building looks.
 * Total War is scaffolded but unreachable.
 */
export const AGE_TABLE: AgeDef[] = [
  { id: AgeId.DARK, name: 'Dark Age' },
  { id: AgeId.CASTLE, name: 'Castle Age' },
  { id: AgeId.GUNPOWDER, name: 'Gunpowder Age' },
  { id: AgeId.TOTAL_WAR, name: 'Total War Age' },
];

export function getAgeDef(ageId: number): AgeDef | null {
  return AGE_TABLE[ageId] ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Wall tiers. One WALL def; cost, build time and hp follow the owner's wall
// research (palisade, then Stone Walls, then Brick Walls). Campaign preset
// walls keep the base def (400 hp) until their owner researches a new tier.
// ────────────────────────────────────────────────────────────────────────────

export interface WallTier {
  name: string;
  hp: number;
  /** Cost per wall tile. */
  cost: CostTuple;
  buildTimeTicks: number;
}

/** Ascending: palisade, stone, brick (tech-tree.ts wallTierIndex picks one). */
export const WALL_TIERS: readonly WallTier[] = [
  {
    name: 'Palisade Wall',
    hp: 400,
    cost: { food: 0, wood: 2, gold: 0, stone: 0 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 4),
  },
  {
    name: 'Stone Wall',
    hp: 1200,
    cost: { food: 0, wood: 0, gold: 0, stone: 5 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 8),
  },
  {
    name: 'Brick Wall',
    hp: 2000,
    cost: { food: 0, wood: 0, gold: 0, stone: 6 },
    buildTimeTicks: Math.round(SIM.TICK_HZ * 10),
  },
];

export function getWallTier(tierIndex: number): WallTier {
  return WALL_TIERS[Math.max(0, Math.min(WALL_TIERS.length - 1, tierIndex))];
}

/** Look up a building def by its numeric id (the index). */
export function getBuildingDef(defId: number): BuildingDef | null {
  return BUILDING_TABLE[defId] ?? null;
}

/** Look up a unit def by its numeric id (the index). */
export function getUnitDef(defId: number): UnitDef | null {
  return UNIT_TABLE[defId] ?? null;
}

/** Cost check - returns true iff the player can afford. */
export function canAfford(
  bank: Int32Array,
  cost: CostTuple
): boolean {
  return (
    bank[0] >= cost.food &&
    bank[1] >= cost.wood &&
    bank[2] >= cost.gold &&
    bank[3] >= cost.stone
  );
}

/** Subtract a cost from a bank in place. Caller should ensure canAfford() first. */
export function spend(bank: Int32Array, cost: CostTuple): void {
  bank[0] -= cost.food;
  bank[1] -= cost.wood;
  bank[2] -= cost.gold;
  bank[3] -= cost.stone;
}

/** Refund a cost into a bank. */
export function refund(bank: Int32Array, cost: CostTuple): void {
  bank[0] += cost.food;
  bank[1] += cost.wood;
  bank[2] += cost.gold;
  bank[3] += cost.stone;
}
