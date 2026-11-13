/**
 * Top resource bar: food / wood / gold / stone / population on the left,
 * the age plaque (with advance progress) in the centre, and the match clock
 * plus objectives, tech tree, speed, pause and menu buttons on the right.
 */

import { SIM } from '../../config';
import type { GameScene } from '../../render/game-scene';
import { h, setAttr, setText } from '../dom';
import { formatAmount, formatClock, RESOURCE_KEYS, type ResourceKey } from '../format';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { attachTip } from './tooltip';

export interface TopBarHandlers {
  onObjectives: () => void;
  onTech: () => void;
  onPause: () => void;
  onMenu: () => void;
}

const RES_LABEL: Record<ResourceKey, string> = { food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone' };
const RES_TIP: Record<ResourceKey, string> = {
  food: 'Feeds new villagers and soldiers. Farms and mills keep it flowing.',
  wood: 'Timber for houses, worksites and bows. Cut by lumber huts.',
  gold: 'Pays for soldiers, research and advancing the age. Mined from gold veins.',
  stone: 'Needed for towers and the Castle Age. Cut by stone quarries.',
};

interface Refs {
  res: Record<ResourceKey, HTMLElement>;
  resChip: Record<ResourceKey, HTMLElement>;
  pop: HTMLElement;
  popChip: HTMLElement;
  ageName: HTMLElement;
  ageBar: HTMLElement;
  ageWrap: HTMLElement;
  ageNext: HTMLElement;
  clock: HTMLElement;
  speed: HTMLButtonElement;
  pause: HTMLButtonElement;
  objectives: HTMLButtonElement;
  tech: HTMLButtonElement;
}

let refs: Refs | null = null;
const lastRes: Partial<Record<ResourceKey, number>> = {};

function barButton(id: string, iconName: IconName, label: string, onclick: () => void, extra: Record<string, string> = {}): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'icon-btn', id, 'aria-label': label, onclick, ...extra }, icon(iconName));
  return btn;
}

export function buildTopBar(handlers: TopBarHandlers): HTMLElement {
  const res = {} as Record<ResourceKey, HTMLElement>;
  const resChip = {} as Record<ResourceKey, HTMLElement>;
  const strip = h('div', { class: 'res-strip', role: 'group', 'aria-label': 'Resources' });
  for (const key of RESOURCE_KEYS) {
    const val = h('span', { class: 'res-val', id: `res-${key}` }, '0');
    const chip = h(
      'div',
      { class: 'res-chip', 'data-res': key, tabindex: '0', 'aria-label': `${RES_LABEL[key]}` },
      icon(key, `res-icon res-${key}`),
      val
    );
    attachTip(chip, () => ({ title: RES_LABEL[key], body: RES_TIP[key] }));
    res[key] = val;
    resChip[key] = chip;
    strip.append(chip);
  }
  const pop = h('span', { class: 'res-val', id: 'res-pop' }, '0/0');
  const popChip = h('div', { class: 'res-chip res-chip-pop', tabindex: '0', 'aria-label': 'Population' }, icon('pop', 'res-icon res-pop'), pop);
  attachTip(popChip, () => ({ title: 'Population', body: 'Units alive out of your housing cap. Build houses to raise the cap.' }));
  strip.append(popChip);

  const ageName = h('span', { class: 'age-name', id: 'res-age' }, 'Dark Age');
  const ageBar = h('i');
  const ageNext = h('span', { class: 'age-next' });
  const ageWrap = h('div', { class: 'age-progress bar', 'aria-hidden': 'true' }, ageBar);
  const plaque = h(
    'div',
    { class: 'age-plaque', tabindex: '0' },
    icon('crown', 'age-crown'),
    h('span', { class: 'age-text' }, ageName, ageNext),
    ageWrap
  );
  attachTip(plaque, () => ({
    title: ageName.textContent ?? '',
    body: ageNext.textContent ? `Advancing: ${ageNext.textContent}` : 'Select your Town Center to advance to the next age.',
  }));

  const clock = h('span', { class: 'clock-val', id: 'match-clock' }, '0:00');
  const objectives = barButton('btn-objectives', 'objectives', 'Objectives', handlers.onObjectives, { 'aria-expanded': 'false', 'aria-keyshortcuts': 'O' });
  const tech = barButton('btn-tech', 'tech', 'Technology tree', handlers.onTech, { 'aria-expanded': 'false', 'aria-keyshortcuts': 'K' });
  const speed = h(
    'button',
    { type: 'button', class: 'icon-btn has-label', id: 'speed-toggle', 'aria-label': 'Game speed', 'aria-pressed': 'false', 'aria-keyshortcuts': 'X' },
    icon('speed'),
    h('span', { class: 'speed-val' }, '1x')
  );
  const pause = barButton('btn-pause', 'pause', 'Pause', handlers.onPause, { 'aria-pressed': 'false', 'aria-keyshortcuts': 'P' });
  const menu = barButton('btn-menu', 'menu', 'Game menu', handlers.onMenu, { 'aria-haspopup': 'dialog', 'aria-keyshortcuts': 'Escape F10' });

  attachTip(objectives, () => ({ title: 'Objectives', hotkey: 'O', body: 'Mission briefing and goals.' }));
  attachTip(tech, () => ({ title: 'Technology', hotkey: 'K', body: 'Research upgrades and unlock new buildings.' }));
  attachTip(speed, () => ({ title: 'Game speed', hotkey: 'X', body: 'Toggle between normal and double speed.' }));
  attachTip(pause, () => ({ title: 'Pause', hotkey: 'P', body: 'Freeze the battle. Not available in multiplayer.' }));
  attachTip(menu, () => ({ title: 'Game menu', hotkey: 'Esc', body: 'Save, load, settings and quit.' }));

  const right = h(
    'div',
    { class: 'topbar-right' },
    h('div', { class: 'clock', 'aria-label': 'Match time' }, icon('hourglass', 'clock-icon'), clock),
    h('div', { class: 'topbar-buttons' }, objectives, tech, speed, pause, menu)
  );

  refs = { res, resChip, pop, popChip, ageName, ageBar, ageWrap, ageNext, clock, speed, pause, objectives, tech };
  return h('header', { class: 'topbar frame-wood', id: 'resource-bar' }, strip, plaque, right);
}

