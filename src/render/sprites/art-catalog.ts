/**
 * Phaser-free lookup over the Blender sprite manifest: "which frame do I draw
 * for asset X in era / stage / amount Y", with the manifest's fallback rules
 * (nearest earlier era, then the asset default). Only frames that actually
 * exist in a loaded atlas are returned, so a half-loaded or stale atlas falls
 * back to voxels instead of drawing Phaser's missing-frame placeholder.
 */

import { atlasTextureKey, type ArtAsset, type ArtVariant, type SpriteManifest } from './sprite-manifest';

/** The texture questions the catalog needs answered (Phaser-free for tests). */
export interface AtlasFrameLookup {
  hasFrame(textureKey: string, frame: string): boolean;
  /** Transparent source rows above the trimmed frame (0 when untrimmed / unknown). */
  trimTop?(textureKey: string, frame: string): number;
}

export function phaserFrameLookup(textures: Phaser.Textures.TextureManager): AtlasFrameLookup {
  return {
    hasFrame: (key, frame) => textures.exists(key) && textures.get(key).has(frame),
    trimTop: (key, frame) => {
      if (!textures.exists(key)) return 0;
      const f = textures.get(key).get(frame);
      return f?.trimmed ? f.y : 0;
    },
  };
}

/** One resolved frame, ready to hand to a sprite. */
export interface ArtFrame {
  /** Texture-manager key of the atlas. */
  texture: string;
  frame: string;
  originX: number;
  originY: number;
  scale: number;
  /** Team mask frame in the same atlas, when present. */
  mask?: string;
  /** Ground shadow frame in the same atlas, when present. */
  shadow?: string;
  /** Screen pixels (at scale) from the anchor up to the first opaque row. */
  top: number;
  variant: ArtVariant;
  /** Pose frames present in the atlas (tree sway). */
  poses?: Readonly<Record<string, string>>;
  /** Animated part overlays whose frames are all present in the atlas. */
  overlays?: readonly ArtOverlay[];
}

export interface ArtOverlay {
  group: string;
  frames: readonly string[];
  masks: readonly (string | undefined)[];
}

export class ArtCatalog {
  readonly scale: number;
  readonly elevationStepPx: number;
  private readonly eraOrder: readonly string[];
  private readonly assets: Readonly<Record<string, ArtAsset>>;
  private readonly byDefId = new Map<string, string>();
  private readonly cache = new Map<string, ArtFrame | null>();
  private readonly sortedKeys = new Map<string, readonly string[]>();

  constructor(manifest: SpriteManifest, private readonly lookup: AtlasFrameLookup) {
    this.scale = manifest.scale;
    this.elevationStepPx = manifest.elevationStepPx;
    this.eraOrder = manifest.eraOrder;
    this.assets = manifest.assets;
    for (const [id, asset] of Object.entries(manifest.assets)) {
      if (asset.kind === 'building' && asset.defId) this.byDefId.set(asset.defId, id);
    }
  }

  get assetCount(): number {
    return Object.keys(this.assets).length;
  }

  asset(id: string): ArtAsset | undefined {
    return this.assets[id];
  }

  /** Asset id of the building with this BuildingDefId key ("HOUSE" -> "building.house"). */
  buildingAssetId(defKey: string): string | undefined {
    return this.byDefId.get(defKey);
  }

  /** Variant keys of an asset in a stable (sorted) order, for hashed picks. */
  variantKeys(assetId: string): readonly string[] {
    let keys = this.sortedKeys.get(assetId);
    if (!keys) {
      const asset = this.assets[assetId];
      keys = asset ? Object.keys(asset.variants).sort() : [];
      this.sortedKeys.set(assetId, keys);
    }
    return keys;
  }

