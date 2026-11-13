/** Delegated UI feedback: ui_click / ui_hover on any HUD button, cell or dropdown. */

import { getScene } from './game-bridge';

const INTERACTIVE_SELECTOR = 'button, [role="button"], .action-grid-cell, [data-tech-id], select';

export function bindUiSounds(): void {
  document.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR);
    if (el) getScene()?.playUiClick();
  });
  // Choosing an option from a <select> doesn't always fire click - cover change.
  document.addEventListener('change', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest('select');
    if (el) getScene()?.playUiClick();
  });
  let lastHover: Element | null = null;
  document.addEventListener('pointerover', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR);
    if (el && el !== lastHover) {
      lastHover = el;
      getScene()?.playUiHover();
    }
  });
  document.addEventListener('pointerout', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR);
    if (el === lastHover) lastHover = null;
  });
}
