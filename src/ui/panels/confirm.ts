/** Small confirm dialog that resolves to true (confirm) or false (cancel/Escape). */

import { h } from '../dom';
import { createModal, type Modal } from './modal';

let modal: Modal | null = null;
let resolver: ((ok: boolean) => void) | null = null;

export function confirmDialog(opts: {
  eyebrow?: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  if (!modal) {
    modal = createModal({
      id: 'confirm-dialog',
      title: '',
      className: 'modal-confirm',
      onClose: () => {
        const r = resolver;
        resolver = null;
        r?.(false);
      },
    });
  }
  const m = modal;
  resolver?.(false);
  m.eyebrowEl.textContent = opts.eyebrow ?? 'Are you certain?';
  m.titleEl.textContent = opts.title;
  m.body.replaceChildren(h('p', { class: 'confirm-text' }, opts.body));
  const cancel = h('button', { type: 'button', class: 'btn btn-ink' }, opts.cancelLabel ?? 'Cancel');
  const ok = h('button', { type: 'button', class: `btn ${opts.danger ? 'btn-danger' : 'btn-seal'}` }, opts.confirmLabel);
  m.foot.replaceChildren(cancel, ok);
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', () => {
      const r = resolver;
      resolver = null;
      m.close();
      r?.(true);
    });
    m.open(cancel);
  });
}
