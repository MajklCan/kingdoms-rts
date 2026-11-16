/**
 * Autosave for single-player matches: one slot in the browser that the main
 * menu resumes with "Continue". Saves about every 30 s of unpaused play,
 * when the match is paused, and when the tab is hidden or closed; never in
 * multiplayer. The slot is cleared when the match is decided.
 *
 * Every save is taken from the HUD frame loop or a DOM event, so the sim is
 * always between ticks (a tick is one synchronous step() call).
 */

import { SIM } from '../../config';
import type { GameScene } from '../../render/game-scene';
import { appState } from '../app-state';
import { getScene, isSceneReady } from '../game-bridge';
import { AutosaveClock } from './autosave-clock';
import { autosaveTitle, buildAutosaveMeta, describeAutosave, type AutosaveMeta, type AutosaveSetup } from './autosave-meta';
import { AutosaveStore, type AutosaveRecord } from './autosave-store';
import { createIdbBackend } from './idb-backend';

interface Session {
  setup: AutosaveSetup;
  clock: AutosaveClock;
  /** The slot holds this match (written or resumed), so ending it may clear it. */
  ownsSlot: boolean;
  lastSavedTick: number;
  lastWrite: Promise<boolean>;
}

type MetaListener = (meta: AutosaveMeta | null) => void;

let store: AutosaveStore | null = null;
let session: Session | null = null;
/** Last known slot contents, so the menu can render without waiting on storage. */
let knownMeta: AutosaveMeta | null = null;
const listeners = new Set<MetaListener>();

function getStore(): AutosaveStore {
  store ??= new AutosaveStore(createIdbBackend());
  return store;
}

function setKnownMeta(meta: AutosaveMeta | null): void {
  if (knownMeta === meta) return;
  knownMeta = meta;
  for (const fn of listeners) fn(meta);
}

/** Called with the slot's metadata whenever it changes (null: no save). */
export function onAutosaveChange(fn: MetaListener): void {
  listeners.add(fn);
}

export function getKnownAutosave(): AutosaveMeta | null {
  return knownMeta;
}

export function autosaveSummary(meta: AutosaveMeta): string {
  return describeAutosave(meta, Date.now(), SIM.TICK_HZ);
}

/** Re-read the slot from storage. An invalid save is dropped and reads as null. */
export async function refreshAutosave(): Promise<AutosaveMeta | null> {
  const meta = await getStore().readMeta();
  setKnownMeta(meta);
  return meta;
}

/** The full save for "Continue"; null (and the slot dropped) when it cannot be loaded. */
export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const record = await getStore().load();
  setKnownMeta(record ? record.meta : null);
  return record;
}

/** Delete the slot, whoever wrote it. */
export function discardAutosave(): void {
  if (session) session.ownsSlot = false;
  setKnownMeta(null);
  void getStore().clear();
}

/** Delete the slot only if it holds the running match (abandoned or decided). */
export function discardCurrentMatchAutosave(): void {
  if (session?.ownsSlot) discardAutosave();
}

/** Start autosaving the match the scene just built. `resumed`: it came from the slot. */
export function beginAutosaveSession(scene: GameScene, setup: AutosaveSetup, resumed = false): void {
  session = {
    setup,
    clock: new AutosaveClock(undefined, scene.isPaused()),
    ownsSlot: resumed,
    lastSavedTick: resumed ? scene.getTick() : -1,
    lastWrite: Promise.resolve(resumed),
  };
}

export function endAutosaveSession(): void {
  session = null;
}

function saveable(scene: GameScene | null): scene is GameScene {
  return (
    session !== null &&
    appState.phase === 'match' &&
    isSceneReady(scene) &&
    !scene.isMultiplayer() &&
    scene.getOutcome().state === 'playing'
  );
}

/** Write the running match to the slot now. Resolves false when nothing was stored. */
export function saveAutosave(scene: GameScene | null = getScene()): Promise<boolean> {
  const current = session;
  if (!current || !saveable(scene)) return Promise.resolve(false);
  const tick = scene.getTick();
  if (tick === current.lastSavedTick) return current.lastWrite;

  let meta: AutosaveMeta;
  let blob: string;
  try {
    const mission = scene.getCampaignMission();
    const snapshot = scene.createSaveSnapshot('Autosave');
    meta = buildAutosaveMeta({
      setup: current.setup,
      mission: mission ? { id: mission.id, name: mission.name } : null,
      difficulty: snapshot.aiDifficulty ?? null,
      tick: snapshot.tick,
      saveVersion: snapshot.version,
      gameSpeed: scene.getGameSpeed(),
      savedAt: Date.now(),
      appVersion: __APP_VERSION__,
    });
    snapshot.label = autosaveTitle(meta);
    blob = JSON.stringify(snapshot);
  } catch {
    return Promise.resolve(false); // Never let a failed save interrupt the match.
  }

  current.lastSavedTick = tick;
  current.clock.restart();
  // Claimed before the write lands, so abandoning the match right now still clears it.
  current.ownsSlot = true;
  current.lastWrite = getStore()
    .write(meta, blob)
    .then((ok) => {
      if (ok) {
        // The match may have been decided or abandoned while this was in flight.
        if (session === current && current.ownsSlot) setKnownMeta(meta);
      } else if (current.lastSavedTick === tick) {
        current.lastSavedTick = -1;
      }
      return ok;
    });
  return current.lastWrite;
}

/** Per-frame driver (HUD loop, match phase only). */
export function updateAutosave(scene: GameScene, now: number): void {
  const current = session;
  if (!current || scene.isMultiplayer()) return;
  if (scene.getOutcome().state !== 'playing') {
    // Won or lost: "Continue" must never resume a finished match.
    discardCurrentMatchAutosave();
    session = null;
    return;
  }
  if (current.clock.advance(now, scene.isPaused()) !== 'none') void saveAutosave(scene);
}

/** Save when the tab is hidden or closed, and warm the menu's "Continue" entry. */
export function bindAutosave(): void {
  const flush = (): void => {
    void saveAutosave();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  void refreshAutosave();
}
