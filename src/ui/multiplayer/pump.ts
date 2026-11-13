/**
 * Multiplayer plumbing that lives on the page rather than in the scene: the
 * lockstep pump (worker timer with interval fallback), client diagnostics and
 * the `window.__MP__` debug handle.
 */

import { SIM } from '../../config';
import type { MultiplayerSessionDebugSnapshot } from '../../net/session';
import type { SimInput } from '../../sim/world';
import { appState } from '../app-state';

type MultiplayerDebugApi = {
  snapshot(): MultiplayerSessionDebugSnapshot | null;
  send(input: SimInput): void;
};

export function installMultiplayerDebugApi(): void {
  (window as typeof window & { __MP__?: MultiplayerDebugApi }).__MP__ = {
    snapshot: () => appState.mpSession?.debugSnapshot() ?? null,
    send: (input) => appState.mpSession?.sendCommand(input),
  };
  // eslint-disable-next-line no-console
  console.log('[Kingdoms] window.__MP__ ready. Try: __MP__.snapshot()');
}

export function bindMultiplayerClientDiagnostics(): void {
  const record = (kind: string) => () => {
    appState.mpSession?.recordClientEvent(kind, {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
    });
  };
  window.addEventListener('visibilitychange', record('visibility'));
  window.addEventListener('blur', record('window-blur'));
  window.addEventListener('focus', record('window-focus'));
  window.addEventListener('pagehide', record('pagehide'));
  window.addEventListener('pageshow', record('pageshow'));
}

// Drive lockstep independently of Phaser's render rAF. Browsers may pause rAF
// for hidden/unfocused tabs; lockstep must still emit empty turns or peers wait.
function startIntervalMultiplayerPump(onTick: (deltaMs: number) => void): void {
  let last = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const deltaMs = now - last;
    last = now;
    onTick(deltaMs);
  }, SIM.TICK_MS);
}

export function startMultiplayerPump(): void {
  const onTick = (deltaMs: number) => {
    appState.mpSession?.update(deltaMs);
  };
  let fallbackStarted = false;
  const startFallbackPump = () => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    startIntervalMultiplayerPump(onTick);
  };

  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const workerSource = `
let timer = null;
let last = 0;
self.onmessage = (event) => {
  const intervalMs = Number(event.data && event.data.intervalMs) || 50;
  if (timer !== null) clearInterval(timer);
  last = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    const deltaMs = now - last;
    last = now;
    self.postMessage({ deltaMs });
  }, intervalMs);
};
`;
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      let workerUrlRevoked = false;
      let workerReceivedTick = false;
      const revokeWorkerUrl = () => {
        if (workerUrlRevoked) return;
        workerUrlRevoked = true;
        URL.revokeObjectURL(workerUrl);
      };
      worker.onerror = () => {
        revokeWorkerUrl();
        worker.terminate();
        startFallbackPump();
      };
      worker.onmessage = (event: MessageEvent<{ deltaMs?: number }>) => {
        workerReceivedTick = true;
        revokeWorkerUrl();
        const deltaMs = Number(event.data?.deltaMs);
        onTick(Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : SIM.TICK_MS);
      };
      worker.postMessage({ intervalMs: SIM.TICK_MS });
      window.setTimeout(() => {
        if (workerReceivedTick) return;
        revokeWorkerUrl();
        worker.terminate();
        startFallbackPump();
      }, SIM.TICK_MS * 4);
      return;
    } catch {
      // Fall back to the main-thread timer below.
    }
  }

  startFallbackPump();
}
