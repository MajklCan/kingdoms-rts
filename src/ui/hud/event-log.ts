/**
 * Event log: the last few game messages (build prompts, training, research)
 * as a faint chronicle above the minimap. Fed from the scene's last-event
 * line (mirrored into a hidden #dbg-event node by the debug overlay updater)
 * until the scene offers an event subscription.
 */

import type { GameScene } from '../../render/game-scene';
import { h, plainDashes } from '../dom';
import { onTrackerEvent } from '../match/tracker';
import { UNIT_TABLE } from '../../sim/defs';
import { pushAlert } from './alerts';

const MAX_LINES = 4;
const LINE_TTL = 9000;

let logEl: HTMLElement | null = null;
let sourceEl: HTMLElement | null = null;
let lastRaw = '';
const lines: Array<{ el: HTMLElement; at: number }> = [];

// Debug chatter from the scene (selection echoes, coordinates, entity ids)
// stays in the dev panel; the player log only keeps meaningful events.
const NOISE = [
  /^-$/,
  /^(placement|build mode|army rally) cancelled$/i,
  /^game speed/i,
  /^(selected|box-selected|cleared selection)/i,
  /^f[12]: selected/i,
  /eid=\d+/,
  /\(-?\d+,\s*-?\d+\)$/,
];

export function buildEventLog(): HTMLElement {
  sourceEl = h('span', { id: 'dbg-event', hidden: true });
  logEl = h('ol', { class: 'event-log', id: 'event-log', 'aria-label': 'Recent events', 'aria-live': 'off' });
  return h('div', { class: 'event-log-wrap' }, logEl, sourceEl);
}

function tidy(raw: string): string {
  const text = plainDashes(raw).trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function logLine(text: string): void {
  if (!logEl) return;
  const el = h('li', { class: 'event-line' }, text);
  logEl.append(el);
  lines.push({ el, at: performance.now() });
  while (lines.length > MAX_LINES) lines.shift()!.el.remove();
}

export function bindEventLog(): void {
  onTrackerEvent((ev) => {
    if (ev.type === 'unit-trained') {
      const name = UNIT_TABLE[ev.defId]?.name;
      if (name) logLine(`${name} ready`);
    } else if (ev.type === 'unit-lost') {
      logLine('A unit has fallen');
    } else if (ev.type === 'building-lost') {
      logLine('A building was lost');
    }
  });
}

export function updateEventLog(_scene: GameScene, now: number): void {
  if (!sourceEl) return;
  const raw = sourceEl.textContent ?? '';
  if (raw !== lastRaw) {
    lastRaw = raw;
    if (raw && !NOISE.some((re) => re.test(raw.trim()))) {
      const text = tidy(raw);
      logLine(text);
      if (/\bneeds\b|not enough|pop space/i.test(raw)) pushAlert({ kind: 'resources', text });
    }
  }
  for (const line of lines) {
    const age = now - line.at;
    line.el.classList.toggle('is-fading', age > LINE_TTL * 0.6);
  }
  while (lines.length > 0 && now - lines[0]!.at > LINE_TTL) lines.shift()!.el.remove();
}

export function resetEventLog(): void {
  for (const line of lines) line.el.remove();
  lines.length = 0;
  lastRaw = sourceEl?.textContent ?? '';
}
