/**
 * Unit sprites from the pre-rendered style A unit atlases
 * (`units-manifest.json`, scripts/blender/render_units.py). Answers only unit
 * queries; everything else is null so the registry falls through.
 *
 * Every frame of a unit shares one source size and feet anchor, so the origin
 * is a per-unit constant; mask (`/m`) and shadow (`/s`) frames line up with
 * the base frame through the atlas trim offsets. Unknown anims fall back to
 * an alias, then to idle, so a covered unit is never blank.
 */

import { FACINGS, type Facing } from './facing';
import { atlasTextureKey } from './sprite-manifest';
import type {
  ShadowRef,
  SpriteRef,
  SpriteSource,
  TeamMaskRef,
  UnitAnimInfo,
  UnitArtInfo,
  UnitSpriteQuery,
} from './sprite-source';
import { unitFrameName, type UnitArtDef, type UnitManifest } from './unit-manifest';

/** Anim names the animator asks for that older art calls differently. */
const ANIM_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  harvest: ['chop', 'attack'],
  carry: ['carry_food', 'move'],
  carry_food: ['carry', 'move'],
  carry_wood: ['carry', 'move'],
  carry_gold: ['carry', 'move'],
  carry_stone: ['carry', 'move'],
  chop: ['harvest', 'attack'],
  mine: ['harvest', 'attack'],
  farm: ['harvest', 'attack'],
  forage: ['harvest', 'attack'],
  build: ['attack'],
  attack: ['idle'],
  death: ['idle'],
};

/** Looks up which loaded atlas texture holds a frame. */
export type UnitFrameLookup = (frame: string) => string | null;

class UnitArt implements UnitArtInfo {
  readonly height: number;
  readonly ring: readonly [number, number];
  private readonly resolved = new Map<string, string | null>();

  constructor(readonly def: UnitArtDef) {
    this.height = def.height;
    this.ring = def.ring;
  }

  /** Anim actually drawn for a requested name (aliases, fallbacks, idle). */
  resolve(anim: string): string {
    let hit = this.resolved.get(anim);
    if (hit === undefined) {
      hit = this.find(anim, 0);
      this.resolved.set(anim, hit);
    }
    return hit ?? 'idle';
  }

  has(anim: string): boolean {
    return this.find(anim, 0) !== null;
  }

  anim(anim: string): UnitAnimInfo | null {
    const name = this.find(anim, 0);
    const a = name ? this.def.anims[name] : undefined;
    return a ? { frames: a.frames, ms: a.ms, stride: a.stride, hit: a.hit, once: a.once } : null;
  }

  projectile(facing: Facing): { dx: number; dy: number } | null {
    const p = this.def.projectile?.[FACINGS.indexOf(facing)];
    return p ? { dx: p[0], dy: p[1] } : null;
  }

  private find(anim: string, depth: number): string | null {
    if (this.def.anims[anim]) return anim;
    const alias = this.def.aliases[anim];
    if (alias && this.def.anims[alias]) return alias;
    if (depth > 2) return null;
    for (const next of ANIM_FALLBACKS[anim] ?? []) {
      const found = this.find(next, depth + 1);
      if (found) return found;
    }
    return null;
  }
}

export class UnitAtlasSource implements SpriteSource {
  private readonly byDef = new Map<number, UnitArt>();
  private readonly refs = new Map<string, SpriteRef | null>();

  constructor(
    manifest: UnitManifest,
    private readonly lookup: UnitFrameLookup,
    private readonly teamColors: readonly number[]
  ) {
    for (const def of manifest.units) {
      // Only units whose idle frame is really in a loaded atlas count as covered.
      if (!lookup(unitFrameName(def.name, 'idle', 1, 0))) continue;
      const art = new UnitArt(def);
      for (const id of def.unitDefIds) this.byDef.set(id, art);
    }
  }

  get isEmpty(): boolean {
    return this.byDef.size === 0;
  }

  /** Unit kinds this source draws (their voxel bakes can be skipped). */
  get coveredUnitDefIds(): number[] {
    return [...this.byDef.keys()];
  }

  unitArt(unitDefId: number): UnitArtInfo | null {
    return this.byDef.get(unitDefId) ?? null;
  }

  unit(query: UnitSpriteQuery): SpriteRef | null {
    const art = this.byDef.get(query.unitDefId);
    if (!art) return null;
    const anim = art.resolve(query.anim);
    const spec = art.def.anims[anim];
    const frame = Math.max(0, Math.min(spec.frames - 1, Math.floor(query.frame)));
    const facing = Math.max(0, FACINGS.indexOf(query.facing));
    const key = `${query.unitDefId}|${query.playerId}|${anim}|${facing}|${frame}`;
    const cached = this.refs.get(key);
    if (cached !== undefined) return cached;
    const ref = this.build(art.def, query.playerId, anim, facing, frame, spec.shadowPerFrame);
    this.refs.set(key, ref);
    return ref;
  }

  unitFrameCount(unitDefId: number, anim: string): number {
    const art = this.byDef.get(unitDefId);
    if (!art || !art.has(anim)) return 0;
    return art.def.anims[art.resolve(anim)].frames;
  }

  building(): SpriteRef | null {
    return null;
  }

  rubble(): SpriteRef | null {
    return null;
  }

  resource(): SpriteRef | null {
    return null;
  }

  stump(): SpriteRef | null {
    return null;
  }

  mapFeature(): SpriteRef | null {
    return null;
  }

  private build(
    def: UnitArtDef,
    playerId: number,
    anim: string,
    facing: number,
    frame: number,
    shadowPerFrame: boolean
  ): SpriteRef | null {
    const name = unitFrameName(def.name, anim, facing, frame);
    const texture = this.lookup(name);
    if (!texture) return null;
    const originX = def.anchor[0] / def.size[0];
    const originY = def.anchor[1] / def.size[1];
    const ref: SpriteRef = {
      texture,
      frame: name,
      originX,
      originY,
      scale: 1,
      anchor: 'center',
      top: def.height,
      source: 'atlas',
    };
    const maskName = unitFrameName(def.name, anim, facing, frame, 'm');
    const maskTexture = this.lookup(maskName);
    if (maskTexture === texture) {
      const mask: TeamMaskRef = { texture, frame: maskName, tint: this.teamColors[playerId] ?? 0xffffff };
      ref.teamMask = mask;
    }
    const shadowName = unitFrameName(def.name, anim, facing, shadowPerFrame ? frame : 0, 's');
    const shadowTexture = this.lookup(shadowName);
    if (shadowTexture) {
      const shadow: ShadowRef = { texture: shadowTexture, frame: shadowName, originX, originY, scale: 1 };
      ref.shadow = shadow;
    }
    return ref;
  }
}

/** Frame -> texture lookup over the loaded unit atlases. */
export function unitFrameLookup(
  textures: Phaser.Textures.TextureManager,
  atlasKeys: readonly string[]
): UnitFrameLookup {
  const keys = atlasKeys.map(atlasTextureKey).filter((key) => textures.exists(key));
  const cache = new Map<string, string | null>();
  return (frame) => {
    let hit = cache.get(frame);
    if (hit !== undefined) return hit;
    hit = keys.find((key) => textures.get(key).has(frame)) ?? null;
    cache.set(frame, hit);
    return hit;
  };
}
