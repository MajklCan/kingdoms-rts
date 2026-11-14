/**
 * Ambient life composition: forest birds and leaves, wildlife, village life
 * and the voxel chimney smoke, all on one seeded render RNG (the same map
 * always starts the same way) and one "units nearby" lookup.
 *
 * Render-only and never interactive: the sim is read, never written, no
 * image takes input, so nothing here can be selected or change the cursor.
 * Everything is pooled, capped, spawned only on visible tiles around the
 * camera, and switched off under prefers-reduced-motion (braziers then hold
 * a still flame).
 */

import { getMapSeed } from '@sim/world';
import type { BuildingRenderer } from '../entities/building-renderer';
import type { ResourceHit, ResourceRenderer } from '../entities/resource-renderer';
import { ForestLife } from './forest-life';
import type { FxHost } from './fx-host';
import { LifeRng, mapLifeSeed, UnitPresence } from './life-kit';
import { ensureLifeSheet } from './life-sprites';
import { reducedMotion } from './motion-prefs';
import { performanceMode } from './perf-mode';
import { VillageLife, VoxelSmoke } from './village-life';
import { Wildlife, type WildClimate } from './wildlife';

export class LifeFx {
  readonly smoke: VoxelSmoke;
  private readonly rng = new LifeRng(1);
  private readonly units: UnitPresence;
  private readonly forest: ForestLife;
  private readonly wild: Wildlife;
  private readonly village: VillageLife;

  constructor(
    private readonly host: FxHost,
    resources: ResourceRenderer,
    buildings: BuildingRenderer
  ) {
    const scene = host.ctx.scene;
    ensureLifeSheet(scene);
    // Birds in the air and dragonflies draw over the entities.
    const front = scene.add.container(0, 0);
    host.ctx.layers.effects.add(front);
    this.units = new UnitPresence(host);
    this.forest = new ForestLife(host, resources, this.units, this.rng, front);
    this.wild = new Wildlife(host, this.units, this.rng, front);
    this.village = new VillageLife(host, buildings, this.units, this.rng);
    this.smoke = new VoxelSmoke(host, this.rng, host.ctx.layers.effects);
  }

  /** New world: reseed from the map and read its climate. */
  reset(climate: WildClimate): void {
    this.rng.reseed(mapLifeSeed(getMapSeed(this.host.ctx.world)));
    this.units.clear();
    this.forest.reset(climate.snow);
    this.wild.reset(climate);
    this.village.reset();
    this.smoke.clear();
  }

  onResourceHit(hit: ResourceHit): void {
    this.forest.onHit(hit);
  }

  update(dtMs: number): void {
    const still = reducedMotion() || performanceMode();
    this.units.refresh(this.host.time);
    this.forest.update(dtMs, still);
    this.wild.update(dtMs, still);
    this.village.update(dtMs, still);
    if (still) this.smoke.clear();
    else this.smoke.update(dtMs);
  }

  clear(): void {
    this.forest.clear();
    this.wild.clear();
    this.village.clear();
    this.smoke.clear();
    this.units.clear();
  }

  get stats(): { forest: number; wild: number; village: number; smoke: number } {
    return { forest: this.forest.count, wild: this.wild.count, village: this.village.count, smoke: this.smoke.count };
  }
}
