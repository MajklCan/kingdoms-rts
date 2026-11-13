/**
 * Post-process for baked voxel sprites: a 1 px outline around the silhouette
 * (8-neighbourhood), written into the transparent padding the baker leaves.
 * Small voxel units read far better against the detailed pre-rendered art
 * with a dark rim; a team-tinted dark rim also helps tell armies apart.
 */

/**
 * Add an outline of `color` (0xRRGGBB) at `alpha` (0..1) around every opaque
 * texel of the canvas-backed texture `key`. No-op for non-canvas textures.
 */
export function outlineCanvasTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  color: number,
  alpha = 0.85
): void {
  if (!textures.exists(key)) return;
  const texture = textures.get(key);
  const source = texture.getSourceImage() as HTMLCanvasElement | HTMLImageElement;
  if (!(source instanceof HTMLCanvasElement)) return;
  const g = source.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  const { width: w, height: h } = source;
  const image = g.getImageData(0, 0, w, h);
  outlinePixels(image.data, w, h, color, alpha);
  g.putImageData(image, 0, 0);
  (texture as Phaser.Textures.CanvasTexture).refresh?.();
}

/** Pure pixel pass (exported for tests): RGBA bytes in place. */
export function outlinePixels(data: Uint8ClampedArray, w: number, h: number, color: number, alpha: number): void {
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) opaque[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  const r = (color >> 16) & 0xff;
  const gg = (color >> 8) & 0xff;
  const b = color & 0xff;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (opaque[i] || data[i * 4 + 3] > 0) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
          if (opaque[yy * w + xx]) {
            edge = true;
            break;
          }
        }
      }
      if (!edge) continue;
      const o = i * 4;
      data[o] = r;
      data[o + 1] = gg;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
}
