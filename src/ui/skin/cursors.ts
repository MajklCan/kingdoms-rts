/**
 * Battlefield cursor: while the pointer is over the game canvas during a
 * match, ask the scene what a click there would mean (UiApi.pointerHoverKind)
 * and mirror it to #game-root[data-cursor], which cursors.css maps to the
 * pixel cursors in public/assets/ui/cursors. The HUD and menus keep the
 * default pointer; text fields keep the text beam.
 */

import type { GameScene } from '../../render/game-scene';
import { hasOpenLayer } from '../a11y/layers';
import { appState, onPhaseChange } from '../app-state';
import { byId } from '../dom';
import { pointerHoverKind, type PointerHoverKind } from '../game-bridge';

/** Units walk under a still pointer, so re-read a few times a second. */
const POLL_MS = 90;

let root: HTMLElement | null = null;
let overCanvas = false;
let lastPoll = 0;
let current: PointerHoverKind = 'default';

function apply(kind: PointerHoverKind): void {
  if (kind === current || !root) return;
  current = kind;
  if (kind === 'default') delete root.dataset.cursor;
  else root.dataset.cursor = kind;
}

export function bindCursor(): void {
  root = byId('game-root');
  if (!root) return;
  root.addEventListener('pointerover', (ev) => {
    overCanvas = (ev.target as HTMLElement | null)?.tagName === 'CANVAS';
    lastPoll = 0;
  });
  root.addEventListener('pointerleave', () => {
    overCanvas = false;
    apply('default');
  });
  onPhaseChange(() => apply('default'));
}

export function updateCursor(scene: GameScene, now: number): void {
  if (!overCanvas || appState.phase !== 'match' || hasOpenLayer()) {
    apply('default');
    return;
  }
  if (now - lastPoll < POLL_MS) return;
  lastPoll = now;
  apply(pointerHoverKind(scene));
}
