/**
 * Sprite source backed by the Blender atlases (via {@link ArtCatalog}).
 * Answers buildings (per era, construction stage, farm stage, wall shape),
 * rubble, resources (species, snow / dead trees, depletion looks), stumps, the
 * linden landmark and rock spires (a scaled boulder until they get art).
 * Units have no atlas art: null, so the registry falls back to voxels.
 */

import { AgeId, BUILDING_TABLE, BuildingDefId } from '@sim/defs';
import { ResourceKindId } from '@sim/components';
import { MapFeatureKind } from '@sim/map-gen';
import { tileHash } from '../tile-hash';
import type { ArtCatalog, ArtFrame } from './art-catalog';
import type {
  BuildingSpriteQuery,
  MapFeatureSpriteQuery,
  ResourceSpriteQuery,
  SpriteRef,
  SpriteSource,
} from './sprite-source';

const ERA_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(AgeId).map(([name, value]) => [value, name.toLowerCase()])
);

const CONIFERS = ['spruce_a', 'spruce_b', 'pine'] as const;
const BROADLEAVES = ['oak', 'beech', 'birch', 'linden', 'oak', 'beech'] as const;

/** Resource kind -> pile asset with full / half / low looks. */
const PILE_ASSETS: Readonly<Record<number, string>> = {
  [ResourceKindId.FOOD]: 'resource.berry_bush',
  [ResourceKindId.GOLD]: 'resource.gold',
  [ResourceKindId.STONE]: 'resource.stone',
};

/** The linden landmark is a bigger, older linden. */
const LINDEN_LANDMARK_SCALE = 1.35;
/** Rock spire scale per footprint tile (the boulder frame covers one tile). */
const ROCK_SPIRE_SCALE = 1.15;

export class AtlasSpriteSource implements SpriteSource {
  private readonly cache = new Map<string, SpriteRef>();

  constructor(
    private readonly art: ArtCatalog,
    private readonly teamColors: readonly number[]
  ) {}

  get isEmpty(): boolean {
    return this.art.assetCount === 0;
  }

  building(query: BuildingSpriteQuery): SpriteRef | null {
    const defKey = BUILDING_TABLE[query.defId]?.id;
    const assetId = defKey ? this.art.buildingAssetId(defKey) : undefined;
    const asset = assetId ? this.art.asset(assetId) : undefined;
    if (!assetId || !asset) return null;

    let frame: ArtFrame | null;
    let teamed = true;
    if (query.construction !== undefined && asset.construction) {
      frame = this.art.stageFrame(asset.construction, query.construction);
      teamed = false;
    } else if (query.defId === BuildingDefId.FARM) {
      frame = this.art.frame(assetId, query.farmStage ?? asset.default) ?? this.art.defaultFrame(assetId);
    } else {
      const era = ERA_NAMES.get(query.age) ?? 'dark';
      frame = query.wallMask === undefined
        ? this.art.eraFrame(assetId, era)
        : this.art.eraFrame(assetId, era, String(query.wallMask & 15));
    }
    return frame ? this.ref(frame, teamed ? query.playerId : -1) : null;
  }

  rubble(defId: number): SpriteRef | null {
    const defKey = BUILDING_TABLE[defId]?.id;
    const assetId = defKey ? this.art.buildingAssetId(defKey) : undefined;
    const rubbleId = assetId ? this.art.asset(assetId)?.rubble : undefined;
    const frame = rubbleId ? this.art.defaultFrame(rubbleId) : null;
    return frame ? this.ref(frame, -1) : null;
  }

  unit(): SpriteRef | null {
    return null;
  }

  unitFrameCount(): number {
    return 0;
  }

  resource(query: ResourceSpriteQuery): SpriteRef | null {
    if (query.kind === ResourceKindId.WOOD) {
      const frame = this.treeFrame(query);
      return frame ? this.ref(frame, -1) : null;
    }
    const pile = PILE_ASSETS[query.kind];
    if (!pile) return null;
    const frame = this.art.amountFrame(pile, query.remaining ?? 1);
    return frame ? this.ref(frame, -1) : null;
  }

  stump(conifer: boolean): SpriteRef | null {
    const frame = this.art.frame('resource.stump', conifer ? 'conifer' : 'broadleaf');
    return frame ? this.ref(frame, -1) : null;
  }

  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null {
    if (query.kind === MapFeatureKind.LINDEN_TREE) {
      const own = this.art.defaultFrame('feature.linden');
      if (own) return this.ref(own, -1);
      const frame = this.art.frame('resource.tree', 'linden');
      return frame ? this.ref(frame, -1, LINDEN_LANDMARK_SCALE) : null;
    }
    if (query.kind === MapFeatureKind.ROCK_SPIRE) {
      const size = Math.max(1, query.size);
      const exact = this.art.frame('feature.rock_spire', String(size));
      if (exact) return this.ref(exact, -1);
      const built = size >= 3 ? 4 : 2;
      const near = this.art.frame('feature.rock_spire', String(built));
      if (near) return this.ref(near, -1, size / built);
      // Older art without a spire: the big boulder blown up to the spire's footprint.
      const frame = this.art.frame('decor.rocks', 'boulder');
      return frame ? this.ref(frame, -1, size * ROCK_SPIRE_SCALE) : null;
    }
    return null;
  }

  private treeFrame(query: ResourceSpriteQuery): ArtFrame | null {
    const hash = tileHash(Math.round(query.x), Math.round(query.y), 0x7ee);
    if (query.variant === 'dead') return this.art.defaultFrame('resource.tree_dead');
    if (query.variant === 'snow') return this.art.pickFrame('resource.tree_snow', hash);
    const species = query.variant === 'broadleaf'
      ? BROADLEAVES[hash % BROADLEAVES.length]
      : CONIFERS[hash % CONIFERS.length];
    return this.art.frame('resource.tree', species) ?? this.art.pickFrame('resource.tree', hash);
  }

  /** `playerId` -1 = no team mask. */
  private ref(frame: ArtFrame, playerId: number, scaleMul = 1): SpriteRef {
    const key = `${frame.texture}|${frame.frame}|${playerId}|${scaleMul}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const scale = frame.scale * scaleMul;
    const ref: SpriteRef = {
      texture: frame.texture,
      frame: frame.frame,
      originX: frame.originX,
      originY: frame.originY,
      scale,
      anchor: 'footprint',
      top: frame.top * scaleMul,
      source: 'atlas',
    };
    if (frame.mask && playerId >= 0) {
      ref.teamMask = { texture: frame.texture, frame: frame.mask, tint: this.teamColors[playerId] ?? 0xffffff };
    }
    if (frame.poses) ref.poses = frame.poses;
    if (frame.overlays) {
      const teamed = ref.teamMask !== undefined;
      ref.overlays = frame.overlays.map((o) => ({
        group: o.group,
        frames: o.frames,
        masks: teamed ? o.masks : o.frames.map(() => undefined),
      }));
    }
    if (frame.shadow) {
      ref.shadow = {
        texture: frame.texture,
        frame: frame.shadow,
        originX: frame.originX,
        originY: frame.originY,
        scale,
      };
    }
    this.cache.set(key, ref);
    return ref;
  }
}
