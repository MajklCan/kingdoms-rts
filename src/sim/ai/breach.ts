/**
 * Wall breaching: when an AI attack wave cannot path to its target because
 * the enemy walled it in, pick the enemy building to knock down first.
 *
 * Dijkstra over the walkability grid with the same moves EasyStar allows
 * (8 directions, corner cutting). Free tiles cost a step; tiles under a living
 * enemy building cost a step plus a penalty that grows with its hp, so the
 * cheapest route goes through the thinnest, weakest part of the wall; terrain
 * and our own buildings stay impassable. The first enemy building on that
 * route is the breach target. Integer costs, ties broken by tile index:
 * every peer picks the same wall.
 */

import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import { Building, Health, Owner } from '../components';
import { getBuildingDef } from '../defs';
import { sortedEids } from '../core/entities';
import { buildingFootprintRect } from '../core/grid';
import { buildingQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import type { GridPos } from '../pathfinding';

const STRAIGHT_STEP = 10;
const DIAGONAL_STEP = 14;
/** Flat cost of going through a building on top of its hp share. */
const BREACH_BASE_COST = 40;
/** One cost unit per this many hp. */
const BREACH_HP_PER_COST = 10;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, STRAIGHT_STEP],
  [-1, 0, STRAIGHT_STEP],
  [1, 0, STRAIGHT_STEP],
  [0, 1, STRAIGHT_STEP],
  [-1, -1, DIAGONAL_STEP],
  [1, -1, DIAGONAL_STEP],
  [-1, 1, DIAGONAL_STEP],
  [1, 1, DIAGONAL_STEP],
];

/**
 * The enemy building `playerId`'s units standing at `from` should destroy to
 * open a way to `targetEid`, or null when no breach helps (already reachable,
 * or sealed by terrain alone).
 */
export function findAiBreachTarget(
  world: SimWorld,
  playerId: number,
  from: GridPos,
  targetEid: number
): number | null {
  const W = MAP.WIDTH;
  const H = MAP.HEIGHT;
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  if (!hasComponent(world.ecs, Building, targetEid)) return null;
  const targetDef = getBuildingDef(Building.defId[targetEid]);
  if (!targetDef) return null;

  // Tile -> enemy building eid standing on it (-1 = none).
  const buildingAt = new Int32Array(W * H).fill(-1);
  for (const eid of sortedEids(world, buildingQuery(world.ecs))) {
    const owner = Owner.player[eid];
    if (owner === playerId || owner === 0) continue;
    if (!hasComponent(world.ecs, Health, eid) || Health.hp[eid] <= 0) continue;
    const def = getBuildingDef(Building.defId[eid]);
    if (!def) continue;
    const r = buildingFootprintRect(eid, def);
    for (let y = r.tileY0; y <= r.tileY1; y++) {
      for (let x = r.tileX0; x <= r.tileX1; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) buildingAt[y * W + x] = eid;
      }
    }
  }
  const goal = buildingFootprintRect(targetEid, targetDef);
  const isGoal = (x: number, y: number) =>
    x >= goal.tileX0 && x <= goal.tileX1 && y >= goal.tileY0 && y <= goal.tileY1;

  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const heap = new MinHeap();
  const start = sy * W + sx;
  dist[start] = 0;
  heap.push(0, start);
  let reached = -1;
  while (heap.size > 0) {
    const [cost, idx] = heap.pop();
    if (cost !== dist[idx]) continue;
    const x = idx % W;
    const y = (idx - x) / W;
    if (isGoal(x, y)) {
      reached = idx;
      break;
    }
    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      let enter = step;
      if (!isGoal(nx, ny) && world.grid[ny][nx] !== 0) {
        const blocker = buildingAt[n];
        if (blocker < 0) continue; // terrain or our own building
        enter += BREACH_BASE_COST + Math.ceil(Math.max(0, Health.hp[blocker]) / BREACH_HP_PER_COST);
      }
      const next = cost + enter;
      if (dist[n] >= 0 && dist[n] <= next) continue;
      dist[n] = next;
      prev[n] = idx;
      heap.push(next, n);
    }
  }
  if (reached < 0) return null;

  // Walk back to the start; the last enemy building seen is the first on the way.
  let breach: number | null = null;
  for (let idx = prev[reached]; idx >= 0 && idx !== start; idx = prev[idx]) {
    const x = idx % W;
    const y = (idx - x) / W;
    const blocker = buildingAt[idx];
    if (blocker >= 0 && blocker !== targetEid && world.grid[y][x] !== 0) breach = blocker;
  }
  return breach;
}

/** Binary min-heap of (cost, tile) ordered by cost, then tile index. */
class MinHeap {
  private costs: number[] = [];
  private tiles: number[] = [];

  get size(): number {
    return this.costs.length;
  }

  push(cost: number, tile: number): void {
    this.costs.push(cost);
    this.tiles.push(tile);
    let i = this.costs.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.costs[0], this.tiles[0]];
    const lastCost = this.costs.pop()!;
    const lastTile = this.tiles.pop()!;
    if (this.costs.length > 0) {
      this.costs[0] = lastCost;
      this.tiles[0] = lastTile;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.costs.length && this.less(l, m)) m = l;
        if (r < this.costs.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.costs[a] < this.costs[b] || (this.costs[a] === this.costs[b] && this.tiles[a] < this.tiles[b]);
  }

  private swap(a: number, b: number): void {
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
    [this.tiles[a], this.tiles[b]] = [this.tiles[b], this.tiles[a]];
  }
}
