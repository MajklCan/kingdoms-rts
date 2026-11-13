/**
 * Sprite source backed by the in-engine voxel bakes (voxel-bake.ts). Answers
 * every query the renderers make; returns null only when the model or its
 * baked texture does not exist, which renderers treat as "skip this entity".
 * Voxel sprites are anchored on the footprint centre / unit feet.
 */

import { UnitDefId } from '@sim/defs';
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
  ShadowRef,
  SpriteRef,
  SpriteSource,
  UnitSpriteQuery,
} from './sprite-source';

/** Soft elliptical contact shadow under units (generated in voxel-bake.ts). */
export const UNIT_SHADOW_KEY = 'unit-contact-shadow';

/** Contact shadow per unit: [width px at 1x, alpha]. Wide bodies get wider blobs. */
const UNIT_SHADOW_SIZE: Readonly<Record<number, readonly [number, number]>> = {
  [UnitDefId.SCOUT_CAVALRY]: [32, 0.6],
  [UnitDefId.CANNON]: [32, 0.6],
  [UnitDefId.MACHINE_GUN]: [28, 0.6],
  [UnitDefId.MORTAR]: [28, 0.6],
};
const DEFAULT_UNIT_SHADOW: readonly [number, number] = [22, 0.62];

/** Wall neighbour mask -> the voxel wall's axis (more connections wins, x on ties). */
export function wallAxisForMask(mask: number): 'x' | 'y' {
  const x = Number((mask & 1) !== 0) + Number((mask & 4) !== 0);
  const y = Number((mask & 2) !== 0) + Number((mask & 8) !== 0);
  return x >= y ? 'x' : 'y';
}

export class VoxelSpriteSource implements SpriteSource {
  /** Refs are cached by texture key (+ scale) so renderers can compare by identity. */
  private readonly cache = new Map<string, SpriteRef>();
  private readonly unitShadows = new Map<number, ShadowRef | undefined>();

  constructor(private readonly textures: Phaser.Textures.TextureManager) {}

  building(query: BuildingSpriteQuery): SpriteRef | null {
    const variant = query.wallMask === undefined ? undefined : wallAxisForMask(query.wallMask);
    const sprite = voxelBuildingSprite(query.defId, query.age, query.playerId, variant);
    return sprite ? this.ref(sprite.key, sprite.originY, 1) : null;
  }

  rubble(): SpriteRef | null {
    return null;
  }

  unit(query: UnitSpriteQuery): SpriteRef | null {
    const model = VOXEL_UNIT_MODELS[query.unitDefId];
    if (!model) return null;
    const key = voxelUnitKey(model, query.playerId, query.facing, query.anim, query.frame);
    return this.ref(key, model.originY, VOXEL_UNIT_SCALE, this.unitShadow(query.unitDefId));
  }

  unitFrameCount(unitDefId: number, anim: string): number {
    return VOXEL_UNIT_MODELS[unitDefId]?.frameCounts[anim] ?? 0;
  }

  resource(query: ResourceSpriteQuery): SpriteRef | null {
    const key = voxelResourceKey(query.kind, query.variant);
    return key ? this.ref(key, VOXEL_RESOURCE_ORIGIN_Y, 1) : null;
  }

  stump(): SpriteRef | null {
    return null;
  }

  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null {
    const sprite = voxelMapFeatureSprite(query.kind, query.size);
    return sprite ? this.ref(sprite.key, sprite.originY, sprite.scale) : null;
  }

  private unitShadow(unitDefId: number): ShadowRef | undefined {
    if (this.unitShadows.has(unitDefId)) return this.unitShadows.get(unitDefId);
    let shadow: ShadowRef | undefined;
    if (this.textures.exists(UNIT_SHADOW_KEY)) {
      const [width, alpha] = UNIT_SHADOW_SIZE[unitDefId] ?? DEFAULT_UNIT_SHADOW;
      const texWidth = this.textures.get(UNIT_SHADOW_KEY).source[0]?.width || 64;
      shadow = {
        texture: UNIT_SHADOW_KEY,
        originX: 0.5,
        originY: 0.5,
        scale: width / texWidth,
        alpha,
      };
    }
    this.unitShadows.set(unitDefId, shadow);
    return shadow;
  }

  private ref(key: string, originY: number, scale: number, shadow?: ShadowRef): SpriteRef | null {
    const cacheKey = scale === 1 ? key : `${key}@${scale}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    if (!this.textures.exists(key)) return null;
    const height = this.textures.get(key).source[0]?.height ?? 0;
    const ref: SpriteRef = {
      texture: key,
      originX: 0.5,
      originY,
      scale,
      anchor: 'center',
      top: height * originY * scale,
      source: 'voxel',
    };
    if (shadow) ref.shadow = shadow;
    this.cache.set(cacheKey, ref);
    return ref;
  }
}
