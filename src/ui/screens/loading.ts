/**
 * Loading screen between the menu and a match. Covers the swap so there is
 * never a blank or half-built frame: it paints first, then runs the start
 * task, waits for the scene, and holds for a minimum time so the transition
 * reads as deliberate instead of a flash.
 */

import { setPhase } from '../app-state';
import { afterPaint, h, wait } from '../dom';
import { isSceneReady, getScene } from '../game-bridge';

const TIPS = [
  'Houses raise your population cap. Build one before you are blocked.',
  'Press B, then a letter, to place buildings without touching the mouse.',
  'Ctrl plus a number saves a control group. Tap the number to recall it, twice to jump there.',
  'Press . to cycle through idle villagers.',
  'Space jumps the camera to the latest alert.',
  'Mills boost farm deliveries. Place them beside your fields.',
  'Pikemen hold the line against cavalry. Archers shoot from behind them.',
  'Worksites spawn their own workers. Villagers are free for building and farming.',
  'Advancing an age unlocks new buildings, units and research.',
  'Press Esc for the pause menu, where you can save, load and change settings.',
];

let root: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let subEl: HTMLElement | null = null;
let tipEl: HTMLElement | null = null;
let barEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let tipIndex = Math.floor(Math.random() * TIPS.length);

export function getLoadingRoot(): HTMLElement {
  if (root) return root;
  titleEl = h('h2', { class: 'loading-title title-display' });
  subEl = h('p', { class: 'loading-sub' });
  tipEl = h('p', { class: 'loading-tip' });
  barEl = h('i');
  statusEl = h('p', { class: 'loading-status', role: 'status', 'aria-live': 'polite' }, 'Preparing the realm');
  root = h(
    'div',
    { id: 'loading-screen', class: 'loading-screen', hidden: true, 'aria-busy': 'true' },
    h('div', { class: 'loading-bg', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'loading-card' },
      h('img', { class: 'loading-crest', src: '/assets/ui/crest.svg', alt: '', width: 200, height: 244 }),
      h('div', { class: 'eyebrow' }, 'Now entering'),
      titleEl,
      subEl,
      h('div', { class: 'loading-bar bar', role: 'progressbar', 'aria-label': 'Loading', 'aria-valuemin': 0, 'aria-valuemax': 100 }, barEl),
      statusEl,
      h('div', { class: 'ornament-rule', 'aria-hidden': 'true' }, h('span')),
      tipEl
    )
  );
  return root;
}

function setProgress(p: number): void {
  barEl?.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
  barEl?.parentElement?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

export interface LoadingOptions {
  title: string;
  subtitle?: string;
  /** Minimum time on screen in ms (default 900). */
  minMs?: number;
  /** Starts the match. Runs after the loading screen has painted. */
  task: () => void;
}

let busy = false;

/** Show the loading screen, run the task, then reveal the match. */
export async function runLoading(opts: LoadingOptions): Promise<boolean> {
  if (busy) return false;
  busy = true;
  const el = getLoadingRoot();
  titleEl!.textContent = opts.title;
  subEl!.textContent = opts.subtitle ?? '';
  tipIndex = (tipIndex + 1) % TIPS.length;
  tipEl!.textContent = TIPS[tipIndex]!;
  statusEl!.textContent = 'Preparing the realm';
  el.classList.remove('is-leaving');
  el.hidden = false;
  setProgress(0.08);
  setPhase('loading');

  const started = performance.now();
  const minMs = opts.minMs ?? 900;
  let ok = true;
  try {
    await afterPaint();
    // The scene may still be decoding audio on a cold start; wait for it.
    for (let i = 0; i < 400 && !isSceneReady(getScene()); i++) {
      setProgress(0.1 + Math.min(0.25, i / 400));
      await wait(25);
    }
    setProgress(0.4);
    statusEl!.textContent = 'Raising the map';
    await afterPaint();
    opts.task();
    setProgress(0.75);
    statusEl!.textContent = 'Mustering the host';
    // Let the scene render its first frames under the cover.
    await afterPaint();
    await afterPaint();
  } catch (err) {
    ok = false;
    console.error('[Kingdoms] failed to start match', err);
    statusEl!.textContent = 'The realm could not be raised. Returning to the menu.';
  }
  const remaining = minMs - (performance.now() - started);
  if (remaining > 0) {
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      setProgress(0.75 + (0.25 * i) / steps);
      await wait(remaining / steps);
    }
  }
  setProgress(1);
  if (ok) setPhase('match');
  el.classList.add('is-leaving');
  await wait(260);
  el.hidden = true;
  el.classList.remove('is-leaving');
  busy = false;
  return ok;
}

export function isLoading(): boolean {
  return busy;
}
