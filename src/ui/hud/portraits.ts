/**
 * Portrait art for the selection panel, production queue and multi-select
 * grid. Units use the painted portraits in public/assets/ui/portraits/units
 * when that folder ships (its index.json maps UnitDefId names to files);
 * buildings are cropped at runtime from the sprite atlas the scene already
 * loaded (public/assets/sprites/manifest.json says which frame). Anything
 * without art falls back to the monochrome icon, so callers always get
 * something to show.
 */

import { atlasTextureKey } from '../../render/sprites/sprite-manifest';
import { BuildingDefId, UnitDefId } from '../../sim/defs';
import { getGame } from '../game-bridge';

const UNIT_DIR = '/assets/ui/portraits/units/';
const MANIFEST_URL = '/assets/sprites/manifest.json';
/** Building crops are rendered at this size and shown scaled down. */
const BUILDING_PX = 96;

interface UnitIndex {
  units?: Record<string, string>;
}

interface ManifestVariant {
  atlas: string;
  frame: string;
}

interface ManifestAsset {
  kind: string;
  defId?: string;
  variants?: Record<string, ManifestVariant>;
  eras?: string[];
  default?: string;
}

interface Manifest {
  eraOrder?: string[];
  assets?: Record<string, ManifestAsset>;
}

const unitUrls = new Map<number, string>();
const buildingUrls = new Map<string, string | null>();
let manifest: Manifest | null = null;
let started = false;

function nameOf(table: Record<string, number>, id: number): string | undefined {
  return Object.keys(table).find((k) => table[k] === id);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    // A missing folder can come back as the SPA's index.html.
    if (!type.includes('json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Start loading both indexes once; portraits appear as soon as they land. */
export function loadPortraits(): void {
  if (started) return;
  started = true;
  void fetchJson<UnitIndex>(`${UNIT_DIR}index.json`).then((index) => {
    for (const [name, file] of Object.entries(index?.units ?? {})) {
      const id = (UnitDefId as Record<string, number>)[name];
      if (id !== undefined && typeof file === 'string') unitUrls.set(id, `${UNIT_DIR}${file}`);
    }
  });
  void fetchJson<Manifest>(MANIFEST_URL).then((m) => {
    manifest = m;
  });
}

export function unitPortraitUrl(unitDefId: number): string | null {
  return unitUrls.get(unitDefId) ?? null;
}

function buildingVariant(defId: number, age: number): ManifestVariant | null {
  const name = nameOf(BuildingDefId, defId);
  if (!manifest?.assets || !name) return null;
  const asset = Object.values(manifest.assets).find((a) => a.kind === 'building' && a.defId === name);
  if (!asset?.variants) return null;
  const order = manifest.eraOrder ?? [];
  // Latest era the building has art for, up to the player's current age.
  let best = asset.default ?? Object.keys(asset.variants)[0];
  for (let i = 0; i <= age && i < order.length; i++) {
    const era = order[i]!;
    if (asset.variants[era]) best = era;
  }
  return best ? (asset.variants[best] ?? null) : null;
}

/** A square crop of the building sprite (data URL), or null without art. */
export function buildingPortraitUrl(defId: number, age: number): string | null {
  const variant = buildingVariant(defId, age);
  if (!variant) return null;
  const key = `${variant.atlas}/${variant.frame}`;
  if (buildingUrls.has(key)) return buildingUrls.get(key) ?? null;
  const textures = getGame()?.textures;
  const atlas = atlasTextureKey(variant.atlas);
  if (!textures?.exists(atlas)) return null;
  const frame = textures.getFrame(atlas, variant.frame);
  const image = frame?.source?.image as CanvasImageSource | undefined;
  if (!frame || !image) {
    buildingUrls.set(key, null);
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = BUILDING_PX;
  canvas.height = BUILDING_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Buildings are wide: take a centred square as tall as the sprite, so the
  // facade fills the frame instead of floating in a letterbox.
  const side = Math.min(frame.cutWidth, frame.cutHeight);
  const sx = frame.cutX + (frame.cutWidth - side) / 2;
  const sy = frame.cutY + (frame.cutHeight - side);
  ctx.drawImage(image, sx, sy, side, side, 0, 0, BUILDING_PX, BUILDING_PX);
  const url = canvas.toDataURL('image/png');
  buildingUrls.set(key, url);
  return url;
}

/** Portrait for an entity kind key (`u<def>` / `b<def>` / 'foundation'). */
export function portraitForKey(key: string, age: number): string | null {
  if (key.startsWith('u')) return unitPortraitUrl(Number(key.slice(1)));
  if (key.startsWith('b')) return buildingPortraitUrl(Number(key.slice(1)), age);
  return null;
}
