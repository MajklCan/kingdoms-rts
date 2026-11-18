/**
 * The tech rings: 18 researches on five paths (arms, timber, mines, walls,
 * land) in three rings. Ring I is always open; ring N+1 opens when two paths
 * are "maxed" in ring N (every research of that path lying in ring N is done).
 * Research is instant. Every unit and building past the settlement is
 * unlocked by exactly one research (BUILDING_UNLOCK_TECH / UNIT_UNLOCK_TECH),
 * except the endless worksites, which come with ring II itself.
 *
 * The highest open ring is also the era the realm's buildings are drawn in:
 * ring I = Dark Age, II = Castle Age, III = Gunpowder Age. The sim writes it
 * to world.ages[p].current when a ring opens (systems/tech-rings.ts).
 *
 * Pure helpers only; the research command lives in systems/tech-rings.ts.
 */

import { AgeId, BuildingDefId, UnitDefId, type CostTuple } from './defs';
import { ResourceKindId } from './components';

export const TechId = {
  BARRACKS_PIKEMEN: 'barracks_pikemen',
  ARCHERS: 'archers',
  COMMANDER: 'commander',
  KNIGHTS: 'knights',
  LUMBER_CREWS: 'lumber_crews',
  HOUSING_I: 'housing_i',
  HOUSING_II: 'housing_ii',
  MINING_CREWS: 'mining_crews',
  GOLD_MINES: 'gold_mines',
  FOUNDRY: 'foundry',
  HOUFNICE: 'houfnice',
  PALISADES: 'palisades',
  WATCHTOWERS: 'watchtowers',
  STONE_WALLS: 'stone_walls',
  BRICK_WALLS: 'brick_walls',
  MILLS: 'mills',
  FARMS: 'farms',
  FARMS_II: 'farms_ii',
} as const;

export type TechIdValue = (typeof TechId)[keyof typeof TechId];
export type TechStatus = 'researched' | 'available' | 'locked';

export const TECH_PATHS = ['arms', 'timber', 'mines', 'walls', 'land'] as const;
export type TechPath = (typeof TECH_PATHS)[number];
export type TechRing = 1 | 2 | 3;
export const TECH_RINGS: readonly TechRing[] = [1, 2, 3];
/** Paths that must be maxed in a ring to open the next one. */
export const RING_PATHS_NEEDED = 2;
export const RING_NUMERALS: Record<TechRing, string> = { 1: 'I', 2: 'II', 3: 'III' };

export interface TechDef {
  id: TechIdValue;
  name: string;
  description: string;
  cost: CostTuple;
  path: TechPath;
  ring: TechRing;
  /** Every prerequisite: the same-path parent first, then any cross-path one. */
  parents: TechIdValue[];
  unlocks: string[];
}

export interface TechStateWorld {
  researchedTechs: Array<Set<TechIdValue>>;
  ages: Array<{ current: number }>;
  campaign?: { lockedTechs: TechIdValue[] } | null;
}

const cost = (wood: number, stone = 0, gold = 0): CostTuple => ({ food: 0, wood, gold, stone });

