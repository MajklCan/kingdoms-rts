/**
 * One on-screen entity sprite, driven by a {@link SpriteRef}. Wraps the base
 * sprite plus an optional team-colour mask sprite (atlas art), so renderers
 * stay identical whether a ref comes from a voxel bake or an atlas frame.
 */

import type { SpriteRef } from '../sprites/sprite-source';
import type { EntityLayer } from './entity-layer';

/** Keeps the mask right above its base in the depth-sorted layer. */
const MASK_DEPTH_OFFSET = 0.001;

export class SpriteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private mask: Phaser.GameObjects.Sprite | null = null;
  private current: SpriteRef;
  private tint: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: EntityLayer,
    ref: SpriteRef,
    x: number,
    y: number
  ) {
    this.current = ref;
    this.sprite = scene.add.sprite(x, y, ref.texture, ref.frame);
    this.sprite.setOrigin(ref.originX, ref.originY);
    this.sprite.setScale(ref.scale);
    layer.add(this.sprite);
    this.syncMask();
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
  }

  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.mask?.setPosition(x, y);
  }

  setDepth(depth: number): void {
    this.layer.setDepth(this.sprite, depth);
    if (this.mask) this.layer.setDepth(this.mask, depth + MASK_DEPTH_OFFSET);
  }

  setAlpha(alpha: number): void {
    this.sprite.setAlpha(alpha);
    this.mask?.setAlpha(alpha);
  }

  setTint(tint: number): void {
    this.tint = tint;
    this.sprite.setTint(tint);
    this.applyMaskTint();
  }

  clearTint(): void {
    this.tint = null;
    this.sprite.clearTint();
    this.applyMaskTint();
  }

  destroy(): void {
    this.mask?.destroy();
    this.mask = null;
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
      this.mask = this.scene.add.sprite(this.sprite.x, this.sprite.y, maskRef.texture, maskRef.frame);
      this.layer.add(this.mask);
    } else {
      this.mask.setTexture(maskRef.texture, maskRef.frame);
    }
    this.mask.setOrigin(this.current.originX, this.current.originY);
    this.mask.setScale(this.current.scale);
    this.mask.setAlpha(this.sprite.alpha);
    this.layer.setDepth(this.mask, this.sprite.depth + MASK_DEPTH_OFFSET);
    this.applyMaskTint();
  }

  private applyMaskTint(): void {
    const maskRef = this.current.teamMask;
    if (!this.mask || !maskRef) return;
    this.mask.setTint(this.tint === null ? maskRef.tint : multiplyColor(maskRef.tint, this.tint));
  }
}

/** Per-channel multiply of two 0xRRGGBB colours (how a tint darkens a team colour). */
export function multiplyColor(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255);
  const g = Math.round((((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255);
  const bl = Math.round(((a & 0xff) * (b & 0xff)) / 255);
  return (r << 16) | (g << 8) | bl;
}
