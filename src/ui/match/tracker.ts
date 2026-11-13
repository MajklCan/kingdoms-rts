/**
 * Match tracker: samples the world a few times a second and turns ownership
 * changes into UI events (building finished, unit trained, losses) and the
 * end-of-match statistics. Read-only; used until the scene offers
 * drainUiAlerts() / getMatchStats() itself (see game-bridge wish list).
 */

import { SIM } from '../../config';
import type { GameScene } from '../../render/game-scene';
import {
  buildingDefIdOf,
  entityTile,
  getSceneMatchStats,
  hpOf,
  snapshotOwnership,
  unitDefIdOf,
  type MatchStats,
  type OwnedSnapshot,
} from '../game-bridge';
import { RESOURCE_KEYS } from '../format';

export type TrackerEvent =
  | { type: 'building-complete'; eid: number; defId: number }
  | { type: 'unit-trained'; eid: number; defId: number }
  | { type: 'unit-lost'; eid: number }
  | { type: 'building-lost'; eid: number }
  | { type: 'under-attack'; eid: number; x: number; y: number; isBuilding: boolean };

type Listener = (ev: TrackerEvent, scene: GameScene) => void;

const listeners = new Set<Listener>();
const SAMPLE_MS = 400;

let prev: OwnedSnapshot | null = null;
let lastSampleAt = 0;
let lastBank: Record<string, number> | null = null;
let lastHp = new Map<number, number>();
let playerId = 1;
const stats: MatchStats = {
  unitsTrained: 0,
  unitsLost: 0,
  enemiesDefeated: 0,
  buildingsBuilt: 0,
  buildingsLost: 0,
  resourcesGathered: 0,
  peakPopulation: 0,
};

export function onTrackerEvent(fn: Listener): void {
  listeners.add(fn);
}

export function resetTracker(): void {
  prev = null;
  lastBank = null;
  lastHp = new Map();
  lastSampleAt = 0;
  for (const key of Object.keys(stats) as Array<keyof MatchStats>) stats[key] = 0;
}

function emit(ev: TrackerEvent, scene: GameScene): void {
  for (const fn of listeners) fn(ev, scene);
}

export function updateTracker(scene: GameScene, now: number): void {
  if (now - lastSampleAt < SAMPLE_MS) return;
  lastSampleAt = now;
  const me = scene.getPerspectivePlayerId();
  if (me !== playerId) {
    playerId = me;
    prev = null;
  }
  const snap = snapshotOwnership(scene, me);
  if (!snap) return;

  const pop = scene.getPop(me);
  stats.peakPopulation = Math.max(stats.peakPopulation, pop.current);

  const bank = scene.getResources(me) as unknown as Record<string, number>;
  if (lastBank) {
    for (const key of RESOURCE_KEYS) {
      const delta = (bank[key] ?? 0) - (lastBank[key] ?? 0);
      if (delta > 0) stats.resourcesGathered += delta;
    }
  }
  lastBank = { ...bank };

  if (prev) {
    for (const eid of snap.units) {
      if (!prev.units.has(eid)) {
        stats.unitsTrained++;
        emit({ type: 'unit-trained', eid, defId: unitDefIdOf(scene, eid) ?? -1 }, scene);
      }
    }
    for (const eid of prev.units) {
      if (!snap.units.has(eid)) {
        stats.unitsLost++;
        emit({ type: 'unit-lost', eid }, scene);
      }
    }
    for (const eid of prev.enemyUnits) if (!snap.enemyUnits.has(eid)) stats.enemiesDefeated++;
    for (const eid of snap.buildings) {
      if (prev.foundations.has(eid)) {
        stats.buildingsBuilt++;
        emit({ type: 'building-complete', eid, defId: buildingDefIdOf(scene, eid) ?? -1 }, scene);
      }
    }
    for (const eid of prev.buildings) {
      if (!snap.buildings.has(eid)) {
        stats.buildingsLost++;
        emit({ type: 'building-lost', eid }, scene);
      }
    }
  }
  // Damage taken since the last sample -> under-attack event at that spot.
  const hp = new Map<number, number>();
  let hit: { eid: number; isBuilding: boolean } | null = null;
  for (const set of [snap.buildings, snap.units, snap.foundations]) {
    for (const eid of set) {
      const v = hpOf(scene, eid)?.hp;
      if (v === undefined) continue;
      hp.set(eid, v);
      const before = lastHp.get(eid);
      if (!hit && before !== undefined && v < before) hit = { eid, isBuilding: set !== snap.units };
    }
  }
  lastHp = hp;
  if (hit && prev) {
    const at = entityTile(scene, hit.eid);
    if (at) emit({ type: 'under-attack', eid: hit.eid, x: at.x, y: at.y, isBuilding: hit.isBuilding }, scene);
  }
  prev = snap;
}

export function getMatchStats(scene: GameScene): MatchStats & { seconds: number } {
  const fromScene = getSceneMatchStats(scene, scene.getPerspectivePlayerId());
  return { ...(fromScene ?? stats), seconds: scene.getTick() / SIM.TICK_HZ };
}
