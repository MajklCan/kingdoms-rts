/**
 * Delegated UI feedback: ui_click / ui_hover on any button, tab, option or
 * choice. The click sounds on press (pointer down), like a physical button,
 * not on release; keyboard activation (Enter / Space) sounds on its click.
 * Hover ticks are rate limited: sweeping the mouse across a toolbar gives a
 * few soft ticks, not a buzz, and never right after a click or mid-drag.
 */

import { getScene } from './game-bridge';

const INTERACTIVE_SELECTOR = 'button, [role="button"], [role="option"], [role="tab"], select';
/** Minimum ms between two hover ticks. */
const HOVER_GAP_MS = 120;
/** No hover tick this soon after a click (the click already spoke). */
const HOVER_AFTER_CLICK_MS = 250;
/** One click sound per press, however many listeners see it. */
const CLICK_DEDUPE_MS = 40;

function pressable(target: EventTarget | null): HTMLElement | null {
  const el = (target as HTMLElement | null)?.closest<HTMLElement>(INTERACTIVE_SELECTOR) ?? null;
  if (!el || (el as HTMLButtonElement).disabled || el.tagName === 'SELECT') return null;
  return el;
}

export function bindUiSounds(): void {
  let lastClickAt = -Infinity;
  let lastHoverAt = -Infinity;
  const click = (ev: Event): void => {
    if (ev.timeStamp - lastClickAt < CLICK_DEDUPE_MS) return;
    lastClickAt = ev.timeStamp;
    getScene()?.playUiClick();
  };
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (pressable(ev.target)) click(ev);
  });
  document.addEventListener('click', (ev) => {
    // detail is 0 for clicks synthesised from the keyboard.
    if (ev.detail === 0 && pressable(ev.target)) click(ev);
  });
  // Selects and radio choices don't always fire a click on a matching element.
  document.addEventListener('change', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest('select, input[type="radio"]');
    if (el) click(ev);
  });
  let lastHover: Element | null = null;
  document.addEventListener('pointerover', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR);
    if (!el || el === lastHover) return;
    lastHover = el;
    if (ev.pointerType === 'touch' || ev.buttons !== 0) return;
    if (ev.timeStamp - lastClickAt < HOVER_AFTER_CLICK_MS) return;
    if (ev.timeStamp - lastHoverAt < HOVER_GAP_MS) return;
    lastHoverAt = ev.timeStamp;
    getScene()?.playUiHover();
  });
  document.addEventListener('pointerout', (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR);
    if (el === lastHover) lastHover = null;
  });
}
