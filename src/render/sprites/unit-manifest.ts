/**
 * Pre-rendered unit sprites (`public/assets/sprites/units-manifest.json`), as
 * written by `scripts/blender/render_units.py`. Separate from the world art
 * manifest so the two pipelines never write the same file. Shape and frame
 * naming are documented in docs/UNIT_SPRITES.md.
 *
 * Like the world manifest it may be absent or partly invalid: invalid units
 * are dropped with a console warning and keep rendering from voxel bakes.
 */

import { UnitDefId } from '@sim/defs';
import { SPRITE_ASSET_BASE, atlasTextureKey, type SpriteAtlasDef } from './sprite-manifest';

export const UNIT_MANIFEST_KEY = 'unit-sprite-manifest';
const UNIT_MANIFEST_FILE = 'units-manifest.json';

export interface UnitAnimDef {
  frames: number;
  /** ms per frame for time-driven anims (idle, attack, work, death). */
  ms: number;
  /** Tiles travelled per full cycle for distance-driven anims (walks). 0 = time driven. */
  stride: number;
  /** Attack / work anims: frame on which the blow lands or the shot leaves (-1 = none). */
  hit: number;
  /** Play once and hold the last frame (death). */
  once: boolean;
  /** 'frame' = a shadow per frame, else one per facing from frame 0. */
  shadowPerFrame: boolean;
}

export interface UnitArtDef {
  /** Unit name in the atlas frame names, e.g. "villager". */
  name: string;
  unitDefIds: readonly number[];
  /** Source size of every frame (all frames of a unit share it). */
  size: readonly [number, number];
  /** Feet position inside that source size. */
  anchor: readonly [number, number];
  /** px from the feet to the top of the head (bars, hit markers). */
  height: number;
  /** Selection ring full width / height, px at 1x. */
  ring: readonly [number, number];
  anims: Readonly<Record<string, UnitAnimDef>>;
  /** Alias name -> real anim name (no extra frames in the atlas). */
  aliases: Readonly<Record<string, string>>;
  /** Projectile / muzzle point per facing (screen px from the feet), at the hit frame. */
  projectile?: ReadonlyArray<readonly [number, number]>;
}

export interface UnitManifest {
  version: number;
  atlases: readonly SpriteAtlasDef[];
  units: readonly UnitArtDef[];
}

export const EMPTY_UNIT_MANIFEST: UnitManifest = { version: 1, atlases: [], units: [] };

/** Atlas frame name of one unit frame; `part` 'm' = team mask, 's' = shadow. */
export function unitFrameName(unit: string, anim: string, facing: number, frame: number, part?: 'm' | 's'): string {
  const base = `${unit}/${anim}/${facing}/${frame}`;
  return part ? `${base}/${part}` : base;
}

/** Validate untrusted manifest JSON. `undefined` / `null` mean "no manifest". */
export function parseUnitManifest(raw: unknown): { manifest: UnitManifest; problems: string[] } {
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { manifest: EMPTY_UNIT_MANIFEST, problems };
  if (!isRecord(raw)) return { manifest: EMPTY_UNIT_MANIFEST, problems: ['unit manifest is not a JSON object'] };

  const atlases: SpriteAtlasDef[] = [];
  const keys = new Set<string>();
  for (const [i, item] of (Array.isArray(raw.atlases) ? raw.atlases : []).entries()) {
    if (!isRecord(item) || !isText(item.key) || !isText(item.image) || !isText(item.json) || keys.has(item.key)) {
      problems.push(`atlases[${i}] needs a unique "key", "image" and "json"`);
      continue;
    }
    keys.add(item.key);
    atlases.push({ key: item.key, image: item.image, json: item.json });
  }

  const units: UnitArtDef[] = [];
  const claimed = new Set<number>();
  for (const [name, item] of Object.entries(isRecord(raw.units) ? raw.units : {})) {
    const unit = parseUnit(name, item, problems);
    if (!unit) continue;
    const fresh = unit.unitDefIds.filter((id) => !claimed.has(id));
    if (fresh.length === 0) {
      problems.push(`units["${name}"] has no unit def that is not drawn already`);
      continue;
    }
    for (const id of fresh) claimed.add(id);
    units.push({ ...unit, unitDefIds: fresh });
  }
  if (units.length > 0 && atlases.length === 0) problems.push('unit manifest lists units but no atlases');
  const version = typeof raw.version === 'number' ? raw.version : 1;
  return { manifest: { version, atlases: units.length > 0 ? atlases : [], units: atlases.length > 0 ? units : [] }, problems };
}

