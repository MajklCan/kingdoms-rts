/** Keyboard shortcuts must not fire while the player is typing in a DOM field. */

export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function isTextEntryActive(): boolean {
  if (typeof document === 'undefined') return false;
  return isTextEntryTarget(document.activeElement);
}
