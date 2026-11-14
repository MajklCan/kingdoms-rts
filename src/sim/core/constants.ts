/**
 * Player ids and gameplay tuning constants shared by several systems.
 */

/** Number of players supported (0=Gaia, 1=human, 2=AI). For Stage 0 we use 0 + 1. */
export const MAX_PLAYERS = 3;
/** The human player's id. All UI commands route through this. */
export const LOCAL_PLAYER_ID = 1;

/** Demo soft pop cap per GDD. */
export const POP_CAP_HARD_LIMIT = 75;
export const TREE_RESOURCE_AMOUNT = 100;
export const LOCAL_GOLD_DEPOSIT_AMOUNT = 650;
export const LOCAL_STONE_DEPOSIT_AMOUNT = 600;
export const TREE_EDGE_BAND_TILES = 10;
export const TREE_REGEN_BUILDING_CLEARANCE = 4;
export const RESOURCE_GATHER_DISTANCE = 0.55;
/**
 * A gatherer whose walk has ended may start work this far from the node.
 * Contact points sit ~0.52 from a tree, so unit separation can nudge a worker
 * that reached one just past RESOURCE_GATHER_DISTANCE; it then re-pathed out
 * and back forever without gathering.
 */
export const RESOURCE_GATHER_REACH = 0.72;
export const DROP_OFF_EDGE_DISTANCE = 0.24;
export const FARM_WORK_EDGE_DISTANCE = 0.65;
// Arena layout as fractions of MAP.HEIGHT (south/high = player, north/low =
// enemy). Each wire belt sits just SOUTH of (in front of) its rifle line; the
// forward machine-gun nests sit just NORTH of the forward belt (behind the
// wire, firing south through it). There is a broad no-man's-land between the
// player jump-off and the forward belt so nothing is in range at spawn.
export const ZBOROV_FORWARD_LINE_FRAC = 0.48;
export const ZBOROV_MID_LINE_FRAC = 0.375;
export const ZBOROV_REAR_LINE_FRAC = 0.27;
export const FORMATION_MODE_FREE = 0;
export const FORMATION_MODE_LINE = 1;
export const FORMATION_MODE_DEFAULT = FORMATION_MODE_FREE;
export const FORMATION_FACING_DEFAULT = 0;
export const ATTACK_RANGE_TOLERANCE = 0.5;
export const AI_PLAYER_ID = 2;
