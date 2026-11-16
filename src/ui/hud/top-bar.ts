/**
 * Top resource bar: food / wood / gold / stone / population on the left,
 * the age plaque (the era of the open tech ring, and the paths toward the
 * next ring) in the centre, and the match clock
 * plus objectives, tech tree, speed, pause and menu buttons on the right.
 */

import { SIM } from '../../config';
import type { GameScene } from '../../render/game-scene';
import { h, setAttr, setText } from '../dom';
import { formatAmount, formatClock, RESOURCE_KEYS, type ResourceKey } from '../format';
import { RESOURCE_ICON } from '../icons/catalog';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { RING_NUMERALS } from '../../sim/tech-tree';
import { showAgeBanner } from './age-banner';
import { attachTip } from './tooltip';

export interface TopBarHandlers {
  onObjectives: () => void;
  onTech: () => void;
  /** Age plaque: the Technology panel on the next ring. */
  onAge: () => void;
  onPause: () => void;
  onMenu: () => void;
}

const RES_LABEL: Record<ResourceKey, string> = { food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone' };
const RES_TIP: Record<ResourceKey, string> = {
  food: 'Feeds new villagers and soldiers. Farms and mills keep it flowing.',
  wood: 'Timber for houses, worksites and bows. Cut by lumber huts.',
  gold: 'Pays for riders, gunmen, cannon and the late research. Mined at gold mines.',
  stone: 'Needed for most research and for stone walls. Cut by stone quarries.',
};

interface Refs {
  res: Record<ResourceKey, HTMLElement>;
  resChip: Record<ResourceKey, HTMLElement>;
  pop: HTMLElement;
  popChip: HTMLElement;
  popQueued: HTMLElement;
  popRising: HTMLElement;
  ageName: HTMLElement;
  ageBar: HTMLElement;
  ageWrap: HTMLElement;
  ageNext: HTMLElement;
  clock: HTMLElement;
  speed: HTMLButtonElement;
  pause: HTMLButtonElement;
  objectives: HTMLButtonElement;
  tech: HTMLButtonElement;
  techBadge: HTMLElement;
}

let refs: Refs | null = null;
const lastRes: Partial<Record<ResourceKey, number>> = {};
/** Age index last seen; the banner drops when it goes up mid-match. */
let lastAge = -1;
/** Research you can start now, and how many of those the player has seen in the panel. */
let plaqueTip = '';
let techReady = 0;
let techReadySeen = 0;

function barButton(id: string, iconName: IconName, label: string, onclick: () => void, extra: Record<string, string> = {}): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'icon-btn', id, 'aria-label': label, onclick, ...extra }, icon(iconName));
  return btn;
}

