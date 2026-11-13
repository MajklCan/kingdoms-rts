/**
 * The single seam between the DOM UI and the Phaser GameScene. UI modules
 * never reach for `game.scene` or the sim directly; they ask the bridge.
 *
 * Several HUD features want scene APIs that do not exist yet (they live in
 * src/render and src/sim, which other work streams own). Each one is
 * feature-detected here: if the scene grows the method, the bridge calls it;
 * otherwise it falls back to a read-only view of the sim world (plus the
 * client-local `Selected` tag, which is excluded from the sim checksum).
 * The wished-for signatures are listed on `SceneWishes` below.
 */

import { hasComponent } from 'bitecs';
import type Phaser from 'phaser';
import { ISO, MAP, RENDER } from '../config';
import type { GameScene } from '../render/game-scene';
import { screenToTile } from '../render/iso';
import {
  Building,
  ConstructionSite,
  DeadTag,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  PathTarget,
  Position,
  Producer,
  UnitKind,
  VillagerTag,
  WorksiteWorker,
} from '../sim/components';
import { UNIT_TABLE } from '../sim/defs';
import type { SimInput, SimWorld } from '../sim/world';
import { buildingQuery, clearSelection, selectedQuery, setSelected, unitQuery } from '../sim/world';
import { appState } from './app-state';

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

