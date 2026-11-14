/**
 * Render-side tile occupancy: which tiles are covered by a building footprint
 * (live, any owner) or hold a resource node. Rebuilt at most once per sim
 * tick. Used to keep render-only decor and stumps off occupied tiles; it is a
 * read of sim state and never feeds back into it.
 */

import { Building, Position } from '@sim/components';
import { BUILDING_TABLE } from '@sim/defs';
import { buildingQuery, resourceQuery } from '@sim/world';
import { MAP } from '../../config';
import type { SceneContext } from '../scene-context';

export class Occupancy {
  private readonly buildings = new Uint8Array(MAP.WIDTH * MAP.HEIGHT);
  private readonly resources = new Uint8Array(MAP.WIDTH * MAP.HEIGHT);
  private builtTick = -1;
  private builtWorld: unknown = null;
  /** Bumped whenever the occupied set changes (cheap change detection for decor). */
  version = 0;

  constructor(private readonly ctx: SceneContext) {}

  /** Refresh once per sim tick (or when the world was replaced). */
  update(): void {
    const world = this.ctx.world;
    if (world.tick === this.builtTick && world === this.builtWorld) return;
    this.builtTick = world.tick;
    this.builtWorld = world;
    let hash = 0;
    this.buildings.fill(0);
    this.resources.fill(0);
    for (const eid of buildingQuery(world.ecs)) {
      const def = BUILDING_TABLE[Building.defId[eid]];
      if (!def) continue;
      const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
      const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
      for (let dy = 0; dy < def.footprint.h; dy++) {
        for (let dx = 0; dx < def.footprint.w; dx++) {
          const i = index(x0 + dx, y0 + dy);
          if (i < 0) continue;
          this.buildings[i] = 1;
          hash = (Math.imul(hash, 31) + i + 1) | 0;
        }
      }
    }
    for (const eid of resourceQuery(world.ecs)) {
      const i = index(Math.round(Position.x[eid]), Math.round(Position.y[eid]));
      if (i < 0) continue;
      this.resources[i] = 1;
      hash = (Math.imul(hash, 17) + i + 7) | 0;
    }
    if (hash !== this.lastHash) {
      this.lastHash = hash;
      this.version++;
    }
  }

  hasBuilding(x: number, y: number): boolean {
    const i = index(x, y);
    return i >= 0 && this.buildings[i] === 1;
  }

  hasResource(x: number, y: number): boolean {
    const i = index(x, y);
    return i >= 0 && this.resources[i] === 1;
  }

  private lastHash = 0;
}

function index(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return -1;
  return y * MAP.WIDTH + x;
}
