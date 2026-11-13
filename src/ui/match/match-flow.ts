/**
 * Match lifecycle: every way into a match (skirmish, campaign mission,
 * loaded save, multiplayer) goes through the loading screen, and every way
 * out returns to the title screens. HUD trackers reset on each new match.
 */

import { CAMPAIGN_MISSIONS, type CampaignMissionIdValue } from '../../sim/campaign';
import { AGE_TABLE, type AgeIdValue } from '../../sim/defs';
import { MAP_DEFS, type MapIdValue } from '../../sim/map-gen';
import type { SavedGameV1 } from '../../sim/save-load';
import type { AiDifficulty, SimWorld } from '../../sim/world';
import { appState, setPhase, type MatchKind } from '../app-state';
import { endMatchViaScene, getScene } from '../game-bridge';
import { enterMenu, leaveMenu, type MenuScreenId } from '../screens/menu-shell';
import { runLoading } from '../screens/loading';

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

async function launch(kind: MatchKind, title: string, subtitle: string, task: () => void, minMs?: number): Promise<void> {
  leaveMenu();
  const ok = await runLoading({
    title,
    subtitle,
    minMs,
    task: () => {
      beginMatch(kind);
      task();
    },
  });
  if (!ok) {
    appState.matchKind = null;
    setPhase('menu');
    enterMenu('root');
  }
}

export function startSkirmish(age: AgeIdValue, mapId: MapIdValue, difficulty: AiDifficulty): void {
  const map = MAP_DEFS.find((m) => m.id === mapId);
  const ageName = AGE_TABLE.find((a) => a.id === age)?.name ?? 'Dark Age';
  const diff = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  void launch('skirmish', map?.name ?? 'Skirmish', `${ageName} · ${diff} AI`, () => {
    getScene()?.startNewGame(age, mapId, difficulty);
  });
}

export function startCampaign(missionId: CampaignMissionIdValue): void {
  const mission = CAMPAIGN_MISSIONS.find((m) => m.id === missionId);
  void launch('campaign', mission?.name ?? 'Campaign', mission?.description ?? '', () => {
    getScene()?.startCampaignMission(missionId);
  });
}

export function loadSnapshot(snapshot: SavedGameV1, label: string): void {
  void launch('loaded', label, 'Restoring a saved chronicle', () => {
    getScene()?.loadSaveSnapshot(snapshot, label);
  });
}

export function loadLateGameTest(): void {
  void launch('loaded', 'Late Game Test', 'Developer fixture', () => {
    getScene()?.loadLateGameTestSave();
  });
}

export function startMultiplayerMatch(world: SimWorld, localPlayerId: number): void {
  const session = appState.mpSession;
  if (!session) return;
  void launch(
    'multiplayer',
    'Multiplayer',
    `You command player ${localPlayerId}`,
    () => {
      getScene()?.beginMultiplayerMatch(session, world, localPlayerId);
    },
    450
  );
}

/** Leave the running match and return to the title screens. */
export function quitToMenu(screen: MenuScreenId = 'root'): void {
  const scene = getScene();
  for (const fn of endListeners) fn();
  if (scene && endMatchViaScene(scene)) {
    appState.matchKind = null;
    setPhase('menu');
    enterMenu(screen);
    return;
  }
  if (appState.matchKind === 'multiplayer' || scene?.isMultiplayer()) {
    // A lockstep session cannot be torn down from the page without a scene
    // API; a clean reload is the safe way out.
    window.location.reload();
    return;
  }
  scene?.setPaused(true);
  appState.matchKind = null;
  setPhase('menu');
  enterMenu(screen);
}
