/**
 * Animated parts of the pixel-art buildings: banners and pennants flutter,
 * windmill sails turn. The Blender pipeline leaves those parts out of the
 * building sprite and renders them as looping overlay frames (same size and
 * anchor, team mask per frame), see `SpriteRef.overlays`.
 *
 * Render-only and keyed like the sprite pools: per frame `begin()`, `show()`
 * every building drawn, `end()` drops the rest. Each building gets a stable
 * phase from its key so a town does not flap in lockstep, and gusts that roll
 * across the map from the left speed the flags up for a moment. Frozen on
 * frame 0 under prefers-reduced-motion and for remembered (fogged) buildings.
 */

import type { EntityLayer } from '../entities/entity-layer';
import type { SpriteView } from '../entities/sprite-view';
import type { SpriteOverlayRef, SpriteRef } from '../sprites/sprite-source';
import { reducedMotion } from './motion-prefs';

/** Loop length per part group, ms. */
const LOOP_MS: Readonly<Record<string, number>> = { flag: 720, sails: 2600 };
const DEFAULT_LOOP_MS = 900;
/** Overlay draws right above its building (its team mask goes above that). */
const DEPTH_OFFSET = 0.002;
const MASK_DEPTH_OFFSET = 0.003;

interface PartImages {
  ref: SpriteOverlayRef;
  image: Phaser.GameObjects.Image;
  mask: Phaser.GameObjects.Image | null;
  frame: number;
}

interface Animated {
  parts: PartImages[];
  source: SpriteRef;
  phase: number;
}

export class PartAnimator<K extends string | number> {
  private readonly items = new Map<K, Animated>();
  private readonly seen = new Set<K>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly entities: EntityLayer
  ) {}

  begin(): void {
    this.seen.clear();
  }

  /**
   * Draw the overlays of `ref` over `view` (no-op without overlays). `frozen`
   * holds frame 0 (fog memory); `tint` multiplies like the sprite's own tint.
   */
  show(key: K, view: SpriteView, ref: SpriteRef, tint: number | null, frozen = false): void {
    if (!ref.overlays || ref.overlays.length === 0) return;
    this.seen.add(key);
    let item = this.items.get(key);
    if (item && item.source !== ref) {
      this.destroyItem(item);
      item = undefined;
    }
    if (!item) {
      item = { parts: ref.overlays.map((o) => this.create(ref, o)), source: ref, phase: phaseOf(key) };
      this.items.set(key, item);
    }
    const s = view.sprite;
    const now = this.scene.time.now;
    const still = frozen || reducedMotion();
    for (const part of item.parts) {
      const n = part.ref.frames.length;
      const frame = still ? 0 : frameAt(now, part.ref.group, item.phase, s.x, n);
      if (frame !== part.frame) {
        part.frame = frame;
        part.image.setFrame(part.ref.frames[frame]);
        const maskFrame = part.ref.masks[frame];
        if (part.mask && maskFrame) part.mask.setFrame(maskFrame);
      }
      for (const img of part.mask ? [part.image, part.mask] : [part.image]) {
        if (img.x !== s.x || img.y !== s.y) img.setPosition(s.x, s.y);
        if (img.alpha !== s.alpha) img.setAlpha(s.alpha);
        if (img.visible !== s.visible) img.setVisible(s.visible);
      }
      this.entities.setDepth(part.image, s.depth + DEPTH_OFFSET);
      if (part.mask) this.entities.setDepth(part.mask, s.depth + MASK_DEPTH_OFFSET);
      applyTint(part.image, tint);
      if (part.mask) part.mask.setTint(multiply(ref.teamMask?.tint ?? 0xffffff, tint ?? 0xffffff));
    }
  }

  end(): void {
    for (const [key, item] of this.items) {
      if (this.seen.has(key)) continue;
      this.destroyItem(item);
      this.items.delete(key);
    }
  }

  clear(): void {
    for (const item of this.items.values()) this.destroyItem(item);
    this.items.clear();
    this.seen.clear();
  }

  get size(): number {
    return this.items.size;
  }

  private create(ref: SpriteRef, overlay: SpriteOverlayRef): PartImages {
    const image = this.scene.add.image(0, 0, ref.texture, overlay.frames[0]);
    image.setOrigin(ref.originX, ref.originY).setScale(ref.scale);
    this.entities.add(image);
    let mask: Phaser.GameObjects.Image | null = null;
    const maskFrame = overlay.masks[0];
    if (maskFrame && ref.teamMask) {
      mask = this.scene.add.image(0, 0, ref.texture, maskFrame);
      mask.setOrigin(ref.originX, ref.originY).setScale(ref.scale);
      this.entities.add(mask);
    }
    return { ref: overlay, image, mask, frame: 0 };
  }

  private destroyItem(item: Animated): void {
    for (const part of item.parts) {
      part.image.destroy();
      part.mask?.destroy();
    }
  }
}

/** Loop frame at `now`: stable phase per building, gusts rolling in from the left speed flags up. */
export function frameAt(now: number, group: string, phase: number, screenX: number, frames: number): number {
  if (frames <= 1) return 0;
  const loop = LOOP_MS[group] ?? DEFAULT_LOOP_MS;
  let t = now / loop + phase;
  if (group === 'flag') {
    // Integral of a speed that swells from 0.75x to 1.35x as a gust passes.
    const g = now / 5200 - screenX * 0.0016;
    t += (0.3 * Math.sin(g * Math.PI * 2) * 5200) / (loop * Math.PI * 2);
  }
  const f = Math.floor((((t % 1) + 1) % 1) * frames);
  return Math.min(frames - 1, f);
}

function phaseOf(key: string | number): number {
  const text = String(key);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function applyTint(img: Phaser.GameObjects.Image, tint: number | null): void {
  if (tint === null) {
    if (img.isTinted) img.clearTint();
  } else {
    img.setTint(tint);
  }
}

function multiply(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255);
  const g = Math.round((((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255);
  const bl = Math.round(((a & 0xff) * (b & 0xff)) / 255);
  return (r << 16) | (g << 8) | bl;
}
