/**
 * Selection panel (bottom centre), a parchment sheet set into the console.
 *
 *   nothing selected  the realm's crest, the current objective and the last
 *                     few chronicle lines, with selection hotkeys
 *   one thing         framed portrait, name and owner, segmented HP bar,
 *                     stats with icons, the current action (progress and
 *                     carried load) and the stance / formation in force;
 *                     producers show their queue as portrait slots with a
 *                     clockwise wipe, and every queued slot cancels on
 *                     click and refunds its cost
 *   several units     one mini portrait per unit with an HP tick (click to
 *                     keep only that unit) and a chip per kind (click to
 *                     keep only that kind)
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
  healthFrac,
  isOwnedBy,
  isProducer,
  selectEntities,
  type ProductionSlotInfo,
} from '../game-bridge';
import { actionIcon, BUILDING_ICON_BY_DEF, SELECTION_ICON, UNIT_ICON_BY_DEF } from '../icons/catalog';
import { icon, setIcon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { recentEvents } from './event-log';
import { loadPortraits, portraitForKey, unitPortraitUrl } from './portraits';
import { attachTip } from './tooltip';

const QUEUE_SLOTS = 6;
/** Mini portraits shown for a multi-selection before "+N" takes over. */
const MAX_TILES = 30;
const CARRY_MAX = 10;
const RESOURCE_WORDS = ['food', 'wood', 'gold', 'stone'] as const;

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
const STAT_ICON: Record<string, IconName> = {
  Atk: 'swords',
  Rng: 'archer',
  Spd: 'speed',
  Pop: 'pop',
  Workers: 'villager',
  Build: 'hammer',
  Deploy: 'machine-gun',
};

interface Refs {
  root: HTMLElement;
  empty: HTMLElement;
  idleAge: HTMLElement;
  idleObjective: HTMLElement;
  idleEvents: HTMLElement;
  single: HTMLElement;
  portrait: HTMLElement;
  portraitImg: HTMLImageElement;
  portraitIcon: HTMLElement;
  count: HTMLElement;
  name: HTMLElement;
  owner: HTMLElement;
  hpRow: HTMLElement;
  hpBar: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  stats: HTMLElement;
  status: HTMLElement;
  statusText: HTMLElement;
  statusBar: HTMLElement;
  carry: HTMLElement;
  carryIcon: HTMLElement;
  carryPips: HTMLElement[];
  state: HTMLElement;
  queueWrap: HTMLElement;
  queueSlots: HTMLElement[];
  queueMore: HTMLElement;
  multi: HTMLElement;
  multiTitle: HTMLElement;
  multiGroups: HTMLElement;
  multiGrid: HTMLElement;
}

let refs: Refs | null = null;
let lastStatsSig = '';
let lastMultiSig = '';
let lastTilesSig = '';
let lastQueueSig = '';
let lastStateSig = '';
let lastIdleSig = '';
let queueProducer = -1;
let queueItems: ProductionSlotInfo[] = [];
let tiles: Array<{ eid: number; el: HTMLElement }> = [];
let activeScene: GameScene | null = null;

