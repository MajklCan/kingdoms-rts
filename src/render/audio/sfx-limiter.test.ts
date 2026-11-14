import { describe, expect, it } from 'vitest';
import { SfxLimiter, type VoiceRequest } from './sfx-limiter';

const req = (over: Partial<VoiceRequest> = {}): VoiceRequest => ({
  key: 'sword_clash',
  bus: 'sfx',
  priority: 2,
  maxVoices: 3,
  cooldown: 0,
  gain: 0.5,
  ...over,
});

let nextId = 1;
function start(lim: SfxLimiter, now: number, r: VoiceRequest, len = 0.8): number {
  const a = lim.admit(now, r);
  if (!a.ok) throw new Error(`dropped: ${a.reason}`);
  for (const id of a.steal) lim.release(id);
  const id = nextId++;
  lim.commit({ id, key: r.key, bus: r.bus, priority: r.priority, gain: r.gain * a.gainScale, startedAt: now, endsAt: now + len });
  return id;
}

describe('SfxLimiter', () => {
  it('enforces the per-key cooldown', () => {
    const lim = new SfxLimiter({});
    start(lim, 0, req({ cooldown: 0.08 }));
    expect(lim.admit(0.05, req({ cooldown: 0.08 }))).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(lim.admit(0.09, req({ cooldown: 0.08 })).ok).toBe(true);
  });

  it('never holds more than maxVoices copies of one key', () => {
    const lim = new SfxLimiter({});
    // 20 units swing in the same 100 ms.
    let max = 0;
    for (let i = 0; i < 20; i++) {
      const now = i * 0.005;
      const a = lim.admit(now, req({ gain: 0.5 }));
      if (a.ok) {
        for (const id of a.steal) lim.release(id);
        lim.commit({ id: nextId++, key: 'sword_clash', bus: 'sfx', priority: 2, gain: 0.5 * a.gainScale, startedAt: now, endsAt: now + 0.8 });
      }
      max = Math.max(max, lim.active(now).filter((v) => v.key === 'sword_clash').length);
    }
    expect(max).toBeLessThanOrEqual(3);
  });

  it('steals the weakest copy for a louder sound and drops a quieter one', () => {
    const lim = new SfxLimiter({});
    const quiet = start(lim, 0, req({ gain: 0.1 }));
    start(lim, 0, req({ gain: 0.6 }));
    start(lim, 0, req({ gain: 0.6 }));
    const loud = lim.admit(0.01, req({ gain: 0.9 }));
    expect(loud.ok).toBe(true);
    expect(loud.steal).toEqual([quiet]);
    expect(lim.admit(0.01, req({ gain: 0.05 }))).toMatchObject({ ok: false, reason: 'key-cap' });
  });

  it('scales a new copy down by the copies still sounding', () => {
    const lim = new SfxLimiter({});
    expect(lim.admit(0, req()).gainScale).toBe(1);
    start(lim, 0, req());
    // One full copy still sounding: 1 / sqrt(2).
    expect(lim.admit(0, req()).gainScale).toBeCloseTo(Math.SQRT1_2, 5);
    // Halfway through, it counts half.
    expect(lim.admit(0.4, req()).gainScale).toBeCloseTo(1 / Math.sqrt(1.5), 5);
    // Ended copies do not count at all.
    expect(lim.admit(0.9, req()).gainScale).toBe(1);
  });

  it('lets a higher priority sound steal from a full bus, never a lower one', () => {
    const lim = new SfxLimiter({ sfx: 2 });
    start(lim, 0, req({ key: 'chop_wood', priority: 1 }));
    start(lim, 0, req({ key: 'mine_stone', priority: 1 }));
    const boom = lim.admit(0.01, req({ key: 'explosion', priority: 3 }));
    expect(boom.ok).toBe(true);
    expect(boom.steal).toHaveLength(1);
    const lim2 = new SfxLimiter({ sfx: 2 });
    start(lim2, 0, req({ key: 'explosion', priority: 3 }));
    start(lim2, 0, req({ key: 'cannon_fire', priority: 3 }));
    expect(lim2.admit(0.01, req({ key: 'chop_wood', priority: 1 }))).toMatchObject({ ok: false, reason: 'bus-cap' });
  });

  it('forgets voices once they end and on clearBus', () => {
    const lim = new SfxLimiter({ ui: 1 });
    start(lim, 0, req({ bus: 'ui', key: 'ui_click' }), 0.2);
    expect(lim.active(0.1)).toHaveLength(1);
    expect(lim.active(0.3)).toHaveLength(0);
    start(lim, 1, req({ bus: 'ui', key: 'ui_click' }), 0.2);
    lim.clearBus('ui');
    expect(lim.active(1.05)).toHaveLength(0);
  });
});
