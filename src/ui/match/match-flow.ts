/**
 * Match lifecycle: every way into a match (skirmish, campaign mission,
 * loaded save, multiplayer) goes through the loading screen, and every way
 * out returns to the title screens. HUD trackers reset on each new match.
 */

import { CAMPAIGN_MISSIONS, type CampaignMissionIdValue } from '../../sim/campaign';
import { AGE_TABLE, type AgeIdValue } from '../../sim/defs';
import { MAP_DEFS, type MapIdValue } from '../../sim/map-gen';
import type { SavedGame } from '../../sim/save-load';
import type { AiDifficulty, SimWorld } from '../../sim/world';
import { appState, setPhase, type MatchKind } from '../app-state';
import { endMatch, getScene } from '../game-bridge';
import { enterMenu, leaveMenu, type MenuScreenId } from '../screens/menu-shell';
import { isLoading, runLoading } from '../screens/loading';

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

/**
 * Repeats the launch of the running match with everything it was started
 * with (null: nothing to repeat). Every start function below goes through
 * launch(), whose `task` closure holds that function's arguments, so a new
 * argument is repeated too without touching this.
 */
let relaunch: (() => void) | null = null;

async function launch(kind: MatchKind, title: string, subtitle: string, task: () => void, minMs?: number): Promise<void> {
  // A multiplayer match cannot be repeated alone: the rival plays on.
  relaunch = kind === 'multiplayer' ? null : () => void launch(kind, title, subtitle, task, minMs);
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
    relaunch = null;
    appState.matchKind = null;
    setPhase('menu');
    enterMenu('root');
  }
}

export function startSkirmish(age: AgeIdValue, mapId: MapIdValue, difficulty: AiDifficulty, night?: boolean): void {
  const map = MAP_DEFS.find((m) => m.id === mapId);
  const ageName = AGE_TABLE.find((a) => a.id === age)?.name ?? 'Dark Age';
  const diff = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  const atNight = night ?? map?.night === true;
  void launch('skirmish', map?.name ?? 'Skirmish', `${ageName} · ${diff} AI${atNight ? ' · Night' : ''}`, () => {
    getScene()?.startNewGame(age, mapId, difficulty, atNight);
  });
}

export function startCampaign(missionId: CampaignMissionIdValue): void {
  const mission = CAMPAIGN_MISSIONS.find((m) => m.id === missionId);
  void launch('campaign', mission?.name ?? 'Campaign', mission?.description ?? '', () => {
    getScene()?.startCampaignMission(missionId);
  });
}

export function loadSnapshot(snapshot: SavedGame, label: string): void {
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

/** True when the running match can be started again (not in multiplayer). */
export function canRestartMatch(): boolean {
  return relaunch !== null;
}

/**
 * Start the running match again from its beginning: a skirmish on the same
 * map, starting age and AI (new seed), a campaign mission from its briefing,
 * a loaded save from that save. False when there is nothing to repeat.
 */
export function restartMatch(): boolean {
  const again = relaunch;
  if (!again || isLoading()) return false;
  // A new match starts at normal speed, like one started from the menu.
  getScene()?.setGameSpeed(1);
  again();
  return true;
}

/** Leave the running match and return to the title screens, in every mode
 *  and without a reload: the scene tears the match down (a multiplayer
 *  session is left properly, so the relay tells the rival) and idles. */
export function quitToMenu(screen: MenuScreenId = 'root'): void {
  for (const fn of endListeners) fn();
  relaunch = null;
  endMatch();
  appState.mpSession = null;
  appState.matchKind = null;
  setPhase('menu');
  enterMenu(screen);
}
