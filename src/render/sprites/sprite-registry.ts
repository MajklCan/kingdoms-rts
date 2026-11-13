/**
 * The one place renderers ask "what do I draw for X". Tries the Blender atlas
 * art from the manifest first and falls back to voxel bakes per query, so a
 * missing manifest, atlas or frame never blanks an entity.
 *
 * Terrain, decor and other atlas-only art read the {@link ArtCatalog}
 * directly through `registry.art` (null without a usable manifest).
 */

import { TEAM_COLORS } from '../../config';
import { ArtCatalog, phaserFrameLookup } from './art-catalog';
import { AtlasSpriteSource } from './atlas-sprite-source';
import { atlasTextureKey, readSpriteManifest } from './sprite-manifest';
import type {
  BuildingSpriteQuery,
  MapFeatureSpriteQuery,
  ResourceSpriteQuery,
  SpriteRef,
  SpriteSource,
  UnitSpriteQuery,
} from './sprite-source';
import { VoxelSpriteSource } from './voxel-sprite-source';

/** `Phaser.Textures.FilterMode.LINEAR`, without a runtime Phaser import (tests run headless). */
export const LINEAR_FILTER = 0 as Phaser.Textures.FilterMode;

export class SpriteSourceRegistry implements SpriteSource {
  constructor(
    private readonly fallback: SpriteSource,
    private readonly override: SpriteSource | null = null,
    /** Atlas art catalog (null = voxels only). */
    readonly art: ArtCatalog | null = null
  ) {}

  /** Manifest assets available to the atlas source (debug / introspection). */
  get atlasEntryCount(): number {
    return this.art?.assetCount ?? 0;
  }

  building(query: BuildingSpriteQuery): SpriteRef | null {
    return this.override?.building(query) ?? this.fallback.building(query);
  }

  rubble(defId: number): SpriteRef | null {
    return this.override?.rubble(defId) ?? this.fallback.rubble(defId);
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

  stump(conifer: boolean): SpriteRef | null {
    return this.override?.stump(conifer) ?? this.fallback.stump(conifer);
  }

  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null {
    return this.override?.mapFeature(query) ?? this.fallback.mapFeature(query);
  }
}

/**
 * Build the registry for a scene after preload: voxel bakes as the base, atlas
 * art from the loaded manifest (if any) on top. Atlas textures switch to
 * linear filtering: the art is rendered at 2x and drawn at 0.5, which nearest
 * sampling (the game's pixel-art default) would shred.
 */
export function createSpriteRegistry(scene: Phaser.Scene): SpriteSourceRegistry {
  const voxel = new VoxelSpriteSource(scene.textures);
  const manifest = readSpriteManifest(scene.cache);
  for (const atlas of manifest.atlases) {
    const key = atlasTextureKey(atlas.key);
    if (scene.textures.exists(key)) {
      scene.textures.get(key).setFilter(LINEAR_FILTER);
    }
  }
  const art = new ArtCatalog(manifest, phaserFrameLookup(scene.textures));
  const atlas = new AtlasSpriteSource(art, TEAM_COLORS);
  return atlas.isEmpty
    ? new SpriteSourceRegistry(voxel)
    : new SpriteSourceRegistry(voxel, atlas, art);
}
