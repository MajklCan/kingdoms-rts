/**
 * Skirmish setup: map list with descriptions, the two banners (colours are
 * fixed by the sim today), AI difficulty, starting age and time of day as
 * segmented radios, and the Begin button. Choices persist between visits;
 * picking a map sets the time of day that map is meant for. A starting
 * age is a research preset: the rings before it come already researched.
 */

import { AgeId, AGE_TABLE, type AgeIdValue } from '../../sim/defs';
import { SKIRMISH_MAP_DEFS, isNightMap, normalizeSkirmishMapId, type MapIdValue } from '../../sim/map-gen';
import { normalizeAiDifficulty, type AiDifficulty } from '../../sim/world';
import { h, plainDashes, readStorage, writeStorage } from '../dom';
import { icon } from '../icons/icon';
import { startSkirmish } from '../match/match-flow';
import { storedPlayerName } from './main-menu';
import { paintMapPreview } from './map-preview';
import { backButton, registerMenuScreen } from './menu-shell';

const PREFS_KEY = 'kingdoms.skirmishSetup.v1';

/** Ages a skirmish may start in. Total War stays sim scaffolding: it is not
 *  playable yet, so the setup screen never offers it. */
export const SKIRMISH_STARTING_AGES: readonly AgeIdValue[] = [AgeId.DARK, AgeId.CASTLE, AgeId.GUNPOWDER];

/** Form or stored value to a starting age; anything else (old Total War
 *  prefs included) falls back to Dark. */
export function parseStartingAge(value: string | undefined): AgeIdValue {
  const parsed = Number(value);
  return SKIRMISH_STARTING_AGES.find((age) => age === parsed) ?? AgeId.DARK;
}

/** What a starting age gives, shown under the choice. */
export function startingAgeNote(age: AgeIdValue): string {
  if (age === AgeId.CASTLE) return 'All of ring I researched, so ring II is open. A larger bank.';
  if (age === AgeId.GUNPOWDER) return 'Rings I and II researched, so ring III is open. A large bank with gold.';
  return 'Nothing researched yet: ring I is open, with 300 wood to start.';
}

export function parseStartingMap(value: string | undefined): MapIdValue {
  return normalizeSkirmishMapId(value);
}

export function parseAiDifficulty(value: string | undefined): AiDifficulty {
  return normalizeAiDifficulty(value);
}

interface SkirmishPrefs {
  map: MapIdValue;
  difficulty: AiDifficulty;
  age: AgeIdValue;
  night: boolean;
}

/** Form or stored value to day/night; anything else is the map's own time. */
export function parseNight(value: unknown, map: MapIdValue): boolean {
  if (value === true || value === 'night') return true;
  if (value === false || value === 'day') return false;
  return isNightMap(map);
}

function loadPrefs(): SkirmishPrefs {
  try {
    const raw = JSON.parse(readStorage(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    const map = parseStartingMap(raw.map as string | undefined);
    return {
      map,
      difficulty: parseAiDifficulty(raw.difficulty as string | undefined),
      age: parseStartingAge(raw.age as string | undefined),
      night: parseNight(raw.night, map),
    };
  } catch {
    const map = parseStartingMap(undefined);
    return { map, difficulty: 'medium', age: AgeId.DARK, night: isNightMap(map) };
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
  const thumbs: Array<{ canvas: HTMLCanvasElement; id: MapIdValue; night: boolean }> = [];
  for (const map of SKIRMISH_MAP_DEFS) {
    const thumb = h('canvas', { class: 'map-thumb', 'aria-hidden': 'true' });
    thumbs.push({ canvas: thumb, id: map.id, night: map.night === true });
    mapList.append(
      h(
        'label',
        { class: 'map-option' },
        h('input', { type: 'radio', name: 'skirmish-map', value: map.id, checked: map.id === prefs.map }),
        h(
          'span',
          { class: 'map-option-body' },
          h('span', { class: 'map-thumb-frame' }, thumb),
          h(
            'span',
            { class: 'map-option-text' },
            h('span', { class: 'map-option-name' }, map.name, map.night ? h('span', { class: 'map-option-tag' }, 'Night') : null),
            h('span', { class: 'map-option-desc' }, plainDashes(map.description))
          )
        )
      )
    );
  }
  // Painted after the screen has laid out (the canvases need a size); the
  // terrain is cached, so repainting on every visit is cheap and follows
  // UI scale changes.
  const paintThumbs = () => {
    for (const t of thumbs) paintMapPreview(t.canvas, t.id, true, t.night);
  };

  const difficulty = h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': 'AI difficulty' },
    radio('skirmish-difficulty', 'easy', 'Easy', prefs.difficulty === 'easy'),
    radio('skirmish-difficulty', 'medium', 'Medium', prefs.difficulty === 'medium'),
    radio('skirmish-difficulty', 'hard', 'Hard', prefs.difficulty === 'hard')
  );

  const ages = h('div', { class: 'seg seg-wrap', role: 'radiogroup', 'aria-label': 'Starting age' });
  for (const age of AGE_TABLE) {
    if (!SKIRMISH_STARTING_AGES.includes(age.id)) continue;
    ages.append(radio('skirmish-age', String(age.id), age.name.replace(/ Age$/, ''), age.id === prefs.age));
  }

  const ageNote = h('p', { class: 'field-note', 'aria-live': 'polite' }, startingAgeNote(prefs.age));

  const time = h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': 'Time of day' },
    radio('skirmish-time', 'day', 'Day', !prefs.night),
    radio('skirmish-time', 'night', 'Night', prefs.night)
  );

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
      h(
        'div',
        { class: 'field-row' },
        h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'AI difficulty'), difficulty),
        h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Time of day'), time)
      ),
      h('p', { class: 'field-note' }, 'At night everyone carries torches and sees only as far as their light reaches.'),
      h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Starting age'), ages, ageNote),
      h('div', { class: 'setup-actions' }, begin)
    )
  );

  const readChoice = (): SkirmishPrefs => {
    const fd = new FormData(form);
    const map = parseStartingMap(String(fd.get('skirmish-map') ?? ''));
    return {
      map,
      difficulty: parseAiDifficulty(String(fd.get('skirmish-difficulty') ?? '')),
      age: parseStartingAge(String(fd.get('skirmish-age') ?? '')),
      night: parseNight(String(fd.get('skirmish-time') ?? ''), map),
    };
  };

  form.addEventListener('change', (ev) => {
    // A newly picked map brings its own time of day; the player can still flip it.
    const target = ev.target as HTMLInputElement | null;
    if (target?.name === 'skirmish-map') {
      const night = isNightMap(parseStartingMap(target.value));
      const pick = time.querySelector<HTMLInputElement>(`input[value="${night ? 'night' : 'day'}"]`);
      if (pick) pick.checked = true;
    }
    const choice = readChoice();
    writeStorage(PREFS_KEY, JSON.stringify(choice));
    ageNote.textContent = startingAgeNote(choice.age);
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
    startSkirmish(choice.age, choice.map, choice.difficulty, choice.night);
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
      requestAnimationFrame(paintThumbs);
    },
  });
}
