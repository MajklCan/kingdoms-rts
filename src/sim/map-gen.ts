/**
 * Procedural map generator.
 *
 * Produces:
 *   - world.tiles[y][x]      : TileType enum value
 *   - world.elevation[y][x]  : 0..7 height level
 *   - world.bridgeTiles      : set of "y*W+x" indices where bridges sit
 *
 * No external noise library — uses world.rng (Mulberry32) for everything so
 * the same seed produces the same map.
 *
 * The pathfinder walkability grid (number[][] of 0/1) is rebuilt from this
 * data after generation: water tiles without bridges and blocking terrain
 * features are blocked.
 */

import { MAP } from '../config';
import type { Rng } from './rng';

export const TileType = {
  GRASS: 0,
  FOREST: 1, // grass with extra trees scattered
  DIRT: 2,
  SAND: 3,
  WATER: 4,
  WATER_SHALLOW: 5,
  STONE: 6,
  BRIDGE: 7,
  MUD: 8,
  SNOW: 9,
  SNOW_FOREST: 10,
  ICE: 11,
  PACKED_SNOW: 12,
  BARBED_WIRE: 13, // walkable WW1 wire entanglement — bogs units to a crawl
} as const;

export type TileTypeValue = (typeof TileType)[keyof typeof TileType];

export const MapId = {
  RIVERLANDS: 'riverlands',
  BOHEMIAN_BORDER_FOREST: 'bohemian_border_forest',
  ORE_MOUNTAIN_PASS: 'ore_mountain_pass',
  MACHOVO_JEZERO: 'machovo_jezero',
  SILESIAN_MARSH: 'silesian_marsh',
  SUDOMER_PONDS: 'sudomer_ponds',
  KRKONOSE_WINTER_CROWN: 'krkonose_winter_crown',
  ZBOROV_LINES: 'zborov_lines',
  FLOODED_BASIN: 'flooded_basin',
} as const;

export type MapIdValue = (typeof MapId)[keyof typeof MapId];

export const MapFeatureKind = {
  ROCK_SPIRE: 'rock_spire',
  LINDEN_TREE: 'linden_tree',
} as const;

export type MapFeatureKindValue = (typeof MapFeatureKind)[keyof typeof MapFeatureKind];

export interface MapFeature {
  kind: MapFeatureKindValue;
  x: number;
  y: number;
  size?: number;
}

export interface MapDef {
  id: MapIdValue;
  name: string;
  description: string;
}

export const MAP_DEFS: MapDef[] = [
  {
    id: MapId.RIVERLANDS,
    name: 'Bohemian Riverlands',
    description: 'Balanced river valley with bridges, forests, and central resources.',
  },
  {
    id: MapId.BOHEMIAN_BORDER_FOREST,
    name: 'Bohemian Border Forest',
    description: 'Dense woodland clearings linked by logging paths and exposed outer mines.',
  },
  {
    id: MapId.ORE_MOUNTAIN_PASS,
    name: 'Ore Mountain Pass',
    description: 'High ridges, stone plateaus, and a dirt trade road through the hills.',
  },
  {
    id: MapId.MACHOVO_JEZERO,
    name: 'Machovo Jezero',
    description: 'Large central lake with sandy banks and woodlands around the shore.',
  },
  {
    id: MapId.SILESIAN_MARSH,
    name: 'Silesian Marsh',
    description: 'Braided wetlands, shallow channels, causeways, and scattered dry islands.',
  },
  {
    id: MapId.SUDOMER_PONDS,
    name: 'Sudoměř Ponds',
    description: 'Upper-left Sudoměř, a blocked lower pond, a dry choke, and a muddy right-pond flank.',
  },
  {
    id: MapId.KRKONOSE_WINTER_CROWN,
    name: 'Krkonoše Winter Crown',
    description: 'A mirrored highland snow map with frozen crown ice, packed passes, and balanced pine lines.',
  },
  {
    id: MapId.ZBOROV_LINES,
    name: 'Zborov Lines',
    description: 'A WWI battlefield: a southern jump-off trench, churned no-man’s-land of shell craters, and fortified enemy lines to the north.',
  },
  {
    id: MapId.FLOODED_BASIN,
    name: 'Flooded Basin',
    description: 'A round, shell-cratered battlefield ringed by impassable floodwater. Symmetric north/south bases for a tight 1v1.',
  },
];

export interface MapData {
  /** tiles[y][x] — TileType. */
  tiles: Uint8Array;
  /** elevation[y][x] — 0..7. */
  elevation: Uint8Array;
  /** Set of indices (y*W + x) where bridges should be spawned. */
  bridgePositions: Array<{ x: number; y: number }>;
  /** Walkability grid for the pathfinder: 0 = walkable, 1 = blocked. */
  walkability: number[][];
  /** Suggested player spawn positions (one per player id, [0]=unused). */
  spawns: Array<{ x: number; y: number }>;
  /** Decorative or blocking authored terrain features. */
  features: MapFeature[];
}

const W = MAP.WIDTH;
const H = MAP.HEIGHT;

function isWaterTile(tile: number): boolean {
  return tile === TileType.WATER || tile === TileType.WATER_SHALLOW;
}

export function normalizeMapId(value: string | undefined): MapIdValue {
  return MAP_DEFS.some((def) => def.id === value)
    ? (value as MapIdValue)
    : MapId.RIVERLANDS;
}

export function generateMap(rng: Rng, mapId: MapIdValue = MapId.RIVERLANDS): MapData {
  switch (mapId) {
    case MapId.BOHEMIAN_BORDER_FOREST:
      return generateBohemianBorderForestMap();
    case MapId.ORE_MOUNTAIN_PASS:
      return generateOreMountainPassMap();
    case MapId.MACHOVO_JEZERO:
      return generateMachovoJezeroMap();
    case MapId.SILESIAN_MARSH:
      return generateSilesianMarshMap(rng);
    case MapId.SUDOMER_PONDS:
      return generateSudomerPondsMap();
    case MapId.KRKONOSE_WINTER_CROWN:
      return generateKrkonoseWinterCrownMap();
    case MapId.ZBOROV_LINES:
      return generateZborovMap();
    case MapId.FLOODED_BASIN:
      return generateFloodedBasinMap();
    default:
      return generateRiverlandsMap(rng);
  }
}

