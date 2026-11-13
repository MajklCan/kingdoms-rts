/**
 * Half-resolution alpha maps of texture frames, built lazily the first time a
 * frame is asked about. Lets per-frame code ask "is this sprite opaque at
 * this point" (occlusion of units behind trees and buildings) without a
 * canvas readback per query, which `TextureManager.getPixelAlpha` would do.
 */

const SHIFT = 1;

interface AlphaMap {
  w: number;
  h: number;
  data: Uint8Array;
}

type SpriteLike = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

export class AlphaMasks {
  private readonly maps = new Map<Phaser.Textures.Frame, AlphaMap | null>();
  private canvas: HTMLCanvasElement | null = null;

  /** Alpha (0-255) of `sprite` at a point in its parent's space; 0 outside. Ignores rotation. */
  alphaAt(sprite: SpriteLike, x: number, y: number): number {
    const frame = sprite.frame;
    const fx = (x - sprite.x) / sprite.scaleX + sprite.displayOriginX - frame.x;
    const fy = (y - sprite.y) / sprite.scaleY + sprite.displayOriginY - frame.y;
    if (fx < 0 || fy < 0 || fx >= frame.cutWidth || fy >= frame.cutHeight) return 0;
    const map = this.mapFor(frame);
    if (!map) return 255;
    const mx = Math.min(map.w - 1, fx >> SHIFT);
    const my = Math.min(map.h - 1, fy >> SHIFT);
    return map.data[my * map.w + mx];
  }

  /**
   * Px above the sprite's origin of its highest opaque row (art top, not
   * texture top: voxel bakes keep padding for the animation poses). Null
   * when the frame cannot be read.
   */
  opaqueLift(sprite: SpriteLike, minAlpha = 40): number | null {
    const frame = sprite.frame;
    const map = this.mapFor(frame);
    if (!map) return null;
    let row = -1;
    for (let y = 0; y < map.h && row < 0; y++) {
      for (let x = 0; x < map.w; x++) {
        if (map.data[y * map.w + x] >= minAlpha) {
          row = y;
          break;
        }
      }
    }
    if (row < 0) return null;
    return (sprite.displayOriginY - frame.y - (row << SHIFT)) * sprite.scaleY;
  }

  clear(): void {
    this.maps.clear();
  }

  private mapFor(frame: Phaser.Textures.Frame): AlphaMap | null {
    const cached = this.maps.get(frame);
    if (cached !== undefined) return cached;
    const map = this.build(frame);
    this.maps.set(frame, map);
    return map;
  }

  private build(frame: Phaser.Textures.Frame): AlphaMap | null {
    const image = frame.source.image as CanvasImageSource | undefined;
    if (!image || typeof document === 'undefined') return null;
    const w = Math.max(1, frame.cutWidth >> SHIFT);
    const h = Math.max(1, frame.cutHeight >> SHIFT);
    this.canvas ??= document.createElement('canvas');
    const canvas = this.canvas;
    if (canvas.width < w) canvas.width = w;
    if (canvas.height < h) canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.clearRect(0, 0, w, h);
    try {
      g.drawImage(image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, w, h);
      const rgba = g.getImageData(0, 0, w, h).data;
      const data = new Uint8Array(w * h);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
      return { w, h, data };
    } catch {
      return null;
    }
  }
}
