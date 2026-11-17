/**
 * Shift-placement bookkeeping: the buildings placed in a row during one build
 * mode, and which of them the sim has not applied yet.
 *
 * A placement leaves as an input and lands a tick (single-player) or the
 * lockstep input delay (multiplayer) later, so right after a Shift+click the
 * bank and the map still look as they did before it. The chain remembers
 * those placements until their foundation shows up, so the next one is
 * judged against what will be left: bank, house allowance and free tiles.
 *
 * Render-side only; nothing here writes to the sim.
 */

export interface PendingPlacement {
  defId: number;
  /** Anchor tile, as sent in the placeBuilding input. */
  x: number;
  y: number;
  footprint: { w: number; h: number };
  /** world.tick when the input left. */
  tick: number;
}

/** A placement the sim never answered (refused it) stops counting after this many ticks. */
export const PENDING_PLACEMENT_TICKS = 30;

export class PlacementChain {
  private pending: PendingPlacement[] = [];
  /** Buildings Shift-placed since the build mode was armed. */
  placed = 0;

  add(placement: PendingPlacement): void {
    this.pending.push(placement);
    this.placed++;
  }

  /**
   * Forget placements the sim has dealt with: the foundation stands
   * (`isBuilt`), or the input is old enough that it must have been refused.
   */
  settle(tick: number, isBuilt: (placement: PendingPlacement) => boolean): void {
    if (this.pending.length === 0) return;
    this.pending = this.pending.filter(
      (p) => tick - p.tick <= PENDING_PLACEMENT_TICKS && tick >= p.tick && !isBuilt(p)
    );
  }

  /** Placements of `defId` still on their way to the sim. */
  pendingCount(defId: number): number {
    let n = 0;
    for (const p of this.pending) if (p.defId === defId) n++;
    return n;
  }

  /** Would a `footprint` building anchored at (x, y) share a tile with one on its way? */
  overlaps(footprint: { w: number; h: number }, x: number, y: number): boolean {
    const a = footprintRect(footprint, x, y);
    for (const p of this.pending) {
      const b = footprintRect(p.footprint, p.x, p.y);
      if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) return true;
    }
    return false;
  }

  reset(): void {
    this.pending = [];
    this.placed = 0;
  }
}

/** Occupied tiles (inclusive), anchored like the sim grid: round(x) - floor(w / 2). */
function footprintRect(footprint: { w: number; h: number }, x: number, y: number) {
  const x0 = Math.round(x) - Math.floor(footprint.w / 2);
  const y0 = Math.round(y) - Math.floor(footprint.h / 2);
  return { x0, y0, x1: x0 + footprint.w - 1, y1: y0 + footprint.h - 1 };
}
