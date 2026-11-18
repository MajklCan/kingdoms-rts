/**
 * Indexed resource and building lookups for a batch of placement queries
 * within one tick.
 *
 * The AI scores thousands of candidate spots per placement attempt (a lumber
 * camp searches a 52-tile radius), and every spot used to scan all resource
 * nodes several times (findResourceAt per footprint tile, findNearestResource
 * for the worksite check and the score) and every building per footprint tile
 * (findBuildingAt). The probes bucket the nodes by tile and mark the tiles
 * buildings stand on once, then answer the same questions with the same math,
 * so the results are identical to the plain lookups. Only valid while
 * resources and buildings do not change, so build a fresh one per batch.
 */

import { dhypot } from './dmath';
import { Building, Position, Resource, type ResourceKind } from '../components';
import { BUILDING_TABLE } from '../defs';
import { distToBuildingEdge } from './grid';
import { buildingQuery, resourceQuery } from './queries';
import type { SimWorld } from './types';

/** Per-tile linked lists of eids (head per cell, next per entry). */
class TileBuckets {
  readonly head: Int32Array;
  readonly next: number[] = [];
  readonly eids: number[] = [];
  /** Nodes whose position rounds off the map: always checked. */
  readonly outside: number[] = [];

  constructor(readonly width: number, readonly height: number) {
    this.head = new Int32Array(width * height).fill(-1);
  }

  add(eid: number): void {
    const tx = Math.round(Position.x[eid]);
    const ty = Math.round(Position.y[eid]);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
      this.outside.push(eid);
      return;
    }
    const cell = ty * this.width + tx;
    this.eids.push(eid);
    this.next.push(this.head[cell]);
    this.head[cell] = this.eids.length - 1;
  }
}

export class ResourceProbe {
  private readonly all: TileBuckets;
  /** Kind -> nodes with amount left. */
  private readonly byKind = new Map<number, TileBuckets>();

  constructor(world: SimWorld) {
    this.all = new TileBuckets(world.map.width, world.map.height);
    for (const eid of resourceQuery(world.ecs)) {
      this.all.add(eid);
      if (Resource.amount[eid] <= 0) continue;
      const kind = Resource.kind[eid];
      let buckets = this.byKind.get(kind);
      if (!buckets) {
        buckets = new TileBuckets(world.map.width, world.map.height);
        this.byKind.set(kind, buckets);
      }
      buckets.add(eid);
    }
  }

  /** Same as `findResourceAt(world, x, y, radius) !== null`. */
  hasResourceAt(x: number, y: number, radius: number): boolean {
    const b = this.all;
    for (const eid of b.outside) {
      if (dhypot(Position.x[eid] - x, Position.y[eid] - y) < radius) return true;
    }
    // A node closer than `radius` rounds to a tile at most ceil(radius) + 1 away.
    const reach = Math.ceil(radius) + 1;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let ty = Math.max(0, cy - reach); ty <= Math.min(b.height - 1, cy + reach); ty++) {
      for (let tx = Math.max(0, cx - reach); tx <= Math.min(b.width - 1, cx + reach); tx++) {
        for (let i = b.head[ty * b.width + tx]; i >= 0; i = b.next[i]) {
          const eid = b.eids[i];
          if (dhypot(Position.x[eid] - x, Position.y[eid] - y) < radius) return true;
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
      const d = dhypot(Position.x[eid] - x, Position.y[eid] - y);
      if (d < best) {
        best = d;
        found = true;
      }
    };
    for (const eid of b.outside) consider(eid);
    const cx = Math.round(x);
    const cy = Math.round(y);
    const cell = (tx: number, ty: number): void => {
      if (tx < 0 || ty < 0 || tx >= b.width || ty >= b.height) return;
      for (let i = b.head[ty * b.width + tx]; i >= 0; i = b.next[i]) consider(b.eids[i]);
    };
    const maxRing = Math.max(b.width, b.height) + Math.abs(cx) + Math.abs(cy);
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

/**
 * A {@link ResourceProbe} that also knows which tiles a building stands on.
 * `hasBuildingAt` answers `findBuildingAt(world, tx, ty, 0.01) !== null` for
 * an integer tile: that is true exactly when the tile lies in some building's
 * footprint (distance 0; a tile outside one is at least 0.5 from its edge).
 * Same lifetime rule: build a fresh one per batch.
 */
export class PlacementProbe extends ResourceProbe {
  private readonly covered: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  /** Checked the slow way: buildings without a def (measured from their
   *  position) and footprints reaching off the map. */
  private readonly unindexed: number[] = [];

  constructor(private readonly world: SimWorld) {
    super(world);
    this.width = world.map.width;
    this.height = world.map.height;
    this.covered = new Uint8Array(this.width * this.height);
    for (const eid of buildingQuery(world.ecs)) {
      const def = BUILDING_TABLE[Building.defId[eid]];
      if (!def) {
        this.unindexed.push(eid);
        continue;
      }
      // The tiles distToBuildingEdge measures 0 for: its rectangle's integer points.
      const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
      const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
      if (x0 < 0 || y0 < 0 || x0 + def.footprint.w > this.width || y0 + def.footprint.h > this.height) {
        this.unindexed.push(eid);
      }
      for (let ty = Math.max(0, y0); ty <= Math.min(this.height - 1, y0 + def.footprint.h - 1); ty++) {
        for (let tx = Math.max(0, x0); tx <= Math.min(this.width - 1, x0 + def.footprint.w - 1); tx++) {
          this.covered[ty * this.width + tx] = 1;
        }
      }
    }
  }

  /** Same as `findBuildingAt(world, tx, ty, 0.01) !== null` for integer `tx`, `ty`. */
  hasBuildingAt(tx: number, ty: number): boolean {
    if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && this.covered[ty * this.width + tx] === 1) {
      return true;
    }
    for (const eid of this.unindexed) {
      if (distToBuildingEdge(this.world, tx, ty, eid) < 0.01) return true;
    }
    return false;
  }
}
