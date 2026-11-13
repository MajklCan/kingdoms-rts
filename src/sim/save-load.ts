/**
 * Save games. Public barrel for the save/ modules:
 *   save/schema.ts     versioned save format (SavedGameV1 and friends) and parsing
 *   save/serialize.ts  SimWorld -> SavedGameV1
 *   save/load.ts       SavedGameV1 -> SimWorld (entity restore and eid remapping)
 * Keep this file a barrel: add new code to the module that owns it.
 */

export { LATE_GAME_TEST_SAVE_ID, SAVE_VERSION, parseSavedGame } from './save/schema';
export type {
  SavedAiPlayerStateV1,
  SavedCampaignV1,
  SavedEntityV1,
  SavedGameV1,
  SavedMapV1,
  SavedVisibilityV1,
} from './save/schema';
export { createLateGameTestSave, serializeSimWorld } from './save/serialize';
export { loadSimWorldSnapshot } from './save/load';