/** The scene exists, has run create() and owns a world. */
export function isSceneReady(scene: GameScene | null = getScene()): scene is GameScene {
  if (!scene) return false;
  const wish = (scene as Partial<SceneWishes>).isReady;
  if (typeof wish === 'function') return wish.call(scene);
  try {
    return scene.sys.isActive() && scene.getWorld() !== undefined && scene.cameras?.main !== undefined;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wish list: optional GameScene methods the UI would like. Keep in sync with
// the report; every one has a fallback below.
// ---------------------------------------------------------------------------

export interface ProductionSlot {
  unitDefId: number;
  /** 0..1 for the item in front of the queue, 0 for the rest. */
  progressFrac: number;
}

export interface CameraQuad {
  /** Four tile-space corners: top-left, top-right, bottom-right, bottom-left of the view. */
  corners: Array<{ x: number; y: number }>;
}

export interface UiAlert {
  kind: 'attack' | 'building-complete' | 'unit-trained' | 'research-complete' | 'age-up' | 'resources' | 'info';
  text: string;
  tileX?: number;
  tileY?: number;
}

export interface MatchStats {
  unitsTrained: number;
  unitsLost: number;
  enemiesDefeated: number;
  buildingsBuilt: number;
  buildingsLost: number;
  resourcesGathered: number;
  peakPopulation: number;
}

export interface SceneWishes {
  isReady(): boolean;
  selectEntities(eids: readonly number[], additive?: boolean): void;
  getSelectedEids(): number[];
  getIdleVillagers(playerId: number): number[];
  getProductionQueue(producerEid: number): ProductionSlot[];
  cancelProduction(producerEid: number): void;
  getCameraTileQuad(): CameraQuad;
  drainUiAlerts(): UiAlert[];
  getMatchStats(playerId: number): MatchStats;
  endMatch(): void;
  setKeyboardEnabled(enabled: boolean): void;
}

function wish<K extends keyof SceneWishes>(scene: GameScene, name: K): SceneWishes[K] | null {
  const fn = (scene as unknown as Partial<SceneWishes>)[name];
  return typeof fn === 'function' ? (fn.bind(scene) as SceneWishes[K]) : null;
}

function world(scene: GameScene): SimWorld | null {
  try {
    return scene.getWorld() ?? null;
  } catch {
    return null;
  }
}

function isAlive(w: SimWorld, eid: number): boolean {
  if (hasComponent(w.ecs, DeadTag, eid)) return false;
  if (hasComponent(w.ecs, Health, eid) && Health.hp[eid]! <= 0) return false;
  return true;
}

// --- Selection --------------------------------------------------------------

export function getSelectedEids(scene: GameScene): number[] {
  const fn = wish(scene, 'getSelectedEids');
  if (fn) return fn();
  const w = world(scene);
  return w ? Array.from(selectedQuery(w.ecs)) : [];
}

export function selectEntities(scene: GameScene, eids: readonly number[], additive = false): void {
  const fn = wish(scene, 'selectEntities');
  if (fn) {
    fn(eids, additive);
    return;
  }
  const w = world(scene);
  if (!w) return;
  if (!additive) clearSelection(w);
  for (const eid of eids) {
    if (hasComponent(w.ecs, Position, eid) && isAlive(w, eid)) setSelected(w, eid, true);
  }
}

/** Keep only living entities owned by `playerId`. */
export function filterOwnedAlive(scene: GameScene, eids: readonly number[], playerId: number): number[] {
  const w = world(scene);
  if (!w) return [];
  return eids.filter(
    (eid) =>
      hasComponent(w.ecs, Owner, eid) &&
      Owner.player[eid] === playerId &&
      hasComponent(w.ecs, Position, eid) &&
      isAlive(w, eid)
  );
}

export function centroidOf(scene: GameScene, eids: readonly number[]): { x: number; y: number } | null {
  const w = world(scene);
  if (!w || eids.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const eid of eids) {
    if (!hasComponent(w.ecs, Position, eid)) continue;
    sx += Position.x[eid]!;
    sy += Position.y[eid]!;
    n++;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

export function entityTile(scene: GameScene, eid: number): { x: number; y: number } | null {
  const w = world(scene);
  if (!w || !hasComponent(w.ecs, Position, eid)) return null;
  return { x: Position.x[eid]!, y: Position.y[eid]! };
}

/** Unit def id for a unit entity, building def id (+100) for a building. */
export function entityKindKey(scene: GameScene, eid: number): string {
  const w = world(scene);
  if (!w) return 'unknown';
  if (hasComponent(w.ecs, UnitKind, eid)) return `u${UnitKind.kind[eid]}`;
  if (hasComponent(w.ecs, ConstructionSite, eid)) return 'foundation';
  if (hasComponent(w.ecs, Building, eid)) return `b${Building.defId[eid]}`;
  return 'unknown';
}

// --- Idle villagers -----------------------------------------------------------

export function getIdleVillagers(scene: GameScene, playerId: number): number[] {
  const fn = wish(scene, 'getIdleVillagers');
  if (fn) return fn(playerId);
  const w = world(scene);
  if (!w) return [];
  const out: number[] = [];
  for (const eid of unitQuery(w.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (!hasComponent(w.ecs, VillagerTag, eid)) continue;
    if (hasComponent(w.ecs, WorksiteWorker, eid)) continue;
    if (!isAlive(w, eid)) continue;
    if (hasComponent(w.ecs, Gatherer, eid) && Gatherer.state[eid] !== GathererStateId.IDLE) continue;
    if (hasComponent(w.ecs, PathTarget, eid) && PathTarget.x[eid] !== -1) continue;
    out.push(eid);
  }
  return out;
}

// --- Production -------------------------------------------------------------

export function getProductionQueue(scene: GameScene, producerEid: number): ProductionSlot[] {
  const fn = wish(scene, 'getProductionQueue');
  if (fn) return fn(producerEid);
  const w = world(scene);
  if (!w) return [];
  const queue = w.productionQueues.get(producerEid) ?? [];
  return queue.map((unitDefId, index) => {
    let progressFrac = 0;
    if (index === 0 && hasComponent(w.ecs, Producer, producerEid)) {
      const total = UNIT_TABLE[unitDefId]?.trainTimeTicks ?? 0;
      progressFrac = total > 0 ? Math.min(1, Producer.currentProgress[producerEid]! / total) : 0;
    }
    return { unitDefId, progressFrac };
  });
}

/** Cancel the most recently queued item at a producer (refunds its cost). */
export function cancelProduction(scene: GameScene, producerEid: number): void {
  const fn = wish(scene, 'cancelProduction');
  if (fn) {
    fn(producerEid);
    return;
  }
  const playerId = scene.getPerspectivePlayerId();
  const input: SimInput = { type: 'cancelProduction', atEid: producerEid, playerId };
  const session = appState.mpSession;
  if (scene.isMultiplayer()) {
    if (session && session.state === 'playing') session.sendCommand(input);
    return;
  }
  const w = world(scene);
  w?.inputs.push(input);
}

// --- Camera -----------------------------------------------------------------

export function getCameraTileQuad(scene: GameScene): CameraQuad | null {
  const fn = wish(scene, 'getCameraTileQuad');
  if (fn) return fn();
  const cam = scene.cameras?.main;
  if (!cam) return null;
  const view = cam.worldView;
  const ox = RENDER.WIDTH / 2;
  const oy = RENDER.HEIGHT / 2 - (MAP.HEIGHT * ISO.TILE_H) / 4;
  const pts = [
    [view.x, view.y],
    [view.x + view.width, view.y],
    [view.x + view.width, view.y + view.height],
    [view.x, view.y + view.height],
  ] as const;
  return { corners: pts.map(([x, y]) => screenToTile(x - ox, y - oy)) };
}

export function panToTile(scene: GameScene, x: number, y: number): void {
  scene.panToTile(x, y);
}

// --- Keyboard ---------------------------------------------------------------

/** Stop the scene from reacting to keys while a menu or modal owns input. */
export function setSceneKeyboardEnabled(enabled: boolean): void {
  const scene = getScene();
  if (!scene) return;
  const fn = wish(scene, 'setKeyboardEnabled');
  if (fn) {
    fn(enabled);
    return;
  }
  const kb = scene.input?.keyboard;
  if (!kb) return;
  kb.enabled = enabled;
  if (!enabled) kb.resetKeys();
}

// --- Alerts / stats / match end ----------------------------------------------

export function drainSceneAlerts(scene: GameScene): UiAlert[] | null {
  const fn = wish(scene, 'drainUiAlerts');
  return fn ? fn() : null;
}

export function getSceneMatchStats(scene: GameScene, playerId: number): MatchStats | null {
  const fn = wish(scene, 'getMatchStats');
  return fn ? fn(playerId) : null;
}

/** Returns true when the scene handled ending the match itself. */
export function endMatchViaScene(scene: GameScene): boolean {
  const fn = wish(scene, 'endMatch');
  if (!fn) return false;
  fn();
  return true;
}

// --- Read-only world snapshots for UI trackers --------------------------------

export interface OwnedSnapshot {
  units: Set<number>;
  buildings: Set<number>;
  foundations: Set<number>;
  enemyUnits: Set<number>;
  enemyBuildings: Set<number>;
}

export function snapshotOwnership(scene: GameScene, playerId: number): OwnedSnapshot | null {
  const w = world(scene);
  if (!w) return null;
  const snap: OwnedSnapshot = {
    units: new Set(),
    buildings: new Set(),
    foundations: new Set(),
    enemyUnits: new Set(),
    enemyBuildings: new Set(),
  };
  for (const eid of unitQuery(w.ecs)) {
    if (!isAlive(w, eid)) continue;
    const owner = Owner.player[eid];
    if (owner === playerId) snap.units.add(eid);
    else if (owner !== 0) snap.enemyUnits.add(eid);
  }
  for (const eid of buildingQuery(w.ecs)) {
    if (!isAlive(w, eid)) continue;
    const owner = Owner.player[eid];
    if (owner === playerId) {
      if (hasComponent(w.ecs, ConstructionSite, eid)) snap.foundations.add(eid);
      else snap.buildings.add(eid);
    } else if (owner !== 0) snap.enemyBuildings.add(eid);
  }
  return snap;
}

export function buildingDefIdOf(scene: GameScene, eid: number): number | null {
  const w = world(scene);
  if (!w || !hasComponent(w.ecs, Building, eid)) return null;
  return Building.defId[eid] ?? null;
}

export function unitDefIdOf(scene: GameScene, eid: number): number | null {
  const w = world(scene);
  if (!w || !hasComponent(w.ecs, UnitKind, eid)) return null;
  return UnitKind.kind[eid] ?? null;
}

export function hpOf(scene: GameScene, eid: number): { hp: number; max: number } | null {
  const w = world(scene);
  if (!w || !hasComponent(w.ecs, Health, eid)) return null;
  return { hp: Health.hp[eid]!, max: Health.hpMax[eid]! };
}

export function isOwnedBy(scene: GameScene, eid: number, playerId: number): boolean {
  const w = world(scene);
  return !!w && hasComponent(w.ecs, Owner, eid) && Owner.player[eid] === playerId;
}

export function isProducer(scene: GameScene, eid: number): boolean {
  const w = world(scene);
  return !!w && hasComponent(w.ecs, Producer, eid) && hasComponent(w.ecs, Building, eid);
}
