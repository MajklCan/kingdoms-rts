/**
 * Multiplayer lobby: name + room (remembered), relay URL under Advanced,
 * connect / leave, a live roster of banner cards and the host's Start button.
 */

import { setLastEvent } from '../../debug/overlay';
import type { PlayerSlot } from '../../net/protocol';
import { MultiplayerSession, type SessionState } from '../../net/session';
import { WebSocketTransport } from '../../net/transport';
import { appState } from '../app-state';
import { h, readStorage, writeStorage } from '../dom';
import { icon } from '../icons/icon';
import { startMultiplayerMatch } from '../match/match-flow';
import { PLAYER_NAME_KEY, storedPlayerName } from './main-menu';
import { backButton, registerMenuScreen } from './menu-shell';

const ROOM_KEY = 'kingdoms.mpRoom';
const RELAY_KEY = 'kingdoms.mpRelay';

/** Default relay URL: localhost in dev, the deployed Coolify relay otherwise.
 *  Players can override it in the lobby. */
export function defaultRelayUrl(): string {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'ws://localhost:8080';
  return 'ws://a8evlomrnvx2no9lztcpflly.176.57.150.247.sslip.io';
}

const STATE_COPY: Record<SessionState, string> = {
  connecting: 'Riding to the relay...',
  lobby: 'In the hall. Waiting for a rival lord.',
  playing: 'The battle has begun.',
  desync: 'Desync detected. The two chronicles diverged.',
  'peer-left': 'Your rival left the match.',
  disconnected: 'Disconnected from the relay.',
};

function field(label: string, input: HTMLInputElement, note?: string): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    input,
    note ? h('span', { class: 'field-note' }, note) : null
  );
}

