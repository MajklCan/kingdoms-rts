/**
 * Desync detection bookkeeping: pairs the local state checksum for a tick with
 * every peer's checksum for the same tick. Either side may arrive first; each
 * (tick, peer) pair is compared exactly once. Pure, no I/O.
 */

export interface ChecksumComparison {
  tick: number;
  peerId: number;
  localHash: number;
  peerHash: number;
  match: boolean;
}

/** Entries older than this many ticks behind the newest local checksum are
 *  dropped; a peer that far behind shows up in the stall diagnostics instead. */
const RETAIN_TICKS = 20 * 60;

export class ChecksumLedger {
  private readonly local = new Map<number, number>();
  /** tick -> peerId -> hash, for peer checksums that arrived before ours. */
  private readonly pendingPeer = new Map<number, Map<number, number>>();
  private newestLocalTick = -Infinity;

  /** Record our checksum for `tick`; returns the comparisons against peers
   *  that already reported this tick (ascending peerId). */
  recordLocal(tick: number, hash: number): ChecksumComparison[] {
    this.local.set(tick, hash);
    this.newestLocalTick = Math.max(this.newestLocalTick, tick);
    const out: ChecksumComparison[] = [];
    const pending = this.pendingPeer.get(tick);
    if (pending) {
      this.pendingPeer.delete(tick);
      for (const peerId of [...pending.keys()].sort((a, b) => a - b)) {
        out.push(compare(tick, peerId, hash, pending.get(peerId)!));
      }
    }
    this.prune();
    return out;
  }

  /** Record a peer checksum; returns the comparison once ours is known. */
  recordPeer(peerId: number, tick: number, hash: number): ChecksumComparison | null {
    const local = this.local.get(tick);
    if (local !== undefined) return compare(tick, peerId, local, hash);
    let pending = this.pendingPeer.get(tick);
    if (!pending) {
      pending = new Map();
      this.pendingPeer.set(tick, pending);
    }
    pending.set(peerId, hash);
    return null;
  }

  pendingPeerChecksums(): Array<{ tick: number; peerId: number; hash: number }> {
    const out: Array<{ tick: number; peerId: number; hash: number }> = [];
    for (const [tick, byPeer] of this.pendingPeer) {
      for (const [peerId, hash] of byPeer) out.push({ tick, peerId, hash });
    }
    return out;
  }

  clear(): void {
    this.local.clear();
    this.pendingPeer.clear();
    this.newestLocalTick = -Infinity;
  }

  private prune(): void {
    const floor = this.newestLocalTick - RETAIN_TICKS;
    for (const tick of this.local.keys()) if (tick < floor) this.local.delete(tick);
    for (const tick of this.pendingPeer.keys()) if (tick < floor) this.pendingPeer.delete(tick);
  }
}

function compare(tick: number, peerId: number, localHash: number, peerHash: number): ChecksumComparison {
  return { tick, peerId, localHash, peerHash, match: localHash === peerHash };
}
