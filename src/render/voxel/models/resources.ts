/**
 * Resource node voxel models — pine tree, gold ore vein, stone outcrop,
 * berry bush. All authored at the same voxel scale so they read consistently
 * on the map.
 */

import type { Voxel } from '../voxel-render';
import { PALETTE as P } from '../palette';

// ────────────────────────────────────────────────────────────────────────────
// Pine tree
// ────────────────────────────────────────────────────────────────────────────

export function buildTreeVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });

  // Trunk (1×1, 6 tall)
  for (let z = 0; z <= 5; z++) {
    put(4, 4, z, z < 2 ? P.TREE_TRUNK_D : P.TREE_TRUNK_L);
  }
  // Wider trunk base for stability
  put(3, 4, 0, P.TREE_TRUNK_D);
  put(5, 4, 0, P.TREE_TRUNK_D);
  put(4, 3, 0, P.TREE_TRUNK_D);
  put(4, 5, 0, P.TREE_TRUNK_D);

  // Conical canopy — 3 stacked tiers narrowing upward.
  // Tier 1 (z=4-6): 5×5
  for (let z = 4; z <= 6; z++) {
    for (let x = 2; x <= 6; x++) {
      for (let y = 2; y <= 6; y++) {
        const corner = (x === 2 || x === 6) && (y === 2 || y === 6);
        if (corner) continue;
        const tone = (x + y + z) % 3 === 0 ? P.TREE_CANOPY_D : P.TREE_CANOPY_M;
        put(x, y, z, tone);
      }
    }
  }
  // Tier 2 (z=7-9): 3×3
  for (let z = 7; z <= 9; z++) {
    for (let x = 3; x <= 5; x++) {
      for (let y = 3; y <= 5; y++) {
        const tone = (x + y + z) % 3 === 0 ? P.TREE_CANOPY_L : P.TREE_CANOPY_M;
        put(x, y, z, tone);
      }
    }
  }
  // Tier 3 (z=10-11): 1-wide tip
  put(4, 4, 10, P.TREE_CANOPY_L);
  put(4, 4, 11, P.TREE_CANOPY_L);

  return out;
}

export function buildSnowTreeVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });

  for (let z = 0; z <= 5; z++) {
    put(4, 4, z, z < 2 ? P.TREE_TRUNK_D : P.TREE_TRUNK_L);
  }
  put(3, 4, 0, P.TREE_TRUNK_D);
  put(5, 4, 0, P.TREE_TRUNK_D);
  put(4, 3, 0, P.TREE_TRUNK_D);
  put(4, 5, 0, P.TREE_TRUNK_D);

  for (let z = 4; z <= 6; z++) {
    for (let x = 2; x <= 6; x++) {
      for (let y = 2; y <= 6; y++) {
        const corner = (x === 2 || x === 6) && (y === 2 || y === 6);
        if (corner) continue;
        const snowCap = z === 6 || ((x + y) % 4 === 0 && z === 5);
        const tone = snowCap
          ? ((x + y) % 3 === 0 ? P.SNOW_D : P.SNOW_L)
          : ((x + y + z) % 3 === 0 ? P.TREE_CANOPY_D : P.TREE_CANOPY_M);
        put(x, y, z, tone);
      }
    }
  }

  for (let z = 7; z <= 9; z++) {
    for (let x = 3; x <= 5; x++) {
      for (let y = 3; y <= 5; y++) {
        const snowCap = z === 9 || (z === 8 && (x + y) % 2 === 0);
        const tone = snowCap
          ? ((x + y + z) % 3 === 0 ? P.SNOW_M : P.SNOW_L)
          : ((x + y + z) % 3 === 0 ? P.TREE_CANOPY_L : P.TREE_CANOPY_M);
        put(x, y, z, tone);
      }
    }
  }

  put(4, 4, 10, P.SNOW_L);
  put(4, 4, 11, P.SNOW_L);
  put(4, 4, 12, P.SNOW_M);

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Linden tree
// ────────────────────────────────────────────────────────────────────────────