function generateRiverlandsMap(rng: Rng): MapData {
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

function generateBohemianBorderForestMap(): MapData {
  const map = createBaseMap(TileType.FOREST, 3);
  const p1 = { x: Math.round(W * 0.18), y: Math.round(H * 0.76) };
  const p2 = { x: Math.round(W * 0.82), y: Math.round(H * 0.24) };
  const center = { x: Math.round(W * 0.50), y: Math.round(H * 0.50) };
  const northwestMine = { x: Math.round(W * 0.22), y: Math.round(H * 0.22) };
  const southeastMine = { x: Math.round(W * 0.78), y: Math.round(H * 0.78) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const northRidge = y < H * 0.24 && x > W * 0.18 && x < W * 0.82;
      const southRidge = y > H * 0.76 && x > W * 0.18 && x < W * 0.82;
      map.elevation[idx] = clampElevation(edge < 5 || northRidge || southRidge ? 4 : 3);
    }
  }

  carveForestClearing(map, p1.x, p1.y, 9, 7);
  carveForestClearing(map, p2.x, p2.y, 9, 7);
  carveForestClearing(map, center.x, center.y, 8, 7);
  carveForestClearing(map, northwestMine.x, northwestMine.y, 7, 6);
  carveForestClearing(map, southeastMine.x, southeastMine.y, 7, 6);
  carveForestClearing(map, Math.round(W * 0.36), Math.round(H * 0.30), 5, 4);
  carveForestClearing(map, Math.round(W * 0.64), Math.round(H * 0.70), 5, 4);

  carveDryRoad(map, p1, center, 1.7);
  carveDryRoad(map, center, p2, 1.7);
  carveDryRoad(map, northwestMine, center, 1.25);
  carveDryRoad(map, center, southeastMine, 1.25);
  carveDryRoad(map, p1, { x: Math.round(W * 0.07), y: Math.round(H * 0.70) }, 1.1);
  carveDryRoad(map, p2, { x: Math.round(W * 0.93), y: Math.round(H * 0.30) }, 1.1);

  addStonePocket(map, northwestMine.x - 2, northwestMine.y + 2, 4);
  addStonePocket(map, southeastMine.x + 2, southeastMine.y - 2, 4);
  addForestBlob(map, Math.round(W * 0.49), Math.round(H * 0.18), 7, 0.92);
  addForestBlob(map, Math.round(W * 0.51), Math.round(H * 0.82), 7, 0.92);

  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function generateOreMountainPassMap(): MapData {
  const map = createBaseMap(TileType.GRASS, 3);
  const p1 = { x: Math.round(W * 0.16), y: Math.round(H * 0.78) };
  const p2 = { x: Math.round(W * 0.84), y: Math.round(H * 0.22) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const roadD = pointSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const ridgeBand = roadD > 10 || edge < 6;
      const shoulder = roadD > 4.8 && roadD <= 10;

      if (roadD <= 2.1) {
        map.tiles[idx] = TileType.DIRT;
        map.elevation[idx] = 3;
      } else if (roadD <= 4.8) {
        map.tiles[idx] = roadD <= 3.1 ? TileType.DIRT : TileType.GRASS;
        map.elevation[idx] = 3;
      } else if (shoulder) {
        map.elevation[idx] = roadD > 7.2 ? 5 : 4;
        map.tiles[idx] = TileType.GRASS;
      } else if (ridgeBand) {
        map.elevation[idx] = clampElevation(edge < 4 || roadD > 16 ? 7 : 6);
        map.tiles[idx] = TileType.STONE;
      }
    }
  }

  carveDryRoad(map, p1, p2, 2.1);
  addForestBlob(map, Math.round(W * 0.24), Math.round(H * 0.30), 8, 0.86);
  addForestBlob(map, Math.round(W * 0.70), Math.round(H * 0.72), 9, 0.86);
  addForestBlob(map, Math.round(W * 0.50), Math.round(H * 0.18), 6, 0.78);
  addForestBlob(map, Math.round(W * 0.78), Math.round(H * 0.42), 5, 0.72);
  addMountainRockSpires(map, p1, p2);

  clearSpawnPatch(map, p1.x, p1.y);
  clearSpawnPatch(map, p2.x, p2.y);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function generateMachovoJezeroMap(): MapData {
  const map = createBaseMap(TileType.GRASS, 3);
  const cx = Math.round(W * 0.5);
  const cy = Math.round(H * 0.5);
  const rx = Math.round(W * 0.30);
  const ry = Math.round(H * 0.21);
  const p1 = { x: Math.round(W * 0.16), y: Math.round(H * 0.78) };
  const p2 = { x: Math.round(W * 0.84), y: Math.round(H * 0.22) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = Math.hypot(nx, ny);
      const shoreline = d
        + Math.sin((x + y) * 0.12) * 0.035
        + Math.cos((x - y) * 0.10) * 0.03;

      if (shoreline <= 0.68) {
        map.elevation[idx] = 0;
        map.tiles[idx] = TileType.WATER;
      } else if (shoreline <= 1.0) {
        map.elevation[idx] = 1;
        map.tiles[idx] = TileType.WATER_SHALLOW;
      } else if (shoreline <= 1.18) {
        map.elevation[idx] = 2;
        map.tiles[idx] = TileType.SAND;
      } else if (shoreline <= 1.42) {
        map.elevation[idx] = 3;
        map.tiles[idx] = TileType.GRASS;
      }
    }
  }

  carveDryRoad(map, p1, { x: Math.round(W * 0.31), y: Math.round(H * 0.68) }, 1.8);
  carveDryRoad(map, { x: Math.round(W * 0.69), y: Math.round(H * 0.32) }, p2, 1.8);
  addForestBlob(map, Math.round(W * 0.20), Math.round(H * 0.22), 11, 0.96);
  addForestBlob(map, Math.round(W * 0.80), Math.round(H * 0.78), 11, 0.96);
  addForestBlob(map, Math.round(W * 0.18), Math.round(H * 0.56), 9, 0.92);
  addForestBlob(map, Math.round(W * 0.82), Math.round(H * 0.44), 9, 0.92);
  addForestBlob(map, Math.round(W * 0.48), Math.round(H * 0.16), 8, 0.86);
  addForestBlob(map, Math.round(W * 0.52), Math.round(H * 0.84), 8, 0.86);
  addMachovoLindenTrees(map);

  clearSpawnPatch(map, p1.x, p1.y);
  clearSpawnPatch(map, p2.x, p2.y);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function generateSilesianMarshMap(rng: Rng): MapData {
  const map = createBaseMap(TileType.GRASS, 2);
  const p1 = { x: Math.round(W * 0.16), y: Math.round(H * 0.74) };
  const p2 = { x: Math.round(W * 0.84), y: Math.round(H * 0.26) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      map.elevation[idx] = 2;
      map.tiles[idx] = TileType.GRASS;
    }
  }

  const channels = [0.24, 0.39, 0.57, 0.74];
  for (const channel of channels) {
    const phase = rng.next() * Math.PI * 2;
    for (let x = 0; x < W; x++) {
      const centerY = Math.round(H * channel + Math.sin(x * 0.18 + phase) * 3);
      for (let dy = -3; dy <= 3; dy++) {
        const y = centerY + dy;
        if (!inBounds(x, y)) continue;
        const idx = mapIndex(x, y);
        map.tiles[idx] = Math.abs(dy) <= 2 ? TileType.WATER_SHALLOW : TileType.SAND;
        map.elevation[idx] = 1;
      }
    }
  }

  addDryIsland(map, Math.round(W * 0.18), Math.round(H * 0.74), 8);
  addDryIsland(map, Math.round(W * 0.82), Math.round(H * 0.26), 8);
  addDryIsland(map, Math.round(W * 0.50), Math.round(H * 0.50), 7);
  carveDryRoad(map, p1, p2, 2.2, TileType.BRIDGE);
  for (const x of [Math.round(W * 0.24), Math.round(W * 0.5), Math.round(W * 0.76)]) {
    addVerticalCauseway(map, x, 1);
  }

  addForestBlob(map, Math.round(W * 0.12), Math.round(H * 0.18), 6, 0.74);
  addForestBlob(map, Math.round(W * 0.88), Math.round(H * 0.82), 6, 0.74);
  addForestBlob(map, Math.round(W * 0.50), Math.round(H * 0.50), 5, 0.68);
  applySandFringe(map);
  clearSpawnPatch(map, p1.x, p1.y, 4);
  clearSpawnPatch(map, p2.x, p2.y, 4);
  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function generateSudomerPondsMap(): MapData {
  const map = createBaseMap(TileType.GRASS, 3);
  const town = { x: Math.round(W * 0.14), y: Math.round(H * 0.14) };
  const bottomAttack = { x: Math.round(W * 0.49), y: H - 5 };
  const leftPond = {
    cx: Math.round(W * 0.12),
    cy: Math.round(H * 0.62),
    rx: Math.round(W * 0.34),
    ry: Math.round(H * 0.27),
  };
  const rightPond = {
    cx: Math.round(W * 0.66),
    cy: Math.round(H * 0.52),
    rx: Math.round(W * 0.18),
    ry: Math.round(H * 0.25),
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      map.elevation[idx] = edge < 5 ? 4 : 3;
    }
  }

  paintSudomerPond(map, leftPond, 0.72, 0.93, 1.06);
  paintSudomerPond(map, rightPond, 0.62, 0.83, 1.0);
  clearSpawnPatch(map, town.x + 8, town.y + 8, 4);
  clearSpawnPatch(map, bottomAttack.x, bottomAttack.y, 5);
  clearSpawnPatch(map, W - 4, Math.round(H * 0.25), 5);
  paintSudomerRightMud(map, rightPond);
  carveSudomerDryChoke(map);
  carveSudomerTownSite(map, town);

  addForestBlob(map, Math.round(W * 0.05), Math.round(H * 0.12), 5, 0.70);
  addForestBlob(map, Math.round(W * 0.25), Math.round(H * 0.06), 7, 0.82);
  addForestBlob(map, Math.round(W * 0.34), Math.round(H * 0.18), 6, 0.74);
  addForestBlob(map, Math.round(W * 0.82), Math.round(H * 0.12), 9, 0.90);
  addForestBlob(map, Math.round(W * 0.91), Math.round(H * 0.32), 7, 0.82);
  addForestBlob(map, Math.round(W * 0.87), Math.round(H * 0.78), 9, 0.88);
  addForestBlob(map, Math.round(W * 0.68), Math.round(H * 0.86), 7, 0.78);
  addForestBlob(map, Math.round(W * 0.52), Math.round(H * 0.10), 5, 0.66);
  addForestBlob(map, Math.round(W * 0.18), Math.round(H * 0.40), 5, 0.70);
  addSudomerLindenTrees(map);

  rebuildWalkability(map);
  setSpawns(map, { x: town.x + 8, y: town.y + 8 }, bottomAttack);
  refreshBridgePositions(map);
  return map;
}

