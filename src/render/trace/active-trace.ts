/**
 * The running match's trace and the one-line hooks the input code calls.
 * Every hook is a no-op while no trace runs (menus, campaign, loaded saves).
 *
 * How an action came in (hotkey, click or touch) is read from the latest
 * raw input: window capture listeners see every keydown and pointerdown
 * before the game or the HUD handles it, so an action recorded while
 * handling that event, or later from it (a placement click after a build
 * hotkey), gets the right source without threading it through the code.
 */

import type { RecordOptions, TraceRecorder, TraceVia } from './player-trace';

let active: TraceRecorder | null = null;
let lastVia: TraceVia = 'click';

export function setActiveTrace(recorder: TraceRecorder | null): void {
  active = recorder;
}

export function activeTrace(): TraceRecorder | null {
  return active;
}

/** The raw input that came in last: a key, or a pointer of this type. */
export function noteInput(kind: 'key' | 'pointer', pointerType = 'mouse'): void {
  lastVia = kind === 'key' ? 'hotkey' : pointerType === 'touch' ? 'touch' : 'click';
}

export function currentVia(): TraceVia {
  return lastVia;
}

/** Watch raw input on `target` (the window). Returns the uninstaller. */
export function installTraceInputSource(target: Window): () => void {
  const onKey = (ev: KeyboardEvent) => {
    // Modifiers alone (Shift for a queued click) are not the action.
    if (ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Meta') return;
    noteInput('key');
  };
  const onPointer = (ev: PointerEvent) => noteInput('pointer', ev.pointerType);
  target.addEventListener('keydown', onKey, true);
  target.addEventListener('pointerdown', onPointer, true);
  return () => {
    target.removeEventListener('keydown', onKey, true);
    target.removeEventListener('pointerdown', onPointer, true);
  };
}

/** One use of a feature. `via` overrides the latest input (wheel, pinch, WASD). */
export function trace(feature: string, opts: RecordOptions & { via?: TraceVia } = {}): void {
  if (!active) return;
  active.record(feature, opts.via ?? lastVia, opts);
}