export function buildTopBar(handlers: TopBarHandlers): HTMLElement {
  const res = {} as Record<ResourceKey, HTMLElement>;
  const resChip = {} as Record<ResourceKey, HTMLElement>;
  const strip = h('div', { class: 'res-strip', role: 'group', 'aria-label': 'Resources' });
  for (const key of RESOURCE_KEYS) {
    const val = h('span', { class: 'res-val num', id: `res-${key}` }, '0');
    const chip = h(
      'div',
      { class: 'res-chip', 'data-res': key, tabindex: '0', 'aria-label': `${RES_LABEL[key]}` },
      icon(RESOURCE_ICON[key], 'res-icon'),
      val
    );
    attachTip(chip, () => ({ title: RES_LABEL[key], body: RES_TIP[key] }));
    res[key] = val;
    resChip[key] = chip;
    strip.append(chip);
  }
  const pop = h('span', { class: 'res-val num', id: 'res-pop' }, '0/0');
  // "1/5→8 +2": 1 alive of 5, houses being built raise the cap to 8, 2 in training.
  const popRising = h('span', { class: 'res-pop-rising num', id: 'res-pop-rising', hidden: '' }, '');
  const popQueued = h('span', { class: 'res-pop-queued num', id: 'res-pop-queued', hidden: '' }, '');
  const popChip = h(
    'div',
    { class: 'res-chip res-chip-pop', tabindex: '0', 'aria-label': 'Population' },
    icon('r-pop', 'res-icon'),
    pop,
    popRising,
    popQueued
  );
  attachTip(popChip, () => ({
    title: 'Population',
    body: 'Units alive out of your housing cap, workers at farms, lumber huts, quarries and mines included. →N: the cap once the houses being built are finished (usable only then). +N: units in training, which already hold their place. Build houses to raise the cap, up to 75.',
  }));
  strip.append(popChip);

  const ageName = h('span', { class: 'age-name', id: 'res-age' }, 'Dark Age');
  const ageBar = h('i');
  const ageNext = h('span', { class: 'age-next num' });
  const ageWrap = h('div', { class: 'age-progress bar', 'aria-hidden': 'true' }, ageBar);
  const plaque = h(
    'div',
    { class: 'age-plaque', tabindex: '0', role: 'button', 'aria-label': 'Age: open the next ring in Technology' },
    icon('crown', 'age-crown'),
    h('span', { class: 'age-text' }, ageName, ageNext),
    ageWrap
  );
  plaque.addEventListener('click', handlers.onAge);
  plaque.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    handlers.onAge();
  });
  attachTip(plaque, () => ({
    title: ageName.textContent ?? '',
    body: plaqueTip,
    hint: 'Click to see the next ring in Technology.',
  }));

  const clock = h('span', { class: 'clock-val num', id: 'match-clock' }, '0:00');
  const objectives = barButton('btn-objectives', 'objectives', 'Objectives', handlers.onObjectives, { 'aria-expanded': 'false', 'aria-keyshortcuts': 'O' });
  const tech = barButton('btn-tech', 'tech', 'Technology tree', handlers.onTech, { 'aria-expanded': 'false', 'aria-keyshortcuts': 'K' });
  const techBadge = h('span', { class: 'tech-badge num', 'aria-hidden': 'true' });
  techBadge.hidden = true;
  tech.append(techBadge);
  const speed = h(
    'button',
    { type: 'button', class: 'icon-btn has-label', id: 'speed-toggle', 'aria-label': 'Game speed', 'aria-pressed': 'false', 'aria-keyshortcuts': 'X' },
    icon('speed'),
    h('span', { class: 'speed-val' }, '1x')
  );
  const pause = barButton('btn-pause', 'pause', 'Pause', handlers.onPause, { 'aria-pressed': 'false', 'aria-keyshortcuts': 'P' });
  const menu = barButton('btn-menu', 'menu', 'Game menu', handlers.onMenu, { 'aria-haspopup': 'dialog', 'aria-keyshortcuts': 'Escape F10' });

  attachTip(objectives, () => ({ title: 'Objectives', hotkey: 'O', body: 'Mission briefing and goals.' }));
  attachTip(tech, () => ({
    title: 'Technology',
    hotkey: 'K',
    body: 'Research unlocks buildings, units and upgrades. Completing two paths of a ring opens the next ring and its era.',
    meta: techReady > 0 ? `${techReady} research ${techReady === 1 ? 'is' : 'are'} ready to start` : undefined,
  }));
  attachTip(speed, () => ({ title: 'Game speed', hotkey: 'X', body: 'Toggle between normal and double speed.' }));
  attachTip(pause, () => ({ title: 'Pause', hotkey: 'P', body: 'Freeze the battle. Not available in multiplayer.' }));
  attachTip(menu, () => ({ title: 'Game menu', hotkey: 'Esc', body: 'Save, load, settings and quit.' }));

  const right = h(
    'div',
    { class: 'topbar-right' },
    h('div', { class: 'clock', 'aria-label': 'Match time' }, icon('hourglass', 'clock-icon'), clock),
    h('div', { class: 'topbar-buttons' }, objectives, tech, speed, pause, menu)
  );

  refs = { res, resChip, pop, popQueued, popRising, popChip, ageName, ageBar, ageWrap, ageNext, clock, speed, pause, objectives, tech, techBadge };
  return h('header', { class: 'topbar', id: 'resource-bar' }, strip, plaque, right);
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
  setText(refs.popRising, pop.rising > 0 ? `→${pop.cap + pop.rising}` : '');
  refs.popRising.hidden = pop.rising <= 0;
  setText(refs.popQueued, pop.queued > 0 ? `+${pop.queued}` : '');
  refs.popQueued.hidden = pop.queued <= 0;
  // Capped = no room to start another unit (the same test training uses).
  refs.popChip.classList.toggle('is-capped', pop.current + pop.queued >= pop.cap);
  setAttr(
    refs.popChip,
    'aria-label',
    `Population ${pop.current} of ${pop.cap}` +
      (pop.rising > 0 ? `, rising to ${pop.cap + pop.rising} when the houses are built` : '') +
      (pop.queued > 0 ? `, ${pop.queued} in training` : '')
  );

  const age = scene.getAge(me);
  if (lastAge >= 0 && age.current > lastAge) showAgeBanner(age.name);
  lastAge = age.current;
  const ring = RING_NUMERALS[age.ring];
  const hasNext = age.nextName !== null;
  setText(refs.ageName, age.name);
  setText(refs.ageNext, hasNext ? `Ring ${ring} · ${age.nextRingPaths} of ${age.nextRingNeed} paths` : `Ring ${ring}`);
  refs.ageWrap.classList.toggle('is-active', hasNext);
  refs.ageBar.style.setProperty('--p', hasNext ? age.progressFrac.toFixed(3) : '0');
  plaqueTip = hasNext
    ? `Ring ${ring} is open. The next ring (the ${age.nextName}) opens when ${age.nextRingNeed} paths are ` +
      `complete in ring ${ring}: every research of that path in the ring done. ${age.nextRingPaths} of ` +
      `${age.nextRingNeed} so far.`
    : `Ring ${ring} is open: the last ring of the Technology tree.`;

  setText(refs.clock, formatClock(scene.getTick() / SIM.TICK_HZ));

  const speed = scene.getGameSpeed();
  setText(refs.speed.querySelector('.speed-val'), `${speed}x`);
  setAttr(refs.speed, 'aria-pressed', String(speed > 1));

  const paused = scene.isPaused();
  setAttr(refs.pause, 'aria-pressed', String(paused));
  refs.pause.disabled = scene.isMultiplayer();

  updateTechButton(scene, me);

  const hasMission = scene.getCampaignMission() !== null;
  refs.objectives.classList.toggle('is-unavailable', !hasMission);
  refs.objectives.tabIndex = hasMission ? 0 : -1;
  setAttr(refs.objectives, 'aria-hidden', String(!hasMission));
}