function generateZborovMap(): MapData {
  // A shell-torn CORRIDOR: churned dirt + mud craters down the middle, hemmed by
  // impassable woods on both flanks so the assault can't just walk around the
  // trench lines. Player jump-off south, enemy lines + bunker north. Trench wire,
  // machine-gun nests, and tree-sprites are placed in the mission config.
  const map = createBaseMap(TileType.DIRT, 3);
  const cx = Math.round(W * 0.5);
  const corridorHalf = Math.round(W * 0.24);
  const leftEdge = cx - corridorHalf;
  const rightEdge = cx + corridorHalf;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      if (x < leftEdge || x > rightEdge) {
        map.tiles[idx] = TileType.FOREST; // wooded flank (sealed below)
        map.elevation[idx] = 3;
        continue;
      }
      const crater = Math.sin(x * 0.45 + y * 0.31) + Math.cos(x * 0.21 - y * 0.6);
      if (crater > 1.4) {
        map.tiles[idx] = TileType.MUD;
        map.elevation[idx] = 2;
      }
    }
  }

  // A few stony patches inside the corridor for texture (walkable).
  for (const [px, py, pr] of [
    [leftEdge + 3, Math.round(H * 0.46), 2],
    [rightEdge - 3, Math.round(H * 0.56), 2],
    [leftEdge + 4, Math.round(H * 0.3), 2],
  ]) {
    for (let dy = -pr; dy <= pr; dy++) {
      for (let dx = -pr; dx <= pr; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (!inBounds(x, y) || Math.hypot(dx, dy) > pr) continue;
        if (x < leftEdge || x > rightEdge) continue;
        map.tiles[mapIndex(x, y)] = TileType.STONE;
        map.elevation[mapIndex(x, y)] = 3;
      }
    }
  }

  rebuildWalkability(map);
  // Seal the wooded flanks — impassable, so the fight stays in the corridor.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < leftEdge || x > rightEdge) map.walkability[y][x] = 1;
    }
  }
  setSpawns(map, { x: cx, y: Math.round(H * 0.80) }, { x: cx, y: Math.round(H * 0.23) });
  refreshBridgePositions(map);
  return map;
}

