#!/usr/bin/env node
/**
 * gen-tc-v2.mjs
 *
 * Re-implementation of the Bohemian Town Center using vox-saver, a battle-tested
 * MagicaVoxel .vox encoder. Our hand-rolled writer (gen-voxel-tc.mjs) produces
 * bytes that SpotVox's renderer rejects with an ArrayIndexOutOfBoundsException
 * at higher render multipliers — likely a missing scene-graph chunk. vox-saver
 * emits the canonical chunk structure SpotVox is happy with.
 *
 * Run:
 *   node scripts/gen-tc-v2.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import voxSaverModule from 'vox-saver';
const writeVox = voxSaverModule.default ?? voxSaverModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(
  __dirname,
  '../art-source/voxel/dark/town-center/tc.vox'
);

// ────────────────────────────────────────────────────────────────────────────
// Palette — 256 entries. Index 0 of THIS array is what voxels reference as
// palette index 1 in the file (vox-saver handles this offset internally).
// ────────────────────────────────────────────────────────────────────────────

const COLORS = [
  { r: 110, g: 113, b: 120, a: 255 }, // 1 stone medium
  { r: 88,  g: 92,  b: 100, a: 255 }, // 2 stone dark
  { r: 140, g: 142, b: 148, a: 255 }, // 3 stone light
  { r: 82,  g: 56,  b: 30,  a: 255 }, // 4 wood dark
  { r: 126, g: 88,  b: 46,  a: 255 }, // 5 wood medium
  { r: 160, g: 116, b: 70,  a: 255 }, // 6 wood light
  { r: 122, g: 36,  b: 36,  a: 255 }, // 7 roof red
  { r: 88,  g: 26,  b: 26,  a: 255 }, // 8 roof shadow
  { r: 232, g: 185, b: 35,  a: 255 }, // 9 gold banner
  { r: 46,  g: 134, b: 222, a: 255 }, // 10 Bohemia blue
  { r: 40,  g: 44,  b: 56,  a: 255 }, // 11 iron / arrow slit
  { r: 62,  g: 90,  b: 44,  a: 255 }, // 12 moss green
];
// Pad palette to 255 entries (the file format expects exactly 255 RGB+A tuples).
const rgbaValues = [...COLORS];
while (rgbaValues.length < 255) rgbaValues.push({ r: 0, g: 0, b: 0, a: 0 });

const C = {
  STONE_M: 1,
  STONE_D: 2,
  STONE_L: 3,
  WOOD_D: 4,
  WOOD_M: 5,
  WOOD_L: 6,
  ROOF: 7,
  ROOF_D: 8,
  GOLD: 9,
  BLUE: 10,
  IRON: 11,
  MOSS: 12,
};

// ────────────────────────────────────────────────────────────────────────────
// Build voxels (offset to fit inside 32×32×32 with breathing room)
// ────────────────────────────────────────────────────────────────────────────

const SIZE = 32;
const OX = 4, OY = 4, OZ = 1;
const voxels = [];
const setVoxel = (x, y, z, c) => {
  const ax = x + OX, ay = y + OY, az = z + OZ;
  if (ax >= 0 && ay >= 0 && az >= 0 && ax < SIZE && ay < SIZE && az < SIZE) {
    voxels.push({ x: ax, y: ay, z: az, i: c });
  }
};
const fillBox = (x0, y0, z0, x1, y1, z1, c) => {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) setVoxel(x, y, z, c);
};
const hollowBox = (x0, y0, z0, x1, y1, z1, wall, fill = null) => {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const onShell = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        if (onShell) setVoxel(x, y, z, wall);
        else if (fill !== null) setVoxel(x, y, z, fill);
      }
};

// Bohemian keep — square donjon, conical wooden roof, banner on top.

// 1. Moss ring around the keep footprint.
for (let x = 3; x <= 20; x++)
  for (let y = 3; y <= 20; y++)
    if (x < 6 || x > 17 || y < 6 || y > 17) setVoxel(x, y, 0, C.MOSS);

// 2. Stone plinth.
fillBox(6, 6, 0, 17, 17, 0, C.STONE_D);

// 3. Hollow stone keep walls.
hollowBox(6, 6, 1, 17, 17, 12, C.STONE_M);

// 4. Banded courses for visual texture.
for (const z of [3, 6, 9, 11]) {
  for (let x = 6; x <= 17; x++) {
    setVoxel(x, 6, z, C.STONE_L);
    setVoxel(x, 17, z, C.STONE_L);
  }
  for (let y = 7; y <= 16; y++) {
    setVoxel(6, y, z, C.STONE_L);
    setVoxel(17, y, z, C.STONE_L);
  }
}

// 5. Wooden door on south face.
for (let z = 1; z <= 3; z++)
  for (let x = 10; x <= 13; x++) setVoxel(x, 6, z, C.WOOD_D);
setVoxel(11, 6, 2, C.IRON);
setVoxel(12, 6, 2, C.IRON);

// 6. Arrow slit windows.
for (const z of [7, 10]) {
  for (const wallX of [9, 14]) {
    setVoxel(wallX, 6, z, C.IRON);
    setVoxel(wallX, 17, z, C.IRON);
    setVoxel(6, wallX, z, C.IRON);
    setVoxel(17, wallX, z, C.IRON);
  }
}

// 7. Crenellations.
const crenZ = 13;
for (let x = 6; x <= 17; x += 2) {
  setVoxel(x, 6, crenZ, C.STONE_L);
  setVoxel(x, 17, crenZ, C.STONE_L);
}
for (let y = 8; y <= 15; y += 2) {
  setVoxel(6, y, crenZ, C.STONE_L);
  setVoxel(17, y, crenZ, C.STONE_L);
}

// 8. Inner courtyard floor.
fillBox(7, 7, 1, 16, 16, 1, C.WOOD_M);

// 9. Stepped roof.
fillBox(7,  7,  13, 16, 16, 13, C.ROOF);
fillBox(8,  8,  14, 15, 15, 14, C.ROOF);
fillBox(9,  9,  15, 14, 14, 15, C.ROOF);
fillBox(10, 10, 16, 13, 13, 16, C.ROOF);
fillBox(11, 11, 17, 12, 12, 17, C.ROOF_D);

// 10. Banner pole + Bohemia flag.
for (let z = 18; z <= 22; z++) setVoxel(11, 11, z, C.WOOD_D);
setVoxel(12, 11, 21, C.GOLD);
setVoxel(13, 11, 21, C.GOLD);
setVoxel(14, 11, 21, C.GOLD);
setVoxel(12, 11, 20, C.BLUE);
setVoxel(13, 11, 20, C.BLUE);

// 11. Wooden roof eaves.
for (let x = 7; x <= 16; x++) {
  setVoxel(x, 7, 13, C.WOOD_D);
  setVoxel(x, 16, 13, C.WOOD_D);
}
for (let y = 8; y <= 15; y++) {
  setVoxel(7, y, 13, C.WOOD_D);
  setVoxel(16, y, 13, C.WOOD_D);
}

console.log(`Built ${voxels.length} voxels.`);

const vox = {
  size: { x: SIZE, y: SIZE, z: SIZE },
  xyzi: { numVoxels: voxels.length, values: voxels },
  rgba: { values: rgbaValues },
};

const bytes = writeVox(vox);
writeFileSync(OUTPUT_PATH, Buffer.from(bytes));
console.log(`Wrote ${bytes.length} bytes to ${OUTPUT_PATH}`);
