/**
 * Delegated UI feedback: ui_click / ui_hover on any button, tab, option or
 * choice. The click sounds on press (pointer down), like a physical button,
 * not on release; keyboard activation (Enter / Space) sounds on its click.
 */

import { getScene } from './game-bridge';

const INTERACTIVE_SELECTOR = 'button, [role="button"], [role="option"], [role="tab"], select';

function pressable(target: EventTarget | null): HTMLElement | null {
  const el = (target as HTMLElement | null)?.closest<HTMLElement>(INTERACTIVE_SELECTOR) ?? null;
  if (!el || (el as HTMLButtonElement).disabled || el.tagName === 'SELECT') return null;
  return el;
}

export function bindUiSounds(): void {
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (pressable(ev.target)) getScene()?.playUiClick();
  });
  document.addEventListener('click', (ev) => {
    // detail is 0 for clicks synthesised from the keyboard.
    if (ev.detail === 0 && pressable(ev.target)) getScene()?.playUiClick();
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
