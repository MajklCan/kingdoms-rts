/**
 * Skirmish setup: map list with descriptions, the two banners (colours are
 * fixed by the sim today), AI difficulty and starting age as segmented
 * radios, and the Begin button. Choices persist between visits.
 */

import { AgeId, AGE_TABLE, type AgeIdValue } from '../../sim/defs';
import { MAP_DEFS, normalizeMapId, type MapIdValue } from '../../sim/map-gen';
import { normalizeAiDifficulty, type AiDifficulty } from '../../sim/world';
import { h, readStorage, writeStorage } from '../dom';
import { icon } from '../icons/icon';
import { startSkirmish } from '../match/match-flow';
import { backButton, registerMenuScreen } from './menu-shell';
import { storedPlayerName } from './main-menu';

const PREFS_KEY = 'kingdoms.skirmishSetup.v1';

export function parseStartingAge(value: string | undefined): AgeIdValue {
  const parsed = Number(value);
  if (parsed === AgeId.CASTLE) return AgeId.CASTLE;
  if (parsed === AgeId.GUNPOWDER) return AgeId.GUNPOWDER;
  if (parsed === AgeId.TOTAL_WAR) return AgeId.TOTAL_WAR;
  return AgeId.DARK;
}

export function parseStartingMap(value: string | undefined): MapIdValue {
  return normalizeMapId(value);
}

export function parseAiDifficulty(value: string | undefined): AiDifficulty {
  return normalizeAiDifficulty(value);
}

interface SkirmishPrefs {
  map: MapIdValue;
  difficulty: AiDifficulty;
  age: AgeIdValue;
}

function loadPrefs(): SkirmishPrefs {
  try {
    const raw = JSON.parse(readStorage(PREFS_KEY) ?? '{}') as Record<string, string>;
    return {
      map: parseStartingMap(raw.map),
      difficulty: parseAiDifficulty(raw.difficulty),
      age: parseStartingAge(raw.age),
    };
  } catch {
    return { map: parseStartingMap(undefined), difficulty: 'medium', age: AgeId.DARK };
  }
}

function radio(name: string, value: string, label: string, checked: boolean, extra?: Node): HTMLLabelElement {
  return h(
    'label',
    null,
    h('input', { type: 'radio', name, value, checked }),
    h('span', null, extra ?? null, label)
  );
}

function banner(team: 1 | 2, title: string, sub: string): HTMLElement {
  return h(
    'div',
    { class: `banner-card team-${team}` },
    h('span', { class: 'banner-flag', 'aria-hidden': 'true' }, icon('shield')),
    h('span', { class: 'banner-text' }, h('strong', null, title), h('span', null, sub))
  );
}

export function bindSkirmishSetup(): void {
  const prefs = loadPrefs();

  const mapList = h('div', { class: 'map-list', role: 'radiogroup', 'aria-label': 'Map' });
  for (const map of MAP_DEFS) {
    mapList.append(
      h(
        'label',
        { class: 'map-option' },
        h('input', { type: 'radio', name: 'skirmish-map', value: map.id, checked: map.id === prefs.map }),
        h(
          'span',
          { class: 'map-option-body' },
          h('span', { class: 'map-option-name' }, map.name),
          h('span', { class: 'map-option-desc' }, map.description)
        )
      )
    );
  }

  const difficulty = h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': 'AI difficulty' },
    radio('skirmish-difficulty', 'easy', 'Easy', prefs.difficulty === 'easy'),
    radio('skirmish-difficulty', 'medium', 'Medium', prefs.difficulty === 'medium'),
    radio('skirmish-difficulty', 'hard', 'Hard', prefs.difficulty === 'hard')
  );

  const ages = h('div', { class: 'seg seg-wrap', role: 'radiogroup', 'aria-label': 'Starting age' });
  for (const age of AGE_TABLE) {
    ages.append(radio('skirmish-age', String(age.id), age.name.replace(/ Age$/, ''), age.id === prefs.age));
  }

  const begin = h(
    'button',
    { type: 'button', class: 'btn btn-seal btn-lg btn-block', id: 'start-button' },
    icon('swords'),
    'Begin Skirmish'
  );

  const form = h('form', { class: 'setup-grid', onsubmit: (ev: Event) => ev.preventDefault() },
    h(
      'fieldset',
      { class: 'setup-col setup-maps' },
      h('legend', { class: 'field-label' }, 'Battlefield'),
      mapList
    ),
    h(
      'div',
      { class: 'setup-col setup-options' },
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Combatants'),
        h(
          'div',
          { class: 'banner-vs' },
          banner(1, storedPlayerName(), 'Kingdom of Bohemia'),
          h('span', { class: 'vs-mark', 'aria-hidden': 'true' }, 'vs'),
          banner(2, 'Rival Lord', 'Computer opponent')
        ),
        h('p', { class: 'field-note' }, 'Banner colours are fixed: you fly blue, the rival flies red.')
      ),
      h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'AI difficulty'), difficulty),
      h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Starting age'), ages),
      h('div', { class: 'setup-actions' }, begin)
    )
  );

  const readChoice = (): SkirmishPrefs => {
    const fd = new FormData(form);
    return {
      map: parseStartingMap(String(fd.get('skirmish-map') ?? '')),
      difficulty: parseAiDifficulty(String(fd.get('skirmish-difficulty') ?? '')),
      age: parseStartingAge(String(fd.get('skirmish-age') ?? '')),
    };
  };

  form.addEventListener('change', () => {
    writeStorage(PREFS_KEY, JSON.stringify(readChoice()));
  });
  // Enter on any choice starts the match, like a classic setup screen.
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.target as HTMLElement).matches('input[type="radio"]')) {
      ev.preventDefault();
      begin.click();
    }
  });

  begin.addEventListener('click', () => {
    const choice = readChoice();
    writeStorage(PREFS_KEY, JSON.stringify(choice));
    startSkirmish(choice.age, choice.map, choice.difficulty);
  });

  const el = h(
    'section',
    { class: 'menu-sub', 'aria-labelledby': 'skirmish-title' },
    h(
      'div',
      { class: 'scroll-panel parchment' },
      h(
        'header',
        { class: 'sub-head' },
        backButton(),
        h('div', { class: 'sub-titles' }, h('div', { class: 'eyebrow' }, 'Open battle'), h('h2', { class: 'title-display', id: 'skirmish-title' }, 'Skirmish')),
        h('span', { class: 'sub-head-spacer' })
      ),
      form
    )
  );

  registerMenuScreen({
    id: 'skirmish',
    el,
    focusTarget: () => mapList.querySelector<HTMLElement>('input:checked') ?? begin,
    onShow: () => {
      const name = el.querySelector('.banner-card.team-1 strong');
      if (name) name.textContent = storedPlayerName();
    },
  });
}
