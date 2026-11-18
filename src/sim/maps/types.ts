/**
 * Tile, map id and map data types shared by every generator.
 */

export const TileType = {
  GRASS: 0,
  FOREST: 1, // grass with extra trees scattered
  DIRT: 2,
  SAND: 3,
  WATER: 4,
  WATER_SHALLOW: 5,
  STONE: 6,
  BRIDGE: 7,
  MUD: 8,
  SNOW: 9,
  SNOW_FOREST: 10,
  ICE: 11,
  PACKED_SNOW: 12,
  BARBED_WIRE: 13, // walkable WW1 wire entanglement - bogs units to a crawl
} as const;

export type TileTypeValue = (typeof TileType)[keyof typeof TileType];

export const MapId = {
  RIVERLANDS: 'riverlands',
  BOHEMIAN_BORDER_FOREST: 'bohemian_border_forest',
  ORE_MOUNTAIN_PASS: 'ore_mountain_pass',
  MACHOVO_JEZERO: 'machovo_jezero',
  SILESIAN_MARSH: 'silesian_marsh',
  SUDOMER_PONDS: 'sudomer_ponds',
  KRKONOSE_WINTER_CROWN: 'krkonose_winter_crown',
  ZBOROV_LINES: 'zborov_lines',
  FLOODED_BASIN: 'flooded_basin',
  BLANIK_NIGHT_WATCH: 'blanik_night_watch',
  MILESOVKA_UPLANDS: 'milesovka_uplands',
  ADRSPACH_ROCK_TOWN: 'adrspach_rock_town',
  MORAVSKY_KRAS: 'moravsky_kras',
} as const;

export type MapIdValue = (typeof MapId)[keyof typeof MapId];

export const MapFeatureKind = {
  ROCK_SPIRE: 'rock_spire',
  LINDEN_TREE: 'linden_tree',
} as const;

export type MapFeatureKindValue = (typeof MapFeatureKind)[keyof typeof MapFeatureKind];

export interface MapFeature {
  kind: MapFeatureKindValue;
  x: number;
  y: number;
  size?: number;
}

export interface MapDef {
  id: MapIdValue;
  name: string;
  description: string;
  /** Played at night unless the match setup says otherwise. */
  night?: boolean;
  /** Built for a campaign mission: not offered in skirmish setup. */
  campaignOnly?: boolean;
  /** A large map (MAP.LARGE_SIZE), labelled as such in the setup. */
  large?: boolean;
}

/** How rich an authored gold or stone node is (amounts live in deposit-sites.ts). */
export type MapDepositTier = 'center' | 'flank' | 'natural' | 'scattered';

/**
 * An authored gold or stone node on player 1's side of a point-mirrored map.
 * World creation places it together with its mirror through the middle
 * between the two towns, so both sides get the same.
 */
export interface MapDeposit {
  kind: 'gold' | 'stone';
  x: number;
  y: number;
  tier: MapDepositTier;
}

export interface MapData {
  /** Size in tiles. Standard maps are MAP.WIDTH x MAP.HEIGHT; large maps are
   *  bigger. Every index into tiles/elevation is y * width + x. */
  width: number;
  height: number;
  /** tiles[y][x] - TileType. */
  tiles: Uint8Array;
  /** elevation[y][x] - 0..7. */
  elevation: Uint8Array;
  /** Set of indices (y*W + x) where bridges should be spawned. */
  bridgePositions: Array<{ x: number; y: number }>;
  /** Walkability grid for the pathfinder: 0 = walkable, 1 = blocked. */
  walkability: number[][];
  /** Suggested player spawn positions (one per player id, [0]=unused). */
  spawns: Array<{ x: number; y: number }>;
  /** Decorative or blocking authored terrain features. */
  features: MapFeature[];
  /** Authored gold and stone, placed in mirrored pairs at world creation.
   *  Only read when the world is created, so saves do not carry it. */
  deposits?: MapDeposit[];
}
