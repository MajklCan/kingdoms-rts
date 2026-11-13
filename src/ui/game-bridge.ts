/**
 * The single seam between the DOM UI and the Phaser GameScene. UI modules
 * never reach for `game.scene` or the sim directly; they ask the bridge, and
 * the bridge forwards to the scene's typed UiApi (src/render/ui-api.ts).
 * No feature detection: every call below has a real implementation.
 */

import type Phaser from 'phaser';
import type { GameScene } from '../render/game-scene';
import type {
  CameraTileQuad,
  CommandFailure,
  GameMessageListener,
  MapOrderKind,
  MatchStatsView,
  ProductionSlotInfo,
  TilePoint,
  UiAlert,
  UiApi,
} from '../render/ui-api';

export type {
  CameraTileQuad,
  CommandFailure,
  GameMessage,
  GameMessageListener,
  GameMessageTone,
  MapOrderKind,
  MatchStatsView,
  ProductionSlotInfo,
  ResourceName,
  TilePoint,
  UiAlert,
  UiAlertKind,
} from '../render/ui-api';

let gameRef: Phaser.Game | null = null;

export function attachGame(game: Phaser.Game): void {
  gameRef = game;
}

export function getGame(): Phaser.Game | null {
  return gameRef;
}

export function getScene(): GameScene | null {
  if (!gameRef) return null;
  return (gameRef.scene.getScene('GameScene') as GameScene | null) ?? null;
}

/** The scene's UI API; null until the scene has run create(). */
export function getUiApi(scene: GameScene | null = getScene()): UiApi | null {
  return scene?.getUiApi() ?? null;
}

/** The scene exists, has run create() and is running. */
export function isSceneReady(scene: GameScene | null = getScene()): scene is GameScene {
  return getUiApi(scene)?.isReady() ?? false;
}

// --- Selection --------------------------------------------------------------

export function getSelectedEids(scene: GameScene): number[] {
  return getUiApi(scene)?.getSelectedEids() ?? [];
}

export function selectEntities(scene: GameScene, eids: readonly number[], additive = false): void {
  getUiApi(scene)?.selectEntities(eids, additive);
}

/** Keep only living entities owned by `playerId`. */
export function filterOwnedAlive(scene: GameScene, eids: readonly number[], playerId: number): number[] {
  return getUiApi(scene)?.filterOwnedAlive(eids, playerId) ?? [];
}

export function centroidOf(scene: GameScene, eids: readonly number[]): TilePoint | null {
  return getUiApi(scene)?.centroid(eids) ?? null;
}

export function entityTile(scene: GameScene, eid: number): TilePoint | null {
  return getUiApi(scene)?.entityTile(eid) ?? null;
}

/** `u<unit def>` for units, `b<building def>` for buildings, or 'foundation'. */
export function entityKindKey(scene: GameScene, eid: number): string {
  return getUiApi(scene)?.entityKindKey(eid) ?? 'unknown';
}

export function isOwnedBy(scene: GameScene, eid: number, playerId: number): boolean {
  return getUiApi(scene)?.ownerOf(eid) === playerId;
}

export function isProducer(scene: GameScene, eid: number): boolean {
  return getUiApi(scene)?.isProducer(eid) ?? false;
}

// --- Idle villagers -----------------------------------------------------------

export function getIdleVillagers(scene: GameScene, playerId: number): number[] {
  return getUiApi(scene)?.getIdleVillagers(playerId) ?? [];
}

// --- Production -------------------------------------------------------------

export function getProductionQueue(scene: GameScene, producerEid: number): ProductionSlotInfo[] {
  return getUiApi(scene)?.getProductionQueue(producerEid) ?? [];
}

/** Cancel one queue slot (default: the last queued); its cost is refunded. */
export function cancelProduction(scene: GameScene, producerEid: number, slot?: number): boolean {
  return getUiApi(scene)?.cancelProduction(producerEid, slot) ?? false;
}

// --- Camera and orders --------------------------------------------------------

export function getCameraTileQuad(scene: GameScene): CameraTileQuad | null {
  return getUiApi(scene)?.getCameraTileQuad() ?? null;
}

export function panToTile(scene: GameScene, x: number, y: number): void {
  getUiApi(scene)?.panToTile(x, y);
}

/** Minimap right-click: move or attack-move the selection to a tile. */
export function issueMapOrder(scene: GameScene, kind: MapOrderKind, x: number, y: number): boolean {
  return getUiApi(scene)?.issueMapOrder(kind, x, y) ?? false;
}

/** A disabled HUD control was used: error sound + typed alert (flashes missing resources). */
export function reportFailure(failure: CommandFailure): void {
  getUiApi()?.reportFailure(failure);
}

// --- Keyboard ---------------------------------------------------------------

/** Stop the scene from reacting to keys while a menu or modal owns input. */
export function setSceneKeyboardEnabled(enabled: boolean): void {
  getUiApi()?.setKeyboardEnabled(enabled);
}

// --- Alerts / messages / stats / match end -----------------------------------

export function drainSceneAlerts(scene: GameScene): UiAlert[] {
  return getUiApi(scene)?.drainUiAlerts() ?? [];
}

/** Subscribe to player-facing event log lines. Returns an unsubscribe. */
export function onGameMessage(listener: GameMessageListener): () => void {
  const api = getUiApi();
  return api ? api.onGameMessage(listener) : () => {};
}

export function lastFightPosition(scene: GameScene): TilePoint | null {
  return getUiApi(scene)?.lastFightPosition() ?? null;
}

export function getMatchStats(scene: GameScene): MatchStatsView | null {
  return getUiApi(scene)?.getMatchStats() ?? null;
}

/** Tear the match down (leaving a multiplayer session) without a reload. */
export function endMatch(scene: GameScene | null = getScene()): void {
  getUiApi(scene)?.endMatch();
}
