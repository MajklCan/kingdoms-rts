/**
 * Pathfinding service. Wraps EasyStar.js with a synchronous interface — we ask for
 * a path and pump EasyStar's `calculate()` until a callback fires, then return.
 * For Stage 0 this is fine; if it ever becomes a perf issue, switch to async with
 * per-tick budget.
 *
 * The path is a list of {x, y} tile coords from start (exclusive) to end (inclusive).
 */

import EasyStar from 'easystarjs';

export interface GridPos {
  x: number;
  y: number;
}

export class Pathfinder {
  private easy: any;
  /** Live reference to the walkability grid — mutating cells here updates
   *  EasyStar's internal grid because we passed the same array reference. */
  public grid: number[][];
  private gridW: number;
  private gridH: number;

  constructor(grid: number[][]) {
    this.grid = grid;
    this.gridH = grid.length;
    this.gridW = grid[0]?.length ?? 0;
    this.easy = new EasyStar.js();
    this.easy.setGrid(grid);
    this.easy.setAcceptableTiles([0]); // 0 = walkable, 1+ = blocked
    this.easy.enableDiagonals();
    this.easy.enableCornerCutting(); // straighter paths around obstacles
    this.easy.enableSync();
  }

  /** Find a path. If the destination is blocked, automatically resolves to the
   *  nearest walkable neighbour. Returns array of waypoints (excluding start)
   *  with redundant intermediate steps smoothed away. */
  findPath(from: GridPos, to: GridPos): GridPos[] | null {
    if (!this.inBounds(to.x, to.y) || !this.inBounds(from.x, from.y)) return null;
    if (from.x === to.x && from.y === to.y) return [];

    // If destination is blocked, find a walkable adjacent tile to aim at.
    let dest = to;
    if (this.isBlocked(to.x, to.y)) {
      const fallback = this.nearestWalkable(to.x, to.y, 6);
      if (!fallback) return null;
      dest = fallback;
    }

    let result: GridPos[] | null = null;
    this.easy.findPath(from.x, from.y, dest.x, dest.y, (path: GridPos[] | null) => {
      result = path;
    });
    this.easy.calculate();
    if (!result) return null;

    const raw = (result as GridPos[]).slice(1);
    if (raw.length === 0) return [];
    // Line-of-sight smoothing — collapse runs of waypoints whose endpoints
    // see each other into a single step. Eliminates the visible NE/N/NE/N
    // zigzag and lets units take direct diagonals across open ground.
    return this.smoothPath(from, raw);
  }

  /** Whether (x, y) is currently blocked in the grid. */
  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.grid[y][x] !== 0;
  }

  /** Search outward from (x, y) for the nearest walkable tile, up to maxR. */
  nearestWalkable(x: number, y: number, maxR: number): GridPos | null {
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (this.inBounds(nx, ny) && this.grid[ny][nx] === 0) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return null;
  }

  /** Bresenham-style line walk; returns true if every cell between a→b is walkable. */
  private hasLineOfSight(a: GridPos, b: GridPos): boolean {
    let x0 = a.x, y0 = a.y;
    const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let guard = 0;
    while (guard++ < 200) {
      if (this.isBlocked(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx)  { err += dx; y0 += sy; }
    }
    return false;
  }

  /** Greedy line-of-sight smoothing: skip ahead to the furthest visible
   *  waypoint, repeat. Result is the same path but with redundant corners
   *  collapsed. */
  private smoothPath(from: GridPos, path: GridPos[]): GridPos[] {
    if (path.length <= 1) return path;
    const out: GridPos[] = [];
    let current = from;
    let i = 0;
    while (i < path.length) {
      // Find the furthest path[j] still visible from `current`.
      let j = path.length - 1;
      while (j > i) {
        if (this.hasLineOfSight(current, path[j])) break;
        j--;
      }
      out.push(path[j]);
      current = path[j];
      i = j + 1;
    }
    return out;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.gridW && y < this.gridH;
  }
}