function refundText(item: ProductionSlotInfo): string {
  const parts = RESOURCE_WORDS.filter((k) => item.cost[k] > 0).map((k) => `${item.cost[k]} ${k}`);
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

/** Show a portrait image when one exists, the icon otherwise. */
function setPortrait(img: HTMLImageElement, iconEl: HTMLElement, url: string | null, fallback: IconName): void {
  setIcon(iconEl, fallback);
  if (url) {
    if (img.getAttribute('src') !== url) img.src = url;
    img.hidden = false;
    iconEl.hidden = true;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    iconEl.hidden = false;
  }
}

function buildIdle(): Pick<Refs, 'empty' | 'idleAge' | 'idleObjective' | 'idleEvents'> {
  const idleAge = h('span', { class: 'idle-age' });
  const idleObjective = h('span', { class: 'idle-objective-text' });
  const idleEvents = h('ol', { class: 'idle-events', 'aria-label': 'Recent events' });
  const empty = h(
    'div',
    { class: 'sel-empty' },
    h('div', { class: 'idle-crest', 'aria-hidden': 'true' }, h('img', { src: '/assets/ui/crest.svg', alt: '', draggable: 'false' })),
    h(
      'div',
      { class: 'idle-main' },
      h('div', { class: 'idle-head' }, h('h3', { class: 'idle-title' }, 'Kingdom of Bohemia'), idleAge),
      h('p', { class: 'idle-objective' }, icon('flag', 'idle-objective-icon'), idleObjective),
      idleEvents,
      h(
        'p',
        { class: 'idle-hint' },
        'Click or drag to select. ',
        h('kbd', null, 'F1'),
        ' villagers ',
        h('kbd', null, 'F2'),
        ' army ',
        h('kbd', null, '.'),
        ' idle villager'
      )
    )
  );
  return { empty, idleAge, idleObjective, idleEvents };
}

function buildQueue(): Pick<Refs, 'queueWrap' | 'queueSlots' | 'queueMore'> {
  const queueSlots: HTMLElement[] = [];
  const list = h('div', { class: 'queue-slots' });
  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const slot = h(
      'button',
      { type: 'button', class: `queue-slot${i === 0 ? ' is-head' : ''}`, tabindex: '-1', disabled: true },
      h('img', { class: 'queue-img', alt: '', hidden: true, draggable: 'false' }),
      icon('person', 'queue-icon'),
      h('span', { class: 'queue-progress', 'aria-hidden': 'true' }),
      h('span', { class: 'queue-x', 'aria-hidden': 'true' })
    );
    slot.addEventListener('click', () => {
      const scene = activeScene;
      if (!scene || queueProducer < 0 || !queueItems[i]) return;
      // Redraw on the next frame even if the sim has not applied it yet.
      if (cancelProduction(scene, queueProducer, i)) lastQueueSig = '';
    });
    attachTip(slot, () => {
      const item = queueItems[i];
      if (!slot.classList.contains('is-filled') || !item) return null;
      return {
        title: item.name,
        body: `${i === 0 ? `Training now, ${Math.floor(item.progressFrac * 100)}% done.` : 'Waiting in the queue.'} Click to cancel. ${refundText(item)}`,
      };
    });
    queueSlots.push(slot);
    list.append(slot);
  }
  const queueMore = h('span', { class: 'queue-more num' });
  list.append(queueMore);
  const queueWrap = h('div', { class: 'queue', 'aria-label': 'Production queue' }, h('span', { class: 'queue-label' }, 'Training'), list);
  return { queueWrap, queueSlots, queueMore };
}

export function buildSelectionPanel(): HTMLElement {
  loadPortraits();
  const portraitImg = h('img', { class: 'portrait-img', alt: '', hidden: true, draggable: 'false' });
  const portraitIcon = icon('shield', 'portrait-icon');
  const count = h('span', { class: 'portrait-count num' });
  const portrait = h('div', { class: 'portrait', 'aria-hidden': 'true' }, portraitImg, portraitIcon, count);
  const name = h('h3', { class: 'sel-name', id: 'sel-name' }, 'Nothing selected');
  const owner = h('span', { class: 'sel-owner' });
  const hpFill = h('i');
  const hpBar = h('div', { class: 'bar hp hp-seg', role: 'meter', 'aria-label': 'Health', 'aria-valuemin': 0 }, hpFill);
  const hpText = h('span', { class: 'hp-text num' });
  const hpRow = h('div', { class: 'hp-row' }, icon('shield', 'hp-icon'), hpBar, hpText);
  const stats = h('ul', { class: 'stat-chips', id: 'sel-stats', 'aria-label': 'Stats' });
  const statusText = h('span', { class: 'sel-status-text' });
  const statusBar = h('div', { class: 'bar sel-status-bar' }, h('i'));
  const carryIcon = icon('wood', 'carry-icon');
  const carryPips: HTMLElement[] = [];
  const pips = h('span', { class: 'carry-pips' });
  for (let i = 0; i < CARRY_MAX; i++) {
    const pip = h('i');
    carryPips.push(pip);
    pips.append(pip);
  }
  const carry = h('span', { class: 'carry', hidden: true }, carryIcon, pips);
  const status = h('div', { class: 'sel-status', role: 'status' }, h('span', { class: 'sel-status-line' }, statusText, carry), statusBar);
  const state = h('ul', { class: 'sel-state', 'aria-label': 'Orders in force' });
  const { queueWrap, queueSlots, queueMore } = buildQueue();

  const single = h(
    'div',
    { class: 'sel-single' },
    portrait,
    h('div', { class: 'sel-main' }, h('div', { class: 'sel-name-row' }, name, owner), hpRow, stats, status, state),
    queueWrap
  );

  const multiTitle = h('h3', { class: 'multi-title' });
  const multiGroups = h('div', { class: 'multi-groups', role: 'group', 'aria-label': 'Selected kinds' });
  const multiGrid = h('div', { class: 'multi-grid', role: 'group', 'aria-label': 'Selected units' });
  const multi = h('div', { class: 'sel-multi' }, h('div', { class: 'multi-head' }, multiTitle, multiGroups), multiGrid);

  const idle = buildIdle();
  const root = h(
    'section',
    { class: 'console-selection', id: 'selection-panel', 'aria-label': 'Selection' },
    h('div', { class: 'sel-inner' }, idle.empty, single, multi)
  );
  refs = {
    root,
    ...idle,
    single,
    portrait,
    portraitImg,
    portraitIcon,
    count,
    name,
    owner,
    hpRow,
    hpBar,
    hpFill,
    hpText,
    stats,
    status,
    statusText,
    statusBar,
    carry,
    carryIcon,
    carryPips,
    state,
    queueWrap,
    queueSlots,
    queueMore,
    multi,
    multiTitle,
    multiGroups,
    multiGrid,
  };
  return root;
}