export function buildLindenTreeVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const leafL = 0x74a94a;
  const leafM = 0x5f8e3a;
  const leafD = 0x3f6729;

  for (let z = 0; z <= 7; z++) {
    put(5, 5, z, z < 3 ? P.TREE_TRUNK_D : P.TREE_TRUNK_L);
    if (z <= 2) put(6, 5, z, P.TREE_TRUNK_D);
  }
  put(4, 5, 0, P.TREE_TRUNK_D);
  put(5, 4, 0, P.TREE_TRUNK_D);
  put(6, 6, 0, P.TREE_TRUNK_D);

  const layers = [
    { z: 5, rx: 5.2, ry: 4.0 },
    { z: 6, rx: 5.0, ry: 4.4 },
    { z: 7, rx: 4.8, ry: 4.6 },
    { z: 8, rx: 4.3, ry: 4.1 },
    { z: 9, rx: 3.8, ry: 3.6 },
    { z: 10, rx: 3.0, ry: 2.9 },
    { z: 11, rx: 2.1, ry: 2.0 },
  ];

  for (const layer of layers) {
    for (let x = 0; x <= 10; x++) {
      for (let y = 1; y <= 9; y++) {
        const dx = (x - 5) / layer.rx;
        const dy = (y - 5) / layer.ry;
        const d = dx * dx + dy * dy;
        const edgeChip = (x * 7 + y * 5 + layer.z) % 11 === 0;
        if (d > 1 || (d > 0.82 && edgeChip)) continue;
        const tone = (x + y + layer.z) % 5 === 0
          ? leafL
          : (x * 3 + y + layer.z) % 4 === 0
            ? leafD
            : leafM;
        put(x, y, layer.z, tone);
      }
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Gold ore vein
// ────────────────────────────────────────────────────────────────────────────

export function buildGoldVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });

  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 9; y++) {
      const dx = (x - 5) / 5.2;
      const dy = (y - 4.5) / 4.8;
      const dist = dx * dx + dy * dy;
      const edgeChip = (x * 5 + y * 7) % 13 === 0;
      if (dist > 1 || (dist > 0.82 && edgeChip)) continue;
      const baseTone = (x + y) % 4 === 0 ? P.STONE_ORE_D : P.STONE_ORE_M;
      put(x, y, 0, baseTone);
      if (dist < 0.76) put(x, y, 1, (x + y) % 3 === 0 ? P.STONE_ORE_M : P.STONE_ORE_L);
      if (dist < 0.42 && (x + y) % 2 === 0) put(x, y, 2, P.STONE_ORE_M);
    }
  }

  const veins = [
    { x: 3, y: 3, h: 3 },
    { x: 4, y: 4, h: 4 },
    { x: 5, y: 4, h: 4 },
    { x: 6, y: 4, h: 3 },
    { x: 7, y: 5, h: 3 },
    { x: 2, y: 5, h: 2 },
    { x: 4, y: 6, h: 3 },
    { x: 6, y: 6, h: 3 },
    { x: 8, y: 3, h: 2 },
  ];
  for (const vein of veins) {
    for (let z = 1; z <= vein.h; z++) {
      const color = z === vein.h || (vein.x + vein.y + z) % 2 === 0 ? P.GOLD_ORE : P.GOLD_ORE_D;
      put(vein.x, vein.y, z, color);
      if (z <= 2 && (vein.x + z) % 2 === 0) put(vein.x + 1, vein.y, z, color);
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Stone outcrop
// ────────────────────────────────────────────────────────────────────────────

export function buildStoneVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });

  // Keep the old low, gray, layered pile style, scaled up to fill most of a tile.
  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 9; y++) {
      const dx = (x - 5) / 5.25;
      const dy = (y - 4.5) / 4.65;
      const dist = dx * dx + dy * dy;
      const chip = (x * 7 + y * 3) % 17 === 0;
      if (dist > 1 || (dist > 0.86 && chip)) continue;

      const baseTone = (x + y) % 3 === 0 ? P.STONE_ORE_D : P.STONE_ORE_M;
      put(x, y, 0, baseTone);

      if (dist < 0.72) {
        const tone = (x + y) % 2 === 0 ? P.STONE_ORE_M : P.STONE_ORE_L;
        put(x, y, 1, tone);
      }
      if (dist < 0.36 && x >= 2 && x <= 8 && y >= 2 && y <= 7) {
        const tone = (x + y) % 3 === 0 ? P.STONE_ORE_M : P.STONE_ORE_L;
        put(x, y, 2, tone);
      }
      if (dist < 0.14 && (x + y) % 2 === 0) {
        put(x, y, 3, P.STONE_ORE_L);
      }
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Jagged mountain rock
// ────────────────────────────────────────────────────────────────────────────

export function buildJaggedRockVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });
  const peaks = [
    { x: 3, y: 4, h: 9, falloff: 2.0 },
    { x: 6, y: 3, h: 7, falloff: 2.2 },
    { x: 6, y: 6, h: 6, falloff: 2.0 },
    { x: 8, y: 5, h: 5, falloff: 2.1 },
    { x: 2, y: 6, h: 4, falloff: 2.3 },
  ];

  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 8; y++) {
      let height = 0;
      for (const peak of peaks) {
        const d = Math.hypot(x - peak.x, y - peak.y);
        height = Math.max(height, Math.ceil(peak.h - d * peak.falloff));
      }
      if (height <= 0) continue;
      for (let z = 0; z <= height; z++) {
        const color = z > height - 2
          ? P.STONE_ORE_L
          : (x + y + z) % 4 === 0
            ? P.STONE_ORE_D
            : P.STONE_ORE_M;
        put(x, y, z, color);
      }
      if (height >= 5 && (x * 3 + y) % 7 === 0) {
        put(x, y, height + 1, P.STONE_ORE_L);
      }
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Berry bush
// ────────────────────────────────────────────────────────────────────────────

export function buildBerryVoxels(): Voxel[] {
  const out: Voxel[] = [];
  const put = (x: number, y: number, z: number, c: number) => out.push({ x, y, z, color: c });

  // Leafy bush mass — round
  for (let x = 1; x <= 5; x++) {
    for (let y = 1; y <= 5; y++) {
      for (let z = 0; z <= 3; z++) {
        const dx = x - 3, dy = y - 3, dz = z - 1.5;
        const dist = dx * dx + dy * dy + dz * dz * 1.5;
        if (dist < 6) {
          const tone = (x + y + z) % 3 === 0 ? P.TREE_CANOPY_D : P.TREE_CANOPY_M;
          put(x, y, z, tone);
        }
      }
    }
  }
  // Berries scattered on the surface
  put(2, 2, 2, P.BERRY);
  put(4, 2, 2, P.BERRY);
  put(3, 3, 3, P.BERRY);
  put(2, 4, 2, P.BERRY);
  put(4, 4, 3, P.BERRY);
  put(1, 3, 1, P.BERRY_D);
  put(5, 3, 2, P.BERRY_D);

  return out;
}
