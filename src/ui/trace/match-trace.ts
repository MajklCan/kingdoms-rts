/**
 * One player trace per skirmish or multiplayer match (campaign missions and
 * loaded saves are not traced). It opens on the match's first HUD frame and
 * closes when the match is decided, left, restarted or its multiplayer
 * session ends. The closed trace is kept on this device with the last few
 * (trace-store.ts) and the game-over screen offers it as a file; only with
 * the setting on (or `?trace` in the address) does every match download
 * its `kingdoms-trace-*.json` by itself. A tab closed mid-match leaves its
 * trace in storage: the next visit keeps it, marked unfinished.
 * Report: scripts/sim/trace-report.ts.
 */

import { SIM } from '../../config';
import { BUILD_BUTTON_MODES } from '../../render/hud/action-grid';
import { installTraceInputSource, setActiveTrace } from '../../render/trace/active-trace';
import {
  TraceRecorder,
  type PlayerTrace,
  type TraceMode,
  type TraceOutcome,
} from '../../render/trace/player-trace';
import { buildTraceCatalog } from '../../render/trace/trace-catalog';
import type { GameScene } from '../../render/game-scene';
import { appState, type MatchKind } from '../app-state';
import { getMatchStats, getScene } from '../game-bridge';
import { onMatchEnd, onMatchStart } from '../match/match-flow';
import { storedPlayerName } from '../screens/main-menu';
import { downloadTrace, isTraceAutoDownloadOn, localTraceStorage } from './trace-files';
import {
  applyTraceUrlFlag,
  clearUnfinishedTrace,
  keepRecentTrace,
  readRecentTraces,
  recoverUnfinishedTrace,
  stashUnfinishedTrace,
} from './trace-store';

/** A match already this far in when its trace opens was resumed from an autosave. */
const RESUMED_AFTER_SECONDS = 10;
/** Lost multiplayer sessions end the trace with their state as the outcome. */
const LOST_STATES = new Set<string>(['desync', 'peer-left', 'disconnected']);

let pending: TraceMode | null = null;
let recorder: TraceRecorder | null = null;
let last: PlayerTrace | null = null;

function tracedMode(kind: MatchKind): TraceMode | null {
  return kind === 'skirmish' || kind === 'multiplayer' ? kind : null;
}

function open(scene: GameScene, mode: TraceMode): void {
  const me = scene.getPerspectivePlayerId();
  const local = storedPlayerName();
  const players =
    mode === 'multiplayer'
      ? (appState.mpSession?.players ?? []).map((p) => ({ playerId: p.playerId, name: p.name }))
      : [{ playerId: me, name: local }];
  recorder = new TraceRecorder(
    {
      build: `${__APP_VERSION__}-${__GIT_COMMIT__}`,
      mode,
      player: players.find((p) => p.playerId === me)?.name ?? local,
      localPlayerId: me,
      players,
      startedAt: new Date().toISOString(),
      tickHz: SIM.TICK_HZ,
      resumed: scene.getTick() > SIM.TICK_HZ * RESUMED_AFTER_SECONDS,
      catalog: buildTraceCatalog(BUILD_BUTTON_MODES),
    },
    () => getScene()?.getTick() ?? 0,
    () => performance.now()
  );
  setActiveTrace(recorder);
}

function close(outcome: TraceOutcome): void {
  pending = null;
  if (!recorder) return;
  const scene = getScene();
  const stats = scene ? getMatchStats(scene) : null;
  last = recorder.finish(outcome, new Date().toISOString(), stats);
  recorder = null;
  setActiveTrace(null);
  keepRecentTrace(localTraceStorage, last);
  clearUnfinishedTrace(localTraceStorage);
  if (isTraceAutoDownloadOn()) downloadTrace(last);
}

/** Per HUD frame during a match: open the trace, close it once the match is over. */
export function updateMatchTrace(scene: GameScene): void {
  if (pending && !recorder) {
    open(scene, pending);
    pending = null;
  }
  if (!recorder) return;
  const outcome = scene.getOutcome();
  if (outcome.state === 'victory') {
    close(outcome.winnerPlayerId === scene.getPerspectivePlayerId() ? 'victory' : 'defeat');
    return;
  }
  const session = appState.mpSession;
  if (appState.matchKind === 'multiplayer' && session && LOST_STATES.has(session.state)) {
    close(session.state as TraceOutcome);
  }
}

/** True while this match has (or had) a trace to download. */
export function hasMatchTrace(): boolean {
  return recorder !== null || last !== null;
}

/** Download this match's trace again (game-over button); a running one as it stands. */
export function downloadMatchTrace(): void {
  const scene = getScene();
  const trace = recorder?.snapshot(scene ? getMatchStats(scene) : null) ?? last;
  if (trace) downloadTrace(trace);
}

function persistUnfinished(): void {
  if (!recorder) return;
  const scene = getScene();
  stashUnfinishedTrace(localTraceStorage, recorder.snapshot(scene ? getMatchStats(scene) : null));
}

/** A trace a closed tab left behind: kept with the others, downloaded if the player opted in. */
function recoverUnfinished(): void {
  const trace = recoverUnfinishedTrace(localTraceStorage);
  // Not a user gesture: the browser may block it, the kept copy stays either way.
  if (trace && isTraceAutoDownloadOn()) window.setTimeout(() => downloadTrace(trace), 1500);
}

export function bindMatchTrace(): void {
  applyTraceUrlFlag(localTraceStorage, window.location.search);
  installTraceInputSource(window);
  onMatchStart((kind) => {
    // A restart starts a new match without leaving the old one first.
    close('restart');
    pending = tracedMode(kind);
    last = null;
  });
  onMatchEnd(() => close('quit'));
  window.addEventListener('pagehide', persistUnfinished);
  recoverUnfinished();
  (window as unknown as { __TRACE__?: unknown }).__TRACE__ = {
    current: () => recorder?.snapshot() ?? null,
    last: () => last,
    saved: () => readRecentTraces(localTraceStorage),
    download: downloadMatchTrace,
  };
}
