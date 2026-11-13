/**
 * Rich tooltip singleton (parchment card). Shows on hover and keyboard
 * focus, positions itself above the anchor (flipping when there is no
 * room), and re-reads its content a few times a second so costs turn red or
 * back as resources change while it is open.
 */

import { h } from '../dom';
import { RESOURCE_KEYS, formatAmount, type CostMap, type ResourceKey } from '../format';
import { icon } from '../icons/icon';

export interface TipContent {
  title: string;
  hotkey?: string;
  body?: string;
  cost?: CostMap;
  /** Current bank; costs above it are flagged. */
  bank?: Partial<Record<ResourceKey, number>>;
  seconds?: number | null;
  pop?: number | null;
  meta?: string;
  /** Why the action cannot be used right now. */
  disabled?: string;
  hint?: string;
}

type TipSource = () => TipContent | null;

let tipEl: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let source: TipSource | null = null;
let showTimer = 0;
let lastRender = '';
const sources = new WeakMap<HTMLElement, TipSource>();

export function getTooltipRoot(): HTMLElement {
  if (!tipEl) {
    tipEl = h('div', { id: 'tooltip', class: 'tooltip parchment', role: 'tooltip', hidden: true });
  }
  return tipEl;
}

function render(content: TipContent): void {
  const el = getTooltipRoot();
  const key = JSON.stringify(content);
  if (key === lastRender) return;
  lastRender = key;
  const head = h(
    'div',
    { class: 'tip-head' },
    h('strong', { class: 'tip-title' }, content.title),
    content.hotkey ? h('kbd', { class: 'tip-key' }, content.hotkey) : null
  );
  const parts: Node[] = [head];
  const costKeys = content.cost ? RESOURCE_KEYS.filter((k) => (content.cost![k] ?? 0) > 0) : [];
  if (costKeys.length > 0 || content.seconds || content.pop) {
    const row = h('div', { class: 'tip-cost' });
    for (const k of costKeys) {
      const need = content.cost![k] ?? 0;
      const have = content.bank?.[k];
      const short = have !== undefined && need > have;
      row.append(
        h(
          'span',
          { class: `tip-res${short ? ' is-short' : ''}`, 'aria-label': `${need} ${k}${short ? ', not enough' : ''}` },
          icon(k, `res-${k}`),
          formatAmount(need)
        )
      );
    }
    if (content.seconds) row.append(h('span', { class: 'tip-res' }, icon('hourglass'), `${content.seconds}s`));
    if (content.pop) row.append(h('span', { class: 'tip-res' }, icon('pop', 'res-pop'), String(content.pop)));
    parts.push(row);
  }
  if (content.body) parts.push(h('p', { class: 'tip-body' }, content.body));
  if (content.meta) parts.push(h('p', { class: 'tip-meta' }, content.meta));
  if (content.disabled) parts.push(h('p', { class: 'tip-disabled' }, icon('lock'), content.disabled));
  if (content.hint) parts.push(h('p', { class: 'tip-hint' }, content.hint));
  el.replaceChildren(...parts);
}

function position(): void {
  const el = getTooltipRoot();
  if (!anchor || el.hidden) return;
  const a = anchor.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const margin = 8;
  let top = a.top - t.height - margin;
  if (top < margin) top = a.bottom + margin;
  let left = a.left + a.width / 2 - t.width / 2;
  left = Math.max(margin, Math.min(window.innerWidth - t.width - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - t.height - margin, top));
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function show(target: HTMLElement, immediate: boolean): void {
  const src = sources.get(target);
  if (!src) return;
  window.clearTimeout(showTimer);
  const doShow = () => {
    const content = src();
    if (!content) return;
    anchor = target;
    source = src;
    const el = getTooltipRoot();
    render(content);
    el.hidden = false;
    target.setAttribute('aria-describedby', 'tooltip');
    position();
  };
  if (immediate) doShow();
  else showTimer = window.setTimeout(doShow, 220);
}

export function hideTip(): void {
  window.clearTimeout(showTimer);
  const el = getTooltipRoot();
  el.hidden = true;
  anchor?.removeAttribute('aria-describedby');
  anchor = null;
  source = null;
  lastRender = '';
}

export function attachTip(el: HTMLElement, src: TipSource): void {
  sources.set(el, src);
  el.addEventListener('pointerenter', () => show(el, getTooltipRoot().hidden === false));
  el.addEventListener('pointerleave', () => {
    if (anchor === el || !getTooltipRoot().hidden) hideTip();
    else window.clearTimeout(showTimer);
  });
  el.addEventListener('focus', () => {
    if (el.matches(':focus-visible')) show(el, true);
  });
  el.addEventListener('blur', () => {
    if (anchor === el) hideTip();
  });
  el.addEventListener('pointerdown', () => {
    // Re-render right after a click so a disabled reason or new count shows.
    window.setTimeout(() => {
      if (anchor === el) refreshTip();
    }, 30);
  });
}

/** Re-read the open tooltip's content (call a few times a second). */
export function refreshTip(): void {
  if (!anchor || !source) return;
  if (!anchor.isConnected || anchor.closest('[hidden]')) {
    hideTip();
    return;
  }
  const content = source();
  if (!content) {
    hideTip();
    return;
  }
  render(content);
  position();
}

export function bindTooltipDismiss(): void {
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && anchor) hideTip();
  });
  window.addEventListener('blur', hideTip);
}
