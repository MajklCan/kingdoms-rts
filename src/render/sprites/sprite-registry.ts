/**
 * The one place renderers ask "what do I draw for X". Tries pre-rendered atlas
 * sprites from the manifest first and falls back to voxel bakes per query, so
 * art can be swapped in one entry at a time.
 */

import { TEAM_COLORS } from '../../config';
import { AtlasSpriteSource, phaserFrameLookup } from './atlas-sprite-source';
import { readSpriteManifest } from './sprite-manifest';
import type {
  BuildingSpriteQuery,
  MapFeatureSpriteQuery,
  ResourceSpriteQuery,
  SpriteRef,
  SpriteSource,
  UnitSpriteQuery,
} from './sprite-source';
import { VoxelSpriteSource } from './voxel-sprite-source';

export class SpriteSourceRegistry implements SpriteSource {
  constructor(
    private readonly fallback: SpriteSource,
    private readonly override: SpriteSource | null = null,
    /** Manifest entries available to the override (debug / introspection). */
    readonly atlasEntryCount = 0
  ) {}

  building(query: BuildingSpriteQuery): SpriteRef | null {
    return this.override?.building(query) ?? this.fallback.building(query);
  }

  unit(query: UnitSpriteQuery): SpriteRef | null {
    return this.override?.unit(query) ?? this.fallback.unit(query);
  }

  unitFrameCount(unitDefId: number, anim: string): number {
    const overridden = this.override?.unitFrameCount(unitDefId, anim) ?? 0;
    return overridden > 0 ? overridden : this.fallback.unitFrameCount(unitDefId, anim);
  }

  resource(query: ResourceSpriteQuery): SpriteRef | null {
    return this.override?.resource(query) ?? this.fallback.resource(query);
  }

  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null {
    return this.override?.mapFeature(query) ?? this.fallback.mapFeature(query);
  }
}

/**
 * Build the registry for a scene after preload: voxel bakes as the base, atlas
 * entries from the loaded manifest (if any) on top.
 */
export function createSpriteRegistry(scene: Phaser.Scene): SpriteSourceRegistry {
  const voxel = new VoxelSpriteSource(scene.textures);
  const atlas = new AtlasSpriteSource(
    readSpriteManifest(scene.cache),
    phaserFrameLookup(scene.textures),
    TEAM_COLORS
  );
  return new SpriteSourceRegistry(voxel, atlas.isEmpty ? null : atlas, atlas.entryCount);
}
