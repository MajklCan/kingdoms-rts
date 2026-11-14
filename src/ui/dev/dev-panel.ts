/**
 * Developer panel (backtick, dev builds only): live debug stats, the cheat
 * buttons that used to sit in the player HUD (reveal map, +500 resources,
 * spawn cavalry / machine gun / mortar), the Late Game Test fixture and a
 * state dump. Cheats are disabled in multiplayer.
 */

import { updateDebugOverlay } from '../../debug/overlay';
import type { MultiplayerSessionDebugSnapshot } from '../../net/session';
import type { GameScene } from '../../render/game-scene';
import { appState } from '../app-state';
import { downloadTextFile, h, isTextEntryTarget } from '../dom';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import { loadLateGameTest } from '../match/match-flow';
import { logLine } from '../hud/event-log';

let panel: HTMLElement | null = null;
let cheatButtons: HTMLButtonElement[] = [];
let mpNote: HTMLElement | null = null;

export function isDevBuild(): boolean {
  return import.meta.env.DEV;
}

export function cheatsBlocked(): boolean {
  const scene = getScene();
  const state = appState.mpSession?.state;
  return scene?.isMultiplayer() === true || state === 'connecting' || state === 'lobby' || state === 'playing';
}

function cheat(id: string, label: string, run: (scene: GameScene) => void): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'dev-btn cheat-button', id }, label);
  btn.addEventListener('click', () => {
    const scene = getScene();
    if (!scene || cheatsBlocked()) return;
    run(scene);
  });
  cheatButtons.push(btn);
  return btn;
}

function dump(): void {
  const scene = getScene();
  if (!scene || cheatsBlocked()) return;
  const snapshot = scene.createSaveSnapshot('Debug Dump');
  const api = window as unknown as {
    __GAME__?: { debugDump?: () => Record<string, unknown> };
    __MP__?: { snapshot?: () => MultiplayerSessionDebugSnapshot | null };
  };
  downloadTextFile(
    `kingdoms-state-${snapshot.tick}.json`,
    JSON.stringify({ debug: api.__GAME__?.debugDump?.() ?? null, mp: api.__MP__?.snapshot?.() ?? null, save: snapshot }, null, 2),
    'application/json'
  );
  logLine(`Debug dump downloaded (${snapshot.tick})`);
}

function row(label: string, id: string): HTMLElement {
  return h('div', { class: 'dev-row' }, h('dt', null, label), h('dd', { id }, '-'));
}

export function buildDevPanel(): HTMLElement | null {
  if (!isDevBuild()) return null;
  cheatButtons = [];
  mpNote = h('p', { class: 'dev-note', hidden: true }, 'Cheats are disabled in multiplayer.');
  panel = h(
    'aside',
    { id: 'debug-overlay', class: 'dev-panel', hidden: true, 'aria-label': 'Developer panel' },
    h('header', { class: 'dev-head' }, icon('hammer'), h('strong', null, 'Developer'), h('kbd', null, '`')),
    h(
      'dl',
      { class: 'dev-stats' },
      row('FPS', 'dbg-fps'),
      row('Tick', 'dbg-tick'),
      row('Entities', 'dbg-entities'),
      row('Selected', 'dbg-selected'),
      row('Status', 'dbg-gather'),
      row('Build', 'dbg-build'),
      row('Zoom', 'dbg-zoom'),
      row('Speed', 'dbg-speed'),
      row('Last event', 'dbg-event')
    ),
    h(
      'div',
      { class: 'dev-buttons' },
      cheat('cheat-reveal-map', 'Reveal', (s) => s.cheatRevealMap(s.getPerspectivePlayerId())),
      cheat('cheat-add-resources', '+500', (s) => s.cheatAddResources(s.getPerspectivePlayerId(), 500)),
      cheat('cheat-spawn-cavalry', 'Cav', (s) => s.cheatSpawnCavalryByTownHall(s.getPerspectivePlayerId())),
      cheat('cheat-spawn-machine-gun', 'MG', (s) => s.cheatSpawnMachineGunByTownHall(s.getPerspectivePlayerId())),
      cheat('cheat-spawn-mortar', 'Mtr', (s) => s.cheatSpawnMortarByTownHall(s.getPerspectivePlayerId())),
      cheat('cheat-dump-state', 'Dump', () => dump()),
      cheat('cheat-late-game', 'Late Game Test', () => loadLateGameTest())
    ),
    mpNote
  );
  return panel;
}

export function bindDevPanel(): void {
  if (!isDevBuild()) return;
  window.addEventListener('keydown', (ev) => {
    if (isTextEntryTarget(ev.target)) return;
    // ev.code covers layouts (Czech, German) where that key types another glyph.
    if (ev.key === '`' || ev.key === '~' || ev.code === 'Backquote') {
      if (!panel) return;
      panel.hidden = !panel.hidden;
    }
  });
}

/** Feed the debug overlay every frame (including the raw last-event line,
 *  which is developer wording and never shown to players). */
export function updateDevPanel(scene: GameScene): void {
  const status = scene.getStatusInfo();
  updateDebugOverlay({
    fps: scene.fps ?? 0,
    tick: scene.getTick(),
    entities: scene.getEntityCount(),
    selected: scene.getSelectedSummary(),
    gather: status.text,
    build: scene.getBuildMode(),
    zoom: scene.zoom,
    speed: scene.getGameSpeed(),
  });
  if (!panel || panel.hidden) return;
  const blocked = cheatsBlocked();
  for (const b of cheatButtons) b.disabled = blocked;
  if (mpNote) mpNote.hidden = !blocked;
}
