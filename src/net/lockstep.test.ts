import { describe, expect, it } from 'vitest';
import { Lockstep, type ReadyTick } from './lockstep';
import type { SimInput } from '@sim/world';

/** Drive two lockstep peers through `iterations` synchronized loop steps with a
 *  perfect (zero-loss, in-order) link. Returns each peer's executed tick log. */
function runPair(
  iterations: number,
  inject: (iter: number, a: Lockstep, b: Lockstep) => void,
  inputDelay = 3
): { a: ReadyTick[]; b: ReadyTick[] } {
  const a = new Lockstep(1, [2], inputDelay);
  const b = new Lockstep(2, [1], inputDelay);
  const logA: ReadyTick[] = [];
  const logB: ReadyTick[] = [];

  for (let i = 0; i < iterations; i++) {
    inject(i, a, b);
    const pa = a.nextSendPacket();
    const pb = b.nextSendPacket();
    // deliver across the link
    b.receivePeerTurn(1, pa.forTick, pa.cmds);
    a.receivePeerTurn(2, pb.forTick, pb.cmds);
    logA.push(...a.drainReadyTicks());
    logB.push(...b.drainReadyTicks());
  }
  return { a: logA, b: logB };
}

const stop = (playerId: number): SimInput => ({ type: 'cmdStop', playerId, eids: [playerId] });

describe('lockstep scheduler', () => {
  it('both peers execute the identical input sequence per tick', () => {
    const { a, b } = runPair(40, (iter, la, lb) => {
      if (iter === 5) la.enqueueLocal(stop(1));
      if (iter === 12) lb.enqueueLocal(stop(2));
      if (iter === 12) la.enqueueLocal(stop(1)); // same iteration, both players
    });

    expect(a.map((t) => t.tick)).toEqual(b.map((t) => t.tick));
    for (let i = 0; i < a.length; i++) {
      expect(a[i].inputs).toEqual(b[i].inputs);
    }
  });

  it('executes warm-up ticks plus the first (zero-latency) sent tick', () => {
    const a = new Lockstep(1, [2], 3);
    const b = new Lockstep(2, [1], 3);
    // First iteration: warm-up ticks 0,1,2 are ready, and the first packet
    // targets tick 3 — delivered with zero latency here, so tick 3 too.
    const pa = a.nextSendPacket();
    const pb = b.nextSendPacket();
    b.receivePeerTurn(1, pa.forTick, pa.cmds);
    a.receivePeerTurn(2, pb.forTick, pb.cmds);
    const ready = a.drainReadyTicks();
    expect(ready.map((t) => t.tick)).toEqual([0, 1, 2, 3]);
    expect(ready.every((t) => t.inputs.length === 0)).toBe(true);
  });

  it('a command applies on the same tick for both peers', () => {
    const { a, b } = runPair(30, (iter, la) => {
      if (iter === 7) la.enqueueLocal(stop(1));
    });
    const tickWithCmdA = a.find((t) => t.inputs.length > 0)?.tick;
    const tickWithCmdB = b.find((t) => t.inputs.length > 0)?.tick;
    expect(tickWithCmdA).toBeDefined();
    expect(tickWithCmdA).toBe(tickWithCmdB);
  });

  it('stalls (no execution) when a peer packet is missing, then resumes', () => {
    const a = new Lockstep(1, [2], 2);
    const b = new Lockstep(2, [1], 2);

    // Run a few clean iterations.
    for (let i = 0; i < 5; i++) {
      const pa = a.nextSendPacket();
      const pb = b.nextSendPacket();
      b.receivePeerTurn(1, pa.forTick, pa.cmds);
      a.receivePeerTurn(2, pb.forTick, pb.cmds);
      a.drainReadyTicks();
      b.drainReadyTicks();
    }

    // Now A keeps sending but B's packets are dropped for 3 iterations.
    const dropped: Array<{ forTick: number; cmds: SimInput[] }> = [];
    for (let i = 0; i < 3; i++) {
      const pa = a.nextSendPacket();
      const pb = b.nextSendPacket();
      b.receivePeerTurn(1, pa.forTick, pa.cmds);
      dropped.push(pb); // withhold from A
    }
    const beforeExec = a.currentExecTick;
    expect(a.drainReadyTicks()).toEqual([]); // stalled — no B packets
    expect(a.isStalled()).toBe(true);
    expect(a.currentExecTick).toBe(beforeExec);

    // Deliver the withheld packets — A catches up over the 3 stalled ticks.
    for (const p of dropped) a.receivePeerTurn(2, p.forTick, p.cmds);
    const caughtUp = a.drainReadyTicks();
    expect(caughtUp.length).toBe(3);
    expect(a.currentExecTick).toBe(beforeExec + 3);
  });
});