export const TECH_TREE: readonly TechDef[] = [
  // Arms.
  {
    id: TechId.BARRACKS_PIKEMEN, name: 'Barracks', path: 'arms', ring: 1, parents: [], cost: cost(250),
    description: 'Raise the land levy: barracks and pikemen, the first line of any army.',
    unlocks: ['Barracks', 'Pikeman'],
  },
  {
    id: TechId.ARCHERS, name: 'Archers', path: 'arms', ring: 1, parents: [TechId.BARRACKS_PIKEMEN], cost: cost(300, 200),
    description: 'Bowmakers for ranged infantry, trained at the barracks.',
    unlocks: ['Archer'],
  },
  {
    id: TechId.COMMANDER, name: 'Commander', path: 'arms', ring: 1, parents: [TechId.BARRACKS_PIKEMEN], cost: cost(200, 150),
    description: 'A veteran to lead the levy: one Commander per realm, trained at the barracks.',
    unlocks: ['Commander'],
  },
  {
    id: TechId.KNIGHTS, name: 'Cavalry', path: 'arms', ring: 1, parents: [TechId.BARRACKS_PIKEMEN], cost: cost(300, 200),
    description: 'Stables and scout cavalry: fast riders to scout, raid and run down archers. Another branch after Barracks.',
    unlocks: ['Stable', 'Scout Cavalry'],
  },
  // Timber.
  {
    id: TechId.LUMBER_CREWS, name: 'Lumber Crews', path: 'timber', ring: 1, parents: [], cost: cost(250),
    description: 'Lumber huts take three workers instead of one.',
    unlocks: ['3 wood workers per hut'],
  },
  {
    id: TechId.HOUSING_I, name: 'Housing I', path: 'timber', ring: 1, parents: [TechId.LUMBER_CREWS], cost: cost(250, 150),
    description: 'Houses hold five people instead of three, and the early limit of six houses is lifted.',
    unlocks: ['Houses +5 pop', 'Unlimited Houses'],
  },
  {
    id: TechId.HOUSING_II, name: 'Housing II', path: 'timber', ring: 2, parents: [TechId.HOUSING_I], cost: cost(600, 400),
    description: 'Town houses of the burghers: each house holds eight people.',
    unlocks: ['Houses +8 pop'],
  },
  // Mines.
  {
    id: TechId.MINING_CREWS, name: 'Mining Crews', path: 'mines', ring: 1, parents: [], cost: cost(300, 250),
    description: 'Stone quarries and gold mines take three workers instead of one.',
    unlocks: ['3 mine workers per site'],
  },
  {
    id: TechId.GOLD_MINES, name: 'Gold Mine', path: 'mines', ring: 2, parents: [TechId.MINING_CREWS], cost: cost(400, 300),
    description: 'Gold mines on the gold veins. Gold pays for gunmen, cannon and the late research.',
    unlocks: ['Gold Mine'],
  },
  {
    id: TechId.FOUNDRY, name: 'Foundry', path: 'mines', ring: 3, parents: [TechId.GOLD_MINES], cost: cost(800, 700, 800),
    description: 'Cast iron and powder: the foundry, which trains gunmen.',
    unlocks: ['Foundry', 'Gunman'],
  },
  {
    id: TechId.HOUFNICE, name: 'Cannons', path: 'mines', ring: 3, parents: [TechId.FOUNDRY], cost: cost(500, 400, 600),
    description: 'The field gun of the Hussite wagon forts, cast at the foundry.',
    unlocks: ['Field Cannon'],
  },
  // Walls.
  {
    id: TechId.PALISADES, name: 'Palisades', path: 'walls', ring: 1, parents: [], cost: cost(200),
    description: 'Sharpened stakes: palisade walls.',
    unlocks: ['Palisade Wall'],
  },
  {
    id: TechId.WATCHTOWERS, name: 'Towers', path: 'walls', ring: 1, parents: [TechId.PALISADES], cost: cost(200, 200),
    description: 'Defensive towers that shoot at enemies in range.',
    unlocks: ['Defensive Tower'],
  },
  {
    id: TechId.STONE_WALLS, name: 'Stone Walls', path: 'walls', ring: 2, parents: [TechId.WATCHTOWERS], cost: cost(300, 600),
    description: 'Walls of stone. Standing palisades are rebuilt in stone and gain its strength.',
    unlocks: ['Stone Wall'],
  },
  {
    id: TechId.BRICK_WALLS, name: 'Brick Walls', path: 'walls', ring: 3, parents: [TechId.STONE_WALLS], cost: cost(400, 800, 300),
    description: 'Thick brick walls that stand up to cannon. Standing walls gain their strength.',
    unlocks: ['Brick Wall'],
  },
  // Land.
  {
    id: TechId.MILLS, name: 'Mills', path: 'land', ring: 1, parents: [], cost: cost(450, 300),
    description: 'Mills: food dropped off at a mill counts half again.',
    unlocks: ['Mill', 'Food drop-off bonus'],
  },
  {
    id: TechId.FARMS, name: 'Farming I', path: 'land', ring: 2, parents: [TechId.MILLS], cost: cost(300, 150),
    description: 'Farms give three food per work cycle instead of two.',
    unlocks: ['Farms +3 food'],
  },
  {
    id: TechId.FARMS_II, name: 'Farming II', path: 'land', ring: 3, parents: [TechId.FARMS], cost: cost(600, 350),
    description: 'Three-field rotation: farms give four food per work cycle.',
    unlocks: ['Farms +4 food'],
  },
];

const TECH_BY_ID: ReadonlyMap<TechIdValue, TechDef> = new Map(TECH_TREE.map((tech) => [tech.id, tech]));

export function techDef(techId: TechIdValue): TechDef | null {
  return TECH_BY_ID.get(techId) ?? null;
}

export function isTechId(value: unknown): value is TechIdValue {
  return typeof value === 'string' && TECH_BY_ID.has(value as TechIdValue);
}

/** Researches of `path` lying in `ring` (empty when the path has no content there). */
export function techsInRing(path: TechPath, ring: TechRing): TechDef[] {
  return TECH_TREE.filter((tech) => tech.path === path && tech.ring === ring);
}

/** Paths with at least one research in `ring`. */
export function pathsWithContent(ring: TechRing): TechPath[] {
  return TECH_PATHS.filter((path) => techsInRing(path, ring).length > 0);
}

// ── Starting presets ───────────────────────────────────────────────────────

