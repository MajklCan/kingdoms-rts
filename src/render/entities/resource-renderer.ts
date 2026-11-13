/**
 * Gaia props: harvestable resources (trees, berries, gold, stone) and static
 * map features (rock spires, linden trees). Both stay visible once explored.
 */

import { MAP } from '../../config';
import { Position, Resource, ResourceKindId } from '@sim/components';
import { CampaignMissionId } from '@sim/campaign';
import { MapFeatureKind, TileType, type MapFeature } from '@sim/map-gen';
import { resourceQuery } from '@sim/world';
import type { ScreenPos } from '../iso';
import type { SceneContext } from '../scene-context';
import type { SpriteSource } from '../sprites/sprite-source';
import { SpriteSync } from './sprite-sync';

const SNOW_TILES: ReadonlySet<number> = new Set([
  TileType.SNOW,
  TileType.SNOW_FOREST,
  TileType.PACKED_SNOW,
  TileType.ICE,
]);

export class ResourceRenderer {
  private readonly resources: SpriteSync<number>;
  private readonly features: SpriteSync<string>;

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource
  ) {
    this.resources = new SpriteSync(ctx.scene, ctx.layers.entities);
    this.features = new SpriteSync(ctx.scene, ctx.layers.entities);
  }

  drawMapFeatures(): void {
    this.features.begin();
    for (const feature of this.ctx.world.map.features) {
      if (!this.isFeatureExplored(feature)) continue;
      const ref = this.sprites.mapFeature({ kind: feature.kind, size: featureSize(feature) });
      if (!ref) continue;
      const id = `${feature.kind}:${feature.x},${feature.y}:${feature.size ?? 1}`;
      const screen = this.featureScreenPosition(feature);
      this.features.show(id, ref, screen.x, screen.y).setDepth(screen.y - 1);
    }
    this.features.end();
  }

  drawResources(): void {
    this.resources.begin();
    for (const eid of resourceQuery(this.ctx.world.ecs)) {
      if (!this.ctx.isResourceExplored(eid)) continue;
      const kind = Resource.kind[eid];
      const ref = this.sprites.resource({ kind, variant: this.resourceVariant(eid, kind) });
      if (!ref) continue;
      const screen = this.ctx.tileToScreen(Position.x[eid], Position.y[eid]);
      this.resources.show(eid, ref, screen.x, screen.y).setDepth(screen.y);
    }
    this.resources.end();
  }

  get counts(): { resources: number; features: number; atlas: number } {
    return {
      resources: this.resources.size,
      features: this.features.size,
      atlas: this.resources.countBySource('atlas') + this.features.countBySource('atlas'),
    };
  }

  clear(): void {
    this.resources.clear();
    this.features.clear();
  }

  /** Trees are dead on the Zborov battlefield and snowy on snow tiles. */
  private resourceVariant(eid: number, kind: number): string | undefined {
    if (kind !== ResourceKindId.WOOD) return undefined;
    if (this.ctx.world.campaign?.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) return 'dead';
    return this.isSnowTile(eid) ? 'snow' : undefined;
  }

  private isSnowTile(eid: number): boolean {
    const x = Math.round(Position.x[eid]);
    const y = Math.round(Position.y[eid]);
    if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return false;
    return SNOW_TILES.has(this.ctx.world.map.tiles[y * MAP.WIDTH + x]);
  }

  private featureScreenPosition(feature: MapFeature): ScreenPos {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) {
      return this.ctx.tileToScreen(feature.x, feature.y);
    }
    const size = featureSize(feature);
    return this.ctx.tileToScreen(feature.x + (size - 1) / 2, feature.y + (size - 1) / 2);
  }

  private isFeatureExplored(feature: MapFeature): boolean {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) {
      return this.ctx.isTileExplored(feature.x, feature.y);
    }
    const size = featureSize(feature);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.ctx.isTileExplored(feature.x + dx, feature.y + dy)) return true;
      }
    }
    return false;
  }
}

/** Footprint size in tiles: rock spires cover 2x2 or 4x4, everything else one tile. */
function featureSize(feature: MapFeature): number {
  return feature.kind === MapFeatureKind.ROCK_SPIRE ? Math.max(2, feature.size ?? 2) : 1;
}
