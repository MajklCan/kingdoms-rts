/**
 * Sprite-source contract. Renderers never build texture keys themselves; they
 * describe WHAT they want to draw (building X in age Y for player P, unit U
 * facing F doing anim A frame N, ...) and a {@link SpriteSource} answers with a
 * {@link SpriteRef}: texture + optional atlas frame, origin, scale, an optional
 * team-colour mask layer and an optional ground shadow.
 *
 * Two implementations exist:
 *  - `VoxelSpriteSource` (voxel-sprite-source.ts): textures baked in-engine
 *    from the TypeScript voxel models. Always available.
 *  - `AtlasSpriteSource` (atlas-sprite-source.ts): frames from the Blender
 *    atlases listed in `public/assets/sprites/manifest.json`.
 *
 * `SpriteSourceRegistry` (sprite-registry.ts) asks the atlas source first and
 * falls back to voxels per request, so a missing atlas or frame never blanks
 * an entity.
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

/** Ground shadow drawn on the shadow layer under every entity. */
export interface ShadowRef extends SpriteFrameRef {
  originX: number;
  originY: number;
  scale: number;
  /** Extra vertical scale (flattened blob shadows); defaults to 1. */
  scaleY?: number;
  alpha?: number;
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
  shadow?: ShadowRef;
  /**
   * Where the sprite's anchor sits: 'footprint' = bottom corner of the
   * footprint diamond (Blender art), 'center' = footprint centre / unit feet
   * (voxel bakes). Renderers place the sprite accordingly.
   */
  anchor: 'footprint' | 'center';
  /** Screen pixels from the anchor up to the top of the art (bars go above). */
  top: number;
  /** Where the ref came from. Debug / introspection only. */
  source: 'voxel' | 'atlas';
}

export type FarmStage = 'sown' | 'growing' | 'ripe' | 'depleted';

export interface BuildingSpriteQuery {
  defId: number;
  /** Age the building is drawn in (owner's current age, or the age a fogged snapshot was seen in). */
  age: number;
  playerId: number;
  /** Walls: connected neighbours, 1 = +x, 2 = +y, 4 = -x, 8 = -y. */
  wallMask?: number;
  /** Farms: crop stage. */
  farmStage?: FarmStage;
  /** Foundations: construction progress 0..1. */
  construction?: number;
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
  /** Tile, for the deterministic per-tile look (tree species...). */
  x: number;
  y: number;
  /** Remaining amount as a fraction of the full pile (depletion looks). */
  remaining?: number;
}

export interface MapFeatureSpriteQuery {
  kind: MapFeatureKindValue;
  /** Footprint size in tiles (rock spires are 2 or 4). */
  size: number;
  x: number;
  y: number;
}

/** Timing of one pre-rendered unit animation (atlas units only). */
export interface UnitAnimInfo {
  frames: number;
  /** ms per frame (time-driven anims). */
  ms: number;
  /** Tiles per cycle for distance-driven walks, 0 = time driven. */
  stride: number;
  /** Frame on which a blow lands / a shot leaves, -1 = none. */
  hit: number;
  once: boolean;
}

/** Per-kind facts about pre-rendered unit art the renderers and effects need. */
export interface UnitArtInfo {
  /** Timing of an anim (aliases resolved), null = the art has no such anim. */
  anim(anim: string): UnitAnimInfo | null;
  /** Screen offset from the feet where projectiles / muzzle smoke start, per facing. */
  projectile(facing: Facing): { dx: number; dy: number } | null;
  /** px from the feet to the top of the head. */
  height: number;
  /** Selection ring full width / height px at 1x. */
  ring: readonly [number, number];
}

export interface SpriteSource {
  building(query: BuildingSpriteQuery): SpriteRef | null;
  /** Ruins left by a destroyed building of this def (null = no ruin art). */
  rubble(defId: number): SpriteRef | null;
  unit(query: UnitSpriteQuery): SpriteRef | null;
  /** Number of frames a unit animation has; 0 when the source has no such anim. */
  unitFrameCount(unitDefId: number, anim: string): number;
  /** Pre-rendered unit facts (timing, anchors); absent / null for voxel units. */
  unitArt?(unitDefId: number): UnitArtInfo | null;
  resource(query: ResourceSpriteQuery): SpriteRef | null;
  /** Stump left by a felled tree (null = no stump art). */
  stump(conifer: boolean): SpriteRef | null;
  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null;
}
