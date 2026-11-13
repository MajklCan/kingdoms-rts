/** Multiplayer lobby: relay connect, roster, host start. */

import { setLastEvent } from '../../debug/overlay';
import type { PlayerSlot } from '../../net/protocol';
import { MultiplayerSession, type SessionState } from '../../net/session';
import { WebSocketTransport } from '../../net/transport';
import { appState } from '../app-state';
import { updateCheatButtonsDisabled } from '../dev/cheats';
import { byId, escapeHtml } from '../dom';
import { getScene } from '../game-bridge';
import { hideTitleScreen } from './main-menu';

/** Default relay URL: localhost in dev, the deployed Coolify relay otherwise.
 *  Players can override it in the lobby. */
export function defaultRelayUrl(): string {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'ws://localhost:8080';
  return 'ws://a8evlomrnvx2no9lztcpflly.176.57.150.247.sslip.io';
}

export function bindMultiplayerLobby(): void {
  const relayInput = byId<HTMLInputElement>('mp-relay');
  const nameInput = byId<HTMLInputElement>('mp-name');
  const roomInput = byId<HTMLInputElement>('mp-room');
  const connectBtn = byId<HTMLButtonElement>('mp-connect');
  const lobby = byId('mp-lobby');
  const statusEl = byId('mp-status');
  const rosterEl = byId('mp-roster');
  const startBtn = byId<HTMLButtonElement>('mp-start');
  if (!relayInput || !connectBtn || !lobby || !statusEl || !rosterEl || !startBtn) return;

  if (!relayInput.value) relayInput.value = defaultRelayUrl();

  const setStatus = (text: string) => {
    statusEl.textContent = text;
  };

  const renderRoster = (players: PlayerSlot[], localId: number) => {
    rosterEl.innerHTML = players
      .map(
        (p) =>
          `<li class="mission-card" style="cursor:default">
             <span><strong>${escapeHtml(p.name)}</strong>
             <span class="mission-desc">Player ${p.playerId}${p.playerId === localId ? ' (you)' : ''}</span></span>
           </li>`
      )
      .join('');
  };

  const onState = (state: SessionState) => {
    if (state === 'lobby') setStatus('In lobby - waiting for players.');
    else if (state === 'playing') {
      setStatus('Match started.');
      startBtn.disabled = false;
      startBtn.textContent = 'Start Match';
    } else if (state === 'peer-left') setStatus('A player left the match.');
    else if (state === 'desync') setStatus('Desync detected - the match state diverged.');
    else if (state === 'disconnected') setStatus('Disconnected from relay.');
    updateCheatButtonsDisabled();
  };

  connectBtn.addEventListener('click', () => {
    const url = relayInput.value.trim();
    const room = (roomInput?.value.trim() || 'bohemia').slice(0, 24);
    const name = (nameInput?.value.trim() || 'Player').slice(0, 20);
    if (!url) {
      setStatus('Enter a relay URL.');
      return;
    }
    connectBtn.disabled = true;
    lobby.classList.remove('hidden');
    setStatus('Connecting…');
    updateCheatButtonsDisabled();

    const transport = new WebSocketTransport(url);
    appState.mpSession = new MultiplayerSession(transport, room, name, {
      onStateChange: onState,
      onRoster: (players, localId, isHost) => {
        renderRoster(players, localId);
        startBtn.classList.toggle('hidden', !isHost);
        startBtn.disabled = players.length < 2;
        startBtn.textContent = players.length < 2 ? 'Waiting for opponent…' : 'Start Match';
      },
      onMatchStart: (world, localPlayerId) => {
        const scene = getScene();
        if (scene) scene.beginMultiplayerMatch(appState.mpSession!, world, localPlayerId);
        hideTitleScreen();
        updateCheatButtonsDisabled();
      },
      onDesync: (tick, local, peer, peerId) => {
        setLastEvent(`DESYNC at tick ${tick}: local ${local.toString(16)} vs P${peerId} ${peer.toString(16)}`);
      },
      onError: (message) => {
        setStatus(`Relay error: ${message}`);
        connectBtn.disabled = false;
        startBtn.disabled = false;
        startBtn.textContent = 'Start Match';
        appState.mpSession = null;
        updateCheatButtonsDisabled();
      },
    });
  });

  startBtn.addEventListener('click', () => {
    if (!appState.mpSession) return;
    // Seed agreement: host picks a seed; Date.now is fine here (host-only, not
    // inside the sim) and is broadcast to every client.
    appState.mpSession.start((Date.now() & 0xffff) ^ ((Math.random() * 0x10000) | 0));
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';
  });
}
