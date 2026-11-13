/**
 * Fair share of a fixed puff pool across chimneys. Without it the pool went to
 * whichever buildings the renderer visited first each frame: in a big town the
 * first houses kept every puff and the rest stood cold. Each chimney that asked
 * for a puff recently counts as active; none may hold more than
 * `capacity / active` live puffs (at least one).
 */

export class SmokeBudget {
  private readonly live = new Map<number, number>();
  private readonly lastAsk = new Map<number, number>();

  constructor(
    private readonly capacity: number,
    /** How long (ms) a chimney stays "active" after its last request. */
    private readonly activeMs: number
  ) {}

  /** May `source` start a puff at `now`? Counts the request either way. */
  tryTake(source: number, now: number): boolean {
    this.lastAsk.set(source, now);
    const share = Math.max(1, Math.floor(this.capacity / this.activeCount(now)));
    const held = this.live.get(source) ?? 0;
    if (held >= share) return false;
    this.live.set(source, held + 1);
    return true;
  }

  /** A puff from `source` ended (or was never placed). */
  release(source: number): void {
    const held = this.live.get(source) ?? 0;
    if (held <= 1) this.live.delete(source);
    else this.live.set(source, held - 1);
  }

  /** Drop chimneys that went quiet and hold nothing. */
  prune(now: number): void {
    for (const [source, at] of this.lastAsk) {
      if (now - at >= this.activeMs && !this.live.has(source)) this.lastAsk.delete(source);
    }
  }

  clear(): void {
    this.live.clear();
    this.lastAsk.clear();
  }

  activeCount(now: number): number {
    let n = 0;
    for (const at of this.lastAsk.values()) if (now - at < this.activeMs) n++;
    return Math.max(1, n);
  }

  held(source: number): number {
    return this.live.get(source) ?? 0;
  }
}
