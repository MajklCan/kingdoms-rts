/**
 * Pre-rendered sprite atlas manifest (`public/assets/sprites/manifest.json`).
 * Shape and conventions are documented in docs/SPRITE_ATLAS.md.
 *
 * The manifest may be absent, empty or partly invalid: invalid parts are
 * dropped with a console warning and everything not covered by a valid entry
 * keeps rendering from voxel bakes.
 */

export const SPRITE_ASSET_BASE = 'assets/sprites/';
export const SPRITE_MANIFEST_KEY = 'sprite-manifest';
const SPRITE_MANIFEST_FILE = 'manifest.json';

export interface SpriteAtlasDef {
  /** Atlas id referenced by sprite entries. */
  key: string;
  /** PNG path relative to public/assets/sprites/. */
  image: string;
  /** Phaser / TexturePacker JSON (hash or array) path relative to public/assets/sprites/. */
  json: string;
}

export interface SpriteFramePattern {
  /** Atlas id; defaults to the entry's own atlas for team masks. */
  atlas?: string;
  /** Frame name, may contain {placeholders} (see docs/SPRITE_ATLAS.md). */
  frame: string;
}

export interface SpriteEntryDef {
  atlas: string;
  frame: string;
  originX?: number;
  originY?: number;
  scale?: number;
  teamMask?: SpriteFramePattern;
  /** Unit entries only: frame count per anim, overriding the voxel model's counts. */
  frames?: Record<string, number>;
}

export interface SpriteManifest {
  version: number;
  atlases: SpriteAtlasDef[];
  /** Keyed by sprite id, e.g. "building:HOUSE", "unit:VILLAGER", "resource:WOOD:snow". */
  sprites: Record<string, SpriteEntryDef>;
}

export const EMPTY_SPRITE_MANIFEST: SpriteManifest = { version: 1, atlases: [], sprites: {} };

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

  const sprites: Record<string, SpriteEntryDef> = {};
  const rawSprites = raw.sprites ?? {};
  if (!isRecord(rawSprites)) problems.push('"sprites" must be an object');
  for (const [id, item] of Object.entries(isRecord(rawSprites) ? rawSprites : {})) {
    const entry = parseEntry(id, item, atlasKeys, problems);
    if (entry) sprites[id] = entry;
  }

  const version = typeof raw.version === 'number' ? raw.version : 1;
  return { manifest: { version, atlases, sprites }, problems };
}

function parseEntry(
  id: string,
  item: unknown,
  atlasKeys: ReadonlySet<string>,
  problems: string[]
): SpriteEntryDef | null {
  if (!isRecord(item) || !isNonEmptyString(item.atlas) || !isNonEmptyString(item.frame)) {
    problems.push(`sprites["${id}"] needs string "atlas" and "frame"`);
    return null;
  }
  if (!atlasKeys.has(item.atlas)) {
    problems.push(`sprites["${id}"] references unknown atlas "${item.atlas}"`);
    return null;
  }
  const entry: SpriteEntryDef = { atlas: item.atlas, frame: item.frame };
  for (const field of ['originX', 'originY', 'scale'] as const) {
    const value = item[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`sprites["${id}"].${field} must be a finite number`);
      continue;
    }
    entry[field] = value;
  }
  if (item.teamMask !== undefined) {
    const mask = item.teamMask;
    const maskAtlas = isRecord(mask) ? mask.atlas ?? item.atlas : undefined;
    if (!isRecord(mask) || !isNonEmptyString(mask.frame) || !isNonEmptyString(maskAtlas) ||
      !atlasKeys.has(maskAtlas)) {
      problems.push(`sprites["${id}"].teamMask needs a "frame" and a known "atlas"`);
    } else {
      entry.teamMask = { atlas: maskAtlas, frame: mask.frame };
    }
  }
  if (item.frames !== undefined) {
    if (!isRecord(item.frames)) {
      problems.push(`sprites["${id}"].frames must be an object of anim -> count`);
    } else {
      const frames: Record<string, number> = {};
      for (const [anim, count] of Object.entries(item.frames)) {
        if (typeof count === 'number' && Number.isInteger(count) && count > 0) frames[anim] = count;
        else problems.push(`sprites["${id}"].frames.${anim} must be a positive integer`);
      }
      entry.frames = frames;
    }
  }
  return entry;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
