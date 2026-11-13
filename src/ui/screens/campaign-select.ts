/**
 * Campaign mission select: a numbered list of chronicles on the left and the
 * selected mission's briefing (objectives, age, battlefield) on the right.
 * Arrow keys move the selection, Enter or Begin starts the mission.
 */

import { CAMPAIGN_MISSIONS, type CampaignMissionDef, type CampaignMissionIdValue } from '../../sim/campaign';
import { AGE_TABLE } from '../../sim/defs';
import { MAP_DEFS } from '../../sim/map-gen';
import { h, plainDashes, readStorage, writeStorage } from '../dom';
import { icon } from '../icons/icon';
import { startCampaign } from '../match/match-flow';
import { backButton, registerMenuScreen } from './menu-shell';

const LAST_KEY = 'kingdoms.lastMission.v1';

const MISSION_META: Record<string, { year: string; tags: string[] }> = {
  siege_of_brno: { year: '1645', tags: ['Economy', 'Siege', 'Gunpowder locked'] },
  battle_of_bila_hora: { year: '1620', tags: ['No economy', 'Cavalry and gunmen', 'Kill all enemies'] },
  battle_of_kutna_hora: { year: '1421', tags: ['City defense', 'Reinforcements', 'Assault waves'] },
  battle_of_sudomer: { year: '1420', tags: ['Town defense', 'Two fronts', 'Largest battle'] },
  battle_of_zborov: { year: '1917', tags: ['Trench assault', 'Artillery first', 'World War I'] },
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function bindCampaignSelect(): void {
  const missions = CAMPAIGN_MISSIONS;
  let selected: CampaignMissionIdValue =
    (missions.find((m) => m.id === readStorage(LAST_KEY))?.id as CampaignMissionIdValue | undefined) ??
    missions[0]!.id;

  const list = h('div', { class: 'mission-list', role: 'listbox', 'aria-label': 'Missions' });
  const briefing = h('article', { class: 'briefing', 'aria-label': 'Mission briefing' });
  const begin = h('button', { type: 'button', class: 'btn btn-seal btn-lg' }, icon('flag'), 'Begin Mission');

  const items = new Map<string, HTMLElement>();
  missions.forEach((mission, index) => {
    const meta = MISSION_META[mission.id];
    const item = h(
      'button',
      {
        type: 'button',
        class: 'mission-item',
        role: 'option',
        'data-campaign-mission': mission.id,
        'aria-selected': 'false',
        tabindex: '-1',
      },
      h('span', { class: 'mission-num', 'aria-hidden': 'true' }, ROMAN[index] ?? String(index + 1)),
      h(
        'span',
        { class: 'mission-item-body' },
        h('span', { class: 'mission-item-name' }, mission.name),
        h('span', { class: 'mission-item-year' }, meta?.year ?? '')
      ),
      icon('chevron-right', 'mission-item-arrow')
    );
    item.addEventListener('click', () => select(mission.id, false));
    item.addEventListener('dblclick', () => start());
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (ev.key === 'Enter') start();
        else select(mission.id, false);
      }
    });
    items.set(mission.id, item);
    list.append(item);
  });

  list.addEventListener('keydown', (ev) => {
    const ids = missions.map((m) => m.id);
    const idx = ids.indexOf(selected);
    let next = -1;
    if (ev.key === 'ArrowDown') next = (idx + 1) % ids.length;
    else if (ev.key === 'ArrowUp') next = (idx - 1 + ids.length) % ids.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    select(ids[next]!, true);
  });

  function renderBriefing(mission: CampaignMissionDef): void {
    const meta = MISSION_META[mission.id];
    const age = AGE_TABLE.find((a) => a.id === mission.startingAge)?.name ?? '';
    const map = MAP_DEFS.find((m) => m.id === mission.mapId)?.name ?? '';
    briefing.replaceChildren(
      h('div', { class: 'eyebrow' }, `Chronicle ${ROMAN[missions.indexOf(mission)] ?? ''}${meta ? ` · ${meta.year}` : ''}`),
      h('h3', { class: 'briefing-title title-display' }, mission.name),
      h('p', { class: 'briefing-lede' }, plainDashes(mission.description)),
      h('div', { class: 'briefing-tags' }, ...(meta?.tags ?? []).map((t) => h('span', { class: 'tag' }, t))),
      h('div', { class: 'ornament-rule', 'aria-hidden': 'true' }, h('span')),
      h('p', { class: /^[A-Za-z]/.test(mission.briefing) ? 'briefing-text has-initial' : 'briefing-text' }, plainDashes(mission.briefing)),
      h('h4', { class: 'field-label' }, 'Objectives'),
      h(
        'ul',
        { class: 'objective-list' },
        ...mission.objectives.map((o) =>
          h(
            'li',
            { class: o.optional ? 'is-optional' : '' },
            icon(o.optional ? 'scroll' : 'flag'),
            h('span', null, plainDashes(o.label), o.optional ? h('em', null, ' (optional)') : null)
          )
        )
      ),
      h(
        'dl',
        { class: 'briefing-facts' },
        h('div', null, h('dt', null, 'Starting age'), h('dd', null, age)),
        h('div', null, h('dt', null, 'Battlefield'), h('dd', null, map))
      )
    );
  }

  function select(id: CampaignMissionIdValue, focus: boolean): void {
    selected = id;
    writeStorage(LAST_KEY, id);
    for (const [mid, item] of items) {
      const on = mid === id;
      item.setAttribute('aria-selected', String(on));
      item.tabIndex = on ? 0 : -1;
      if (on && focus) item.focus();
    }
    const mission = missions.find((m) => m.id === id);
    if (mission) renderBriefing(mission);
  }

  function start(): void {
    startCampaign(selected);
  }

  begin.addEventListener('click', start);

  const el = h(
    'section',
    { class: 'menu-sub', 'aria-labelledby': 'campaign-title' },
    h(
      'div',
      { class: 'scroll-panel parchment scroll-panel-wide' },
      h(
        'header',
        { class: 'sub-head' },
        backButton(),
        h('div', { class: 'sub-titles' }, h('div', { class: 'eyebrow' }, 'Chronicles of the crown'), h('h2', { class: 'title-display', id: 'campaign-title' }, 'Campaign')),
        h('span', { class: 'sub-head-spacer' })
      ),
      h(
        'div',
        { class: 'campaign-grid' },
        h('div', { class: 'campaign-list-col' }, list, h('p', { class: 'field-note' }, 'Arrow keys to choose, Enter to begin.')),
        h('div', { class: 'campaign-brief-col' }, briefing, h('div', { class: 'setup-actions' }, begin))
      )
    )
  );

  select(selected, false);
  registerMenuScreen({
    id: 'campaign',
    el,
    focusTarget: () => items.get(selected) ?? begin,
  });
}
