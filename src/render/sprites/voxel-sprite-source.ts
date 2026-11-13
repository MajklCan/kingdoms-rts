/**
 * Sprite source backed by the in-engine voxel bakes (voxel-bake.ts). Answers
 * every query the renderers make; returns null only when the model or its
 * baked texture does not exist, which renderers treat as "skip this entity".
 */

import {
  VOXEL_RESOURCE_ORIGIN_Y,
  VOXEL_UNIT_MODELS,
  VOXEL_UNIT_SCALE,
  voxelBuildingSprite,
  voxelMapFeatureSprite,
  voxelResourceKey,
  voxelUnitKey,
} from './voxel-models';
import type {
  BuildingSpriteQuery,
  MapFeatureSpriteQuery,
  ResourceSpriteQuery,
  SpriteRef,
  SpriteSource,
  UnitSpriteQuery,
} from './sprite-source';

export class VoxelSpriteSource implements SpriteSource {
  /** Refs are cached by texture key (+ scale) so renderers can compare by identity. */
  private readonly cache = new Map<string, SpriteRef>();

  constructor(private readonly textures: Phaser.Textures.TextureManager) {}

  building(query: BuildingSpriteQuery): SpriteRef | null {
    const sprite = voxelBuildingSprite(query.defId, query.age, query.playerId, query.variant);
    return sprite ? this.ref(sprite.key, sprite.originY, 1) : null;
  }

  unit(query: UnitSpriteQuery): SpriteRef | null {
    const model = VOXEL_UNIT_MODELS[query.unitDefId];
    if (!model) return null;
    const key = voxelUnitKey(model, query.playerId, query.facing, query.anim, query.frame);
    return this.ref(key, model.originY, VOXEL_UNIT_SCALE);
  }

  unitFrameCount(unitDefId: number, anim: string): number {
    return VOXEL_UNIT_MODELS[unitDefId]?.frameCounts[anim] ?? 0;
  }

  resource(query: ResourceSpriteQuery): SpriteRef | null {
    const key = voxelResourceKey(query.kind, query.variant);
    return key ? this.ref(key, VOXEL_RESOURCE_ORIGIN_Y, 1) : null;
  }

  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null {
    const sprite = voxelMapFeatureSprite(query.kind, query.size);
    return sprite ? this.ref(sprite.key, sprite.originY, sprite.scale) : null;
  }

  private ref(key: string, originY: number, scale: number): SpriteRef | null {
    const cacheKey = scale === 1 ? key : `${key}@${scale}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    if (!this.textures.exists(key)) return null;
    const ref: SpriteRef = { texture: key, originX: 0.5, originY, scale, source: 'voxel' };
    this.cache.set(cacheKey, ref);
    return ref;
  }
}
