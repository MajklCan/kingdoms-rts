/**
 * Ground of the map. With the Blender art loaded, the tiles are baked into
 * 8x8-tile chunk textures (terrain-baker.ts) once per map: a 64x64 map is 64
 * images, one draw each, plus a texture swap per animated chunk for the
 * water loop. Without the art (missing manifest / atlas) it falls back to the
 * flat-colour bake in voxel/terrain.ts.
 */

import type { MapData } from '@sim/map-gen';
import { MAP } from '../../config';
import type { ArtCatalog } from '../sprites/art-catalog';
import { LINEAR_FILTER } from '../sprites/sprite-registry';
import { bakeTerrain } from '../voxel/terrain';
import { TerrainBaker, type AtlasFrameResolver } from './terrain-baker';
import { terrainNames } from './terrain-art';

const CHUNK_TILES = 8;
/** Canvas pixels per world pixel for the bake (1 = the art's game scale). */
const BAKE_SCALE = 1;
const WATER_FRAMES = 4;
const WATER_FRAME_MS = 240;
const KEY_PREFIX = 'terrain-chunk-';

/** Terrain assets that must exist for the atlas bake (others fall back to grass). */
const REQUIRED_ASSETS = ['terrain.grass', 'terrain.transition', 'terrain.cliff_earth'];

export interface TerrainBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Chunk {
  image: Phaser.GameObjects.Image;
  keys: string[];
}

export class TerrainLayer {
  bounds: TerrainBounds = { x: 0, y: 0, width: 1, height: 1 };
  /** Terrain asset name per tile when drawn from the atlas (null for the flat bake). */
  names: string[] | null = null;
  /** How the current map was drawn and how long the bake took (debug). */
  stats = { mode: 'none' as 'atlas' | 'flat' | 'none', chunks: 0, textures: 0, bakeMs: 0 };
  private chunks: Chunk[] = [];
  private animated: Chunk[] = [];
  private flat?: Phaser.GameObjects.Sprite;
  private frame = 0;
  private frameTimer = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly container: Phaser.GameObjects.Container
  ) {}

  /** (Re)build the ground for a map. `seed` varies render-only details per map. */
  build(map: MapData, art: ArtCatalog | null, seed: number): void {
    this.destroy();
    const started = performance.now();
    if (art && REQUIRED_ASSETS.every((id) => art.defaultFrame(id) !== null)) {
      this.buildAtlas(map, art, seed);
    } else {
      this.buildFlat(map);
    }
    this.stats.bakeMs = Math.round(performance.now() - started);
  }

  /** Advance the water loop. */
  update(deltaMs: number): void {
    if (this.animated.length === 0) return;
    this.frameTimer += deltaMs;
    if (this.frameTimer < WATER_FRAME_MS) return;
    this.frameTimer %= WATER_FRAME_MS;
    this.frame = (this.frame + 1) % WATER_FRAMES;
    for (const chunk of this.animated) {
      chunk.image.setTexture(chunk.keys[this.frame % chunk.keys.length]);
    }
  }

  destroy(): void {
    const textures = this.scene.textures;
    for (const chunk of this.chunks) {
      chunk.image.destroy();
      for (const key of chunk.keys) if (textures.exists(key)) textures.remove(key);
    }
    this.chunks = [];
    this.animated = [];
    this.flat?.destroy();
    this.flat = undefined;
    this.names = null;
    this.stats = { mode: 'none', chunks: 0, textures: 0, bakeMs: 0 };
  }

  private buildAtlas(map: MapData, art: ArtCatalog, seed: number): void {
    const textures = this.scene.textures;
    this.names = terrainNames(map, seed);
    const baker = new TerrainBaker(map, this.names, art, phaserFrameResolver(textures), {
      scale: BAKE_SCALE,
      animFrames: WATER_FRAMES,
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let index = 0;
    // Back-to-front so overlapping chunk edges paint in tile order.
    const order: Array<[number, number]> = [];
    for (let cy = 0; cy < MAP.HEIGHT / CHUNK_TILES; cy++) {
      for (let cx = 0; cx < MAP.WIDTH / CHUNK_TILES; cx++) order.push([cx, cy]);
    }
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
    for (const [cx, cy] of order) {
      const bake = baker.bakeChunk(
        cx * CHUNK_TILES,
        cy * CHUNK_TILES,
        (cx + 1) * CHUNK_TILES,
        (cy + 1) * CHUNK_TILES
      );
      if (!bake) continue;
      const keys: string[] = [];
      for (const [f, canvas] of bake.frames.entries()) {
        const key = `${KEY_PREFIX}${index}-${f}`;
        if (textures.exists(key)) textures.remove(key);
        // A canvas is a valid texture source; Phaser uploads it once.
        const texture = textures.addImage(key, canvas as unknown as HTMLImageElement);
        // Pixel art (scale 1) keeps the game's nearest sampling; smooth 2x art is filtered.
        if (art.scale < 1) texture?.setFilter(LINEAR_FILTER);
        keys.push(key);
      }
      index++;
      const image = this.scene.add.image(bake.x, bake.y, keys[0]).setOrigin(0, 0);
      image.setScale(1 / BAKE_SCALE);
      this.container.add(image);
      const chunk = { image, keys };
      this.chunks.push(chunk);
      if (keys.length > 1) this.animated.push(chunk);
      minX = Math.min(minX, bake.x);
      minY = Math.min(minY, bake.y);
      maxX = Math.max(maxX, bake.x + bake.width);
      maxY = Math.max(maxY, bake.y + bake.height);
    }
    this.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    this.stats.mode = 'atlas';
    this.stats.chunks = this.chunks.length;
    this.stats.textures = this.chunks.reduce((n, c) => n + c.keys.length, 0);
  }

  private buildFlat(map: MapData): void {
    this.flat = bakeTerrain(this.scene, this.container, map);
    this.bounds = {
      x: this.flat.x,
      y: this.flat.y,
      width: this.flat.width,
      height: this.flat.height,
    };
    this.stats.mode = 'flat';
    this.stats.chunks = 1;
    this.stats.textures = 1;
  }
}

function phaserFrameResolver(textures: Phaser.Textures.TextureManager): AtlasFrameResolver {
  return (key, name) => {
    if (!textures.exists(key)) return null;
    const frame = textures.get(key).get(name);
    if (!frame || frame.name !== name) return null;
    return {
      image: frame.source.image as CanvasImageSource,
      cutX: frame.cutX,
      cutY: frame.cutY,
      cutW: frame.cutWidth,
      cutH: frame.cutHeight,
      offX: frame.trimmed ? frame.x : 0,
      offY: frame.trimmed ? frame.y : 0,
    };
  };
}
