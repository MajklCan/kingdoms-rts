/**
 * Modal layer stack: focus trap, focus restore, Escape-to-close and the
 * scene keyboard gate. While any layer is open (or we are outside a match)
 * the Phaser scene stops receiving keys, so typing in a dialog never moves
 * the camera or fires a hotkey.
 */

import { isTouchUi } from '../../render/input/input-mode';
import { appState, onPhaseChange } from '../app-state';
import { isTextEntryTarget } from '../dom';
import { setSceneKeyboardEnabled } from '../game-bridge';

export interface Layer {
  el: HTMLElement;
  /** Called when the layer is dismissed via Escape or closeLayer(). */
  onClose?: () => void;
  /** Escape closes this layer (default true). */
  dismissible?: boolean;
  /** Element to focus after the layer closes; defaults to the opener. */
  returnFocus?: HTMLElement | null;
  /** Element to focus on open; defaults to the first focusable child. */
  initialFocus?: HTMLElement | null;
}

const stack: Layer[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && el.offsetParent !== null && !el.closest('[inert]')
  );
}

export function syncSceneKeyboard(): void {
  setSceneKeyboardEnabled(appState.phase === 'match' && stack.length === 0);
}

export function openLayer(layer: Layer): void {
  const existing = stack.findIndex((l) => l.el === layer.el);
  if (existing >= 0) stack.splice(existing, 1);
  const returnFocus =
    layer.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  stack.push({ dismissible: true, ...layer, returnFocus });
  syncSceneKeyboard();
  requestAnimationFrame(() => {
    let target = layer.initialFocus ?? focusablesIn(layer.el)[0] ?? layer.el;
    // On touch, focusing a text field would throw up the on-screen keyboard.
    if (isTouchUi() && isTextEntryTarget(target)) target = layer.el;
    if (!layer.el.contains(document.activeElement)) target.focus({ preventScroll: true });
  });
}

/** Remove a layer without invoking its onClose (the owner closed it). */
export function releaseLayer(el: HTMLElement): void {
  const idx = stack.findIndex((l) => l.el === el);
  if (idx < 0) return;
  const [layer] = stack.splice(idx, 1);
  syncSceneKeyboard();
  const back = layer?.returnFocus;
  if (back && back.isConnected && !back.closest('[hidden]')) back.focus({ preventScroll: true });
}

/** Dismiss the given layer (or the top one) and run its onClose. */
export function closeLayer(el?: HTMLElement): void {
  const layer = el ? stack.find((l) => l.el === el) : stack[stack.length - 1];
  if (!layer) return;
  releaseLayer(layer.el);
  layer.onClose?.();
}

export function topLayer(): Layer | null {
  return stack[stack.length - 1] ?? null;
}

export function hasOpenLayer(): boolean {
  return stack.length > 0;
}

export function isLayerOpen(el: HTMLElement): boolean {
  return stack.some((l) => l.el === el);
}

export function bindLayerKeys(): void {
  window.addEventListener(
    'keydown',
    (ev) => {
      const top = topLayer();
      if (!top) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (top.dismissible !== false) closeLayer(top.el);
        return;
      }
      if (ev.key === 'Tab') {
        const items = focusablesIn(top.el);
        if (items.length === 0) {
          ev.preventDefault();
          return;
        }
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (!active || !top.el.contains(active)) {
          ev.preventDefault();
          first.focus();
        } else if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    },
    true
  );
  onPhaseChange(() => syncSceneKeyboard());
}

/**
 * Arrow-key roving focus for a vertical (or horizontal) list of buttons.
 * Home/End jump to the ends. Returns a cleanup function.
 */
export function rovingFocus(
  container: HTMLElement,
  selector: string,
  orientation: 'vertical' | 'horizontal' | 'both' = 'vertical'
): () => void {
  const handler = (ev: KeyboardEvent) => {
    const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const prevKeys = orientation === 'horizontal' ? ['ArrowLeft'] : orientation === 'vertical' ? ['ArrowUp'] : ['ArrowUp', 'ArrowLeft'];
    const nextKeys = orientation === 'horizontal' ? ['ArrowRight'] : orientation === 'vertical' ? ['ArrowDown'] : ['ArrowDown', 'ArrowRight'];
    let next = -1;
    if (prevKeys.includes(ev.key)) next = idx <= 0 ? items.length - 1 : idx - 1;
    else if (nextKeys.includes(ev.key)) next = idx < 0 || idx >= items.length - 1 ? 0 : idx + 1;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    items[next]!.focus();
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}
