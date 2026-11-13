/**
 * Sprite-source contract. Renderers never build texture keys themselves; they
 * describe WHAT they want to draw (building X in age Y for player P, unit U
 * facing F doing anim A frame N, ...) and a {@link SpriteSource} answers with a
 * {@link SpriteRef}: texture + optional atlas frame, origin, scale and an
 * optional team-colour mask layer.
 *
 * Two implementations exist:
 *  - `VoxelSpriteSource` (voxel-sprite-source.ts): textures baked in-engine
 *    from the TypeScript voxel models. Always available.
 *  - `AtlasSpriteSource` (atlas-sprite-source.ts): frames from pre-rendered
 *    atlases listed in `public/assets/sprites/manifest.json`.
 *
 * `SpriteSourceRegistry` (sprite-registry.ts) asks the atlas source first and
 * falls back to voxels per request, so a manifest can override one building
 * without touching anything else.
 */

import type { MapFeatureKindValue } from '@sim/map-gen';
import type { Facing } from './facing';

/** A single drawable image: a texture key plus an optional atlas frame. */
export interface SpriteFrameRef {
  texture: string;
  frame?: string;
}

/** Team-colour overlay drawn over the base sprite, tinted with `tint`. */
export interface TeamMaskRef extends SpriteFrameRef {
  tint: number;
}

/**
 * Everything a renderer needs to place one sprite. Instances are cached and
 * reused by the sources, so renderers can compare refs by identity to skip
 * redundant texture swaps.
 */
export interface SpriteRef extends SpriteFrameRef {
  originX: number;
  originY: number;
  scale: number;
  teamMask?: TeamMaskRef;
  /** Where the ref came from. Debug / introspection only. */
  source: 'voxel' | 'atlas';
}

export interface BuildingSpriteQuery {
  defId: number;
  /** Age the building is drawn in (owner's current age, or the age a fogged snapshot was seen in). */
  age: number;
  playerId: number;
  /** Optional shape variant, e.g. wall orientation 'x' / 'y'. */
  variant?: string;
}

export interface UnitSpriteQuery {
  unitDefId: number;
  playerId: number;
  facing: Facing;
  anim: string;
  frame: number;
}

export interface ResourceSpriteQuery {
  kind: number;
  /** Optional look variant, e.g. 'snow' or 'dead' for trees. */
  variant?: string;
}

export interface MapFeatureSpriteQuery {
  kind: MapFeatureKindValue;
  /** Footprint size in tiles (rock spires are 2 or 4). */
  size: number;
}

export interface SpriteSource {
  building(query: BuildingSpriteQuery): SpriteRef | null;
  unit(query: UnitSpriteQuery): SpriteRef | null;
  /** Number of frames a unit animation has; 0 when the source has no such anim. */
  unitFrameCount(unitDefId: number, anim: string): number;
  resource(query: ResourceSpriteQuery): SpriteRef | null;
  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null;
}