/**
 * Technology button: a badge with the research you can start now, and a
 * pulse while some of it is new since you last opened the panel.
 */
function updateTechButton(scene: GameScene, me: number): void {
  if (!refs) return;
  const ready = scene.getTechTree(me).filter((n) => n.status === 'available' && n.affordable).length;
  if (ready < techReadySeen) techReadySeen = ready;
  if (ready === techReady && refs.techBadge.dataset.seen === String(techReadySeen)) return;
  techReady = ready;
  refs.techBadge.dataset.seen = String(techReadySeen);
  setText(refs.techBadge, ready > 0 ? String(ready) : '');
  refs.techBadge.hidden = ready <= 0;
  refs.tech.classList.toggle('has-ready', ready > 0);
  refs.tech.classList.toggle('is-new', ready > techReadySeen);
  setAttr(refs.tech, 'aria-label', ready > 0 ? `Technology tree, ${ready} research ready` : 'Technology tree');
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
  if (which === 'tech' && open) {
    // Seen: stop the pulse until more research becomes ready.
    techReadySeen = techReady;
    refs.tech.classList.remove('is-new');
    refs.techBadge.dataset.seen = String(techReadySeen);
  }
}

export function resetTopBar(): void {
  for (const key of RESOURCE_KEYS) delete lastRes[key];
  lastAge = -1;
  techReady = 0;
  techReadySeen = 0;
  if (refs) refs.techBadge.dataset.seen = '';
}
