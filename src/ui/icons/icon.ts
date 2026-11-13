/**
 * Icon helper. Every icon is a real SVG file in public/assets/ui/icons, drawn
 * as a CSS mask so it inherits `color` (see .icon in styles/components.css).
 */

import type { IconName } from './icon-names';

export const ICON_BASE = '/assets/ui/icons/';

export function iconUrl(name: IconName): string {
  return `${ICON_BASE}${name}.svg`;
}

/** Create a decorative icon element. Pass `label` to expose it to assistive tech. */
export function icon(name: IconName, className = '', label?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className ? `icon ${className}` : 'icon';
  setIcon(el, name);
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}

/** Swap the glyph of an existing icon element (no-op if unchanged). */
export function setIcon(el: HTMLElement, name: IconName): void {
  if (el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.style.setProperty('--icon', `url("${iconUrl(name)}")`);
}

/** Same as icon() but as an HTML string, for template-built rows. */
export function iconHtml(name: IconName, className = ''): string {
  return `<span class="icon${className ? ` ${className}` : ''}" aria-hidden="true" data-icon="${name}" style="--icon:url('${iconUrl(name)}')"></span>`;
}