function generateFloodedBasinMap(): MapData {
  // The parked "circle" arena, kept as a 1v1 skirmish map: a round grassy basin
  // pocked with mud shell-craters, ringed by impassable floodwater, with
  // symmetric north/south bases.
  const map = createBaseMap(TileType.WATER, 0);
  const cx = Math.round(W * 0.5);
  const cy = Math.round(H * 0.5);
  const R = Math.round(Math.min(W, H) * 0.31);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const d = Math.hypot(x - cx, y - cy);
      if (d <= R) {
        const crater = Math.sin(x * 0.45 + y * 0.31) + Math.cos(x * 0.21 - y * 0.6);
        if (crater > 1.55) {
          map.tiles[idx] = TileType.MUD;
          map.elevation[idx] = 2;
        } else {
          map.tiles[idx] = TileType.GRASS;
          map.elevation[idx] = 3;
        }
      } else if (d <= R + 1.4) {
        map.tiles[idx] = TileType.WATER_SHALLOW;
        map.elevation[idx] = 1;
      }
    }
  }

  // Mirrored woodland near each base + a neutral central copse. (The world's
  // resource scatter fills in gold/stone/berries on the open ground.)
  addForestBlob(map, cx - 11, cy + 11, 4, 0.78);
  addForestBlob(map, cx + 11, cy + 11, 4, 0.78);
  addForestBlob(map, cx - 11, cy - 11, 4, 0.78);
  addForestBlob(map, cx + 11, cy - 11, 4, 0.78);
  addForestBlob(map, cx, cy, 3, 0.6);

  rebuildWalkability(map);
  setSpawns(
    map,
    { x: cx, y: cy + Math.round(R * 0.72) },
    { x: cx, y: cy - Math.round(R * 0.72) }
  );
  refreshBridgePositions(map);
  return map;
}

function generateKrkonoseWinterCrownMap(): MapData {
  const map = createBaseMap(TileType.SNOW, 3);
  const p1 = { x: Math.round(W * 0.18), y: Math.round(H * 0.78) };
  const p2 = mirrorMapPoint(p1);
  const centerX = (W - 1) / 2;
  const centerY = (H - 1) / 2;
  const mainPassA = p1;
  const mainPassB = p2;
  const crossPassA = { x: Math.round(W * 0.18), y: Math.round(H * 0.30) };
  const crossPassB = mirrorMapPoint(crossPassA);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const mainPassD = pointSegmentDistance(x, y, mainPassA.x, mainPassA.y, mainPassB.x, mainPassB.y);
      const crossPassD = pointSegmentDistance(x, y, crossPassA.x, crossPassA.y, crossPassB.x, crossPassB.y);
      const crownD = Math.abs(
        Math.hypot((x - centerX) / (W * 0.28), (y - centerY) / (H * 0.22)) - 1
      );
      const shoulderD = Math.abs(
        Math.hypot((x - centerX) / (W * 0.38), (y - centerY) / (H * 0.34)) - 1
      );

      let elevation = 3;
      if (edge < 4) elevation = 6;
      else if (edge < 8) elevation = 5;
      if (shoulderD < 0.06) elevation = Math.max(elevation, 4);
      if (crownD < 0.15 && mainPassD > 4.0 && crossPassD > 3.0) elevation = Math.max(elevation, 5);
      if (crownD < 0.07 && mainPassD > 4.6 && crossPassD > 3.4) elevation = Math.max(elevation, 6);
      if (mainPassD < 2.6 || crossPassD < 1.6) elevation = Math.min(elevation, 3);

      map.elevation[idx] = clampElevation(elevation);
      map.tiles[idx] = elevation >= 6 ? TileType.STONE : TileType.SNOW;
    }
  }

  carvePackedSnowRoad(map, mainPassA, mainPassB, 2.0);
  carvePackedSnowRoad(map, crossPassA, crossPassB, 1.15);
  paintCentralIce(map, centerX, centerY);

  addMirroredSnowForestBlob(map, Math.round(W * 0.10), Math.round(H * 0.68), 8, 0.95);
  addMirroredSnowForestBlob(map, Math.round(W * 0.24), Math.round(H * 0.87), 9, 0.92);
  addMirroredSnowForestBlob(map, Math.round(W * 0.34), Math.round(H * 0.64), 7, 0.86);
  addMirroredSnowForestBlob(map, Math.round(W * 0.14), Math.round(H * 0.91), 6, 0.84);
  addMirroredSnowForestBlob(map, Math.round(W * 0.30), Math.round(H * 0.37), 6, 0.76);
  addMirroredSnowForestBlob(map, Math.round(W * 0.42), Math.round(H * 0.20), 6, 0.76);

  addMirroredSnowStonePocket(map, Math.round(W * 0.28), Math.round(H * 0.57), 4);
  addMirroredSnowStonePocket(map, Math.round(W * 0.17), Math.round(H * 0.47), 3);
  addMirroredSnowStonePocket(map, Math.round(W * 0.40), Math.round(H * 0.78), 3);

  clearSnowSpawnPatch(map, p1.x, p1.y, 5);
  clearSnowSpawnPatch(map, p2.x, p2.y, 5);

  rebuildWalkability(map);
  setSpawns(map, p1, p2);
  refreshBridgePositions(map);
  return map;
}

function mirrorMapPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: W - 1 - point.x, y: H - 1 - point.y };
}

function carvePackedSnowRoad(
  map: MapData,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = TileType.PACKED_SNOW;
      map.elevation[idx] = Math.min(map.elevation[idx], 3);
    }
  }
}

function paintCentralIce(map: MapData, centerX: number, centerY: number): void {
  const rx = W * 0.16;
  const ry = H * 0.12;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const d = Math.hypot((x - centerX) / rx, (y - centerY) / ry);
      const frostRipple = Math.cos((x - centerX) * 0.54) * 0.025
        + Math.cos((y - centerY) * 0.46) * 0.025;
      const edge = d + frostRipple;
      if (edge <= 0.82) {
        map.tiles[idx] = TileType.ICE;
        map.elevation[idx] = 2;
      } else if (edge <= 1.04 && map.tiles[idx] !== TileType.STONE) {
        map.tiles[idx] = TileType.PACKED_SNOW;
        map.elevation[idx] = Math.min(map.elevation[idx], 3);
      }
    }
  }
}

function addMirroredSnowForestBlob(
  map: MapData,
  cx: number,
  cy: number,
  radius: number,
  fullness: number
): void {
  addSnowForestBlob(map, cx, cy, radius, fullness);
  const mirrored = mirrorMapPoint({ x: cx, y: cy });
  if (mirrored.x !== cx || mirrored.y !== cy) {
    addSnowForestBlob(map, mirrored.x, mirrored.y, radius, fullness);
  }
}

function addSnowForestBlob(
  map: MapData,
  cx: number,
  cy: number,
  radius: number,
  fullness: number
): void {
  const clampedFullness = Math.max(0, Math.min(1, fullness));
  const effectiveRadius = radius * (0.62 + clampedFullness * 0.38);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const edge = effectiveRadius
        * (1 + Math.cos(dx * 0.41 + dy * 0.17) * 0.04 + Math.cos((dx - dy) * 0.29) * 0.04);
      if (d > edge) continue;
      const idx = mapIndex(x, y);
      const tile = map.tiles[idx];
      if (
        tile === TileType.ICE
        || tile === TileType.PACKED_SNOW
        || tile === TileType.STONE
        || isWaterTile(tile)
      ) {
        continue;
      }
      map.tiles[idx] = TileType.SNOW_FOREST;
    }
  }
}

function addMirroredSnowStonePocket(map: MapData, cx: number, cy: number, radius: number): void {
  addSnowStonePocket(map, cx, cy, radius);
  const mirrored = mirrorMapPoint({ x: cx, y: cy });
  if (mirrored.x !== cx || mirrored.y !== cy) {
    addSnowStonePocket(map, mirrored.x, mirrored.y, radius);
  }
}

function addSnowStonePocket(map: MapData, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      if (map.tiles[idx] === TileType.ICE || map.tiles[idx] === TileType.PACKED_SNOW) continue;
      map.tiles[idx] = TileType.STONE;
      map.elevation[idx] = d < radius * 0.55 ? 5 : 4;
    }
  }
}

function clearSnowSpawnPatch(
  map: MapData,
  cx: number,
  cy: number,
  radius: number
): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = Math.abs(x - cx) + Math.abs(y - cy) <= 1
        ? TileType.PACKED_SNOW
        : TileType.SNOW;
      map.elevation[idx] = 3;
    }
  }
}

function paintSudomerPond(
  map: MapData,
  pond: { cx: number; cy: number; rx: number; ry: number },
  waterEdge: number,
  shallowEdge: number,
  sandEdge: number
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      const d = ellipseDistance(x, y, pond.cx, pond.cy, pond.rx, pond.ry);
      const ripple =
        Math.sin(x * 0.34 + y * 0.17) * 0.035 +
        Math.cos(x * 0.19 - y * 0.27) * 0.025;
      const shoreline = d + ripple;
      if (shoreline <= waterEdge) {
        map.tiles[idx] = TileType.WATER;
        map.elevation[idx] = 0;
      } else if (shoreline <= shallowEdge) {
        map.tiles[idx] = TileType.WATER_SHALLOW;
        map.elevation[idx] = 1;
      } else if (shoreline <= sandEdge && map.tiles[idx] === TileType.GRASS) {
        map.tiles[idx] = TileType.SAND;
        map.elevation[idx] = 2;
      }
    }
  }
}

function ellipseDistance(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): number {
  const nx = (x - cx) / Math.max(1, rx);
  const ny = (y - cy) / Math.max(1, ry);
  return Math.hypot(nx, ny);
}

