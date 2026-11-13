/**
 * Pre-rendered sprite manifest (`public/assets/sprites/manifest.json`), as
 * written by the Blender pipeline (`scripts/pack_sprites.py`). The Blender
 * manifest is the source of truth; its shape and conventions are documented
 * in docs/BLENDER_SPRITE_PIPELINE.md.
 *
 * The manifest may be absent, empty or partly invalid: invalid parts are
 * dropped with a console warning and everything not covered keeps rendering
 * from voxel bakes (and the flat-colour terrain bake).
 */

export const SPRITE_ASSET_BASE = 'assets/sprites/';
export const SPRITE_MANIFEST_KEY = 'sprite-manifest';
const SPRITE_MANIFEST_FILE = 'manifest.json';

export interface SpriteAtlasDef {
  /** Atlas id referenced by variants, e.g. "kr-buildings-0". */
  key: string;
  /** PNG path relative to public/assets/sprites/. */
  image: string;
  /** Phaser / TexturePacker JSON hash path relative to public/assets/sprites/. */
  json: string;
}

/** One drawable frame of an asset (an era, a stage, a tile variant...). */
export interface ArtVariant {
  atlas: string;
  frame: string;
  /** Bottom corner of the footprint diamond, in source pixels at render scale. */
  anchor: readonly [number, number];
  /** Full source size of the frame, in source pixels at render scale. */
  size: readonly [number, number];
  /** Team-colour mask frame (same atlas, size and anchor). */
  mask?: string;
  /** Ground shadow frame (same atlas, size and anchor). */
  shadow?: string;
  /** Construction stages: progress (0..1) from which this stage shows. */
  progress?: number;
  /** Resource piles: remaining fraction this look stands for. */
  amount?: number;
  /** Animated terrain: frame index of this variant. */
  frameIndex?: number;
  /** Fence decor: axis the fence runs along. */
  connections?: string;
}

export interface ArtAsset {
  kind: string;
  footprint: readonly [number, number];
  default: string;
  variants: Readonly<Record<string, ArtVariant>>;
  /** Buildings: BuildingDefId key in src/sim/defs.ts. */
  defId?: string;
  /** Resources: ResourceKindId key. */
  resource?: string;
  /** Terrain: TileType key in src/sim/map-gen.ts. */
  tileType?: string;
  /** Terrain: tiles repeat every `period` tiles on both axes. */
  period?: number;
  eras?: readonly string[];
  stages?: readonly string[];
  /** Buildings: construction / rubble asset ids for their footprint. */
  construction?: string;
  rubble?: string;
  /** Cliffs: pixel height of one face step at 1x. */
  stepPx?: number;
}

export interface SpriteManifest {
  version: number;
  /** Draw scale for every frame (frames are rendered at 1 / scale). */
  scale: number;
  /** Screen pixels per elevation step at 1x. */
  elevationStepPx: number;
  eraOrder: readonly string[];
  atlases: readonly SpriteAtlasDef[];
  assets: Readonly<Record<string, ArtAsset>>;
}

export const EMPTY_SPRITE_MANIFEST: SpriteManifest = {
  version: 1,
  scale: 0.5,
  elevationStepPx: 4,
  eraOrder: ['dark', 'castle', 'gunpowder', 'total_war'],
  atlases: [],
  assets: {},
};

/** Texture-manager key an atlas is loaded under (namespaced away from voxel keys). */
export function atlasTextureKey(atlasKey: string): string {
  return `sprite-atlas:${atlasKey}`;
}

/** Validate untrusted manifest JSON. `undefined` / `null` mean "no manifest". */
export function parseSpriteManifest(raw: unknown): { manifest: SpriteManifest; problems: string[] } {
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { manifest: EMPTY_SPRITE_MANIFEST, problems };
  if (!isRecord(raw)) {
    return { manifest: EMPTY_SPRITE_MANIFEST, problems: ['manifest is not a JSON object'] };
  }

  const atlases: SpriteAtlasDef[] = [];
  const atlasKeys = new Set<string>();
  const rawAtlases = raw.atlases ?? [];
  if (!Array.isArray(rawAtlases)) problems.push('"atlases" must be an array');
  for (const [i, item] of (Array.isArray(rawAtlases) ? rawAtlases : []).entries()) {
    if (!isRecord(item) || !isNonEmptyString(item.key) || !isNonEmptyString(item.image) ||
      !isNonEmptyString(item.json)) {
      problems.push(`atlases[${i}] needs string "key", "image" and "json"`);
      continue;
    }
    if (atlasKeys.has(item.key)) {
      problems.push(`atlases[${i}] duplicates key "${item.key}"`);
      continue;
    }
    atlasKeys.add(item.key);
    atlases.push({ key: item.key, image: item.image, json: item.json });
  }

  const assets: Record<string, ArtAsset> = {};
  const rawAssets = raw.assets ?? {};
  if (!isRecord(rawAssets)) problems.push('"assets" must be an object');
  for (const [id, item] of Object.entries(isRecord(rawAssets) ? rawAssets : {})) {
    const asset = parseAsset(id, item, atlasKeys, problems);
    if (asset) assets[id] = asset;
  }

  const scale = positiveNumber(raw.scale) ?? EMPTY_SPRITE_MANIFEST.scale;
  const tile = isRecord(raw.tile) ? raw.tile : {};
  const elevationStepPx = positiveNumber(tile.elevationStepPx) ?? EMPTY_SPRITE_MANIFEST.elevationStepPx;
  const eraOrder = Array.isArray(raw.eraOrder) && raw.eraOrder.every(isNonEmptyString)
    ? (raw.eraOrder as string[])
    : EMPTY_SPRITE_MANIFEST.eraOrder;
  const version = typeof raw.version === 'number' ? raw.version : 1;
  return { manifest: { version, scale, elevationStepPx, eraOrder, atlases, assets }, problems };
}

