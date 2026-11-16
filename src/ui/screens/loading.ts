/**
 * Loading screen between the menu and a match: the title's own painted map,
 * haze and glows, darkened, with one quiet line bottom-left (the real
 * start-up phase) over a thin gold hairline that fills as the work
 * completes. It paints first, runs the start task under the cover, and holds
 * long enough to read, never flashing.
 */

import type { MapIdValue } from '../../sim/map-gen';
import { setPhase } from '../app-state';
import { afterPaint, byId, h, wait } from '../dom';
import { getScene, isSceneReady } from '../game-bridge';
import { LOADING_PHASES, PHASE_COUNT, minDisplayMs, phaseCreep, type LoadingKind } from './loading-phases';

export type { LoadingKind } from './loading-phases';

const SLOW_PHASE_MS = 4000;
const FAIL_HOLD_MS = 1200;
const REVEAL_HOLD_MS = 220;
const LEAVE_MS = 420;

interface Parts {
  root: HTMLElement;
  bg: HTMLElement;
  status: HTMLElement;
  rule: HTMLElement;
}

let parts: Parts | null = null;

function build(): Parts {
  const bg = h('div', { class: 'menu-bg loading-bg', 'aria-hidden': 'true' });
  const status = h('p', { class: 'loading-status', role: 'status', 'aria-live': 'polite' }, LOADING_PHASES[0]);
  const rule = h(
    'div',
    { class: 'loading-rule', role: 'progressbar', 'aria-label': 'Loading', 'aria-valuemin': 0, 'aria-valuemax': PHASE_COUNT, 'aria-valuenow': 0 },
    h('i', { class: 'loading-fill' })
  );
  const root = h(
    'div',
    { id: 'loading-screen', class: 'loading-screen', hidden: true, 'aria-busy': 'true' },
    bg,
    h('div', { class: 'menu-haze', 'aria-hidden': 'true' }),
    h('div', { class: 'menu-glow-hall', 'aria-hidden': 'true' }),
    h('div', { class: 'menu-glow-core loading-glow', 'aria-hidden': 'true' }),
    h('div', { class: 'loading-motes', 'aria-hidden': 'true' }),
    h('div', { class: 'loading-scrim', 'aria-hidden': 'true' }),
    h('div', { class: 'loading-frame' }, h('div', { class: 'loading-foot' }, status, rule))
  );
  return { root, bg, status, rule };
}

export function getLoadingRoot(): HTMLElement {
  parts ??= build();
  return parts.root;
}

/** Move the hairline to `value` (0..1); `slow` eases over seconds. */
function setRule(p: Parts, value: number, done: number, slow: boolean): void {
  p.root.style.setProperty('--p', value.toFixed(4));
  p.root.style.setProperty('--rule-dur', slow ? '2.4s' : '0.3s');
  p.rule.setAttribute('aria-valuenow', String(done));
}

export interface LoadingOptions {
  /** Destination name; announced to screen readers, not drawn. */
  title: string;
  subtitle?: string;
  kind: LoadingKind;
  mapId?: MapIdValue | null;
  /** Minimum time on screen in ms (default per kind, see loading-phases). */
  minMs?: number;
  /** Starts the match. Runs after the loading screen has painted. */
  task: () => void;
}

let busy = false;

/** Show the loading screen, run the task, then reveal the match. */
export async function runLoading(opts: LoadingOptions): Promise<boolean> {
  if (busy) return false;
  busy = true;
  const p = (parts ??= build());
  const el = p.root;
  el.setAttribute('aria-label', `Loading ${opts.title}`);
  p.status.textContent = LOADING_PHASES[0];
  p.status.classList.remove('is-slow', 'is-error');
  // Pick the backdrop up exactly where the title's drifting map stands.
  const menuBg = byId('menu-bg');
  p.bg.style.transform = menuBg ? getComputedStyle(menuBg).transform : '';
  p.bg.style.translate = menuBg ? getComputedStyle(menuBg).translate : '';
  el.classList.remove('is-leaving');
  setRule(p, 0, 0, false);
  el.hidden = false;
  setPhase('loading');

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
  if (ok) {
    setPhase('match');
    p.status.textContent = LOADING_PHASES[PHASE_COUNT - 1];
    setRule(p, 1, PHASE_COUNT, false);
    await wait(REVEAL_HOLD_MS);
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
