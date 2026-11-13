/**
 * Native client feel: the page must never behave like a web document.
 * No context menu, no text selection or word selection on double-click, no
 * image or link dragging, no pinch / ctrl+wheel page zoom and no Safari
 * gesture zoom. Real text inputs keep all of their native behaviour.
 * The CSS half of this lives in styles/base.css.
 */

import { isTextEntryTarget } from '../dom';

function allowNative(target: EventTarget | null): boolean {
  return isTextEntryTarget(target);
}

export function bindNativeFeel(): void {
  document.addEventListener('contextmenu', (ev) => {
    if (!allowNative(ev.target)) ev.preventDefault();
  });
  document.addEventListener('selectstart', (ev) => {
    if (!allowNative(ev.target)) ev.preventDefault();
  });
  document.addEventListener('dragstart', (ev) => {
    if (!allowNative(ev.target)) ev.preventDefault();
  });
  // Trackpad pinch arrives as ctrl+wheel; the camera zoom listens on the
  // canvas and still receives it, only the page zoom is suppressed.
  document.addEventListener(
    'wheel',
    (ev) => {
      if (ev.ctrlKey) ev.preventDefault();
    },
    { passive: false }
  );
  // Safari's proprietary pinch gestures.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (ev) => ev.preventDefault(), { passive: false });
  }
  // Multi-touch pinch on touch screens.
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (ev.touches.length > 1) ev.preventDefault();
    },
    { passive: false }
  );
}
