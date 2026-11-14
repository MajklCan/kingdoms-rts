/**
 * "Turn your device" card for phones held upright. Pure CSS decides when it
 * shows (touch mode + portrait + narrow screen, see touch.css), so it reacts
 * to rotation without any listener.
 */

import { h } from '../dom';
import { icon } from '../icons/icon';

export function buildRotateHint(): HTMLElement {
  return h(
    'div',
    { class: 'rotate-hint', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'rotate-card' },
      icon('rotate-device', 'rotate-icon'),
      h('p', { class: 'rotate-title' }, 'Turn your device'),
      h('p', { class: 'rotate-body' }, 'Kingdoms plays in landscape.')
    )
  );
}
