/**
 * Touch mode for the DOM UI: reads the stored Input and Performance mode
 * preferences, tracks the device in use and mirrors the resolved mode on
 * <html data-input="touch|mouse">, which every touch layout rule keys off
 * (bigger hit targets, touch bar, placement Confirm, compact phone console).
 */

import { installInputModeDetection, inputModePref, isTouchUi, onInputModeChange, setInputModePref, type InputModePref } from '../../render/input/input-mode';
import { perfModePref, setPerfModePref, type PerfModePref } from '../../render/effects/perf-mode';
import { readStorage, writeStorage } from '../dom';
import { hideTip } from '../hud/tooltip';

const INPUT_KEY = 'kingdoms.inputMode';
const PERF_KEY = 'kingdoms.perfMode';

const INPUT_PREFS: readonly InputModePref[] = ['auto', 'touch', 'mouse'];
const PERF_PREFS: readonly PerfModePref[] = ['auto', 'on', 'off'];

const modeListeners = new Set<() => void>();

function parse<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function storedInputPref(): InputModePref {
  return inputModePref();
}

export function setStoredInputPref(next: InputModePref): void {
  writeStorage(INPUT_KEY, next);
  setInputModePref(next);
}

export function storedPerfPref(): PerfModePref {
  return perfModePref();
}

export function setStoredPerfPref(next: PerfModePref): void {
  writeStorage(PERF_KEY, next);
  setPerfModePref(next);
}

/** Run `fn` whenever the resolved input mode flips (UI scale, layout). */
export function onTouchModeChange(fn: () => void): void {
  modeListeners.add(fn);
}

function apply(): void {
  const mode = isTouchUi() ? 'touch' : 'mouse';
  document.documentElement.dataset.input = mode;
  // A tooltip opened by hover would stay stuck once fingers take over.
  hideTip();
  for (const fn of modeListeners) fn();
}

export function bindTouchMode(): void {
  setInputModePref(parse(readStorage(INPUT_KEY), INPUT_PREFS, 'auto'));
  setPerfModePref(parse(readStorage(PERF_KEY), PERF_PREFS, 'auto'));
  installInputModeDetection();
  onInputModeChange(() => apply());
}
