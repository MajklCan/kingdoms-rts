/**
 * Age-up proclamation: a crimson cloth banner that drops from the top bar
 * when the realm enters a new age, hangs for a few seconds and is hauled
 * back up. Decorative only (the alert toast and the live region already
 * announce it), so it never takes focus or blocks clicks.
 */

import { h, setText } from '../dom';

const HANG_MS = 3600;

let el: HTMLElement | null = null;
let title: HTMLElement | null = null;
let timer = 0;

export function buildAgeBanner(): HTMLElement {
  title = h('span', { class: 'age-banner-title' });
  el = h(
    'div',
    { class: 'age-banner', 'aria-hidden': 'true', hidden: true },
    h('span', { class: 'age-banner-eyebrow' }, 'The realm enters'),
    title,
    h('span', { class: 'age-banner-rule' })
  );
  return el;
}

export function showAgeBanner(ageName: string): void {
  if (!el || !title) return;
  window.clearTimeout(timer);
  setText(title, ageName);
  el.hidden = false;
  el.classList.remove('is-raising', 'is-dropping');
  void el.offsetWidth;
  el.classList.add('is-dropping');
  timer = window.setTimeout(() => {
    el?.classList.add('is-raising');
    timer = window.setTimeout(() => hideAgeBanner(), 520);
  }, HANG_MS);
}

export function hideAgeBanner(): void {
  window.clearTimeout(timer);
  if (!el) return;
  el.hidden = true;
  el.classList.remove('is-raising', 'is-dropping');
}