/** Every research lying in `ring`. */
export function techIdsInRing(ring: TechRing): TechIdValue[] {
  return TECH_TREE.filter((tech) => tech.ring === ring).map((tech) => tech.id);
}

/** Every research of rings 1..`ring`. */
export function techsThroughRing(ring: number): TechIdValue[] {
  return TECH_TREE.filter((tech) => tech.ring <= ring).map((tech) => tech.id);
}

/**
 * Starting-age preset: Dark = nothing, Castle = all of ring I (ring II open),
 * Gunpowder = rings I and II (ring III open), Total War = every research.
 */
export function createStartingTechSetForAge(ageId: number): Set<TechIdValue> {
  if (ageId >= AgeId.TOTAL_WAR) return createAllTechSet();
  return new Set(techsThroughRing(Math.max(0, ageId)));
}

export function createAllTechSet(): Set<TechIdValue> {
  return new Set(TECH_TREE.map((tech) => tech.id));
}

// ── Status ─────────────────────────────────────────────────────────────────

export function hasTech(world: TechStateWorld, playerId: number, techId: TechIdValue): boolean {
  return world.researchedTechs[playerId]?.has(techId) ?? false;
}

function isCampaignLocked(world: TechStateWorld, techId: TechIdValue): boolean {
  return world.campaign?.lockedTechs.includes(techId) ?? false;
}

/** Every research of `path` in `ring` is done (a path without content there is never maxed). */
export function isPathMaxed(world: TechStateWorld, playerId: number, path: TechPath, ring: TechRing): boolean {
  const techs = techsInRing(path, ring);
  return techs.length > 0 && techs.every((tech) => hasTech(world, playerId, tech.id));
}

export function maxedPaths(world: TechStateWorld, playerId: number, ring: TechRing): TechPath[] {
  return TECH_PATHS.filter((path) => isPathMaxed(world, playerId, path, ring));
}

/** A campaign that locks every research of a ring keeps that ring (and its era) shut. */
function isRingLockedByCampaign(world: TechStateWorld, ring: TechRing): boolean {
  const techs = TECH_TREE.filter((tech) => tech.ring === ring);
  return techs.every((tech) => isCampaignLocked(world, tech.id));
}

export function isRingOpen(world: TechStateWorld, playerId: number, ring: TechRing): boolean {
  if (ring === 1) return true;
  const previous = (ring - 1) as TechRing;
  return isRingOpen(world, playerId, previous) &&
    maxedPaths(world, playerId, previous).length >= RING_PATHS_NEEDED &&
    !isRingLockedByCampaign(world, ring);
}

/** The highest open ring. */
export function openRing(world: TechStateWorld, playerId: number): TechRing {
  if (isRingOpen(world, playerId, 3)) return 3;
  return isRingOpen(world, playerId, 2) ? 2 : 1;
}

/** Era (AgeId) the realm is drawn in when `ring` is its highest open ring. */
export function ringEra(ring: TechRing): number {
  return ring - 1;
}

export function techPrereqsMet(world: TechStateWorld, playerId: number, tech: TechDef): boolean {
  return isRingOpen(world, playerId, tech.ring) &&
    tech.parents.every((parent) => hasTech(world, playerId, parent));
}

export function techStatus(world: TechStateWorld, playerId: number, techId: TechIdValue): TechStatus {
  const tech = techDef(techId);
  if (!tech) return 'locked';
  if (hasTech(world, playerId, techId)) return 'researched';
  if (isCampaignLocked(world, techId)) return 'locked';
  return techPrereqsMet(world, playerId, tech) ? 'available' : 'locked';
}

/** Parents of `techId` the player has not researched yet, in tree order. */
export function missingParents(world: TechStateWorld, playerId: number, techId: TechIdValue): TechIdValue[] {
  return (techDef(techId)?.parents ?? []).filter((parent) => !hasTech(world, playerId, parent));
}

/** "Ring II opens when 2 paths are complete in ring I (1 of 2)". */
export function closedRingText(world: TechStateWorld, playerId: number, ring: TechRing): string {
  if (ring === 1) return '';
  const previous = (ring - 1) as TechRing;
  if (isRingLockedByCampaign(world, ring)) return `Ring ${RING_NUMERALS[ring]} is closed in this mission`;
  if (!isRingOpen(world, playerId, previous)) return closedRingText(world, playerId, previous);
  const done = Math.min(RING_PATHS_NEEDED, maxedPaths(world, playerId, previous).length);
  return `Ring ${RING_NUMERALS[ring]} opens when ${RING_PATHS_NEEDED} paths are complete in ring ` +
    `${RING_NUMERALS[previous]} (${done} of ${RING_PATHS_NEEDED})`;
}

