/**
 * Event log: the last few game messages (training, construction, research,
 * losses, refused orders) as a faint chronicle above the minimap. Fed by the
 * scene's typed message subscription; lines with a location jump the camera
 * when clicked.
 */

import type { GameScene } from '../../render/game-scene';
import { h, plainDashes } from '../dom';
import { onGameMessage, panToTile, type GameMessage } from '../game-bridge';

const MAX_LINES = 4;
const LINE_TTL = 9000;

let logEl: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;
const lines: Array<{ el: HTMLElement; at: number }> = [];

export function buildEventLog(): HTMLElement {
  logEl = h('ol', { class: 'event-log', id: 'event-log', 'aria-label': 'Recent events', 'aria-live': 'off' });
  return h('div', { class: 'event-log-wrap' }, logEl);
}

export function logLine(text: string, tone: GameMessage['tone'] = 'info', at?: GameMessage['at']): void {
  if (!logEl) return;
  const el = h('li', { class: `event-line tone-${tone}`, 'data-tone': tone }, plainDashes(text));
  if (at) {
    el.classList.add('is-located');
    el.title = 'Show on the map';
    el.addEventListener('click', () => {
      const scene = activeScene;
      if (scene) panToTile(scene, at.x, at.y);
    });
  }
  logEl.append(el);
  lines.push({ el, at: performance.now() });
  while (lines.length > MAX_LINES) lines.shift()!.el.remove();
}

let activeScene: GameScene | null = null;

export function bindEventLog(): void {
  // The subscription is opened lazily once the scene's UI API exists.
}

export function updateEventLog(scene: GameScene, now: number): void {
  activeScene = scene;
  if (!unsubscribe) unsubscribe = onGameMessage((m) => logLine(m.text, m.tone, m.at));
  for (const line of lines) {
    const age = now - line.at;
    line.el.classList.toggle('is-fading', age > LINE_TTL * 0.6);
  }
  while (lines.length > 0 && now - lines[0]!.at > LINE_TTL) lines.shift()!.el.remove();
}

export function resetEventLog(): void {
  for (const line of lines) line.el.remove();
  lines.length = 0;
}
