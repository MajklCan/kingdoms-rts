/**
 * Indexed resource lookups for a batch of placement queries within one tick.
 *
 * The AI scores thousands of candidate spots per placement attempt (a lumber
 * camp searches a 52-tile radius), and every spot used to scan all resource
 * nodes several times (findResourceAt per footprint tile, findNearestResource
 * for the worksite check and the score). The probe buckets the nodes by tile
 * once and answers the same questions with the same math, so the results are
 * identical to the plain lookups. Only valid while resources do not change,
 * so build a fresh one per batch.
 */

import { MAP } from '../../config';
import { Position, Resource, type ResourceKind } from '../components';
import { resourceQuery } from './queries';
import type { SimWorld } from './types';

const CELLS = MAP.WIDTH * MAP.HEIGHT;

/** Per-tile linked lists of eids (head per cell, next per entry). */
class TileBuckets {
  readonly head = new Int32Array(CELLS).fill(-1);
  readonly next: number[] = [];
  readonly eids: number[] = [];
  /** Nodes whose position rounds off the map: always checked. */
  readonly outside: number[] = [];

  add(eid: number): void {
    const tx = Math.round(Position.x[eid]);
    const ty = Math.round(Position.y[eid]);
    if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) {
      this.outside.push(eid);
      return;
    }
    const cell = ty * MAP.WIDTH + tx;
    this.eids.push(eid);
    this.next.push(this.head[cell]);
    this.head[cell] = this.eids.length - 1;
  }
}

export class ResourceProbe {
  private readonly all = new TileBuckets();
  /** Kind -> nodes with amount left. */
  private readonly byKind = new Map<number, TileBuckets>();

  constructor(world: SimWorld) {
    for (const eid of resourceQuery(world.ecs)) {
      this.all.add(eid);
      if (Resource.amount[eid] <= 0) continue;
      const kind = Resource.kind[eid];
      let buckets = this.byKind.get(kind);
      if (!buckets) {
        buckets = new TileBuckets();
        this.byKind.set(kind, buckets);
      }
      buckets.add(eid);
    }
  }

  /** Same as `findResourceAt(world, x, y, radius) !== null`. */
  hasResourceAt(x: number, y: number, radius: number): boolean {
    const b = this.all;
    for (const eid of b.outside) {
      if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) < radius) return true;
    }
    // A node closer than `radius` rounds to a tile at most ceil(radius) + 1 away.
    const reach = Math.ceil(radius) + 1;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let ty = Math.max(0, cy - reach); ty <= Math.min(MAP.HEIGHT - 1, cy + reach); ty++) {
      for (let tx = Math.max(0, cx - reach); tx <= Math.min(MAP.WIDTH - 1, cx + reach); tx++) {
        for (let i = b.head[ty * MAP.WIDTH + tx]; i >= 0; i = b.next[i]) {
          const eid = b.eids[i];
          if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) < radius) return true;
        }
      }
    }
    return false;
  }

  /**
   * Distance to the nearest node of `kind` with amount left that is closer
   * than `maxRange`, or null: the distance `findNearestResource` would pick.
   * Walks tile rings outward; a node rounding to ring k is at least k - 1
   * away, so the walk stops once that bound reaches the best distance.
   */
  nearestDistance(x: number, y: number, kind: ResourceKind, maxRange: number): number | null {
    const b = this.byKind.get(kind);
    if (!b) return null;
    let best = maxRange;
    let found = false;
    const consider = (eid: number): void => {
      const d = Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
      if (d < best) {
        best = d;
        found = true;
      }
    };
    for (const eid of b.outside) consider(eid);
    const cx = Math.round(x);
    const cy = Math.round(y);
    const cell = (tx: number, ty: number): void => {
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return;
      for (let i = b.head[ty * MAP.WIDTH + tx]; i >= 0; i = b.next[i]) consider(b.eids[i]);
    };
    const maxRing = Math.max(MAP.WIDTH, MAP.HEIGHT) + Math.abs(cx) + Math.abs(cy);
    for (let k = 0; k <= maxRing && k - 1 < best; k++) {
      if (k === 0) {
        cell(cx, cy);
        continue;
      }
      for (let dx = -k; dx <= k; dx++) {
        cell(cx + dx, cy - k);
        cell(cx + dx, cy + k);
      }
      for (let dy = -k + 1; dy <= k - 1; dy++) {
        cell(cx - k, cy + dy);
        cell(cx + k, cy + dy);
      }
    }
    return found ? best : null;
  }
}
