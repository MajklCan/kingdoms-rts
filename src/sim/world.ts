/**
 * Public sim API. Re-exports the stable import surface (`@sim/world`) that
 * render, net, debug and tests build against. Implementation lives in:
 *   core/      world shape, constants, entity ids, queries, world creation
 *   factories/ spawn helpers and the late-game preset fixture
 *   input/     applyInput command handlers
 *   systems/   per-tick systems
 *   ai/        computer player
 *   missions/  campaign mission setup and scripted runtime
 *   step.ts    tick order
 * Keep this file a barrel: add new code to the module that owns it.
 */

export type {
  AgeState,
  AiDifficulty,
  AiEvent,
  AiPlan,
  AiPlayerState,
  CampaignObjectiveState,
  CampaignState,
  CombatEvent,
  CreateSimWorldOptions,
  GameEvent,
  LastSeenBuilding,
  MatchOutcome,
  PlayerMatchStats,
  PlayerVisibility,
  PopState,
  SimInput,
  SimWorld,
  SoundCue,
  SoundCueKind,
} from './core/types';
export { AI_PLAYER_ID, LOCAL_PLAYER_ID, MAX_PLAYERS, POP_CAP_HARD_LIMIT } from './core/constants';
export { addSimEntity, entityForNetId, netIdForEntity, removeSimEntity } from './core/entities';
export {
  buildingQuery,
  combatQuery,
  damageableQuery,
  deadQuery,
  dropOffQuery,
  foundationQuery,
  gathererQuery,
  movableQuery,
  positionQuery,
  producerQuery,
  resourceQuery,
  resourceWorksiteQuery,
  selectedQuery,
  townCenterQuery,
  unitQuery,
  worksiteWorkerQuery,
} from './core/queries';
export { getBuildingPopProvided } from './core/population';
export {
  findBuildingAt,
  findEntityNear,
  findNearestResource,
  findResourceAt,
  isEnemyOf,
} from './core/lookup';
export {
  clearSelection,
  pruneHiddenSelectionForPlayer,
  selectUnitsOfSameKindInRadius,
  setSelected,
} from './core/selection';
export { createSimWorld } from './core/create-world';
export { findIdleVillagers, isIdleVillager } from './core/idle-villagers';
export { clonePlayerStats, emptyPlayerStats } from './core/match-stats';
export {
  isSelectionRelativeInput,
  selectedCommandableEids,
  toSelfDescribingInput,
  type SelectionRelativeInput,
} from './input/self-describing';
export {
  spawnArcher,
  spawnCannon,
  spawnGunman,
  spawnMachineGun,
  spawnMortar,
  spawnScoutCavalry,
  spawnSpearman,
  spawnVillager,
} from './factories/units';
export {
  spawnCompletedBuilding,
  spawnFoundation,
  spawnResource,
  spawnTownCenter,
} from './factories/buildings';
export { createLateGameTestWorld } from './factories/late-game';
export { playerFormationFacing, playerFormationMode } from './input/formation';
export {
  createVisibilityState,
  createVisibilityStates,
  getPlayerVisibility,
  isBuildingFootprintVisibleTo,
  isBuildingVisibleTo,
  isEntityVisibleTo,
  isTileExploredBy,
  isTileVisibleTo,
  revealMapForPlayer,
  tileVisibilityIndex,
  updatePlayerVisibility,
} from './systems/visibility';
export { canStartCastleAge, canStartGunpowderAge } from './systems/age-tech';
export { getWorksiteWorkerSlots, worksiteUsesResourceNodes } from './systems/worksites';
export { canPlaceBuildingAt } from './input/buildings';
export { createAiPlayerState, normalizeAiDifficulty } from './ai/difficulty';
export { createCampaignWorld } from './missions/campaign-world';
export { step } from './step';