function parseAsset(
  id: string,
  item: unknown,
  atlasKeys: ReadonlySet<string>,
  problems: string[]
): ArtAsset | null {
  if (!isRecord(item) || !isRecord(item.variants)) {
    problems.push(`assets["${id}"] needs a "variants" object`);
    return null;
  }
  const variants: Record<string, ArtVariant> = {};
  for (const [key, raw] of Object.entries(item.variants)) {
    const variant = parseVariant(raw, atlasKeys);
    if (variant) variants[key] = variant;
    else problems.push(`assets["${id}"].variants["${key}"] is invalid or names an unknown atlas`);
  }
  const keys = Object.keys(variants);
  if (keys.length === 0) return null;
  const footprint = pair(item.footprint) ?? [1, 1];
  const fallback = isNonEmptyString(item.default) && variants[item.default] ? item.default : keys[0];
  const asset: ArtAsset = {
    kind: isNonEmptyString(item.kind) ? item.kind : 'sprite',
    footprint,
    default: fallback,
    variants,
  };
  for (const field of ['defId', 'resource', 'tileType', 'construction', 'rubble'] as const) {
    if (isNonEmptyString(item[field])) asset[field] = item[field];
  }
  const period = positiveNumber(item.period);
  if (period !== undefined) asset.period = Math.round(period);
  const stepPx = positiveNumber(item.stepPx);
  if (stepPx !== undefined) asset.stepPx = stepPx;
  if (Array.isArray(item.eras)) asset.eras = item.eras.filter(isNonEmptyString);
  if (Array.isArray(item.stages)) asset.stages = item.stages.filter(isNonEmptyString);
  return asset;
}

function parseVariant(raw: unknown, atlasKeys: ReadonlySet<string>): ArtVariant | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.atlas) || !isNonEmptyString(raw.frame)) return null;
  if (!atlasKeys.has(raw.atlas)) return null;
  const anchor = pair(raw.anchor);
  const size = pair(raw.size);
  if (!anchor || !size || size[0] <= 0 || size[1] <= 0) return null;
  const variant: ArtVariant = { atlas: raw.atlas, frame: raw.frame, anchor, size };
  if (isNonEmptyString(raw.mask)) variant.mask = raw.mask;
  if (isNonEmptyString(raw.shadow)) variant.shadow = raw.shadow;
  if (isNonEmptyString(raw.connections)) variant.connections = raw.connections;
  for (const field of ['progress', 'amount', 'frameIndex'] as const) {
    const value = raw[field];
    if (typeof value === 'number' && Number.isFinite(value)) variant[field] = value;
  }
  return variant;
}

/**
 * Queue the manifest and, once it arrives, every atlas it lists. Call from a
 * scene's preload(); the loader keeps running until the atlases are in.
 */
export function queueSpriteManifest(load: Phaser.Loader.LoaderPlugin): void {
  load.once(
    `filecomplete-json-${SPRITE_MANIFEST_KEY}`,
    (_key: string, _type: string, data: unknown) => {
      const { manifest, problems } = parseSpriteManifest(data);
      warnProblems(problems);
      for (const atlas of manifest.atlases) {
        load.atlas(
          atlasTextureKey(atlas.key),
          SPRITE_ASSET_BASE + atlas.image,
          SPRITE_ASSET_BASE + atlas.json
        );
      }
    }
  );
  load.json(SPRITE_MANIFEST_KEY, SPRITE_ASSET_BASE + SPRITE_MANIFEST_FILE);
}

/** The parsed manifest from the JSON cache (empty when it never loaded). */
export function readSpriteManifest(cache: Phaser.Cache.CacheManager): SpriteManifest {
  const raw: unknown = cache.json.exists(SPRITE_MANIFEST_KEY)
    ? cache.json.get(SPRITE_MANIFEST_KEY)
    : undefined;
  return parseSpriteManifest(raw).manifest;
}

function warnProblems(problems: readonly string[]): void {
  for (const problem of problems) {
    // eslint-disable-next-line no-console
    console.warn(`[Kingdoms] sprite manifest: ${problem}`);
  }
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return [a, b];
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