/** Why `techId` cannot be researched yet, or undefined when it is not locked. */
export function techLockedReason(world: TechStateWorld, playerId: number, techId: TechIdValue): string | undefined {
  const tech = techDef(techId);
  if (!tech || techStatus(world, playerId, techId) !== 'locked') return undefined;
  if (isCampaignLocked(world, techId)) return 'Locked for this mission';
  const parts: string[] = [];
  if (!isRingOpen(world, playerId, tech.ring)) parts.push(closedRingText(world, playerId, tech.ring));
  const missing = missingParents(world, playerId, techId);
  if (missing.length > 0) parts.push(`Needs ${missing.map((id) => techDef(id)?.name ?? id).join(' and ')}`);
  return parts.join('. ');
}

// ── What each research unlocks ─────────────────────────────────────────────

/**
 * The research that unlocks each building; absent and not part of the
 * settlement = never buildable. The archery range is retired (archers come
 * from the barracks); ranges in old saves still stand and train archers.
 */
export const BUILDING_UNLOCK_TECH: Readonly<Partial<Record<number, TechIdValue>>> = {
  [BuildingDefId.BARRACKS]: TechId.BARRACKS_PIKEMEN,
  [BuildingDefId.STABLE]: TechId.KNIGHTS,
  [BuildingDefId.GOLD_MINE]: TechId.GOLD_MINES,
  [BuildingDefId.FOUNDRY]: TechId.FOUNDRY,
  [BuildingDefId.WALL]: TechId.PALISADES,
  [BuildingDefId.DEFENSIVE_TOWER]: TechId.WATCHTOWERS,
  [BuildingDefId.MILL]: TechId.MILLS,
};

/**
 * Mint, brickworks, forester's lodge: open with ring II (Castle Age), not a
 * research. Every research costs wood and stone, so a realm whose deposits
 * ran dry could never pay for the one that would save it.
 */
const ENDLESS_WORKSITE_BUILDINGS: ReadonlySet<number> = new Set([
  BuildingDefId.MINT,
  BuildingDefId.BRICKWORKS,
  BuildingDefId.FORESTER,
]);
export const ENDLESS_WORKSITE_RING: TechRing = 2;

const SETTLEMENT_BUILDINGS: ReadonlySet<number> = new Set([
  BuildingDefId.TOWN_CENTER,
  BuildingDefId.HOUSE,
  BuildingDefId.FARM,
  BuildingDefId.LUMBER_CAMP,
  BuildingDefId.STONE_QUARRY,
]);

/** The research that unlocks each unit; the villager needs none. */
export const UNIT_UNLOCK_TECH: Readonly<Partial<Record<number, TechIdValue>>> = {
  [UnitDefId.SPEARMAN]: TechId.BARRACKS_PIKEMEN,
  [UnitDefId.ARCHER]: TechId.ARCHERS,
  [UnitDefId.COMMANDER]: TechId.COMMANDER,
  [UnitDefId.SCOUT_CAVALRY]: TechId.KNIGHTS,
  [UnitDefId.GUNMAN]: TechId.FOUNDRY,
  [UnitDefId.CANNON]: TechId.HOUFNICE,
};

export function isBuildingUnlocked(world: TechStateWorld, playerId: number, defId: number): boolean {
  if (SETTLEMENT_BUILDINGS.has(defId)) return true;
  if (ENDLESS_WORKSITE_BUILDINGS.has(defId)) return isRingOpen(world, playerId, ENDLESS_WORKSITE_RING);
  const techId = BUILDING_UNLOCK_TECH[defId];
  return techId !== undefined && hasTech(world, playerId, techId);
}

/** Machine guns, mortars and militia have no research: never trainable. */
export function isUnitUnlocked(world: TechStateWorld, playerId: number, defId: number): boolean {
  if (defId === UnitDefId.VILLAGER) return true;
  const techId = UNIT_UNLOCK_TECH[defId];
  return techId !== undefined && hasTech(world, playerId, techId);
}

export function worksiteWorkerSlotsForKind(world: TechStateWorld, playerId: number, kind: number): number {
  if (kind === ResourceKindId.WOOD) {
    return hasTech(world, playerId, TechId.LUMBER_CREWS) ? 3 : 1;
  }
  if (kind === ResourceKindId.STONE || kind === ResourceKindId.GOLD) {
    return hasTech(world, playerId, TechId.MINING_CREWS) ? 3 : 1;
  }
  return 1;
}

/** Wall tier index the player builds and upgrades to: 0 palisade, 1 stone, 2 brick. */
export function wallTierIndex(world: TechStateWorld, playerId: number): number {
  if (hasTech(world, playerId, TechId.BRICK_WALLS)) return 2;
  return hasTech(world, playerId, TechId.STONE_WALLS) ? 1 : 0;
}