// --- Single ------------------------------------------------------------------

function renderStats(text: string): void {
  if (!refs || text === lastStatsSig) return;
  lastStatsSig = text;
  const parts = plainDashes(text)
    .split(/\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    // The carried load has its own meter on the status line.
    .filter((p) => !p.startsWith('Carry '));
  refs.stats.replaceChildren(
    ...parts.map((part) => {
      const m = /^([A-Za-z]+)\s+(.+)$/.exec(part);
      const label = m ? m[1]! : '';
      const value = m ? m[2]! : part;
      const full = STAT_LABEL[label];
      const resource = RESOURCE_WORDS.find((r) => r === part.toLowerCase());
      if (resource) {
        return h('li', { class: 'stat-chip is-text' }, icon(resource, `stat-icon res-${resource}`), h('span', { class: 'stat-value' }, part));
      }
      const glyph = STAT_ICON[label];
      return h(
        'li',
        { class: `stat-chip${full ? '' : ' is-text'}`, 'aria-label': full ? `${full} ${value}` : part },
        glyph ? icon(glyph, 'stat-icon') : full ? h('span', { class: 'stat-label' }, label) : null,
        h('span', { class: full ? 'stat-value num' : 'stat-value' }, full ? value : part)
      );
    })
  );
}

function renderCarry(stats: string, statusText: string): void {
  if (!refs) return;
  const m = /Carry\s+(\d+)\s*\/\s*(\d+)/.exec(stats);
  refs.carry.hidden = !m;
  if (!m) return;
  const n = Math.min(CARRY_MAX, Number(m[1]));
  refs.carryPips.forEach((pip, i) => pip.classList.toggle('is-on', i < n));
  const kind = RESOURCE_WORDS.find((r) => statusText.toLowerCase().includes(r)) ?? 'wood';
  setIcon(refs.carryIcon, kind);
  refs.carryIcon.className = `icon carry-icon res-${kind}`;
  setAttr(refs.carry, 'aria-label', `Carrying ${m[1]} of ${m[2]}`);
}

function renderState(scene: GameScene): void {
  if (!refs) return;
  const active = scene
    .getAvailableActions()
    .filter((a) => a.active && (a.id.startsWith('stance-') || (a.id.startsWith('formation-') && !a.id.includes('rotate'))));
  const sig = active.map((a) => a.id).join('|');
  if (sig === lastStateSig) return;
  lastStateSig = sig;
  refs.state.replaceChildren(
    ...active.map((a) =>
      h('li', { class: 'state-chip' }, icon(actionIcon(a.id), 'state-icon'), plainDashes(a.label).replace(/^(Stance|Formation):\s*/i, ''))
    )
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
  refs.root.classList.toggle('has-queue', producer >= 0);
  const sig = `${producer}|${queue.map((s) => s.unitDefId).join(',')}|${Math.floor((queue[0]?.progressFrac ?? 0) * 72)}`;
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
      setPortrait(
        slot.querySelector<HTMLImageElement>('.queue-img')!,
        slot.querySelector<HTMLElement>('.queue-icon')!,
        unitPortraitUrl(item.unitDefId),
        UNIT_ICON_BY_DEF[item.unitDefId] ?? 'person'
      );
    }
    (slot.querySelector('.queue-progress') as HTMLElement).style.setProperty('--p', i === 0 && item ? item.progressFrac.toFixed(3) : '0');
  });
  setText(refs.queueMore, queue.length > QUEUE_SLOTS ? `+${queue.length - QUEUE_SLOTS}` : '');
}