function parseUnit(name: string, item: unknown, problems: string[]): UnitArtDef | null {
  if (!isRecord(item)) {
    problems.push(`units["${name}"] is not an object`);
    return null;
  }
  const ids = (Array.isArray(item.defIds) ? item.defIds : [])
    .map((id) => (isText(id) ? (UnitDefId as Record<string, number>)[id] : undefined))
    .filter((id): id is number => typeof id === 'number');
  const size = pair(item.size);
  const anchor = pair(item.anchor);
  if (ids.length === 0 || !size || !anchor || size[0] <= 0 || size[1] <= 0) {
    problems.push(`units["${name}"] needs known "defIds", a "size" and an "anchor"`);
    return null;
  }
  const anims: Record<string, UnitAnimDef> = {};
  const aliases: Record<string, string> = {};
  for (const [anim, a] of Object.entries(isRecord(item.anims) ? item.anims : {})) {
    if (!isRecord(a)) continue;
    if (isText(a.alias)) {
      aliases[anim] = a.alias;
      continue;
    }
    const frames = positiveInt(a.frames);
    if (!frames) {
      problems.push(`units["${name}"].anims["${anim}"] needs "frames"`);
      continue;
    }
    anims[anim] = {
      frames,
      ms: positive(a.ms) ?? 120,
      stride: positive(a.stride) ?? 0,
      hit: typeof a.hit === 'number' && a.hit >= 0 && a.hit < frames ? Math.floor(a.hit) : -1,
      once: a.once === true,
      shadowPerFrame: a.shadow === 'frame',
    };
  }
  for (const [alias, target] of Object.entries(aliases)) {
    if (!anims[target]) {
      problems.push(`units["${name}"].anims["${alias}"] aliases unknown anim "${target}"`);
      delete aliases[alias];
    }
  }
  if (!anims.idle) {
    problems.push(`units["${name}"] needs an "idle" anim`);
    return null;
  }
  const ring = pair(item.ring) ?? [24, 10];
  const unit: UnitArtDef = {
    name,
    unitDefIds: ids,
    size,
    anchor,
    height: positive(item.height) ?? 36,
    ring,
    anims,
    aliases,
  };
  if (Array.isArray(item.projectile) && item.projectile.length === 8) {
    const pts = item.projectile.map(pair);
    if (pts.every((p): p is [number, number] => p !== null)) unit.projectile = pts;
  }
  return unit;
}

/** Queue the unit manifest and, once it arrives, its atlases. Absent file = voxel units. */
export function queueUnitManifest(load: Phaser.Loader.LoaderPlugin): void {
  load.once(`filecomplete-json-${UNIT_MANIFEST_KEY}`, (_key: string, _type: string, data: unknown) => {
    const { manifest, problems } = parseUnitManifest(data);
    for (const problem of problems) {
      // eslint-disable-next-line no-console
      console.warn(`[Kingdoms] unit manifest: ${problem}`);
    }
    for (const atlas of manifest.atlases) {
      load.atlas(atlasTextureKey(atlas.key), SPRITE_ASSET_BASE + atlas.image, SPRITE_ASSET_BASE + atlas.json);
    }
  });
  load.json(UNIT_MANIFEST_KEY, SPRITE_ASSET_BASE + UNIT_MANIFEST_FILE);
}

/** The parsed unit manifest from the JSON cache (empty when it never loaded). */
export function readUnitManifest(cache: Phaser.Cache.CacheManager): UnitManifest {
  const raw: unknown = cache.json.exists(UNIT_MANIFEST_KEY) ? cache.json.get(UNIT_MANIFEST_KEY) : undefined;
  return parseUnitManifest(raw).manifest;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  return typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const v = positive(value);
  return v === undefined ? undefined : Math.floor(v);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
