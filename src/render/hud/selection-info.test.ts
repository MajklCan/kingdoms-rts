import { describe, expect, it } from 'vitest';
import { createSimWorld } from '@sim/world';
import type { SceneContext } from '../scene-context';
import { getStatusInfo, STALL_HINT_DELAY_MS } from './selection-info';

/** Nothing selected; the sim last advanced `ms` ago and lacks `peers`' turns. */
function ctxWaiting(ms: number, peers: number[]): SceneContext {
  const session = { msSinceLastStep: () => ms, waitingForPeers: () => peers };
  return { world: createSimWorld(1), multiplayer: session } as unknown as SceneContext;
}

describe('multiplayer stall status', () => {
  it('stays quiet through the short waits lockstep makes every tick', () => {
    expect(getStatusInfo(ctxWaiting(0, [2])).text).not.toContain('waiting');
    expect(getStatusInfo(ctxWaiting(60, [2])).text).not.toContain('waiting');
    expect(getStatusInfo(ctxWaiting(STALL_HINT_DELAY_MS - 1, [2])).text).not.toContain('waiting');
  });

  it('names the peer once the sim has stood still long enough to feel', () => {
    expect(getStatusInfo(ctxWaiting(STALL_HINT_DELAY_MS, [2])).text).toBe('waiting for P2');
  });

  it('never blames a stall on nobody (only peers count, not ourselves)', () => {
    expect(getStatusInfo(ctxWaiting(5000, [])).text).not.toContain('waiting');
  });
});