function paintSudomerRightMud(
  map: MapData,
  rightPond: { cx: number; cy: number; rx: number; ry: number }
): void {
  const mudMinX = rightPond.cx - 1;
  const guaranteedEdgeX = rightPond.cx + Math.round(rightPond.rx * 0.45);
  const edgeBandBottom = rightPond.cy + Math.round(rightPond.ry * 0.42);
  const routeStart = {
    x: rightPond.cx - 1,
    y: rightPond.cy - rightPond.ry + 4,
  };
  const routeEnd = {
    x: W - 1,
    y: Math.round(H * 0.12),
  };

  for (let y = 0; y <= edgeBandBottom; y++) {
    for (let x = mudMinX; x < W; x++) {
      if (!inBounds(x, y)) continue;
      const idx = mapIndex(x, y);
      if (isWaterTile(map.tiles[idx])) continue;
      const pondD = ellipseDistance(x, y, rightPond.cx, rightPond.cy, rightPond.rx, rightPond.ry);
      const routeD = pointSegmentDistance(
        x,
        y,
        routeStart.x,
        routeStart.y,
        routeEnd.x,
        routeEnd.y
      );
      const wetPatchNoise =
        Math.sin(x * 0.71 + y * 0.19) +
        Math.cos(x * 0.31 - y * 0.53);

      const reachesMapEdge = x >= guaranteedEdgeX;
      const northernRoute = routeD <= 8.5 && y <= rightPond.cy + 1;
      const pondShore = pondD > 0.82 && pondD < 1.58 && y <= edgeBandBottom;
      const unevenShore = pondShore && wetPatchNoise > -1.1;
      const easternShore = x >= rightPond.cx + Math.round(rightPond.rx * 0.2) && y <= edgeBandBottom;

      if (reachesMapEdge || northernRoute || easternShore || unevenShore) {
        map.tiles[idx] = TileType.MUD;
        map.elevation[idx] = 2;
      }
    }
  }
}

function carveSudomerDryChoke(map: MapData): void {
  const minX = Math.round(W * 0.45);
  const maxX = minX + 2;
  const minY = Math.round(H * 0.48);
  const maxY = Math.round(H * 0.80);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inBounds(x, y)) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = Math.abs(x - Math.round((minX + maxX) / 2)) <= 1
        ? TileType.DIRT
        : TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

function carveSudomerTownSite(map: MapData, town: { x: number; y: number }): void {
  const minX = 0;
  const maxX = Math.min(W - 2, town.x + 18);
  const minY = 0;
  const maxY = Math.min(H - 2, town.y + 14);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = mapIndex(x, y);
      map.tiles[idx] = isSudomerTownRoad(x, y, town)
        ? TileType.DIRT
        : TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

function isSudomerTownRoad(x: number, y: number, town: { x: number; y: number }): boolean {
  const mainRoad = [
    { x: 0, y: town.y + 3 },
    { x: town.x - 6, y: town.y + 2 },
    { x: town.x - 2, y: town.y },
    { x: town.x + 3, y: town.y },
    { x: town.x + 9, y: town.y + 1 },
    { x: town.x + 15, y: town.y + 4 },
    { x: town.x + 19, y: town.y + 7 },
  ];
  const northLane = [
    { x: town.x - 2, y: town.y },
    { x: town.x - 3, y: town.y - 4 },
    { x: town.x - 1, y: 0 },
  ];
  const eastLane = [
    { x: town.x + 3, y: town.y },
    { x: town.x + 7, y: town.y - 4 },
    { x: town.x + 14, y: town.y - 4 },
    { x: town.x + 18, y: town.y - 2 },
  ];
  const lowerLane = [
    { x: town.x - 2, y: town.y },
    { x: town.x - 3, y: town.y + 5 },
    { x: town.x - 6, y: town.y + 9 },
  ];
  const westLane = [
    { x: town.x - 8, y: town.y - 4 },
    { x: town.x - 8, y: town.y + 2 },
    { x: town.x - 6, y: town.y + 4 },
  ];
  const topLane = [
    { x: town.x - 5, y: town.y - 7 },
    { x: town.x + 1, y: town.y - 7 },
    { x: town.x + 7, y: town.y - 5 },
  ];
  const innerLane = [
    { x: town.x - 1, y: town.y + 3 },
    { x: town.x + 3, y: town.y + 2 },
    { x: town.x + 8, y: town.y + 3 },
    { x: town.x + 13, y: town.y + 5 },
  ];
  const southEdgeLane = [
    { x: town.x - 4, y: town.y + 7 },
    { x: town.x + 1, y: town.y + 7 },
    { x: town.x + 8, y: town.y + 9 },
    { x: town.x + 17, y: town.y + 9 },
  ];
  const easternLoop = [
    { x: town.x + 13, y: town.y - 2 },
    { x: town.x + 17, y: town.y + 1 },
    { x: town.x + 17, y: town.y + 9 },
  ];
  const roadSets = [
    mainRoad,
    northLane,
    eastLane,
    lowerLane,
    westLane,
    topLane,
    innerLane,
    southEdgeLane,
    easternLoop,
  ];
  for (const road of roadSets) {
    for (let i = 1; i < road.length; i++) {
      if (pointSegmentDistance(x, y, road[i - 1].x, road[i - 1].y, road[i].x, road[i].y) <= 1.15) {
        return true;
      }
    }
  }
  return Math.abs(x - (town.x + 2)) <= 2 && Math.abs(y - town.y) <= 1;
}

function addSudomerLindenTrees(map: MapData): void {
  const anchors = [
    { x: 0.24, y: 0.06 },
    { x: 0.32, y: 0.16 },
    { x: 0.52, y: 0.10 },
    { x: 0.76, y: 0.12 },
    { x: 0.86, y: 0.18 },
    { x: 0.91, y: 0.32 },
    { x: 0.83, y: 0.76 },
    { x: 0.70, y: 0.86 },
    { x: 0.20, y: 0.40 },
    { x: 0.12, y: 0.31 },
    { x: 0.38, y: 0.09 },
    { x: 0.74, y: 0.76 },
  ];
  for (const anchor of anchors) {
    addLindenTreeFeature(map, Math.round(W * anchor.x), Math.round(H * anchor.y));
  }
}

function mapIndex(x: number, y: number): number {
  return y * W + x;
}

function createBaseMap(tileType: TileTypeValue, elevationLevel: number): MapData {
  const tiles = new Uint8Array(W * H);
  const elevation = new Uint8Array(W * H);
  tiles.fill(tileType);
  elevation.fill(clampElevation(elevationLevel));
  const walkability = Array.from({ length: H }, () => Array.from({ length: W }, () => 0));
  return {
    tiles,
    elevation,
    bridgePositions: [],
    walkability,
    spawns: [{ x: 0, y: 0 }],
    features: [],
  };
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

function clampElevation(value: number): number {
  return Math.max(0, Math.min(7, value));
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  return Math.hypot(px - cx, py - cy);
}

function carveDryRoad(
  map: MapData,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  waterTile: number = TileType.DIRT
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = isWaterTile(map.tiles[idx]) ? waterTile : TileType.DIRT;
      map.elevation[idx] = Math.max(2, Math.min(3, map.elevation[idx]));
    }
  }
}

