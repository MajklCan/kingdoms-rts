/**
 * Sprite source backed by pre-rendered atlases from the sprite manifest.
 *
 * Each query maps to an ordered list of sprite ids, most specific first, e.g.
 * a castle-age town centre tries `building:TOWN_CENTER:CASTLE` then
 * `building:TOWN_CENTER`. The first id with a manifest entry whose frame
 * exists in the loaded atlas wins; if none does, the query returns null and
 * the registry falls back to voxels.
 */

import { AgeId, BUILDING_TABLE, UNIT_TABLE } from '@sim/defs';
import { ResourceKindId } from '@sim/components';
import {
  atlasTextureKey,
  type SpriteEntryDef,
  type SpriteManifest,
} from './sprite-manifest';
import type {
  BuildingSpriteQuery,
  MapFeatureSpriteQuery,
  ResourceSpriteQuery,
  SpriteRef,
  SpriteSource,
  UnitSpriteQuery,
} from './sprite-source';

/** The texture questions the atlas source needs answered (Phaser-free for tests). */
export interface AtlasFrameLookup {
  hasFrame(textureKey: string, frame: string): boolean;
}

export function phaserFrameLookup(textures: Phaser.Textures.TextureManager): AtlasFrameLookup {
  return {
    hasFrame: (key, frame) => textures.exists(key) && textures.get(key).has(frame),
  };
}

type PatternVars = Readonly<Record<string, string | number | undefined>>;

const AGE_NAMES = invert(AgeId);
const RESOURCE_NAMES = invert(ResourceKindId);

export class AtlasSpriteSource implements SpriteSource {
  private readonly entries: ReadonlyMap<string, SpriteEntryDef>;
  private readonly categories: ReadonlySet<string>;
  private readonly cache = new Map<string, SpriteRef | null>();

  constructor(
    manifest: SpriteManifest,
    private readonly lookup: AtlasFrameLookup,
    private readonly teamColors: readonly number[]
  ) {
    this.entries = new Map(Object.entries(manifest.sprites));
    this.categories = new Set([...this.entries.keys()].map((id) => id.split(':')[0]));
  }

  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  building(query: BuildingSpriteQuery): SpriteRef | null {
    if (!this.categories.has('building')) return null;
    const name = BUILDING_TABLE[query.defId]?.id;
    if (!name) return null;
    const age = AGE_NAMES.get(query.age);
    const ids = [
      query.variant ? `building:${name}:${query.variant}` : null,
      age ? `building:${name}:${age}` : null,
      `building:${name}`,
    ];
    return this.resolve(ids, {
      age: age?.toLowerCase(),
      player: query.playerId,
      variant: query.variant,
    }, query.playerId);
  }

  unit(query: UnitSpriteQuery): SpriteRef | null {
    if (!this.categories.has('unit')) return null;
    const name = UNIT_TABLE[query.unitDefId]?.id;
    if (!name) return null;
    return this.resolve([`unit:${name}:${query.anim}`, `unit:${name}`], {
      player: query.playerId,
      facing: query.facing,
      anim: query.anim,
      frame: query.frame,
    }, query.playerId);
  }

  unitFrameCount(unitDefId: number, anim: string): number {
    if (!this.categories.has('unit')) return 0;
    const name = UNIT_TABLE[unitDefId]?.id;
    if (!name) return 0;
    const entry = this.entries.get(`unit:${name}:${anim}`) ?? this.entries.get(`unit:${name}`);
    return entry?.frames?.[anim] ?? 0;
  }

  resource(query: ResourceSpriteQuery): SpriteRef | null {
    if (!this.categories.has('resource')) return null;
    const name = RESOURCE_NAMES.get(query.kind);
    if (!name) return null;
    const ids = [query.variant ? `resource:${name}:${query.variant}` : null, `resource:${name}`];
    return this.resolve(ids, { variant: query.variant }, 0);
  }

  mapFeature(query: MapFeatureSpriteQuery): SpriteRef | null {
    if (!this.categories.has('feature')) return null;
    const name = query.kind.toUpperCase();
    return this.resolve([`feature:${name}:${query.size}`, `feature:${name}`], {
      size: query.size,
    }, 0);
  }

  private resolve(
    ids: ReadonlyArray<string | null>,
    vars: PatternVars,
    playerId: number
  ): SpriteRef | null {
    for (const id of ids) {
      if (!id) continue;
      const entry = this.entries.get(id);
      if (!entry) continue;
      const frame = fillPattern(entry.frame, vars);
      const maskFrame = entry.teamMask ? fillPattern(entry.teamMask.frame, vars) : '';
      const cacheKey = `${id}|${frame}|${maskFrame}|${playerId}`;
      let ref = this.cache.get(cacheKey);
      if (ref === undefined) {
        ref = this.buildRef(entry, frame, maskFrame, playerId);
        this.cache.set(cacheKey, ref);
      }
      if (ref) return ref;
    }
    return null;
  }

  private buildRef(
    entry: SpriteEntryDef,
    frame: string,
    maskFrame: string,
    playerId: number
  ): SpriteRef | null {
    const texture = atlasTextureKey(entry.atlas);
    if (!this.lookup.hasFrame(texture, frame)) return null;
    const ref: SpriteRef = {
      texture,
      frame,
      originX: entry.originX ?? 0.5,
      originY: entry.originY ?? 0.5,
      scale: entry.scale ?? 1,
      source: 'atlas',
    };
    if (entry.teamMask) {
      const maskTexture = atlasTextureKey(entry.teamMask.atlas ?? entry.atlas);
      if (this.lookup.hasFrame(maskTexture, maskFrame)) {
        ref.teamMask = {
          texture: maskTexture,
          frame: maskFrame,
          tint: this.teamColors[playerId] ?? 0xffffff,
        };
      }
    }
    return ref;
  }
}

/** Replace `{name}` placeholders; unknown or undefined placeholders become ''. */
export function fillPattern(pattern: string, vars: PatternVars): string {
  return pattern.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? '' : String(value);
  });
}

function invert(table: Readonly<Record<string, number>>): ReadonlyMap<number, string> {
  return new Map(Object.entries(table).map(([name, value]) => [value, name]));
}
