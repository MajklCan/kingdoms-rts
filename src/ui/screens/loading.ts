/**
 * Loading screen between the menu and a match: the destination named over
 * the darkened title map, one chronicle line, the map plate, and a progress
 * rule whose four notches each complete on real work (scene ready, world
 * built, first frames drawn, minimum time held). It paints first, runs the
 * start task under the cover, and holds long enough to read, never flashing.
 */

import type { MapIdValue } from '../../sim/map-gen';
import { setPhase } from '../app-state';
import { afterPaint, byId, h, wait } from '../dom';
import { getScene, isSceneReady } from '../game-bridge';
import {
  LOADING_PHASES,
  LORE,
  LORE_ROTATE_MS,
  PHASE_COUNT,
  eyebrowFor,
  minDisplayMs,
  phaseCreep,
  pickLore,
  type LoadingKind,
} from './loading-phases';
import { paintMapPreview } from './map-preview';

export type { LoadingKind } from './loading-phases';

const SLOW_PHASE_MS = 4000;
const FAIL_HOLD_MS = 1200;
const REVEAL_HOLD_MS = 220;
const LEAVE_MS = 420;

interface Parts {
  root: HTMLElement;
  bg: HTMLElement;
  eyebrow: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  lore: HTMLElement;
  plate: HTMLElement;
  map: HTMLCanvasElement;
  status: HTMLElement;
  rule: HTMLElement;
}

let parts: Parts | null = null;
let loreIndex = -1;

function build(): Parts {
  const bg = h('div', { class: 'loading-bg', 'aria-hidden': 'true' });
  const eyebrow = h('p', { class: 'loading-eyebrow' });
  const title = h('h2', { class: 'loading-title' });
  const sub = h('p', { class: 'loading-sub' });
  const lore = h('p', { class: 'loading-lore', 'aria-live': 'off' });
  const map = h('canvas', { class: 'loading-map' });
  const plate = h(
    'div',
    { class: 'loading-plate', 'aria-hidden': 'true' },
    map,
    h('img', { class: 'loading-plate-crest', src: '/assets/ui/crest.svg', alt: '', width: 200, height: 244, draggable: 'false' }),
    h('div', { class: 'loading-fog' })
  );
  const status = h('p', { class: 'loading-status', role: 'status', 'aria-live': 'polite' }, LOADING_PHASES[0]);
  const notches = [1, 2, 3].map((n) => h('span', { class: 'loading-notch', style: `left: ${(n / PHASE_COUNT) * 100}%` }));
  const rule = h(
    'div',
    { class: 'loading-rule', role: 'progressbar', 'aria-label': 'Loading', 'aria-valuemin': 0, 'aria-valuemax': PHASE_COUNT, 'aria-valuenow': 0 },
    h('i', { class: 'loading-fill' }),
    ...notches
  );
  const root = h(
    'div',
    { id: 'loading-screen', class: 'loading-screen', hidden: true, 'aria-busy': 'true' },
    bg,
    h('div', { class: 'loading-scrim', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'loading-frame' },
      h('div', { class: 'loading-brief' }, eyebrow, title, sub, lore),
      plate,
      h('div', { class: 'loading-foot' }, status, rule)
    )
  );
  return { root, bg, eyebrow, title, sub, lore, plate, map, status, rule };
}

export function getLoadingRoot(): HTMLElement {
  parts ??= build();
  return parts.root;
}

/** Move the rule (and the plate's fog) to `p`; `slow` eases over seconds. */
function setRule(p: Parts, value: number, done: number, slow: boolean): void {
  p.root.style.setProperty('--p', value.toFixed(4));
  p.root.style.setProperty('--rule-dur', slow ? '2.4s' : '0.3s');
  p.rule.setAttribute('aria-valuenow', String(done));
}

export interface LoadingOptions {
  title: string;
  subtitle?: string;
  kind: LoadingKind;
  /** Map for the plate; the crest stands in when there is none. */
  mapId?: MapIdValue | null;
  /** Minimum time on screen in ms (default per kind, see loading-phases). */
  minMs?: number;
  /** Starts the match. Runs after the loading screen has painted. */
  task: () => void;
  /** The cover starts to lift off a started match (match-start stinger). */
  onReveal?: () => void;
}

let busy = false;

/** Show the loading screen, run the task, then reveal the match. */
export async function runLoading(opts: LoadingOptions): Promise<boolean> {
  if (busy) return false;
  busy = true;
  const p = (parts ??= build());
  const el = p.root;
  p.eyebrow.textContent = eyebrowFor(opts.kind);
  p.title.textContent = opts.title;
  p.sub.textContent = opts.subtitle ?? '';
  loreIndex = pickLore(loreIndex, Math.random);
  p.lore.textContent = LORE[loreIndex]!;
  p.status.textContent = LOADING_PHASES[0];
  p.status.classList.remove('is-slow', 'is-error');
  p.plate.dataset.plate = opts.mapId ? 'map' : 'crest';
  // Pick the backdrop up exactly where the title's drifting map stands.
  const menuBg = byId('menu-bg');
  p.bg.style.transform = menuBg ? getComputedStyle(menuBg).transform : '';
  el.classList.remove('is-leaving');
  setRule(p, 0, 0, false);
  el.hidden = false;
  setPhase('loading');
  if (opts.mapId) paintMapPreview(p.map, opts.mapId, opts.kind === 'skirmish');

  const started = performance.now();
  const minMs = opts.minMs ?? minDisplayMs(opts.kind);
  let slowTimer = 0;
  const enterPhase = (done: number): void => {
    window.clearTimeout(slowTimer);
    p.status.classList.remove('is-slow');
    p.status.textContent = LOADING_PHASES[Math.min(done, PHASE_COUNT - 1)]!;
    setRule(p, phaseCreep(done), done, true);
    if (done < PHASE_COUNT) slowTimer = window.setTimeout(() => p.status.classList.add('is-slow'), SLOW_PHASE_MS);
  };
  const loreTimer = window.setInterval(() => {
    loreIndex = pickLore(loreIndex, Math.random);
    p.lore.textContent = LORE[loreIndex]!;
  }, LORE_ROTATE_MS);

  let ok = true;
  try {
    enterPhase(0);
    await afterPaint();
    // The scene may still be decoding audio on a cold start; wait for it.
    for (let i = 0; i < 400 && !isSceneReady(getScene()); i++) await wait(25);
    enterPhase(1);
    // Paint the new target first: the rule's transform keeps easing on the
    // compositor while the task blocks the main thread.
    await afterPaint();
    opts.task();
    enterPhase(2);
    // Let the scene render its first frames under the cover.
    await afterPaint();
    await afterPaint();
    enterPhase(3);
    const remaining = minMs - (performance.now() - started);
    if (remaining > 0) await wait(remaining);
  } catch (err) {
    ok = false;
    console.error('[Kingdoms] failed to start match', err);
    p.status.classList.add('is-error');
    p.status.textContent = 'The realm could not be raised. Returning to the menu.';
    await wait(FAIL_HOLD_MS);
  }
  window.clearTimeout(slowTimer);
  window.clearInterval(loreTimer);
  if (ok) {
    setPhase('match');
    p.status.textContent = LOADING_PHASES[PHASE_COUNT - 1];
    setRule(p, 1, PHASE_COUNT, false);
    await wait(REVEAL_HOLD_MS);
    opts.onReveal?.();
  }
  el.classList.add('is-leaving');
  await wait(LEAVE_MS);
  el.hidden = true;
  el.classList.remove('is-leaving');
  busy = false;
  return ok;
}

export function isLoading(): boolean {
  return busy;
}