function addVerticalCauseway(map: MapData, centerX: number, radius: number): void {
  for (let y = 2; y < H - 2; y++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = centerX + dx;
      if (!inBounds(x, y)) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = isWaterTile(map.tiles[idx]) ? TileType.BRIDGE : TileType.DIRT;
      map.elevation[idx] = Math.max(2, map.elevation[idx]);
    }
  }
}

function addDryIsland(map: MapData, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      map.elevation[idx] = d < radius * 0.6 ? 3 : 2;
      map.tiles[idx] = d < radius * 0.78 ? TileType.GRASS : TileType.SAND;
    }
  }
}

function addForestBlob(
  map: MapData,
  cx: number,
  cy: number,
  radius: number,
  fullness: number
): void {
  const clampedFullness = Math.max(0, Math.min(1, fullness));
  const effectiveRadius = radius * (0.62 + clampedFullness * 0.38);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      const edge = effectiveRadius
        * (1 + Math.sin((x + cx) * 0.34) * 0.04 + Math.cos((y - cy) * 0.31) * 0.04);
      if (d > edge) continue;
      const idx = mapIndex(x, y);
      const tile = map.tiles[idx];
      if (
        isWaterTile(tile)
        || tile === TileType.BRIDGE
        || tile === TileType.DIRT
        || tile === TileType.SAND
        || tile === TileType.MUD
      ) {
        continue;
      }
      map.tiles[idx] = TileType.FOREST;
    }
  }
}

function carveForestClearing(
  map: MapData,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      if (!inBounds(x, y)) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const boundary = nx * nx + ny * ny
        + Math.sin((x + cx) * 0.27) * 0.045
        + Math.cos((y - cy) * 0.31) * 0.045;
      if (boundary > 1) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

function addStonePocket(map: MapData, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const idx = mapIndex(x, y);
      if (map.tiles[idx] === TileType.DIRT) continue;
      map.tiles[idx] = TileType.STONE;
      map.elevation[idx] = d < radius * 0.55 ? 5 : 4;
    }
  }
}

function addMountainRockSpires(
  map: MapData,
  roadStart: { x: number; y: number },
  roadEnd: { x: number; y: number }
): void {
  const anchors: Array<{ x: number; y: number; size: 2 | 4 }> = [
    { x: 0.10, y: 0.18, size: 4 },
    { x: 0.09, y: 0.65, size: 4 },
    { x: 0.34, y: 0.18, size: 2 },
    { x: 0.27, y: 0.48, size: 2 },
    { x: 0.45, y: 0.86, size: 4 },
    { x: 0.58, y: 0.13, size: 2 },
    { x: 0.69, y: 0.84, size: 2 },
    { x: 0.76, y: 0.56, size: 2 },
    { x: 0.88, y: 0.82, size: 4 },
    { x: 0.91, y: 0.34, size: 4 },
  ];

  for (const anchor of anchors) {
    const x = Math.round(W * anchor.x);
    const y = Math.round(H * anchor.y);
    if (pointSegmentDistance(x, y, roadStart.x, roadStart.y, roadEnd.x, roadEnd.y) < 6.5) {
      continue;
    }
    addRockSpireFeature(map, x, y, anchor.size, roadStart, roadEnd);
  }
}

function addRockSpireFeature(
  map: MapData,
  cx: number,
  cy: number,
  size: 2 | 4,
  roadStart: { x: number; y: number },
  roadEnd: { x: number; y: number }
): void {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = Math.round(cx + dx - (size - 1) / 2);
        const y = Math.round(cy + dy - (size - 1) / 2);
        if (!canPlaceRockSpire(map, x, y, size, roadStart, roadEnd)) continue;
        forRockSpireFootprint(x, y, size, (tx, ty) => {
          const idx = mapIndex(tx, ty);
          map.tiles[idx] = TileType.STONE;
          const centerBoost = Math.hypot(tx - (x + (size - 1) / 2), ty - (y + (size - 1) / 2)) < size * 0.36;
          map.elevation[idx] = clampElevation(Math.max(map.elevation[idx], centerBoost ? 7 : 6));
        });
        map.features.push({ kind: MapFeatureKind.ROCK_SPIRE, x, y, size });
        return;
      }
    }
  }
}

function canPlaceRockSpire(
  map: MapData,
  x: number,
  y: number,
  size: number,
  roadStart: { x: number; y: number },
  roadEnd: { x: number; y: number }
): boolean {
  if (x < 1 || y < 1 || x + size >= W - 1 || y + size >= H - 1) return false;
  for (const feature of map.features) {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) continue;
    if (rockSlicesOverlap(x, y, size, feature.x, feature.y, rockFeatureSize(feature), 2)) {
      return false;
    }
  }
  let stoneOrHighGround = false;
  let canPlace = true;
  forRockSpireFootprint(x, y, size, (tx, ty) => {
    const idx = mapIndex(tx, ty);
    const tile = map.tiles[idx];
    if (
      isWaterTile(tile)
      || tile === TileType.BRIDGE
      || tile === TileType.DIRT
      || tile === TileType.SAND
      || pointSegmentDistance(tx, ty, roadStart.x, roadStart.y, roadEnd.x, roadEnd.y) < 5.4
    ) {
      canPlace = false;
      return;
    }
    if (tile === TileType.STONE || map.elevation[idx] >= 5) stoneOrHighGround = true;
  });
  if (!canPlace) return false;
  return stoneOrHighGround;
}

