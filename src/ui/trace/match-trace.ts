/**
 * One player trace per skirmish or multiplayer match (campaign missions and
 * loaded saves are not traced). It opens on the match's first HUD frame and
 * closes when the match is decided, left, restarted or its multiplayer
 * session ends; the closed trace downloads as `kingdoms-trace-*.json`, and
 * the game-over screen offers it again in case the browser blocked that.
 * A tab closed mid-match leaves the trace in storage: the next visit
 * downloads it marked unfinished. Report: scripts/sim/trace-report.ts.
 */

import { SIM } from '../../config';
import { BUILD_BUTTON_MODES } from '../../render/hud/action-grid';
import { installTraceInputSource, setActiveTrace } from '../../render/trace/active-trace';
import {
  TraceRecorder,
  traceFileName,
  type PlayerTrace,
  type TraceMode,
  type TraceOutcome,
} from '../../render/trace/player-trace';
import { buildTraceCatalog } from '../../render/trace/trace-catalog';
import type { GameScene } from '../../render/game-scene';
import { appState, type MatchKind } from '../app-state';
import { readStorage, removeStorage, writeStorage } from '../dom';
import { getMatchStats, getScene } from '../game-bridge';
import { onMatchEnd, onMatchStart } from '../match/match-flow';
import { storedPlayerName } from '../screens/main-menu';

const UNFINISHED_KEY = 'kingdoms.trace.unfinished';
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
  removeStorage(UNFINISHED_KEY);
  download(last);
}

function download(trace: PlayerTrace): void {
  try {
    const blob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = traceFileName(trace);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // Download blocked: the trace is still on __TRACE__.last() and the game-over button.
  }
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
  if (trace) download(trace);
}

function persistUnfinished(): void {
  if (!recorder) return;
  const scene = getScene();
  writeStorage(UNFINISHED_KEY, JSON.stringify(recorder.snapshot(scene ? getMatchStats(scene) : null)));
}

/** A trace a closed tab left behind: download it once, then forget it. */
function recoverUnfinished(): void {
  const raw = readStorage(UNFINISHED_KEY);
  if (!raw) return;
  removeStorage(UNFINISHED_KEY);
  try {
    const trace = JSON.parse(raw) as PlayerTrace;
    if (typeof trace.version === 'number' && Array.isArray(trace.events)) download(trace);
  } catch {
    // Corrupt leftover: dropped.
  }
}

export function bindMatchTrace(): void {
  installTraceInputSource(window);
  onMatchStart((kind) => {
    // A restart starts a new match without leaving the old one first.
    close('restart');
    pending = tracedMode(kind);
    last = null;
  });
  onMatchEnd(() => close('quit'));
  window.addEventListener('pagehide', persistUnfinished);
  window.setTimeout(recoverUnfinished, 1500);
  (window as unknown as { __TRACE__?: unknown }).__TRACE__ = {
    current: () => recorder?.snapshot() ?? null,
    last: () => last,
    download: downloadMatchTrace,
  };
}
