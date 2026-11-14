/**
 * Auto performance mode: while a touch device plays a match with the
 * Performance setting on Auto, watch the frame time; when it stays above
 * 25 ms for a few seconds, switch the cheap effects on for the rest of the
 * session and say so once.
 */

import { FrameTimeProbe, perfModeAutoEngaged, perfModePref, setPerfModeAuto } from '../../render/effects/perf-mode';
import { isTouchUi } from '../../render/input/input-mode';
import { pushAlert } from '../hud/alerts';

const probe = new FrameTimeProbe(25, 1000, 4000);
let lastNow = 0;

/** Feed one HUD frame (match only). */
export function tickPerfProbe(now: number): void {
  const dt = lastNow > 0 ? now - lastNow : 0;
  lastNow = now;
  if (dt <= 0 || perfModePref() !== 'auto' || perfModeAutoEngaged() || !isTouchUi()) return;
  if (!probe.frame(now, dt)) return;
  setPerfModeAuto(true);
  pushAlert({ kind: 'info', text: 'Performance mode on: fewer effects for a smoother game. Change it in Settings.' });
}

/** Between matches: forget the last timestamp so a menu gap is not a slow frame. */
export function resetPerfProbe(): void {
  lastNow = 0;
}
