/**
 * One on-screen entity sprite, driven by a {@link SpriteRef}. Wraps the base
 * sprite plus an optional team-colour mask (atlas art) and an optional ground
 * shadow on the shadow layer, so renderers stay identical whether a ref comes
 * from a voxel bake or an atlas frame.
 *
 * Team masks: the mask frame's RGB carries the colour frame's shading and its
 * alpha the team coverage, so a plain tinted overlay in normal blending gives
 * `mix(rgb, teamColour * shade, coverage)` and stays in the atlas batch.
 */

import { TINT_ADD, TINT_MULTIPLY } from '../effects/fx-constants';
import type { ShadowRef, SpriteRef } from '../sprites/sprite-source';
import type { EntityLayer } from './entity-layer';

/** Keeps the mask right above its base in the depth-sorted layer. */
const MASK_DEPTH_OFFSET = 0.001;

export interface SpriteViewLayers {
  entities: EntityLayer;
  shadows: Phaser.GameObjects.Container;
}

export class SpriteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private mask: Phaser.GameObjects.Image | null = null;
  private shadow: Phaser.GameObjects.Image | null = null;
  private shadowRef: ShadowRef | undefined;
  private current: SpriteRef;
  private tint: number | null = null;
  /** Additive hit-flash colour, 0 = none. Wins over `tint` while set. */
  private flash = 0;
  private alpha = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layers: SpriteViewLayers,
    ref: SpriteRef,
    x: number,
    y: number
  ) {
    this.current = ref;
    this.sprite = scene.add.sprite(x, y, ref.texture, ref.frame);
    this.sprite.setOrigin(ref.originX, ref.originY);
    this.sprite.setScale(ref.scale);
    layers.entities.add(this.sprite);
    this.syncMask();
    this.syncShadow();
  }

  get ref(): SpriteRef {
    return this.current;
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  /** Switch to another ref. Identity-equal refs are free. */
  apply(ref: SpriteRef): void {
    if (ref === this.current) return;
    const textureChanged = ref.texture !== this.current.texture || ref.frame !== this.current.frame;
    this.current = ref;
    if (textureChanged) this.sprite.setTexture(ref.texture, ref.frame);
    this.sprite.setOrigin(ref.originX, ref.originY);
    this.sprite.setScale(ref.scale);
    this.syncMask();
    this.syncShadow();
  }

  setPosition(x: number, y: number): void {
    if (this.sprite.x === x && this.sprite.y === y) return;
    this.sprite.setPosition(x, y);
    this.mask?.setPosition(x, y);
    this.shadow?.setPosition(x, y);
  }

  setDepth(depth: number): void {
    this.layers.entities.setDepth(this.sprite, depth);
    if (this.mask) this.layers.entities.setDepth(this.mask, depth + MASK_DEPTH_OFFSET);
  }

  setAlpha(alpha: number): void {
    if (alpha === this.alpha) return;
    this.alpha = alpha;
    this.sprite.setAlpha(alpha);
    this.mask?.setAlpha(alpha);
    this.shadow?.setAlpha((this.shadowRef?.alpha ?? 1) * alpha);
  }

  setTint(tint: number): void {
    if (tint === this.tint) return;
    this.tint = tint;
    this.applySpriteTint();
    this.applyMaskTint();
  }

  clearTint(): void {
    if (this.tint === null) return;
    this.tint = null;
    this.applySpriteTint();
    this.applyMaskTint();
  }

  /**
   * Additive flash (hit feedback): `color` is added to the art, 0 turns it
   * off and restores the regular tint.
   */
  setFlash(color: number): void {
    if (color === this.flash) return;
    this.flash = color;
    this.applySpriteTint();
    this.applyMaskTint();
  }

  /** Texture, frame, origin, scale and position of the base sprite (death / collapse copies). */
  snapshot(): SpriteSnapshot {
    const s = this.sprite;
    const mask = this.mask && this.current.teamMask
      ? { frame: this.current.teamMask.frame, tint: this.current.teamMask.tint }
      : undefined;
    return {
      texture: s.texture.key,
      frame: s.frame.name,
      x: s.x,
      y: s.y,
      originX: s.originX,
      originY: s.originY,
      scale: s.scaleX,
      flipX: s.flipX,
      depth: s.depth,
      alpha: this.alpha,
      top: this.current.top,
      mask,
    };
  }

  /** Tint when given, plain colours when null. */
  setTintOrClear(tint: number | null): void {
    if (tint === null) this.clearTint();
    else this.setTint(tint);
  }

  destroy(): void {
    this.mask?.destroy();
    this.mask = null;
    this.shadow?.destroy();
    this.shadow = null;
    this.sprite.destroy();
  }

  private syncMask(): void {
    const maskRef = this.current.teamMask;
    if (!maskRef) {
      this.mask?.destroy();
      this.mask = null;
      return;
    }
    if (!this.mask) {
      this.mask = this.scene.add.image(this.sprite.x, this.sprite.y, maskRef.texture, maskRef.frame);
      this.layers.entities.add(this.mask);
    } else {
      this.mask.setTexture(maskRef.texture, maskRef.frame);
    }
    this.mask.setOrigin(this.current.originX, this.current.originY);
    this.mask.setScale(this.current.scale);
    this.mask.setAlpha(this.alpha);
    this.layers.entities.setDepth(this.mask, this.sprite.depth + MASK_DEPTH_OFFSET);
    this.applyMaskTint();
  }

  private syncShadow(): void {
    const ref = this.current.shadow;
    this.shadowRef = ref;
    if (!ref) {
      this.shadow?.destroy();
      this.shadow = null;
      return;
    }
    if (!this.shadow) {
      this.shadow = this.scene.add.image(this.sprite.x, this.sprite.y, ref.texture, ref.frame);
      this.layers.shadows.add(this.shadow);
    } else {
      this.shadow.setTexture(ref.texture, ref.frame);
    }
    this.shadow.setOrigin(ref.originX, ref.originY);
    this.shadow.setScale(ref.scale, ref.scale * (ref.scaleY ?? 1));
    this.shadow.setAlpha((ref.alpha ?? 1) * this.alpha);
  }

  private applySpriteTint(): void {
    if (this.flash !== 0) {
      this.sprite.setTint(this.flash).setTintMode(TINT_ADD);
    } else if (this.tint !== null) {
      this.sprite.setTint(this.tint).setTintMode(TINT_MULTIPLY);
    } else {
      this.sprite.clearTint();
    }
  }

  private applyMaskTint(): void {
    const maskRef = this.current.teamMask;
    if (!this.mask || !maskRef) return;
    const base = this.tint === null ? maskRef.tint : multiplyColor(maskRef.tint, this.tint);
    this.mask.setTint(this.flash === 0 ? base : addColor(base, this.flash));
  }
}

export interface SpriteSnapshot {
  texture: string;
  frame: string | number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  scale: number;
  flipX: boolean;
  depth: number;
  alpha: number;
  top: number;
  /** Team-colour mask frame (same texture) and its tint, when drawn. */
  mask?: { frame?: string; tint: number };
}

/** Per-channel saturating add of two 0xRRGGBB colours. */
export function addColor(a: number, b: number): number {
  const r = Math.min(255, ((a >> 16) & 0xff) + ((b >> 16) & 0xff));
  const g = Math.min(255, ((a >> 8) & 0xff) + ((b >> 8) & 0xff));
  const bl = Math.min(255, (a & 0xff) + (b & 0xff));
  return (r << 16) | (g << 8) | bl;
}

/** Per-channel multiply of two 0xRRGGBB colours (how a tint darkens a team colour). */
export function multiplyColor(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255);
  const g = Math.round((((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255);
  const bl = Math.round(((a & 0xff) * (b & 0xff)) / 255);
  return (r << 16) | (g << 8) | bl;
}
