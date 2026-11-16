/**
 * Match lifecycle: every way into a match (skirmish, campaign mission,
 * loaded save, multiplayer) goes through the loading screen, and every way
 * out returns to the title screens. HUD trackers reset on each new match.
 * Single-player matches also open an autosave session (src/ui/saves).
 */

import { CAMPAIGN_MISSIONS, type CampaignMissionIdValue } from '../../sim/campaign';
import { AGE_TABLE, type AgeIdValue } from '../../sim/defs';
import { MAP_DEFS, type MapIdValue } from '../../sim/map-gen';
import type { SavedGame } from '../../sim/save-load';
import type { AiDifficulty, SimWorld } from '../../sim/world';
import { appState, setPhase, type MatchKind } from '../app-state';
import { endMatch, getScene } from '../game-bridge';
import { enterMenu, leaveMenu, type MenuScreenId } from '../screens/menu-shell';
import { runLoading, type LoadingKind } from '../screens/loading';
import { beginAutosaveSession, discardAutosave, endAutosaveSession } from '../saves/autosave';
import { autosaveTitle } from '../saves/autosave-meta';
import type { AutosaveRecord } from '../saves/autosave-store';

type MatchListener = (kind: MatchKind) => void;
const startListeners = new Set<MatchListener>();
const endListeners = new Set<() => void>();

/** Called right before a new match starts (reset per-match HUD state). */
export function onMatchStart(fn: MatchListener): void {
  startListeners.add(fn);
}

/** Called when the player leaves a match for the menu. */
export function onMatchEnd(fn: () => void): void {
  endListeners.add(fn);
}

function beginMatch(kind: MatchKind): void {
  appState.matchKind = kind;
  for (const fn of startListeners) fn(kind);
}

interface LaunchSpec {
  kind: MatchKind;
  /** Eyebrow on the loading screen (a resumed autosave says "Continue"). */
  loadingKind?: LoadingKind;
  title: string;
  subtitle: string;
  mapId?: MapIdValue | null;
  task: () => void;
}

async function launch(spec: LaunchSpec): Promise<void> {
  leaveMenu();
  const ok = await runLoading({
    title: spec.title,
    subtitle: spec.subtitle,
    kind: spec.loadingKind ?? spec.kind,
    mapId: spec.mapId ?? null,
    task: () => {
      beginMatch(spec.kind);
      spec.task();
    },
  });
  if (!ok) {
    appState.matchKind = null;
    setPhase('menu');
    enterMenu('root');
  }
}

function missionMapId(missionId: string | null): MapIdValue | null {
  return CAMPAIGN_MISSIONS.find((m) => m.id === missionId)?.mapId ?? null;
}

export function startSkirmish(age: AgeIdValue, mapId: MapIdValue, difficulty: AiDifficulty): void {
  const map = MAP_DEFS.find((m) => m.id === mapId);
  const ageName = AGE_TABLE.find((a) => a.id === age)?.name ?? 'Dark Age';
  const diff = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  void launch({
    kind: 'skirmish',
    title: map?.name ?? 'Skirmish',
    subtitle: `${ageName} · ${diff} AI`,
    mapId,
    task: () => {
      const scene = getScene();
      if (!scene) return;
      scene.startNewGame(age, mapId, difficulty);
      beginAutosaveSession(scene, { mapName: map?.name ?? null });
    },
  });
}

export function startCampaign(missionId: CampaignMissionIdValue): void {
  const mission = CAMPAIGN_MISSIONS.find((m) => m.id === missionId);
  void launch({
    kind: 'campaign',
    title: mission?.name ?? 'Campaign',
    subtitle: mission?.description ?? '',
    mapId: mission?.mapId ?? null,
    task: () => {
      const scene = getScene();
      if (!scene) return;
      scene.startCampaignMission(missionId);
      beginAutosaveSession(scene, { mapName: null });
    },
  });
}

export function loadSnapshot(snapshot: SavedGame, label: string): void {
  void launch({
    kind: 'loaded',
    title: label,
    subtitle: '',
    task: () => {
      const scene = getScene();
      if (!scene) return;
      scene.loadSaveSnapshot(snapshot, label);
      beginAutosaveSession(scene, { mapName: null });
    },
  });
}

/**
 * "Continue": rebuild the match from the autosave slot. It comes back paused
 * (a campaign mission behind its briefing, a skirmish under the Paused
 * banner) so the player gets their bearings first. A save that fails while
 * loading is dropped and the player lands back on the menu.
 */
export function continueAutosave(record: AutosaveRecord): void {
  const { meta, snapshot } = record;
  const title = autosaveTitle(meta);
  void launch({
    kind: meta.mode,
    loadingKind: 'continue',
    title,
    subtitle: meta.mode === 'campaign' ? 'Campaign' : 'Skirmish',
    mapId: meta.mode === 'campaign' ? missionMapId(meta.missionId) : (MAP_DEFS.find((m) => m.name === meta.mapName)?.id ?? null),
    task: () => {
      const scene = getScene();
      if (!scene) return;
      try {
        scene.loadSaveSnapshot(snapshot, title);
      } catch (err) {
        discardAutosave();
        endMatch(scene); // swap the half-loaded world for an idle one
        throw err;
      }
      scene.setGameSpeed(meta.gameSpeed);
      scene.setPaused(true);
      beginAutosaveSession(scene, { mapName: meta.mapName }, true);
    },
  });
}

export function loadLateGameTest(): void {
  void launch({
    kind: 'loaded',
    title: 'Late Game Test',
    subtitle: 'Developer fixture',
    task: () => {
      const scene = getScene();
      if (!scene) return;
      scene.loadLateGameTestSave();
      beginAutosaveSession(scene, { mapName: null });
    },
  });
}

export function startMultiplayerMatch(world: SimWorld, localPlayerId: number): void {
  const session = appState.mpSession;
  if (!session) return;
  void launch({
    kind: 'multiplayer',
    title: 'Multiplayer',
    subtitle: `You command player ${localPlayerId}`,
    task: () => {
      getScene()?.beginMultiplayerMatch(session, world, localPlayerId);
    },
  });
}

/** Leave the running match and return to the title screens, in every mode
 *  and without a reload: the scene tears the match down (a multiplayer
 *  session is left properly, so the relay tells the rival) and idles. */
export function quitToMenu(screen: MenuScreenId = 'root'): void {
  for (const fn of endListeners) fn();
  endAutosaveSession();
  endMatch();
  appState.mpSession = null;
  appState.matchKind = null;
  setPhase('menu');
  enterMenu(screen);
}
