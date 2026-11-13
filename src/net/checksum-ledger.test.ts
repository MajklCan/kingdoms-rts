import { describe, expect, it } from 'vitest';
import { ChecksumLedger } from './checksum-ledger';

describe('ChecksumLedger', () => {
  it('compares each (tick, peer) once, whichever side arrives first', () => {
    const ledger = new ChecksumLedger();
    expect(ledger.recordPeer(2, 20, 111)).toBeNull();
    expect(ledger.recordLocal(20, 111)).toEqual([{ tick: 20, peerId: 2, localHash: 111, peerHash: 111, match: true }]);
    expect(ledger.recordLocal(40, 222)).toEqual([]);
    expect(ledger.recordPeer(2, 40, 999)).toEqual({ tick: 40, peerId: 2, localHash: 222, peerHash: 999, match: false });
    expect(ledger.pendingPeerChecksums()).toEqual([]);
  });

  it('checks every peer for the same tick, not only the first to report', () => {
    const ledger = new ChecksumLedger();
    ledger.recordLocal(20, 111);
    expect(ledger.recordPeer(2, 20, 111)?.match).toBe(true);
    expect(ledger.recordPeer(3, 20, 333)?.match).toBe(false);

    ledger.recordPeer(3, 40, 1);
    ledger.recordPeer(2, 40, 2);
    expect(ledger.recordLocal(40, 2).map((c) => [c.peerId, c.match])).toEqual([
      [2, true],
      [3, false],
    ]);
  });

  it('forgets ticks far behind the newest local checksum', () => {
    const ledger = new ChecksumLedger();
    ledger.recordPeer(2, 20, 1);
    ledger.recordLocal(20, 1);
    ledger.recordPeer(2, 40, 5);
    ledger.recordLocal(20 + 20 * 60 * 2, 7);
    expect(ledger.pendingPeerChecksums()).toEqual([]);
    expect(ledger.recordPeer(2, 20, 1)).toBeNull();
  });
});