export function bindSpeedButton(onToggle: () => void): void {
  refs?.speed.addEventListener('click', onToggle);
}

export function updateTopBar(scene: GameScene): void {
  if (!refs) return;
  const me = scene.getPerspectivePlayerId();
  const bank = scene.getResources(me) as unknown as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) {
    const v = Math.floor(bank[key] ?? 0);
    if (lastRes[key] !== v) {
      const prev = lastRes[key];
      lastRes[key] = v;
      setText(refs.res[key], formatAmount(v));
      refs.resChip[key].setAttribute('aria-label', `${RES_LABEL[key]} ${v}`);
      if (prev !== undefined && v > prev) {
        refs.resChip[key].classList.remove('is-gain');
        void refs.resChip[key].offsetWidth;
        refs.resChip[key].classList.add('is-gain');
      }
    }
  }
  const pop = scene.getPop(me);
  setText(refs.pop, `${pop.current}/${pop.cap}`);
  refs.popChip.classList.toggle('is-capped', pop.current >= pop.cap);
  setAttr(refs.popChip, 'aria-label', `Population ${pop.current} of ${pop.cap}`);

  const age = scene.getAge(me);
  setText(refs.ageName, age.name);
  setText(refs.ageNext, age.advancing && age.nextName ? `${age.nextName} ${Math.floor(age.progressFrac * 100)}%` : '');
  refs.ageWrap.classList.toggle('is-active', age.advancing);
  refs.ageBar.style.setProperty('--p', age.advancing ? age.progressFrac.toFixed(3) : '0');

  setText(refs.clock, formatClock(scene.getTick() / SIM.TICK_HZ));

  const speed = scene.getGameSpeed();
  setText(refs.speed.querySelector('.speed-val'), `${speed}x`);
  setAttr(refs.speed, 'aria-pressed', String(speed > 1));

  const paused = scene.isPaused();
  setAttr(refs.pause, 'aria-pressed', String(paused));
  refs.pause.disabled = scene.isMultiplayer();

  const hasMission = scene.getCampaignMission() !== null;
  refs.objectives.classList.toggle('is-unavailable', !hasMission);
  refs.objectives.tabIndex = hasMission ? 0 : -1;
  setAttr(refs.objectives, 'aria-hidden', String(!hasMission));
}

function restartAnimation(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/** Flash the resources a refused command was short of. */
export function flashMissingResources(keys: readonly ResourceKey[]): void {
  if (!refs) return;
  for (const key of keys) restartAnimation(refs.resChip[key], 'is-short');
}

/** Flash the population chip (refused for lack of housing). */
export function flashPopulation(): void {
  if (refs) restartAnimation(refs.popChip, 'is-short');
}

export function setPanelExpanded(which: 'objectives' | 'tech', open: boolean): void {
  if (!refs) return;
  setAttr(which === 'tech' ? refs.tech : refs.objectives, 'aria-expanded', String(open));
}

export function resetTopBar(): void {
  for (const key of RESOURCE_KEYS) delete lastRes[key];
}
