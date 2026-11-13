/** Delegated UI feedback: ui_click / ui_hover on any button, tab, option or choice. */

import { getScene } from './game-bridge';

const INTERACTIVE_SELECTOR = 'button, [role="button"], [role="option"], [role="tab"], select';

export function bindUiSounds(): void {
  document.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR);
    if (el && !(el as HTMLButtonElement).disabled) getScene()?.playUiClick();
  });
  // Selects and radio choices don't always fire a click on a matching element.
  document.addEventListener('change', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest('select, input[type="radio"]');
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
