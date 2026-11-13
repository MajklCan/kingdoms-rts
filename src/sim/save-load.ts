/**
 * Save games. Public barrel for the save/ modules:
 *   save/schema.ts     versioned save format (SavedGame and friends), parsing, migration
 *   save/serialize.ts  SimWorld -> SavedGame
 *   save/load.ts       SavedGame -> SimWorld (entity restore and eid remapping)
 * Keep this file a barrel: add new code to the module that owns it.
 */

export {
  LATE_GAME_TEST_SAVE_ID,
  SAVE_VERSION,
  migrateSavedGame,
  parseSavedGame,
  sanitizeSavedMatchStats,
} from './save/schema';
export type {
  SavedAiPlayerStateV1,
  SavedCampaignV1,
  SavedEntityV1,
  SavedGame,
  SavedGameV1,
  SavedGameV2,
  SavedMapV1,
  SavedVisibilityV1,
} from './save/schema';
export { createLateGameTestSave, serializeSimWorld } from './save/serialize';
export { loadSimWorldSnapshot } from './save/load';
