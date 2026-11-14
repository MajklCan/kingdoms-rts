/**
 * Touch or mouse UI. "Auto" follows the last pointer that pressed something
 * (pointerType of real Pointer Events, so emulated mouse events after a tap
 * never flip it back) and starts from the media query for a coarse primary
 * pointer. Settings can force either mode.
 *
 * The mode only decides layout and flows that differ by device (touch bar,
 * hit target size, placement Confirm, long-press tooltips). Gestures always
 * follow the pointer itself: a finger is handled as touch and a mouse as a
 * mouse whatever the mode says.
 */

export type InputModePref = 'auto' | 'touch' | 'mouse';
export type InputMode = 'touch' | 'mouse';

let pref: InputModePref = 'auto';
let lastPointer: InputMode | null = null;
let coarseDefault = false;
let installed = false;
const listeners = new Set<(mode: InputMode) => void>();
let lastMode: InputMode = 'mouse';

/** Mode from the preference, the last pointer used and the device default. Pure. */
export function resolveInputMode(p: InputModePref, last: InputMode | null, coarse: boolean): InputMode {
  if (p !== 'auto') return p;
  return last ?? (coarse ? 'touch' : 'mouse');
}

export function inputMode(): InputMode {
  return resolveInputMode(pref, lastPointer, coarseDefault);
}

export function isTouchUi(): boolean {
  return inputMode() === 'touch';
}

export function inputModePref(): InputModePref {
  return pref;
}

export function setInputModePref(next: InputModePref): void {
  pref = next;
  notify();
}

/** Subscribe to mode changes (called once with the current mode). Returns an unsubscribe. */
export function onInputModeChange(fn: (mode: InputMode) => void): () => void {
  listeners.add(fn);
  fn(inputMode());
  return () => listeners.delete(fn);
}

function notify(): void {
  const mode = inputMode();
  if (mode === lastMode) return;
  lastMode = mode;
  for (const fn of listeners) fn(mode);
}

/** Track the device the player is actually using. Idempotent. */
export function installInputModeDetection(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const mq = window.matchMedia?.('(pointer: coarse)');
  const fine = window.matchMedia?.('(any-pointer: fine)');
  coarseDefault = !!mq?.matches && !fine?.matches;
  lastMode = inputMode();
  window.addEventListener(
    'pointerdown',
    (ev) => {
      const type = ev.pointerType === 'touch' || ev.pointerType === 'pen' ? 'touch' : ev.pointerType === 'mouse' ? 'mouse' : null;
      if (!type || type === lastPointer) return;
      lastPointer = type;
      notify();
    },
    true
  );
}
