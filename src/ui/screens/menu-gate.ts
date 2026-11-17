/**
 * Title gate: the first frame after boot. Browsers keep audio locked until a
 * gesture, so the menu opens on "Press any key" over the backdrop; the press
 * unlocks audio, swells the menu theme in and glides
 * the wordmark from the centre to its corner. Shown on every page load;
 * `?nogate` skips it (dev reloads, automated tests).
 *
 * Every element is laid out in its final title position from the start: the
 * gate only adds a transform to the brand and hides the rest, so the reveal
 * never shifts layout.
 */

import { onPhaseChange } from '../app-state';
import { byId, isTextEntryTarget, prefersReducedMotion, wait } from '../dom';
import { getScene } from '../game-bridge';

type GateState = 'idle' | 'armed' | 'entering';

/** Keys that are not a deliberate "press any key" (or must keep their job). */
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Fn', 'ContextMenu']);
const ENTRY_MS = 1150;
const ENTRY_REDUCED_MS = 150;
/** The music starts a beat after the press and swells in slowly
 *  (menu_theme opens about 15 dB under its body, so a long swell suits it). */
const MUSIC_DELAY_S = 0.35;
const MUSIC_FADE_IN_S = 2.8;

let state: GateState = 'idle';
let cleanup: (() => void) | null = null;

export function gateWanted(search: string = window.location.search): boolean {
  return !new URLSearchParams(search).has('nogate');
}

export function isGateActive(): boolean {
  return state !== 'idle';
}

function menuRoot(): HTMLElement | null {
  return byId('menu-root');
}

/** Transform that puts the brand (crest + wordmark) in the centre, larger. */
function placeBrand(): void {
  const brand = byId('menu-brand');
  const inner = brand?.firstElementChild as HTMLElement | null;
  if (!brand || !inner) return;
  const r = brand.getBoundingClientRect();
  if (r.width === 0) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.max(1, Math.min(1.7, (vw * 0.86) / r.width, (vh * 0.34) / r.height));
  inner.style.setProperty('--gate-x', `${Math.round(vw / 2 - (r.left + r.width / 2))}px`);
  inner.style.setProperty('--gate-y', `${Math.round(vh * 0.42 - (r.top + r.height / 2))}px`);
  inner.style.setProperty('--gate-s', scale.toFixed(3));
}

function startMenuMusic(fadeIn?: number): void {
  getScene()?.getAudio()?.playMenuMusic({ fadeOut: 0, delay: fadeIn === undefined ? 0 : MUSIC_DELAY_S, fadeIn });
}

/** No gate (`?nogate`): the music starts on its own once audio unlocks. */
export function skipGate(): void {
  startMenuMusic();
}

function finish(focus: boolean): void {
  const root = menuRoot();
  if (root) delete root.dataset.gate;
  state = 'idle';
  cleanup?.();
  cleanup = null;
  const btn = byId('menu-gate-btn');
  if (btn) btn.hidden = true;
  if (focus) root?.querySelector<HTMLElement>('.menu-screen--title .charter:not([hidden])')?.focus({ preventScroll: true });
}

async function enter(): Promise<void> {
  if (state !== 'armed') return;
  state = 'entering';
  const root = menuRoot();
  if (root) root.dataset.gate = 'entering';
  const audio = getScene()?.getAudio();
  if (audio) {
    void audio.unlock().then(() => {
      startMenuMusic(MUSIC_FADE_IN_S);
    });
  }
  await wait(prefersReducedMotion() ? ENTRY_REDUCED_MS : ENTRY_MS);
  if (state === 'entering') finish(true);
}

/** Show the gate over the title screen (call after enterMenu('root')). */
export function armGate(): void {
  const root = menuRoot();
  const btn = byId('menu-gate-btn');
  if (!root || !btn || state !== 'idle') return;
  state = 'armed';
  root.dataset.gate = 'armed';
  btn.hidden = false;
  placeBrand();
  requestAnimationFrame(() => {
    placeBrand();
    btn.focus({ preventScroll: true });
  });
  // The wordmark width changes once the blackletter face has loaded.
  void document.fonts?.ready.then(() => {
    if (state === 'armed') placeBrand();
  });

  const onKey = (ev: KeyboardEvent): void => {
    if (state !== 'armed' || IGNORED_KEYS.has(ev.key) || /^F\d{1,2}$/.test(ev.key)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || isTextEntryTarget(ev.target)) return;
    ev.preventDefault();
    void enter();
  };
  const onClick = (ev: MouseEvent): void => {
    if (ev.button !== 0) return;
    void enter();
  };
  const onResize = (): void => {
    if (state === 'armed') placeBrand();
  };
  window.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  window.addEventListener('resize', onResize);
  // A match started some other way (debug API): drop the gate silently.
  const offPhase = onPhaseChange((phase) => {
    if (phase !== 'menu' && state !== 'idle') finish(false);
  });
  cleanup = () => {
    window.removeEventListener('keydown', onKey);
    root.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
    offPhase();
  };
}