// --- Multi -------------------------------------------------------------------

function groupsOf(scene: GameScene, selected: number[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const eid of selected) {
    const key = entityKindKey(scene, eid);
    const list = groups.get(key) ?? [];
    list.push(eid);
    groups.set(key, list);
  }
  return groups;
}

function renderMulti(scene: GameScene, selected: number[], age: number): void {
  if (!refs) return;
  const groups = groupsOf(scene, selected);
  setText(refs.multiTitle, `${selected.length} selected`);
  const sig = Array.from(groups.entries())
    .map(([k, v]) => `${k}:${v.length}`)
    .join('|');
  if (sig !== lastMultiSig) {
    lastMultiSig = sig;
    refs.multiGroups.replaceChildren(
      ...Array.from(groups.entries()).map(([key, eids]) => {
        const btn = h(
          'button',
          { type: 'button', class: 'group-chip', 'aria-label': `${eids.length} ${kindName(key)}. Select only these.` },
          icon(kindIcon(key), 'group-icon'),
          h('span', { class: 'group-count num' }, String(eids.length))
        );
        btn.addEventListener('click', () => selectEntities(scene, eids));
        attachTip(btn, () => ({ title: `${kindName(key)} x${eids.length}`, body: 'Click to keep only this kind selected.' }));
        return btn;
      })
    );
  }

  // One mini portrait per unit, grouped by kind.
  const ordered = Array.from(groups.values()).flat();
  const shown = ordered.slice(0, MAX_TILES);
  const tileSig = `${shown.join(',')}|${ordered.length}`;
  if (tileSig !== lastTilesSig) {
    lastTilesSig = tileSig;
    tiles = shown.map((eid) => {
      const key = entityKindKey(scene, eid);
      const img = h('img', { class: 'tile-img', alt: '', hidden: true, draggable: 'false' });
      const glyph = icon(kindIcon(key), 'tile-icon');
      setPortrait(img, glyph, portraitForKey(key, age), kindIcon(key));
      const el = h(
        'button',
        { type: 'button', class: 'unit-tile', 'aria-label': `${kindName(key)}. Select only this one.` },
        img,
        glyph,
        h('span', { class: 'tile-hp', 'aria-hidden': 'true' }, h('i'))
      );
      el.addEventListener('click', () => selectEntities(scene, [eid]));
      attachTip(el, () => {
        const f = healthFrac(scene, eid);
        return { title: kindName(key), body: f === null ? 'Click to select only this one.' : `Health ${Math.round(f * 100)}%. Click to select only this one.` };
      });
      return { eid, el };
    });
    const extra = ordered.length - shown.length;
    refs.multiGrid.replaceChildren(...tiles.map((t) => t.el), extra > 0 ? h('span', { class: 'tile-more num' }, `+${extra}`) : '');
  }
  for (const t of tiles) {
    const f = healthFrac(scene, t.eid) ?? 0;
    const bar = t.el.lastElementChild as HTMLElement;
    bar.style.setProperty('--p', f.toFixed(2));
    setAttr(bar, 'data-level', hpBucket(f));
  }
}

// --- Idle --------------------------------------------------------------------