export function bindMultiplayerLobby(): void {
  const nameInput = h('input', {
    class: 'text-input',
    id: 'mp-name',
    type: 'text',
    maxlength: 20,
    autocomplete: 'off',
    spellcheck: 'false',
    value: storedPlayerName(),
  });
  const roomInput = h('input', {
    class: 'text-input',
    id: 'mp-room',
    type: 'text',
    maxlength: 24,
    autocomplete: 'off',
    spellcheck: 'false',
    value: readStorage(ROOM_KEY) ?? 'bohemia',
  });
  const relayInput = h('input', {
    class: 'text-input',
    id: 'mp-relay',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    value: readStorage(RELAY_KEY) ?? defaultRelayUrl(),
  });
  const connectBtn = h('button', { type: 'submit', class: 'btn btn-seal btn-lg btn-block', id: 'mp-connect' }, icon('banners'), 'Enter the Hall');
  const leaveBtn = h('button', { type: 'button', class: 'btn btn-ink', id: 'mp-leave', hidden: true }, icon('quit'), 'Leave');
  const statusEl = h('p', { class: 'lobby-status', id: 'mp-status', role: 'status', 'aria-live': 'polite' }, 'Not connected.');
  const rosterEl = h('ul', { class: 'roster', id: 'mp-roster', 'aria-label': 'Players in room' });
  const startBtn = h('button', { type: 'button', class: 'btn btn-seal btn-lg btn-block', id: 'mp-start', hidden: true, disabled: true }, icon('swords'), 'Start Match');

  let transport: WebSocketTransport | null = null;
  let isHostNow = false;

  const setStatus = (text: string, tone: 'info' | 'error' = 'info') => {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  };

  const renderRoster = (players: PlayerSlot[], localId: number) => {
    const slots = [1, 2].map((pid) => players.find((p) => p.playerId === pid) ?? null);
    rosterEl.replaceChildren(
      ...slots.map((p, i) =>
        h(
          'li',
          { class: `roster-card team-${i + 1}${p ? '' : ' is-empty'}` },
          h('span', { class: 'banner-flag', 'aria-hidden': 'true' }, icon(p ? 'shield' : 'person')),
          h(
            'span',
            { class: 'banner-text' },
            h('strong', null, p ? p.name : 'Awaiting a rival'),
            h('span', null, p ? `Player ${p.playerId}${p.playerId === localId ? ' (you)' : ''}${p.playerId === 1 ? ' · Host' : ''}` : 'Share the room code')
          )
        )
      )
    );
  };

  const resetIdle = () => {
    connectBtn.disabled = false;
    leaveBtn.hidden = true;
    startBtn.hidden = true;
    nameInput.disabled = false;
    roomInput.disabled = false;
    relayInput.disabled = false;
    // Two open seats keep the hall the same size before and after joining.
    renderRoster([], -1);
  };
  renderRoster([], -1);

  const onState = (state: SessionState) => {
    setStatus(STATE_COPY[state], state === 'desync' || state === 'disconnected' ? 'error' : 'info');
    if (state === 'disconnected' && appState.phase === 'menu') {
      appState.mpSession = null;
      transport = null;
      resetIdle();
    }
  };

  const form = h('form', { class: 'lobby-form', novalidate: true },
    field('Your name', nameInput),
    field('Room code', roomInput, 'Both lords must enter the same code.'),
    h(
      'details',
      { class: 'advanced' },
      h('summary', null, 'Advanced'),
      field('Relay server', relayInput, 'Lockstep 1v1 over a WebSocket relay. Chrome gives the best determinism.')
    ),
    connectBtn
  );

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (appState.mpSession) return;
    const url = relayInput.value.trim();
    const room = (roomInput.value.trim() || 'bohemia').slice(0, 24);
    const name = (nameInput.value.trim() || 'Player').slice(0, 20);
    if (!url) {
      setStatus('Enter a relay server address under Advanced.', 'error');
      return;
    }
    writeStorage(PLAYER_NAME_KEY, name);
    writeStorage(ROOM_KEY, room);
    writeStorage(RELAY_KEY, url);
    connectBtn.disabled = true;
    nameInput.disabled = true;
    roomInput.disabled = true;
    relayInput.disabled = true;
    leaveBtn.hidden = false;
    setStatus(STATE_COPY.connecting);
    renderRoster([], 0);

    transport = new WebSocketTransport(url);
    appState.mpSession = new MultiplayerSession(transport, room, name, {
      onStateChange: onState,
      onRoster: (players, localId, isHost) => {
        isHostNow = isHost;
        renderRoster(players, localId);
        startBtn.hidden = !isHost;
        startBtn.disabled = players.length < 2;
        startBtn.lastChild!.textContent = players.length < 2 ? 'Waiting for opponent' : 'Start Match';
        if (!isHost) setStatus(players.length < 2 ? STATE_COPY.lobby : 'In the hall. The host will start the battle.');
      },
      onMatchStart: (world, localPlayerId) => {
        startMultiplayerMatch(world, localPlayerId);
      },
      onDesync: (tick, local, peer, peerId) => {
        setLastEvent(`DESYNC at tick ${tick}: local ${local.toString(16)} vs P${peerId} ${peer.toString(16)}`);
      },
      onError: (message) => {
        setStatus(`Relay error: ${message}`, 'error');
        appState.mpSession = null;
        transport = null;
        resetIdle();
      },
    });
  });

  leaveBtn.addEventListener('click', () => {
    const t = transport;
    appState.mpSession = null;
    transport = null;
    resetIdle();
    setStatus('You left the hall.');
    t?.close();
  });

  startBtn.addEventListener('click', () => {
    if (!appState.mpSession || !isHostNow) return;
    // Seed agreement: host picks a seed; Date.now is fine here (host-only, not
    // inside the sim) and is broadcast to every client.
    appState.mpSession.start((Date.now() & 0xffff) ^ ((Math.random() * 0x10000) | 0));
    startBtn.disabled = true;
    startBtn.lastChild!.textContent = 'Starting';
  });

  const el = h(
    'section',
    { class: 'menu-sub', 'aria-labelledby': 'mp-title' },
    h(
      'div',
      { class: 'scroll-panel parchment' },
      h(
        'header',
        { class: 'sub-head' },
        backButton(),
        h('div', { class: 'sub-titles' }, h('div', { class: 'eyebrow' }, 'Rival lords'), h('h2', { class: 'title-display', id: 'mp-title' }, 'Multiplayer')),
        h('span', { class: 'sub-head-spacer' })
      ),
      h(
        'div',
        { class: 'lobby-grid' },
        h('div', { class: 'lobby-col' }, form),
        h(
          'div',
          { class: 'lobby-col lobby-hall' },
          h('span', { class: 'field-label' }, 'The hall'),
          statusEl,
          rosterEl,
          h('div', { class: 'lobby-actions' }, startBtn, leaveBtn)
        )
      )
    )
  );

  registerMenuScreen({ id: 'multiplayer', el, focusTarget: () => (nameInput.disabled ? leaveBtn : nameInput) });
}
