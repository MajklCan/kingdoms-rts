/**
 * Selection panel (bottom centre): portrait medallion, name and owner, HP
 * bar, stat chips, live status line and the production queue with progress;
 * every queued slot cancels on click and refunds its cost. Multi-selections show a composition grid; clicking a group
 * narrows the selection to that kind. An empty selection shows a hint.
 */

import type { GameScene } from '../../render/game-scene';
import { BUILDING_TABLE, UNIT_TABLE } from '../../sim/defs';
import { h, plainDashes, setAttr, setText } from '../dom';
import { hpBucket } from '../format';
import {
  cancelProduction,
  entityKindKey,
  getProductionQueue,
  getSelectedEids,
  isOwnedBy,
  isProducer,
  selectEntities,
  type ProductionSlotInfo,
} from '../game-bridge';
import { BUILDING_ICON_BY_DEF, SELECTION_ICON, UNIT_ICON_BY_DEF } from '../icons/catalog';
import { icon, setIcon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { attachTip } from './tooltip';

const QUEUE_SLOTS = 6;
const STAT_LABEL: Record<string, string> = {
  Atk: 'Attack',
  Rng: 'Range',
  Spd: 'Speed',
  Carry: 'Carrying',
  Pop: 'Population',
  Workers: 'Workers',
  Build: 'Construction',
  Deploy: 'Deploying',
};

interface Refs {
  root: HTMLElement;
  empty: HTMLElement;
  single: HTMLElement;
  portrait: HTMLElement;
  portraitIcon: HTMLElement;
  count: HTMLElement;
  name: HTMLElement;
  owner: HTMLElement;
  hpBar: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  stats: HTMLElement;
  status: HTMLElement;
  statusText: HTMLElement;
  statusBar: HTMLElement;
  queueWrap: HTMLElement;
  queueSlots: HTMLElement[];
  queueMore: HTMLElement;
  multi: HTMLElement;
}

let refs: Refs | null = null;
let lastStatsSig = '';
let lastMultiSig = '';
let lastQueueSig = '';
let queueProducer = -1;
let queueItems: ProductionSlotInfo[] = [];

function refundText(item: ProductionSlotInfo): string {
  const parts = (['food', 'wood', 'gold', 'stone'] as const)
    .filter((k) => item.cost[k] > 0)
    .map((k) => `${item.cost[k]} ${k}`);
  return parts.length > 0 ? `Refunds ${parts.join(', ')}.` : 'Nothing to refund.';
}

function kindIcon(key: string): IconName {
  if (key === 'foundation') return 'foundation';
  if (key.startsWith('u')) return UNIT_ICON_BY_DEF[Number(key.slice(1))] ?? 'person';
  if (key.startsWith('b')) return BUILDING_ICON_BY_DEF[Number(key.slice(1))] ?? 'house';
  return 'shield';
}

function kindName(key: string): string {
  if (key === 'foundation') return 'Foundation';
  if (key.startsWith('u')) return UNIT_TABLE[Number(key.slice(1))]?.name ?? 'Unit';
  if (key.startsWith('b')) return BUILDING_TABLE[Number(key.slice(1))]?.name ?? 'Building';
  return 'Unknown';
}

export function buildSelectionPanel(): HTMLElement {
  const portraitIcon = icon('shield', 'portrait-icon');
  const count = h('span', { class: 'portrait-count' });
  const portrait = h('div', { class: 'portrait', 'aria-hidden': 'true' }, h('span', { class: 'portrait-disc' }), portraitIcon, count);
  const name = h('h3', { class: 'sel-name', id: 'sel-name' }, 'Nothing selected');
  const owner = h('span', { class: 'sel-owner' });
  const hpFill = h('i');
  const hpBar = h('div', { class: 'bar hp', role: 'meter', 'aria-label': 'Health', 'aria-valuemin': 0 }, hpFill);
  const hpText = h('span', { class: 'hp-text' });
  const stats = h('ul', { class: 'stat-chips', id: 'sel-stats', 'aria-label': 'Stats' });
  const statusText = h('span', { class: 'sel-status-text' });
  const statusBar = h('div', { class: 'bar sel-status-bar' }, h('i'));
  const status = h('div', { class: 'sel-status', role: 'status' }, statusText, statusBar);

  const queueSlots: HTMLElement[] = [];
  const queueList = h('div', { class: 'queue-slots' });
  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const slot = h('button', { type: 'button', class: 'queue-slot', tabindex: '-1', disabled: true }, icon('person', 'queue-icon'), h('span', { class: 'queue-progress' }), h('span', { class: 'queue-x', 'aria-hidden': 'true' }));
    slot.addEventListener('click', () => {
      const scene = activeScene;
      if (!scene || queueProducer < 0 || !queueItems[i]) return;
      if (cancelProduction(scene, queueProducer, i)) {
        // Redraw on the next frame even if the sim has not applied it yet.
        lastQueueSig = '';
      }
    });
    attachTip(slot, () => {
      const item = queueItems[i];
      if (!slot.classList.contains('is-filled') || !item) return null;
      return {
        title: item.name,
        body: `${i === 0 ? 'Training now.' : 'Waiting in the queue.'} Click to cancel. ${refundText(item)}`,
      };
    });
    queueSlots.push(slot);
    queueList.append(slot);
  }
  const queueMore = h('span', { class: 'queue-more' });
  const queueWrap = h('div', { class: 'queue', 'aria-label': 'Production queue' }, h('span', { class: 'queue-label' }, 'Queue'), queueList, queueMore);

  const single = h(
    'div',
    { class: 'sel-single' },
    portrait,
    h(
      'div',
      { class: 'sel-main' },
      h('div', { class: 'sel-name-row' }, name, owner),
      h('div', { class: 'hp-row' }, hpBar, hpText),
      stats,
      status
    ),
    queueWrap
  );

  const multi = h('div', { class: 'sel-multi', role: 'group', 'aria-label': 'Selected groups' });
  const empty = h(
    'div',
    { class: 'sel-empty' },
    icon('banners', 'sel-empty-icon'),
    h('p', { class: 'sel-empty-title' }, 'No one answers your call'),
    h('p', { class: 'sel-empty-hint' }, 'Click a unit or drag a box to select. ', h('kbd', null, 'F1'), ' villagers, ', h('kbd', null, 'F2'), ' army, ', h('kbd', null, '.'), ' idle villager.')
  );

  const root = h('section', { class: 'console-selection frame-wood', id: 'selection-panel', 'aria-label': 'Selection' }, h('div', { class: 'sel-inner inlay' }, empty, single, multi));
  refs = { root, empty, single, portrait, portraitIcon, count, name, owner, hpBar, hpFill, hpText, stats, status, statusText, statusBar, queueWrap, queueSlots, queueMore, multi };
  return root;
}