function rockSlicesOverlap(
  ax: number,
  ay: number,
  asize: number,
  bx: number,
  by: number,
  bsize: number,
  padding: number
): boolean {
  return (
    ax - padding < bx + bsize
    && ax + asize + padding > bx
    && ay - padding < by + bsize
    && ay + asize + padding > by
  );
}

function addMachovoLindenTrees(map: MapData): void {
  const anchors = [
    { x: 0.18, y: 0.18 },
    { x: 0.25, y: 0.25 },
    { x: 0.31, y: 0.20 },
    { x: 0.20, y: 0.68 },
    { x: 0.14, y: 0.54 },
    { x: 0.22, y: 0.61 },
    { x: 0.47, y: 0.14 },
    { x: 0.55, y: 0.16 },
    { x: 0.78, y: 0.39 },
    { x: 0.80, y: 0.32 },
    { x: 0.86, y: 0.45 },
    { x: 0.74, y: 0.79 },
    { x: 0.83, y: 0.73 },
    { x: 0.48, y: 0.87 },
    { x: 0.56, y: 0.83 },
  ];

  for (const anchor of anchors) {
    addLindenTreeFeature(map, Math.round(W * anchor.x), Math.round(H * anchor.y));
  }
}

function addLindenTreeFeature(map: MapData, cx: number, cy: number): void {
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!canPlaceLindenTree(map, x, y)) continue;
        map.features.push({ kind: MapFeatureKind.LINDEN_TREE, x, y });
        return;
      }
    }
  }
}

function canPlaceLindenTree(map: MapData, x: number, y: number): boolean {
  if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
  const tile = map.tiles[mapIndex(x, y)];
  if (tile !== TileType.FOREST && tile !== TileType.GRASS) return false;
  for (const feature of map.features) {
    if (Math.hypot(feature.x - x, feature.y - y) < 4) return false;
  }
  return true;
}

function clearSpawnPatch(
  map: MapData,
  cx: number,
  cy: number,
  radius = 3
): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const idx = mapIndex(x, y);
      map.tiles[idx] = Math.abs(x - cx) + Math.abs(y - cy) <= 1 ? TileType.DIRT : TileType.GRASS;
      map.elevation[idx] = 3;
    }
  }
}

function applySandFringe(map: MapData): void {
  const next = Uint8Array.from(map.tiles);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = mapIndex(x, y);
      if (map.tiles[idx] !== TileType.GRASS) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!inBounds(x + dx, y + dy)) continue;
          if (isWaterTile(map.tiles[mapIndex(x + dx, y + dy)])) {
            nearWater = true;
            break;
          }
        }
      }
      if (nearWater) next[idx] = TileType.SAND;
    }
  }
  map.tiles.set(next);
}

function forRockSpireFootprint(
  x: number,
  y: number,
  size: number,
  visit: (x: number, y: number) => void
): void {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(tx, ty)) continue;
      visit(tx, ty);
    }
  }
}

function rockFeatureSize(feature: MapFeature): number {
  return feature.kind === MapFeatureKind.ROCK_SPIRE ? Math.max(2, feature.size ?? 2) : 1;
}

function rebuildWalkability(map: MapData): void {
  for (let y = 0; y < H; y++) {
    if (!map.walkability[y]) map.walkability[y] = [];
    for (let x = 0; x < W; x++) {
      map.walkability[y][x] = isWaterTile(map.tiles[mapIndex(x, y)]) ? 1 : 0;
    }
  }
  for (const feature of map.features) {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) continue;
    forRockSpireFootprint(feature.x, feature.y, rockFeatureSize(feature), (x, y) => {
      map.walkability[y][x] = 1;
    });
  }
}

function setSpawns(
  map: MapData,
  p1Prefer: { x: number; y: number },
  p2Prefer: { x: number; y: number }
): void {
  map.spawns[1] = findClearSpawn(map, p1Prefer.x, p1Prefer.y);
  map.spawns[2] = findClearSpawn(map, p2Prefer.x, p2Prefer.y);
}

function findClearSpawn(map: MapData, preferX: number, preferY: number): { x: number; y: number } {
  for (let r = 0; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = preferX + dx;
        const y = preferY + dy;
        if (x < 4 || y < 4 || x >= W - 4 || y >= H - 4) continue;
        if (map.walkability[y][x] !== 0) continue;
        const tile = map.tiles[mapIndex(x, y)];
        if (
          tile !== TileType.GRASS
          && tile !== TileType.DIRT
          && tile !== TileType.SNOW
          && tile !== TileType.PACKED_SNOW
        ) continue;
        if (hasNearbyWater(map, x, y, 2)) continue;
        return { x, y };
      }
    }
  }
  return { x: preferX, y: preferY };
}

function hasNearbyWater(map: MapData, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (isWaterTile(map.tiles[mapIndex(nx, ny)])) return true;
    }
  }
  return false;
}

function refreshBridgePositions(map: MapData): void {
  map.bridgePositions.length = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map.tiles[mapIndex(x, y)] === TileType.BRIDGE) {
        map.bridgePositions.push({ x, y });
      }
    }
  }
}

/** Helper for the render layer — get tile type at (x, y). */
export function getTile(map: MapData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= W || y >= H) return TileType.GRASS;
  return map.tiles[y * W + x];
}

/** Helper — get elevation at (x, y). */
export function getElevation(map: MapData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= W || y >= H) return 3;
  return map.elevation[y * W + x];
}
