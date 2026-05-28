/**
 * Voxel → iso-projected Phaser texture baker.
 *
 * Take an array of voxels (x, y, z, color) and render them as iso pixel art into
 * a `Phaser.GameObjects.RenderTexture`. The resulting texture is registered with
 * the global Phaser texture manager under `textureKey` and can be used by any
 * sprite via `this.add.sprite(x, y, textureKey)`.
 *
 * Coordinate convention (matches MagicaVoxel + most voxel renderers):
 *   - x/y are the ground plane
 *   - z is up
 *
 * The iso projection is 2:1 (matches our TILE_W=64 / TILE_H=32 game grid). Each
 * voxel renders as three coloured faces with directional shading:
 *   - top    : base colour
 *   - right  : 80% brightness ("sun" side)
 *   - left   : 60% brightness (shadow side)
 *
 * No external tools (no MagicaVoxel, no SpotVox, no Java). The model data is just
 * TypeScript — agent edits the model file, hot-reload re-bakes, sprite updates.
 */

export interface Voxel {
  x: number;
  y: number;
  z: number;
  /** RGB 0xRRGGBB (no alpha; voxels are fully opaque). */
  color: number;
}

export interface VoxelBakeOptions {
  /** Iso width of one voxel in pixels. Height is half of this (2:1). */
  voxelW?: number;
  /** Vertical height of one voxel on screen in pixels. Default = voxelW/2. */
  voxelZ?: number;
  /** Texture key to register under. Must be unique. */
  textureKey: string;
  /** Optional black 1-pixel outline around silhouette + interior edges. */
  outline?: boolean;
  /** Optional stable model bounds. Useful for animation frames with different extents. */
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Bake voxels into a texture. Call once per model at scene boot.
 * Returns the texture key for convenience.
 */
export function bakeVoxelTexture(
  scene: Phaser.Scene,
  voxels: Voxel[],
  opts: VoxelBakeOptions
): string {
  const voxelW = opts.voxelW ?? 6;
  const voxelH = voxelW / 2;
  const voxelZ = opts.voxelZ ?? voxelW / 2;
  const halfW = voxelW / 2;

  if (voxels.length === 0) {
    throw new Error(`bakeVoxelTexture: no voxels for "${opts.textureKey}"`);
  }

  // Compute screen bounds.
  let minSx = Infinity, maxSx = -Infinity;
  let minSy = Infinity, maxSy = -Infinity;
  const boundsVoxels = opts.bounds
    ? [
        { x: opts.bounds.minX, y: opts.bounds.minY, z: opts.bounds.minZ, color: 0 },
        { x: opts.bounds.minX, y: opts.bounds.minY, z: opts.bounds.maxZ, color: 0 },
        { x: opts.bounds.minX, y: opts.bounds.maxY, z: opts.bounds.minZ, color: 0 },
        { x: opts.bounds.minX, y: opts.bounds.maxY, z: opts.bounds.maxZ, color: 0 },
        { x: opts.bounds.maxX, y: opts.bounds.minY, z: opts.bounds.minZ, color: 0 },
        { x: opts.bounds.maxX, y: opts.bounds.minY, z: opts.bounds.maxZ, color: 0 },
        { x: opts.bounds.maxX, y: opts.bounds.maxY, z: opts.bounds.minZ, color: 0 },
        { x: opts.bounds.maxX, y: opts.bounds.maxY, z: opts.bounds.maxZ, color: 0 },
      ]
    : voxels;
  for (const v of boundsVoxels) {
    const sx = (v.x - v.y) * halfW;
    const sy = (v.x + v.y) * (voxelH / 2) - v.z * voxelZ;
    if (sx - halfW < minSx) minSx = sx - halfW;
    if (sx + halfW > maxSx) maxSx = sx + halfW;
    if (sy < minSy) minSy = sy;
    if (sy + voxelH + voxelZ > maxSy) maxSy = sy + voxelH + voxelZ;
  }
  const PAD = 2;
  const width = Math.ceil(maxSx - minSx) + PAD * 2;
  const height = Math.ceil(maxSy - minSy) + PAD * 2;
  const offsetX = -minSx + PAD;
  const offsetY = -minSy + PAD;

  // Sort back-to-front. For iso projection with our axis convention, back voxels
  // have lower (x + y + z) sum. Paint those first.
  const sorted = [...voxels].sort((a, b) => {
    const da = a.x + a.y + a.z;
    const db = b.x + b.y + b.z;
    if (da !== db) return da - db;
    // Stable tiebreak: lower z first so vertical columns paint upward.
    return a.z - b.z;
  });

  // Use a Graphics → generateTexture pipeline. Graphics is GPU-friendly for the
  // bake then we throw it away.
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.setVisible(false);

  for (const v of sorted) {
    const sx = (v.x - v.y) * halfW + offsetX;
    const sy = (v.x + v.y) * (voxelH / 2) - v.z * voxelZ + offsetY;

    // AoE2-style softer shading. Top is full brightness; right side ~88%,
    // left side ~72%. The hard 3-tone cut is what gives "minecraft" away —
    // narrower brightness range reads more painterly.
    const top = v.color;
    const right = shade(v.color, 0.88);
    const left = shade(v.color, 0.72);

    // TOP — iso diamond.
    g.fillStyle(top, 1);
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + halfW, sy + voxelH / 2);
    g.lineTo(sx, sy + voxelH);
    g.lineTo(sx - halfW, sy + voxelH / 2);
    g.closePath();
    g.fillPath();

    // RIGHT face — parallelogram.
    g.fillStyle(right, 1);
    g.beginPath();
    g.moveTo(sx, sy + voxelH);
    g.lineTo(sx + halfW, sy + voxelH / 2);
    g.lineTo(sx + halfW, sy + voxelH / 2 + voxelZ);
    g.lineTo(sx, sy + voxelH + voxelZ);
    g.closePath();
    g.fillPath();

    // LEFT face — parallelogram.
    g.fillStyle(left, 1);
    g.beginPath();
    g.moveTo(sx, sy + voxelH);
    g.lineTo(sx - halfW, sy + voxelH / 2);
    g.lineTo(sx - halfW, sy + voxelH / 2 + voxelZ);
    g.lineTo(sx, sy + voxelH + voxelZ);
    g.closePath();
    g.fillPath();

    if (opts.outline) {
      g.lineStyle(1, 0x000000, 0.5);
      g.strokeRect(sx - halfW, sy, voxelW, voxelH + voxelZ);
    }
  }

  // Generate the texture from the graphics object.
  g.generateTexture(opts.textureKey, width, height);
  g.destroy();
  return opts.textureKey;
}

/** Multiply a 0xRRGGBB colour by a brightness factor, clamping to [0,255]. */
function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const gg = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (gg << 8) | b;
}
