/**
 * Multiplayer end-of-line screen: the relay connection dropped, the rival
 * left, or the two simulations diverged. There is no reconnect; the only
 * way on is back to the menu (which leaves the session cleanly). Shown over
 * the frozen battlefield, styled like the game-over proclamation.
 */

import type { SessionState } from '../../net/session';
import { openLayer, releaseLayer } from '../a11y/layers';
import { appState } from '../app-state';
import { h } from '../dom';
import { getScene } from '../game-bridge';
import { icon } from '../icons/icon';
import { quitToMenu } from '../match/match-flow';

type LostState = Extract<SessionState, 'disconnected' | 'peer-left' | 'desync'>;

const COPY: Record<LostState, { title: string; body: string }> = {
  disconnected: {
    title: 'Connection lost',
    body: 'The link to the relay was cut. The battle cannot go on without it.',
  },
  'peer-left': {
    title: 'Your rival left',
    body: 'The other lord has left the field. The match ends here.',
  },
  desync: {
    title: 'The chronicles diverged',
    body: 'The two games no longer agree on what happened, so the match was stopped.',
  },
};

let root: HTMLElement | null = null;
let card: HTMLElement | null = null;
let shownFor: LostState | null = null;

export function getConnectionLostRoot(): HTMLElement {
  if (!root) {
    card = h('div', {
      class: 'gameover-card parchment',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'connection-lost-title',
      'aria-describedby': 'connection-lost-body',
      tabindex: '-1',
    });
    root = h('div', { id: 'connection-lost', class: 'gameover', hidden: true }, card);
  }
  return root;
}

function isLostState(state: SessionState): state is LostState {
  return state === 'disconnected' || state === 'peer-left' || state === 'desync';
}

function show(state: LostState): void {
  const r = getConnectionLostRoot();
  const copy = COPY[state];
  const back = h('button', { type: 'button', class: 'btn btn-seal btn-lg', id: 'connection-lost-menu' }, icon('quit'), 'Return to Menu');
  back.addEventListener('click', () => {
    hide();
    quitToMenu('multiplayer');
  });
  card!.replaceChildren(
    h('div', { class: 'go-emblem is-defeat', 'aria-hidden': 'true' }, icon(state === 'peer-left' ? 'banners' : 'alert')),
    h('div', { class: 'eyebrow' }, 'Multiplayer'),
    h('h2', { class: 'go-title defeat is-long', id: 'connection-lost-title' }, copy.title),
    h('p', { class: 'go-sub', id: 'connection-lost-body' }, copy.body),
    h('div', { class: 'go-actions' }, back)
  );
  r.hidden = false;
  shownFor = state;
  openLayer({ el: card!, dismissible: false, initialFocus: back });
}

function hide(): void {
  if (!root || shownFor === null) return;
  shownFor = null;
  root.hidden = true;
  if (card) releaseLayer(card);
}

/** Per frame during a multiplayer match: show the screen once the session ends. */
export function updateConnectionLost(): void {
  if (appState.matchKind !== 'multiplayer') return;
  const session = appState.mpSession;
  if (!session || !isLostState(session.state)) return;
  // A decided match keeps its victory / defeat screen; a peer leaving after
  // that is not news.
  if (getScene()?.getOutcome().state === 'victory') return;
  if (shownFor === session.state) return;
  if (shownFor !== null) hide();
  show(session.state);
}

export function resetConnectionLost(): void {
  hide();
}
