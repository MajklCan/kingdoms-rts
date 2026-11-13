/**
 * Render-only ground decor: grass tufts, flowers, rocks, ferns, reeds by the
 * water. Placement is a pure function of the map, a render seed and tile
 * coordinates (never Math.random), so every peer sees the same scatter.
 * Decor never touches the sim: it only reads the map at build time and the
 * render occupancy map to hide pieces under buildings and resources.
 */

import { TileType, type MapData } from '@sim/map-gen';
import { MAP } from '../../config';
import type { Occupancy } from '../entities/occupancy';
import type { ArtCatalog, ArtFrame } from '../sprites/art-catalog';
import { tileHash01 } from '../tile-hash';

type DecorPick = readonly [assetId: string, variant: string, weight: number];

/** What grows where. Weights are relative inside one list. */
const DECOR_BY_TERRAIN: Readonly<Record<string, { chance: number; picks: readonly DecorPick[] }>> = {
  grass: {
    chance: 0.07,
    picks: [
      ['decor.grass', 'a', 5],
      ['decor.grass', 'b', 5],
      ['decor.flowers', 'meadow', 2],
      ['decor.rocks', 'small', 2],
      ['decor.bush', 'small', 1],
      ['decor.rocks', 'medium', 0.6],
    ],
  },
  meadow: {
    chance: 0.11,
    picks: [
      ['decor.flowers', 'meadow', 4],
      ['decor.flowers', 'poppy', 3],
      ['decor.grass', 'a', 3],
      ['decor.grass', 'b', 2],
    ],
  },
  forest: {
    chance: 0.1,
    picks: [
      ['decor.fern', 'default', 5],
      ['decor.bush', 'a', 2],
      ['decor.bush', 'small', 2],
      ['decor.grass', 'b', 2],
      ['decor.rocks', 'medium', 1],
    ],
  },
  dirt: { chance: 0.03, picks: [['decor.rocks', 'small', 3], ['decor.grass', 'dry', 2]] },
  sand: { chance: 0.03, picks: [['decor.rocks', 'small', 2], ['decor.grass', 'dry', 3]] },
  stone: {
    chance: 0.1,
    picks: [['decor.rocks', 'slabs', 3], ['decor.rocks', 'medium', 3], ['decor.rocks', 'boulder', 1]],
  },
  mud: { chance: 0.04, picks: [['decor.grass', 'dry', 3], ['decor.rocks', 'small', 1]] },
  snow: { chance: 0.02, picks: [['decor.rocks', 'small', 1], ['decor.rocks', 'medium', 1]] },
  packed_snow: { chance: 0.01, picks: [['decor.rocks', 'small', 1]] },
};

/** Reeds line the banks: land tiles touching water. */
const REED_CHANCE = 0.32;
const REED_TERRAIN: ReadonlySet<string> = new Set(['sand', 'mud', 'grass', 'meadow', 'dirt']);

interface DecorPiece {
  x: number;
  y: number;
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image | null;
}

export class DecorLayer {
  private pieces: DecorPiece[] = [];
  private occupancyVersion = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly container: Phaser.GameObjects.Container,
    private readonly shadows: Phaser.GameObjects.Container,
    private readonly occupancy: Occupancy
  ) {}

  get count(): number {
    return this.pieces.length;
  }

  /** Scatter decor for a map. `names` = terrain asset name per tile. */
  build(map: MapData, names: readonly string[] | null, art: ArtCatalog | null, seed: number): void {
    this.destroy();
    if (!art || !names) return;
    const placed: Array<{ x: number; y: number; frame: ArtFrame; sx: number; sy: number }> = [];
    for (let y = 0; y < MAP.HEIGHT; y++) {
      for (let x = 0; x < MAP.WIDTH; x++) {
        if (map.walkability[y]?.[x] !== 0) continue;
        const tile = map.tiles[y * MAP.WIDTH + x];
        if (tile === TileType.BRIDGE || tile === TileType.WATER || tile === TileType.WATER_SHALLOW) continue;
        const frame = this.pick(map, names, art, x, y, seed);
        if (!frame) continue;
        // Jitter inside the tile so the scatter does not read as a grid.
        const jx = (tileHash01(x, y, seed ^ 0x51) - 0.5) * 22;
        const jy = (tileHash01(x, y, seed ^ 0x52) - 0.5) * 9;
        const e = map.elevation[y * MAP.WIDTH + x];
        const sx = (x - y) * 32 + jx;
        const sy = (x + y) * 16 + 16 - e * 4 + jy;
        placed.push({ x, y, frame, sx, sy });
      }
    }
    placed.sort((a, b) => a.sy - b.sy);
    for (const p of placed) {
      const image = this.scene.add
        .image(p.sx, p.sy, p.frame.texture, p.frame.frame)
        .setOrigin(p.frame.originX, p.frame.originY)
        .setScale(p.frame.scale);
      this.container.add(image);
      let shadow: Phaser.GameObjects.Image | null = null;
      if (p.frame.shadow) {
        shadow = this.scene.add
          .image(p.sx, p.sy, p.frame.texture, p.frame.shadow)
          .setOrigin(p.frame.originX, p.frame.originY)
          .setScale(p.frame.scale);
        this.shadows.add(shadow);
      }
      this.pieces.push({ x: p.x, y: p.y, image, shadow });
    }
    this.occupancyVersion = -1;
  }

  /** Hide pieces whose tile got a building or a resource. */
  update(): void {
    if (this.occupancy.version === this.occupancyVersion) return;
    this.occupancyVersion = this.occupancy.version;
    for (const piece of this.pieces) {
      const free = !this.occupancy.hasBuilding(piece.x, piece.y) && !this.occupancy.hasResource(piece.x, piece.y);
      if (piece.image.visible !== free) {
        piece.image.setVisible(free);
        piece.shadow?.setVisible(free);
      }
    }
  }

  destroy(): void {
    for (const piece of this.pieces) {
      piece.image.destroy();
      piece.shadow?.destroy();
    }
    this.pieces = [];
  }

  private pick(
    map: MapData,
    names: readonly string[],
    art: ArtCatalog,
    x: number,
    y: number,
    seed: number
  ): ArtFrame | null {
    const name = names[y * MAP.WIDTH + x];
    const roll = tileHash01(x, y, seed ^ 0xdec0);
    if (REED_TERRAIN.has(name) && touchesWater(map, x, y)) {
      return roll < REED_CHANCE ? art.frame('decor.reeds', 'default') : null;
    }
    const table = DECOR_BY_TERRAIN[name];
    if (!table || roll >= table.chance) return null;
    const total = table.picks.reduce((n, p) => n + p[2], 0);
    let r = tileHash01(x, y, seed ^ 0xdec1) * total;
    for (const [asset, variant, weight] of table.picks) {
      r -= weight;
      if (r <= 0) return art.frame(asset, variant);
    }
    return null;
  }
}

function touchesWater(map: MapData, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP.WIDTH || ny >= MAP.HEIGHT) continue;
    const t = map.tiles[ny * MAP.WIDTH + nx];
    if (t === TileType.WATER || t === TileType.WATER_SHALLOW) return true;
  }
  return false;
}