let activeScene: GameScene | null = null;

function renderStats(text: string): void {
  if (!refs || text === lastStatsSig) return;
  lastStatsSig = text;
  const parts = plainDashes(text)
    .split(/\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  refs.stats.replaceChildren(
    ...parts.map((part) => {
      const m = /^([A-Za-z]+)\s+(.+)$/.exec(part);
      const label = m ? m[1]! : '';
      const value = m ? m[2]! : part;
      const full = STAT_LABEL[label];
      return h(
        'li',
        { class: 'stat-chip', title: full ? `${full} ${value}` : part },
        full ? h('span', { class: 'stat-label' }, label) : null,
        h('span', { class: 'stat-value' }, full ? value : part)
      );
    })
  );
}

function renderQueue(scene: GameScene, selected: number[], me: number): void {
  if (!refs) return;
  const producers = selected.filter((eid) => isProducer(scene, eid) && isOwnedBy(scene, eid, me));
  let producer = -1;
  let queue: ProductionSlotInfo[] = [];
  for (const eid of producers) {
    const q = getProductionQueue(scene, eid);
    if (producer < 0 || (queue.length === 0 && q.length > 0)) {
      producer = eid;
      queue = q;
    }
  }
  queueProducer = producer;
  queueItems = queue;
  refs.queueWrap.classList.toggle('is-visible', producer >= 0);
  const sig = `${producer}|${queue.map((s) => s.unitDefId).join(',')}|${Math.floor((queue[0]?.progressFrac ?? 0) * 50)}`;
  if (sig === lastQueueSig) return;
  lastQueueSig = sig;
  refs.queueSlots.forEach((slot, i) => {
    const item = queue[i];
    slot.classList.toggle('is-filled', !!item);
    slot.classList.toggle('is-active', i === 0 && !!item);
    slot.classList.toggle('is-cancel', !!item);
    (slot as HTMLButtonElement).disabled = !item;
    slot.tabIndex = item ? 0 : -1;
    setAttr(slot, 'aria-label', item ? `${item.name}, ${i === 0 ? 'training' : 'queued'}. Cancel and refund` : 'Empty slot');
    if (item) {
      slot.dataset.unit = String(item.unitDefId);
      setIcon(slot.querySelector<HTMLElement>('.queue-icon')!, UNIT_ICON_BY_DEF[item.unitDefId] ?? 'person');
    }
    (slot.querySelector('.queue-progress') as HTMLElement).style.setProperty('--p', i === 0 && item ? item.progressFrac.toFixed(3) : '0');
  });
  setText(refs.queueMore, queue.length > QUEUE_SLOTS ? `+${queue.length - QUEUE_SLOTS}` : '');
}

function renderMulti(scene: GameScene, selected: number[]): void {
  if (!refs) return;
  const groups = new Map<string, number[]>();
  for (const eid of selected) {
    const key = entityKindKey(scene, eid);
    const list = groups.get(key) ?? [];
    list.push(eid);
    groups.set(key, list);
  }
  const sig = Array.from(groups.entries())
    .map(([k, v]) => `${k}:${v.length}`)
    .join('|');
  if (sig === lastMultiSig) return;
  lastMultiSig = sig;
  refs.multi.replaceChildren(
    ...Array.from(groups.entries()).map(([key, eids]) => {
      const btn = h(
        'button',
        { type: 'button', class: 'group-chip', 'aria-label': `${eids.length} ${kindName(key)}. Select only these.` },
        icon(kindIcon(key), 'group-icon'),
        h('span', { class: 'group-count' }, String(eids.length))
      );
      btn.addEventListener('click', () => selectEntities(scene, eids));
      attachTip(btn, () => ({ title: `${kindName(key)} x${eids.length}`, body: 'Click to select only this group.' }));
      return btn;
    })
  );
}

export function updateSelectionPanel(scene: GameScene): void {
  if (!refs) return;
  activeScene = scene;
  const info = scene.getSelectionInfo();
  const me = scene.getPerspectivePlayerId();
  const mode = info.count === 0 ? 'empty' : info.kind === 'mixed' ? 'multi' : 'single';
  refs.root.dataset.mode = mode;
  refs.empty.hidden = mode !== 'empty';
  refs.single.hidden = mode === 'empty';
  refs.multi.hidden = mode !== 'multi';
  if (mode === 'empty') {
    lastQueueSig = '';
    queueProducer = -1;
    queueItems = [];
    return;
  }

  const selected = getSelectedEids(scene);
  setIcon(refs.portraitIcon, SELECTION_ICON[info.kind] ?? 'shield');
  refs.portrait.dataset.team = String(info.team);
  setText(refs.count, info.count > 1 ? `x${info.count}` : '');
  setText(refs.name, info.kind === 'mixed' ? `${info.count} selected` : info.name === '\u2014' ? '' : plainDashes(info.name));
  const owner = info.team === me ? 'Yours' : info.team === 0 ? 'Gaia' : 'Enemy';
  setText(refs.owner, owner);
  refs.owner.dataset.team = String(info.team === me ? 'me' : info.team);

  const frac = info.hpMax > 0 ? info.hp / info.hpMax : 0;
  refs.hpFill.style.setProperty('--p', frac.toFixed(3));
  setAttr(refs.hpBar, 'data-level', hpBucket(frac));
  setAttr(refs.hpBar, 'aria-valuemax', String(Math.round(info.hpMax)));
  setAttr(refs.hpBar, 'aria-valuenow', String(Math.round(info.hp)));
  refs.hpBar.parentElement!.hidden = info.hpMax <= 0;
  setText(refs.hpText, `${Math.ceil(info.hp)} / ${Math.ceil(info.hpMax)}`);

  renderStats(info.stats);
  const status = scene.getStatusInfo();
  const statusText = plainDashes(status.text ?? '');
  setText(refs.statusText, statusText === '-' ? '' : statusText.charAt(0).toUpperCase() + statusText.slice(1));
  refs.status.classList.toggle('has-progress', status.progressFrac !== null);
  (refs.statusBar.firstElementChild as HTMLElement).style.setProperty('--p', String(status.progressFrac ?? 0));

  renderQueue(scene, selected, me);
  if (!refs.multi.hidden) renderMulti(scene, selected);
}

export function resetSelectionPanel(): void {
  lastStatsSig = '';
  lastMultiSig = '';
  lastQueueSig = '';
  queueProducer = -1;
  queueItems = [];
}