  /** Exact variant; null when the asset / variant / frame does not exist. */
  frame(assetId: string, variantKey: string): ArtFrame | null {
    const cacheKey = `${assetId}|${variantKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const variant = this.assets[assetId]?.variants[variantKey];
    const resolved = variant ? this.build(variant) : null;
    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  /** The asset's default variant. */
  defaultFrame(assetId: string): ArtFrame | null {
    const asset = this.assets[assetId];
    return asset ? this.frame(assetId, asset.default) : null;
  }

  /**
   * Era-dependent variant `<era>` or `<era>.<rest>` (walls). A missing era
   * falls back to the nearest earlier era in `eraOrder`, then to the default.
   */
  eraFrame(assetId: string, era: string, rest?: string): ArtFrame | null {
    const asset = this.assets[assetId];
    if (!asset) return null;
    const keyFor = (e: string): string => (rest === undefined ? e : `${e}.${rest}`);
    const index = this.eraOrder.indexOf(era);
    const candidates = index < 0 ? [era] : this.eraOrder.slice(0, index + 1).reverse();
    for (const e of candidates) {
      const hit = this.frame(assetId, keyFor(e));
      if (hit) return hit;
    }
    if (rest !== undefined) {
      // No earlier era has this shape: try the same shape in any era.
      for (const e of this.eraOrder) {
        const hit = this.frame(assetId, keyFor(e));
        if (hit) return hit;
      }
    }
    return this.defaultFrame(assetId);
  }

  /** Construction-like assets: the last stage whose `progress` is reached. */
  stageFrame(assetId: string, progress: number): ArtFrame | null {
    const asset = this.assets[assetId];
    if (!asset) return null;
    let best: string | null = null;
    let bestProgress = -Infinity;
    for (const [key, variant] of Object.entries(asset.variants)) {
      const p = variant.progress ?? 0;
      if (p <= progress + 1e-6 && p > bestProgress) {
        best = key;
        bestProgress = p;
      }
    }
    return best === null ? this.defaultFrame(assetId) : this.frame(assetId, best);
  }

  /** Resource piles: the variant whose `amount` is closest to `fraction`. */
  amountFrame(assetId: string, fraction: number): ArtFrame | null {
    const asset = this.assets[assetId];
    if (!asset) return null;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const key of this.variantKeys(assetId)) {
      const amount = asset.variants[key].amount;
      if (amount === undefined) continue;
      const dist = Math.abs(amount - fraction);
      if (dist < bestDist) {
        best = key;
        bestDist = dist;
      }
    }
    return best === null ? this.defaultFrame(assetId) : this.frame(assetId, best);
  }

  /** Deterministic pick among all variants (e.g. tree species by tile hash). */
  pickFrame(assetId: string, hash: number): ArtFrame | null {
    const keys = this.variantKeys(assetId);
    if (keys.length === 0) return null;
    return this.frame(assetId, keys[(hash >>> 0) % keys.length]);
  }

  private build(variant: ArtVariant): ArtFrame | null {
    const texture = atlasTextureKey(variant.atlas);
    if (!this.lookup.hasFrame(texture, variant.frame)) return null;
    const trimTop = this.lookup.trimTop?.(texture, variant.frame) ?? 0;
    const resolved: ArtFrame = {
      texture,
      frame: variant.frame,
      originX: variant.anchor[0] / variant.size[0],
      originY: variant.anchor[1] / variant.size[1],
      scale: this.scale,
      top: Math.max(0, variant.anchor[1] - trimTop) * this.scale,
      variant,
    };
    if (variant.mask && this.lookup.hasFrame(texture, variant.mask)) resolved.mask = variant.mask;
    if (variant.shadow && this.lookup.hasFrame(texture, variant.shadow)) resolved.shadow = variant.shadow;
    if (variant.poses) {
      const poses = Object.entries(variant.poses).filter(([, f]) => this.lookup.hasFrame(texture, f));
      if (poses.length > 0) resolved.poses = Object.fromEntries(poses);
    }
    if (variant.overlays) {
      const overlays: ArtOverlay[] = [];
      for (const [group, frames] of Object.entries(variant.overlays)) {
        if (!frames.every((f) => this.lookup.hasFrame(texture, f.frame))) continue;
        overlays.push({
          group,
          frames: frames.map((f) => f.frame),
          masks: frames.map((f) => (f.mask && this.lookup.hasFrame(texture, f.mask) ? f.mask : undefined)),
        });
      }
      if (overlays.length > 0) resolved.overlays = overlays;
    }
    return resolved;
  }
}
