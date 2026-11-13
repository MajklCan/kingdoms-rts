/**
 * Riverlands: the default skirmish map with a winding river and bridges.
 */

import type { Rng } from '../rng';
import { H, W, isWaterTile } from './terrain';
import { type MapData, TileType } from './types';

export function generateRiverlandsMap(rng: Rng): MapData {
  const tiles = new Uint8Array(W * H);
  const elevation = new Uint8Array(W * H);
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t;
  };
  const get = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return TileType.GRASS;
    return tiles[y * W + x];
  };

  // 1. Base layer: mostly grass at elevation 3.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      tiles[y * W + x] = TileType.GRASS;
      elevation[y * W + x] = 3;
    }
  }

  // 2. Elevation bumps — scattered hills + a couple of depressions.
  // Positions scale to map size so map gen works at 32×32 or 64×64+.
  const sx = (frac: number) => Math.round(frac * W);
  const sy = (frac: number) => Math.round(frac * H);
  const bumps = [
    { cx: sx(0.12), cy: sy(0.12), r: 7, dz: +2 },
    { cx: sx(0.85), cy: sy(0.78), r: 7, dz: +2 },
    { cx: sx(0.55), cy: sy(0.20), r: 6, dz: +1 },
    { cx: sx(0.20), cy: sy(0.85), r: 6, dz: -1 },
    { cx: sx(0.40), cy: sy(0.50), r: 5, dz: +1 },
    { cx: sx(0.78), cy: sy(0.35), r: 5, dz: +1 },
  ];
  for (const b of bumps) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - b.cx, dy = y - b.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < b.r) {
          const falloff = 1 - d / b.r;
          const delta = Math.round(b.dz * falloff);
          const e = elevation[y * W + x] + delta;
          elevation[y * W + x] = Math.max(0, Math.min(7, e));
        }
      }
    }
  }

  // 3. River — a meandering path from one edge to another.
  // Start near upper-middle, end near lower-middle, with sinusoidal wobble.
  const riverStartX = Math.floor(W / 2) + Math.floor((rng.next() - 0.5) * (W * 0.2));
  const riverEndX = Math.floor(W / 2) + Math.floor((rng.next() - 0.5) * (W * 0.2));
  // Wavelength + amplitude scale with map size so bigger maps get suitably
  // wider meanders rather than a tight squiggle.
  const wavelength = Math.max(8, Math.floor(H * 0.18) + Math.floor(rng.next() * 4));
  const amplitude = Math.max(3, Math.floor(W * 0.08) + Math.floor(rng.next() * 2));
  const phase = rng.next() * Math.PI * 2;
  const bridgePositions: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const centerX =
      riverStartX * (1 - t) +
      riverEndX * t +
      Math.sin(y / wavelength * Math.PI * 2 + phase) * amplitude;
    const cx = Math.round(centerX);
    const width = 2 + ((y % 6 === 0) ? 1 : 0); // slight variation
    for (let dx = -width; dx <= width; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      const absDx = Math.abs(dx);
      if (absDx < width - 1) {
        set(x, y, TileType.WATER);
      } else {
        set(x, y, TileType.WATER_SHALLOW);
      }
      elevation[y * W + x] = 1;
    }
  }

  // 4. Sand fringe — any GRASS tile adjacent to WATER becomes SAND.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (get(x, y) !== TileType.GRASS) continue;
      const neighbors = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ];
      let nearWater = false;
      for (const [dx, dy] of neighbors) {
        const t = get(x + dx, y + dy);
        if (isWaterTile(t)) {
          nearWater = true;
          break;
        }
      }
      if (nearWater) set(x, y, TileType.SAND);
    }
  }

  // 5. Forest patches — scattered FOREST tile clusters, with denser edge
  // forests so map boundaries do not feel stripped after early harvesting.
  const forestSeeds = [
    { cx: sx(0.08), cy: sy(0.10), r: 7 },
    { cx: sx(0.90), cy: sy(0.12), r: 7 },
    { cx: sx(0.10), cy: sy(0.88), r: 7 },
    { cx: sx(0.90), cy: sy(0.90), r: 7 },
    { cx: sx(0.50), cy: sy(0.06), r: 6 },
    { cx: sx(0.50), cy: sy(0.94), r: 6 },
    { cx: sx(0.05), cy: sy(0.42), r: 5 },
    { cx: sx(0.95), cy: sy(0.58), r: 5 },
    { cx: sx(0.30), cy: sy(0.55), r: 4 },
    { cx: sx(0.72), cy: sy(0.55), r: 4 },
  ];
  for (const f of forestSeeds) {
    for (let y = f.cy - f.r; y <= f.cy + f.r; y++) {
      for (let x = f.cx - f.r; x <= f.cx + f.r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = x - f.cx, dy = y - f.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f.r && get(x, y) === TileType.GRASS) {
          set(x, y, TileType.FOREST);
        }
      }
    }
  }

  // 6. Stone outcrops on high-elevation tiles.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (elevation[y * W + x] >= 6 && get(x, y) === TileType.GRASS) {
        set(x, y, TileType.STONE);
      }
    }
  }

  // 7. Bridges — find spots every ~10 rows where the river is narrow and
  // surrounded by walkable land on both sides. With a larger map we want
  // more bridges so movement isn't strangled.
  const bridgeStep = Math.max(8, Math.floor(H / 8));
  for (let y = 4; y < H - 4; y += bridgeStep) {
    // Find the river's centre on this row.
    let waterCells: number[] = [];
    for (let x = 0; x < W; x++) {
      const t = get(x, y);
      if (isWaterTile(t)) waterCells.push(x);
    }
    if (waterCells.length === 0) continue;
    const mid = waterCells[Math.floor(waterCells.length / 2)];

    // Place the bridge as a raised deck over the river. Sampling nearby land
    // before converting the row keeps the bridge visibly above its banks.
    let nearbyLandElevation = 1;
    for (const x of waterCells) {
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (isWaterTile(get(nx, ny))) continue;
          nearbyLandElevation = Math.max(nearbyLandElevation, elevation[ny * W + nx]);
        }
      }
    }
    const bridgeElevation = Math.min(7, nearbyLandElevation + 1);

    // Convert water to BRIDGE so it's walkable.
    for (const x of waterCells) {
      set(x, y, TileType.BRIDGE);
      elevation[y * W + x] = bridgeElevation;
    }
    // Pick one of the row's middle tiles as the canonical bridge entity position.
    bridgePositions.push({ x: mid, y });
  }

  // 8. Build walkability grid: water blocks, everything else (including
  // bridges) walks. Pathfinder will use this.
  const walkability: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      const t = tiles[y * W + x];
      const blocked = isWaterTile(t);
      row.push(blocked ? 1 : 0);
    }
    walkability.push(row);
  }

  // 9. Player spawns — left side (player 1) and right side (player 2). Adjust
  // if the river runs through these defaults.
  const spawns: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  const findClearSpawn = (preferX: number, preferY: number) => {
    // Walk outward in a spiral until we find walkable grass/dirt with no neighbour water within 2 tiles.
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
          const x = preferX + dx, y = preferY + dy;
          if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) continue;
          if (walkability[y][x] === 1) continue;
          const t = get(x, y);
          if (t !== TileType.GRASS && t !== TileType.SAND && t !== TileType.DIRT) continue;
          // Check 4x4 area is clear of water.
          let clear = true;
          for (let ny = y - 2; ny <= y + 2 && clear; ny++) {
            for (let nx = x - 2; nx <= x + 2 && clear; nx++) {
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (walkability[ny][nx] === 1) clear = false;
            }
          }
          if (clear) return { x, y };
        }
      }
    }
    return { x: preferX, y: preferY };
  };
  spawns.push(findClearSpawn(Math.round(W * 0.18), Math.round(H * 0.78)));
  spawns.push(findClearSpawn(Math.round(W * 0.82), Math.round(H * 0.22)));

  return { tiles, elevation, bridgePositions, walkability, spawns, features: [] };
}
