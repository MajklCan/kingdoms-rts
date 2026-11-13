/**
 * Objectives scroll for campaign missions: briefing, objectives with live
 * check marks and the mission note. Opens automatically when a mission
 * starts (sim paused in single player until dismissed), from the top bar,
 * the pause menu or the O key. Completed objectives raise an alert.
 */

import type { GameScene } from '../../render/game-scene';
import { CampaignMissionId } from '../../sim/campaign';
import { TechId } from '../../sim/tech-tree';
import { hasOpenLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h, isTextEntryTarget, plainDashes } from '../dom';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import { pushAlert } from '../hud/alerts';
import { setPanelExpanded } from '../hud/top-bar';
import { createModal, type Modal } from './modal';

type Mission = NonNullable<ReturnType<GameScene['getCampaignMission']>>;

let modal: Modal | null = null;
let lastMissionId = '';
let lastSig = '';
const completed = new Set<string>();
let wasPaused = false;

export function missionNoteFor(mission: Mission): string {
  return mission.lockedTechs.includes(TechId.GUNPOWDER_AGE)
    ? 'Gunpowder Age is locked in this mission.'
    : mission.id === CampaignMissionId.BATTLE_OF_BILA_HORA
      ? 'No town center. No economy. Victory requires destroying every enemy unit.'
      : mission.id === CampaignMissionId.BATTLE_OF_KUTNA_HORA
        ? 'City defense. Train reinforcements and keep the Town Center standing until every assault wave is destroyed.'
        : mission.id === CampaignMissionId.BATTLE_OF_SUDOMER
          ? 'Outnumbered town defense. You start with a small guard. Put villagers to work and raise pikemen and gunmen during the lull, then hold the dry choke and the muddy flank. Keep the Town Hall standing.'
          : mission.id === CampaignMissionId.BATTLE_OF_ZBOROV
            ? 'Economy trench duel. Your command foundry and resource sites are live from the start; train gunmen and cannon, hold enemy waves, and mass enough force to break the three trench lines.'
            : '';
}

function ensureModal(): Modal {
  if (modal) return modal;
  modal = createModal({
    id: 'mission-panel',
    eyebrow: 'Orders from the crown',
    title: 'Objectives',
    className: 'modal-objectives',
    onOpen: () => setPanelExpanded('objectives', true),
    onClose: () => {
      setPanelExpanded('objectives', false);
      const scene = getScene();
      if (scene && !scene.isMultiplayer() && !wasPaused) scene.setPaused(false);
    },
  });
  const ok = h('button', { type: 'button', class: 'btn btn-seal' }, icon('flag'), 'To Battle');
  ok.addEventListener('click', () => modal?.close());
  modal.foot.append(ok);
  return modal;
}

function render(mission: Mission): void {
  const m = ensureModal();
  m.titleEl.textContent = mission.name;
  const note = missionNoteFor(mission);
  const noteEl = note ? h('p', { class: 'mission-note' }, icon('info'), note) : '';
  m.body.replaceChildren(
    h('p', { class: /^[A-Za-z]/.test(mission.briefing) ? 'briefing-text has-initial' : 'briefing-text' }, plainDashes(mission.briefing)),
    h('h3', { class: 'field-label' }, 'Objectives'),
    h(
      'ul',
      { class: 'objective-list is-live', id: 'mission-objectives' },
      ...mission.objectives.map((o) =>
        h(
          'li',
          { class: `${o.completed ? 'is-done' : ''} ${o.optional ? 'is-optional' : ''}`.trim() },
          icon(o.completed ? 'check' : o.optional ? 'scroll' : 'flag'),
          h(
            'span',
            null,
            plainDashes(o.label),
            o.optional ? h('em', null, ' Side objective: weakens enemy troop refresh.') : null,
            o.completed ? h('span', { class: 'sr-only' }, ' (completed)') : null
          )
        )
      )
    ),
    noteEl
  );
}

export function openObjectives(): void {
  const scene = getScene();
  const mission = scene?.getCampaignMission();
  if (!scene || !mission) return;
  render(mission);
  const m = ensureModal();
  if (m.isOpen()) return;
  wasPaused = scene.isPaused();
  if (!scene.isMultiplayer()) scene.setPaused(true);
  m.open();
}

export function toggleObjectives(): void {
  if (modal?.isOpen()) modal.close();
  else openObjectives();
}

export function updateObjectives(scene: GameScene): void {
  const mission = scene.getCampaignMission();
  if (!mission) {
    lastMissionId = '';
    return;
  }
  if (mission.id !== lastMissionId) {
    lastMissionId = mission.id;
    completed.clear();
    for (const o of mission.objectives) if (o.completed) completed.add(o.id);
    lastSig = '';
    if (appState.phase === 'match') openObjectives();
  }
  const sig = mission.objectives.map((o) => `${o.id}:${o.completed ? 1 : 0}`).join('|');
  if (sig === lastSig) return;
  lastSig = sig;
  for (const o of mission.objectives) {
    if (o.completed && !completed.has(o.id)) {
      completed.add(o.id);
      pushAlert({ kind: 'info', text: `Objective complete: ${plainDashes(o.label)}` });
    }
  }
  if (modal?.isOpen()) render(mission);
}

export function resetObjectives(): void {
  lastMissionId = '';
  lastSig = '';
  completed.clear();
}

export function bindObjectivesKey(): void {
  window.addEventListener('keydown', (ev) => {
    if (appState.phase !== 'match' || isTextEntryTarget(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key.toLowerCase() !== 'o') return;
    if (hasOpenLayer() && !modal?.isOpen()) return;
    if (!getScene()?.getCampaignMission()) return;
    ev.preventDefault();
    toggleObjectives();
  });
}
