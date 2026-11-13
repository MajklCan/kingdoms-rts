/**
 * Modal dialog factory: a parchment scroll on a dimmed backdrop with an
 * eyebrow, title, close button, body and footer. Opening registers it with
 * the layer stack (focus trap, Escape, scene keyboard gate).
 */

import { closeLayer, focusablesIn, isLayerOpen, openLayer, releaseLayer } from '../a11y/layers';
import { h } from '../dom';
import { icon } from '../icons/icon';

export interface ModalOptions {
  id: string;
  eyebrow?: string;
  title: string;
  className?: string;
  /** Escape / close button dismisses (default true). */
  dismissible?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
}

export interface Modal {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  titleEl: HTMLElement;
  eyebrowEl: HTMLElement;
  open(initialFocus?: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
}

let modalRoot: HTMLElement | null = null;
const allModals: Modal[] = [];

export function getModalRoot(): HTMLElement {
  if (!modalRoot) modalRoot = h('div', { id: 'modal-root', class: 'modal-root' });
  return modalRoot;
}

export function createModal(opts: ModalOptions): Modal {
  const titleId = `${opts.id}-title`;
  const titleEl = h('h2', { class: 'title-display', id: titleId }, opts.title);
  const eyebrowEl = h('div', { class: 'eyebrow' }, opts.eyebrow ?? '');
  const closeBtn = h('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': 'Close' }, icon('close'));
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const dialog = h(
    'div',
    {
      class: `modal parchment ${opts.className ?? ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      id: opts.id,
      tabindex: '-1',
    },
    h('span', { class: 'modal-filigree tl', 'aria-hidden': 'true' }),
    h('span', { class: 'modal-filigree br', 'aria-hidden': 'true' }),
    h('header', { class: 'modal-head' }, h('div', null, eyebrowEl, titleEl), opts.dismissible === false ? null : closeBtn),
    body,
    foot
  );
  const backdrop = h('div', { class: 'modal-backdrop', hidden: true }, dialog);
  getModalRoot().append(backdrop);

  const hide = () => {
    backdrop.hidden = true;
  };

  const modal: Modal = {
    backdrop,
    dialog,
    body,
    foot,
    titleEl,
    eyebrowEl,
    open(initialFocus) {
      if (!backdrop.hidden && isLayerOpen(dialog)) return;
      backdrop.hidden = false;
      opts.onOpen?.();
      openLayer({
        el: dialog,
        dismissible: opts.dismissible !== false,
        // Content first: landing on the close button makes Enter dismiss.
        initialFocus: initialFocus ?? focusablesIn(body)[0] ?? focusablesIn(foot)[0] ?? null,
        onClose: () => {
          hide();
          opts.onClose?.();
        },
      });
    },
    close() {
      if (backdrop.hidden) return;
      if (isLayerOpen(dialog)) closeLayer(dialog);
      else {
        hide();
        opts.onClose?.();
      }
    },
    isOpen() {
      return !backdrop.hidden;
    },
  };
  allModals.push(modal);
  closeBtn.addEventListener('click', () => modal.close());
  backdrop.addEventListener('pointerdown', (ev) => {
    if (ev.target === backdrop && opts.dismissible !== false) modal.close();
  });
  return modal;
}

/** Close without running onClose (used when swapping one modal for another). */
export function dismissSilently(modal: Modal): void {
  if (modal.backdrop.hidden) return;
  modal.backdrop.hidden = true;
  releaseLayer(modal.dialog);
}

/** Close every open modal without running their onClose hooks. */
export function dismissAllModals(): void {
  for (const m of [...allModals].reverse()) dismissSilently(m);
}
