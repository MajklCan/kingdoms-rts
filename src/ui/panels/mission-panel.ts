/** Campaign mission card: briefing + objectives, auto-opens on mission start. */

import type { GameScene } from '../../render/game-scene';
import { CampaignMissionId } from '../../sim/campaign';
import { TechId } from '../../sim/tech-tree';
import { byId, escapeHtml } from '../dom';

let lastMissionSig = '';
let lastMissionId = '';

function setMissionPanelOpen(open: boolean): void {
  const panel = byId('mission-panel');
  const toggle = byId<HTMLButtonElement>('mission-toggle');
  if (!panel || !toggle) return;
  panel.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function bindMissionControls(): void {
  const panel = byId('mission-panel');
  const toggle = byId<HTMLButtonElement>('mission-toggle');
  const close = byId<HTMLButtonElement>('mission-close');
  if (!panel || !toggle || !close) return;
  toggle.addEventListener('click', () => {
    setMissionPanelOpen(!panel.classList.contains('open'));
  });
  close.addEventListener('click', () => setMissionPanelOpen(false));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && panel.classList.contains('open')) setMissionPanelOpen(false);
  });
}

export function missionNoteFor(mission: NonNullable<ReturnType<GameScene['getCampaignMission']>>): string {
  return mission.lockedTechs.includes(TechId.GUNPOWDER_AGE)
    ? 'Gunpowder Age is locked in this mission.'
    : mission.id === CampaignMissionId.BATTLE_OF_BILA_HORA
      ? 'No town center. No economy. Victory requires destroying every enemy unit.'
      : mission.id === CampaignMissionId.BATTLE_OF_KUTNA_HORA
        ? 'City defense. Train reinforcements and keep the Town Center standing until every assault wave is destroyed.'
        : mission.id === CampaignMissionId.BATTLE_OF_SUDOMER
          ? 'Outnumbered town defense. You start with a small guard - put villagers to work and raise pikemen and gunmen during the lull, then hold the dry choke and the muddy flank. Keep the Town Hall standing.'
          : mission.id === CampaignMissionId.BATTLE_OF_ZBOROV
            ? 'Economy trench duel. Your command foundry and resource sites are live from the start; train gunmen and cannon, hold enemy waves, and mass enough force to break the three trench lines.'
            : '';
}

export function renderMissionCard(scene: GameScene): void {
  const missionPanelEl = byId('mission-panel');
  const missionBodyEl = byId('mission-body');
  const missionToggleEl = byId<HTMLButtonElement>('mission-toggle');
  if (!missionPanelEl || !missionBodyEl || !missionToggleEl) return;
  const mission = scene.getCampaignMission();
  if (!mission) {
    missionToggleEl.classList.add('hidden');
    setMissionPanelOpen(false);
    lastMissionSig = '';
    lastMissionId = '';
    return;
  }

  missionToggleEl.classList.remove('hidden');
  if (mission.id !== lastMissionId) {
    lastMissionId = mission.id;
    setMissionPanelOpen(true);
  }

  const sig = [
    mission.id,
    mission.name,
    mission.lockedTechs.join(','),
    ...mission.objectives.map((objective) => `${objective.id}:${objective.completed ? 1 : 0}`),
  ].join('|');
  if (sig === lastMissionSig) return;
  lastMissionSig = sig;
  const missionNote = missionNoteFor(mission);

  missionBodyEl.innerHTML = `
    <h3 class="mission-name">${escapeHtml(mission.name)}</h3>
    <p class="mission-briefing">${escapeHtml(mission.briefing)}</p>
    <ul class="mission-objectives">
      ${mission.objectives.map((objective) => `
        <li class="mission-objective ${objective.completed ? 'done' : ''}">
          <input type="checkbox" disabled ${objective.completed ? 'checked' : ''} aria-label="${escapeHtml(objective.label)}">
          <span>
            ${escapeHtml(objective.label)}
            ${objective.optional ? '<span class="optional">Side objective - weakens enemy troop refresh</span>' : ''}
          </span>
        </li>
      `).join('')}
    </ul>
    ${missionNote ? `<p class="mission-note">${escapeHtml(missionNote)}</p>` : ''}
  `;
}
