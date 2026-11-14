/**
 * Fullscreen toggle. Browsers without the Fullscreen API (some in-car and
 * iOS browsers) hide the buttons instead of offering one that does nothing.
 * Entering fullscreen also tries to lock landscape; that only works on some
 * mobile browsers and is allowed to fail quietly.
 */

import { h } from '../dom';
import { icon, setIcon } from '../icons/icon';
import { attachTip } from '../hud/tooltip';

type OrientationWithLock = ScreenOrientation & { lock?: (o: string) => Promise<void> };

const buttons = new Set<HTMLButtonElement>();

export function canFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

function lockLandscape(): void {
  const orientation = screen.orientation as OrientationWithLock | undefined;
  try {
    orientation?.lock?.('landscape')?.catch(() => undefined);
  } catch {
    // Not supported here; the rotate hint covers portrait phones.
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (!canFullscreen()) return;
  try {
    if (isFullscreen()) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      lockLandscape();
    }
  } catch {
    // Refused (no user gesture, policy): stay as we are.
  }
}

function sync(): void {
  const on = isFullscreen();
  for (const btn of buttons) {
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Leave fullscreen' : 'Fullscreen');
    const ic = btn.querySelector<HTMLElement>('.icon');
    if (ic) setIcon(ic, on ? 'fullscreen-exit' : 'fullscreen');
  }
}

/** An icon button that toggles fullscreen; hidden where the API is missing. */
export function buildFullscreenButton(className = 'icon-btn', id?: string): HTMLButtonElement {
  const btn = h(
    'button',
    { type: 'button', class: `${className} fullscreen-btn`, id, 'aria-label': 'Fullscreen', 'aria-pressed': 'false', hidden: !canFullscreen() },
    icon('fullscreen')
  );
  btn.addEventListener('click', () => void toggleFullscreen());
  attachTip(btn, () => ({ title: isFullscreen() ? 'Leave fullscreen' : 'Fullscreen', body: 'Hide the browser bars and use the whole screen.' }));
  buttons.add(btn);
  if (buttons.size === 1) document.addEventListener('fullscreenchange', sync);
  sync();
  return btn;
}
