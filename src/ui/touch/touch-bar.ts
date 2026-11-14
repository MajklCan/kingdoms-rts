/**
 * On-screen controls for touch mode (hidden with a mouse): a carved bar of
 * the commands a keyboard would give (select villagers / army, attack-move,
 * deselect, zoom) and, while a building is being placed, a Confirm / Cancel
 * plank. Both only call the same UiApi paths the hotkeys use.
 */

import type { GameScene } from '../../render/game-scene';
import { h, setAttr, setText } from '../dom';
import {
  cancelPlacement,
  canCommandSelection,
  confirmPlacement,
  deselectAll,
  isAttackMoveArmed,
  placementState,
  selectAllMilitary,
  selectAllVillagers,
  toggleAttackMove,
  zoomStep,
} from '../game-bridge';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { attachTip } from '../hud/tooltip';

interface BarRefs {
  attack: HTMLButtonElement;
  deselect: HTMLButtonElement;
}

interface PlaceRefs {
  root: HTMLElement;
  label: HTMLElement;
  confirm: HTMLButtonElement;
}

let bar: BarRefs | null = null;
let place: PlaceRefs | null = null;
let lastPlaceSig = '';

function barButton(id: string, iconName: IconName, label: string, body: string, onclick: () => void): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'touch-btn', id, 'aria-label': label }, icon(iconName, 'touch-btn-icon'));
  btn.addEventListener('click', onclick);
  attachTip(btn, () => ({ title: label, body }));
  return btn;
}

/** The touch command bar; sits beside the idle villager button. */
export function buildTouchBar(): HTMLElement {
  const villagers = barButton('touch-villagers', 'u-villager', 'Select villagers', 'Select every villager you have.', () => selectAllVillagers());
  const army = barButton('touch-army', 'u-spearman', 'Select army', 'Select every soldier you have.', () => selectAllMilitary());
  const attack = barButton('touch-attack', 'swords', 'Attack-move', 'Then tap the map: the selection marches there and fights anything on the way.', () => {
    toggleAttackMove();
    syncAttack();
  });
  attack.setAttribute('aria-pressed', 'false');
  const deselect = barButton('touch-deselect', 'close', 'Deselect', 'Clear the selection.', () => deselectAll());
  const zoomOut = barButton('touch-zoom-out', 'minus', 'Zoom out', 'Or pinch with two fingers.', () => zoomStep(-1));
  const zoomIn = barButton('touch-zoom-in', 'plus', 'Zoom in', 'Or spread two fingers.', () => zoomStep(1));
  bar = { attack, deselect };
  return h(
    'div',
    { class: 'touch-bar touch-only', role: 'toolbar', 'aria-label': 'Touch commands' },
    villagers,
    army,
    attack,
    deselect,
    h('span', { class: 'touch-bar-gap', 'aria-hidden': 'true' }),
    zoomOut,
    zoomIn
  );
}

function syncAttack(): void {
  if (!bar) return;
  const armed = isAttackMoveArmed();
  setAttr(bar.attack, 'aria-pressed', String(armed));
  bar.attack.classList.toggle('is-armed', armed);
}

/** Confirm / Cancel plank for touch building placement. */
export function buildPlacementBar(): HTMLElement {
  const label = h('span', { class: 'place-label' });
  const cancel = h('button', { type: 'button', class: 'place-btn place-cancel', id: 'touch-place-cancel' }, icon('close'), h('span', null, 'Cancel'));
  const confirm = h('button', { type: 'button', class: 'place-btn place-confirm', id: 'touch-place-confirm' }, icon('check'), h('span', null, 'Build'));
  cancel.addEventListener('click', () => cancelPlacement());
  confirm.addEventListener('click', () => {
    if (!confirm.disabled) confirmPlacement();
  });
  const root = h('div', { class: 'place-bar touch-only', role: 'group', 'aria-label': 'Place building', hidden: true }, cancel, label, confirm);
  place = { root, label, confirm };
  return root;
}

export function updateTouchBar(scene: GameScene): void {
  if (bar) {
    syncAttack();
    const any = scene.getSelectionInfo().count > 0;
    bar.deselect.disabled = !any;
    bar.attack.disabled = !canCommandSelection() && !isAttackMoveArmed();
  }
  if (!place) return;
  const state = placementState();
  const show = !!state && state.kind !== 'none';
  const sig = show ? `${state.kind}|${state.label}|${state.canConfirm}|${state.valid}` : '';
  if (sig === lastPlaceSig) return;
  lastPlaceSig = sig;
  place.root.hidden = !show;
  document.documentElement.classList.toggle('is-placing', show);
  if (!show || !state) return;
  setText(place.label, state.label);
  place.confirm.disabled = !state.canConfirm;
  place.confirm.classList.toggle('is-invalid', !state.valid);
  // Rally points land on the tap itself; only Cancel is needed.
  place.confirm.hidden = state.kind === 'rally';
}

export function resetTouchBar(): void {
  lastPlaceSig = '';
}
