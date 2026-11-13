/**
 * Player ids and gameplay tuning constants shared by several systems.
 */

/** Number of players supported (0=Gaia, 1=human, 2=AI). For Stage 0 we use 0 + 1. */
export const MAX_PLAYERS = 3;
/** The human player's id. All UI commands route through this. */
export const LOCAL_PLAYER_ID = 1;

/** Demo soft pop cap per GDD. */
export const POP_CAP_HARD_LIMIT = 75;
export const AI_PLAYER_ID = 2;
