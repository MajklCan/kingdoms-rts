/**
 * Victory / defeat proclamation with match statistics. Appears once when
 * the scene reports an outcome; "Keep watching" dismisses it for the rest of
 * the match, "Return to menu" leaves.
 */

import type { GameScene } from '../../render/game-scene';
import { openLayer, releaseLayer } from '../a11y/layers';
import { h } from '../dom';
import { formatAmount, formatClock } from '../format';
import { icon } from '../icons/icon';
import type { IconName } from '../icons/icon-names';
import { quitToMenu } from '../match/match-flow';
import { getMatchStats } from '../match/tracker';

let root: HTMLElement | null = null;
let card: HTMLElement | null = null;
let shown = false;
let dismissed = false;

export function getGameOverRoot(): HTMLElement {
  if (!root) {
    card = h('div', { class: 'gameover-card parchment', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'game-over-title', tabindex: '-1' });
    root = h('div', { id: 'game-over', class: 'gameover', hidden: true }, card);
  }
  return root;
}

function stat(iconName: IconName, label: string, value: string): HTMLElement {
  return h('div', { class: 'go-stat' }, icon(iconName, 'go-stat-icon'), h('dt', null, label), h('dd', null, value));
}

function show(scene: GameScene, won: boolean): void {
  const r = getGameOverRoot();
  const s = getMatchStats(scene);
  const mission = scene.getCampaignMission();
  const returnBtn = h('button', { type: 'button', class: 'btn btn-seal btn-lg', id: 'game-over-play-again' }, icon('quit'), 'Return to Menu');
  const watchBtn = h('button', { type: 'button', class: 'btn btn-ink btn-lg', id: 'game-over-watch' }, icon('eye'), 'Keep Watching');
  returnBtn.addEventListener('click', () => {
    hide();
    quitToMenu();
  });
  watchBtn.addEventListener('click', () => {
    dismissed = true;
    hide();
  });
  card!.replaceChildren(
    h('div', { class: `go-emblem ${won ? 'is-victory' : 'is-defeat'}`, 'aria-hidden': 'true' }, icon(won ? 'victory' : 'defeat')),
    h('div', { class: 'eyebrow' }, mission ? mission.name : 'The chronicle records'),
    h('h2', { class: `go-title ${won ? 'victory' : 'defeat'}`, id: 'game-over-title' }, won ? 'Victory' : 'Defeat'),
    h('p', { class: 'go-sub', id: 'game-over-subtitle' }, won ? 'Bohemia stands triumphant. The kingdom endures.' : 'Bohemia has fallen. The realm is no more.'),
    h('div', { class: 'ornament-rule', 'aria-hidden': 'true' }, h('span')),
    h(
      'dl',
      { class: 'go-stats' },
      stat('hourglass', 'Match time', formatClock(s.seconds)),
      stat('person', 'Units trained', String(s.unitsTrained)),
      stat('swords', 'Enemies defeated', String(s.enemiesDefeated)),
      stat('defeat', 'Units lost', String(s.unitsLost)),
      stat('hammer', 'Buildings raised', String(s.buildingsBuilt)),
      stat('gold', 'Resources gathered', formatAmount(s.resourcesGathered)),
      stat('pop', 'Peak population', String(s.peakPopulation)),
      stat('crown', 'Age reached', scene.getAge(scene.getPerspectivePlayerId()).name)
    ),
    h('div', { class: 'go-actions' }, watchBtn, returnBtn)
  );
  r.hidden = false;
  shown = true;
  openLayer({ el: card!, dismissible: false, initialFocus: returnBtn });
}

function hide(): void {
  if (!root || !shown) return;
  shown = false;
  root.hidden = true;
  if (card) releaseLayer(card);
}

export function updateGameOver(scene: GameScene): void {
  const outcome = scene.getOutcome();
  if (outcome.state === 'victory') {
    if (!shown && !dismissed) show(scene, outcome.winnerPlayerId === scene.getPerspectivePlayerId());
  } else if (shown) {
    hide();
  }
}

export function resetGameOver(): void {
  hide();
  dismissed = false;
}
