// Dev-only `window.__AUDIO__`: a read-only snapshot of the mix for agents and
// humans who cannot listen. Active voices per bus and key, bus levels + ducks,
// master meters, the music program with each deck's gain, crossfade history,
// the director's mood + intensity, and the last plays with their verdicts.

import type { AudioManager } from './audio-manager';

export interface WindowAudioApi {
  snapshot(): Record<string, unknown>;
  resetStats(): void;
}

declare global {
  interface Window {
    __AUDIO__?: WindowAudioApi;
  }
}

export function installAudioDebug(manager: AudioManager, game: () => Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.__AUDIO__ = {
    snapshot: () => ({ game: game(), ...(manager.debugSnapshot() ?? { engine: 'unavailable' }) }),
    resetStats: () => manager.debugResetStats(),
  };
}