function renderIdle(scene: GameScene): void {
  if (!refs) return;
  const me = scene.getPerspectivePlayerId();
  const age = scene.getAge(me);
  const mission = scene.getCampaignMission();
  const next = mission?.objectives.find((o) => !o.completed && !o.optional) ?? mission?.objectives.find((o) => !o.completed);
  const objective = mission
    ? next
      ? plainDashes(next.label)
      : 'Every objective is met. Hold until the chroniclers write it down.'
    : 'Skirmish: grow your town, raise an army and break the rival lord.';
  const events = recentEvents();
  const sig = `${age.name}|${objective}|${events.map((e) => e.text).join('|')}`;
  if (sig === lastIdleSig) return;
  lastIdleSig = sig;
  setText(refs.idleAge, age.name);
  setText(refs.idleObjective, objective);
  refs.idleEvents.replaceChildren(
    ...(events.length > 0
      ? events.map((e) => h('li', { class: `idle-event tone-${e.tone}` }, plainDashes(e.text)))
      : [h('li', { class: 'idle-event is-quiet' }, 'The chronicle is quiet.')])
  );
}

// --- Frame -------------------------------------------------------------------

export function updateSelectionPanel(scene: GameScene): void {
  if (!refs) return;
  activeScene = scene;
  const info = scene.getSelectionInfo();
  const me = scene.getPerspectivePlayerId();
  const selected = info.count === 0 ? [] : getSelectedEids(scene);
  const firstKey = selected.length > 0 ? entityKindKey(scene, selected[0]!) : '';
  const many = info.count > 1 && (info.kind === 'mixed' || firstKey.startsWith('u'));
  const mode = info.count === 0 ? 'empty' : many ? 'multi' : 'single';
  refs.root.dataset.mode = mode;
  refs.empty.hidden = mode !== 'empty';
  refs.single.hidden = mode !== 'single';
  refs.multi.hidden = mode !== 'multi';
  if (mode === 'empty') {
    lastQueueSig = '';
    queueProducer = -1;
    queueItems = [];
    refs.root.classList.remove('has-queue');
    renderIdle(scene);
    return;
  }
  const age = scene.getAge(me).current;
  if (mode === 'multi') {
    queueProducer = -1;
    queueItems = [];
    refs.root.classList.remove('has-queue');
    renderMulti(scene, selected, age);
    return;
  }

  const byKey = kindIcon(firstKey);
  const fallback = byKey !== 'shield' ? byKey : (SELECTION_ICON[info.kind] ?? 'shield');
  setPortrait(refs.portraitImg, refs.portraitIcon, portraitForKey(firstKey, age), fallback);
  refs.portrait.dataset.team = String(info.team === me ? 'me' : info.team);
  setText(refs.count, info.count > 1 ? `x${info.count}` : '');
  const name = plainDashes(info.name).trim();
  setText(refs.name, name === '-' ? '' : name);
  const owner = info.team === me ? 'Yours' : info.team === 0 ? 'Gaia' : 'Enemy';
  setText(refs.owner, owner);
  refs.owner.dataset.team = String(info.team === me ? 'me' : info.team);

  const frac = info.hpMax > 0 ? info.hp / info.hpMax : 0;
  refs.hpFill.style.setProperty('--p', frac.toFixed(3));
  setAttr(refs.hpBar, 'data-level', hpBucket(frac));
  setAttr(refs.hpBar, 'aria-valuemax', String(Math.round(info.hpMax)));
  setAttr(refs.hpBar, 'aria-valuenow', String(Math.round(info.hp)));
  refs.hpRow.hidden = info.hpMax <= 0;
  setText(refs.hpText, `${Math.ceil(info.hp)} / ${Math.ceil(info.hpMax)}`);

  renderStats(info.stats);
  const status = scene.getStatusInfo();
  const raw = plainDashes(status.text ?? '');
  const statusText = raw === '-' ? '' : raw.charAt(0).toUpperCase() + raw.slice(1);
  setText(refs.statusText, statusText || (info.team === me ? 'Awaiting orders' : ''));
  refs.status.classList.toggle('has-progress', status.progressFrac !== null);
  (refs.statusBar.firstElementChild as HTMLElement).style.setProperty('--p', String(status.progressFrac ?? 0));
  renderCarry(info.stats, statusText);
  renderState(scene);
  renderQueue(scene, selected, me);
}

export function resetSelectionPanel(): void {
  lastStatsSig = '';
  lastMultiSig = '';
  lastTilesSig = '';
  lastQueueSig = '';
  lastStateSig = '';
  lastIdleSig = '';
  queueProducer = -1;
  queueItems = [];
  tiles = [];
}
