#!/usr/bin/env node
/**
 * gen-voxel-tc.mjs
 *
 * Writes a MagicaVoxel .vox file representing a Bohemian early-medieval
 * Town Center (donjon-keep style). No external deps — emits raw RIFF chunks
 * per the official MagicaVoxel format spec:
 *   https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 *
 * Coordinate system: x/y are the ground plane, z is up. The model fits within
 * (0..size-1) in each axis.
 *
 * Run:
 *   node scripts/gen-voxel-tc.mjs
 *
 * Output:
 *   art-source/voxel/dark/town-center/tc.vox
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(
  __dirname,
  '../art-source/voxel/dark/town-center/tc.vox'
);

// ────────────────────────────────────────────────────────────────────────────
// Palette (index 1 = first usable colour; index 0 is reserved as empty/void)
// We supply our own 256-colour palette so we know exactly what each index is.
// ────────────────────────────────────────────────────────────────────────────

/** [r, g, b, a] tuples. Index 0 of this array becomes vox palette index 1. */
const PALETTE = [
  [0, 0, 0, 0],            // 1 — unused / transparent slot
  [110, 113, 120, 255],    // 2 — stone medium
  [88,  92,  100, 255],    // 3 — stone dark (mortar / shadow)
  [140, 142, 148, 255],    // 4 — stone light
  [82,  56,  30,  255],    // 5 — wood dark
  [126, 88,  46,  255],    // 6 — wood medium
  [160, 116, 70,  255],    // 7 — wood light
  [122, 36,  36,  255],    // 8 — roof tile red (Bohemian terracotta)
  [88,  26,  26,  255],    // 9 — roof tile shadow
  [232, 185, 35,  255],    // 10 — gold banner
  [46,  134, 222, 255],    // 11 — Bohemia blue (banner stripe)
  [40,  44,  56,  255],    // 12 — iron door / arrow slit black
  [62,  90,  44,  255],    // 13 — moss base
];
// Pad to 256 entries (SpotVox / MagicaVoxel expect a full 256-entry palette).
while (PALETTE.length < 256) PALETTE.push([0, 0, 0, 0]);

// Convenient short names — mapped to 1-based palette indices.
const C = {
  STONE_M: 2,
  STONE_D: 3,
  STONE_L: 4,
  WOOD_D: 5,
  WOOD_M: 6,
  WOOD_L: 7,
  ROOF: 8,
  ROOF_D: 9,
  GOLD: 10,
  BLUE: 11,
  IRON: 12,
  MOSS: 13,
};

// ────────────────────────────────────────────────────────────────────────────
// Build the voxel model
// ────────────────────────────────────────────────────────────────────────────

const SIZE = 32; // 32×32×32 bounding box (matches sample model sizes; smaller boxes crash SpotVox at higher render multipliers).
const OFFSET = 4; // pad the model away from the bbox edges so iso projection doesn't go negative.
const voxels = []; // {x, y, z, c}

const setVoxel = (x, y, z, c) => {
  const ax = x + OFFSET;
  const ay = y + OFFSET;
  const az = z + 1; // 1 voxel of air below ground so we never sit on z=0
  if (ax < 0 || ay < 0 || az < 0 || ax >= SIZE || ay >= SIZE || az >= SIZE) return;
  voxels.push({ x: ax, y: ay, z: az, c });
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
        const onShell =
          x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        if (onShell) setVoxel(x, y, z, wall);
        else if (fill !== null) setVoxel(x, y, z, fill);
      }
};

// 1. Moss / grass base ring around the keep (cosmetic — gives it a footprint).
for (let x = 3; x <= 20; x++) {
  for (let y = 3; y <= 20; y++) {
    if (x < 6 || x > 17 || y < 6 || y > 17) {
      setVoxel(x, y, 0, C.MOSS);
    }
  }
}

// 2. Stone plinth — 12×12 footprint, 1 voxel high.
fillBox(6, 6, 0, 17, 17, 0, C.STONE_D);

// 3. Main keep walls — 12×12 footprint, 12 voxels tall, hollow.
hollowBox(6, 6, 1, 17, 17, 12, C.STONE_M);

// 4. Banded courses (a row of lighter stone every 3 voxels) — adds visible texture.
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

// 5. Door on south face (carved into wall by overwriting stone with iron/wood).
for (let z = 1; z <= 3; z++) {
  for (let x = 10; x <= 13; x++) {
    setVoxel(x, 6, z, C.WOOD_D);
  }
}
// Iron door studs
setVoxel(11, 6, 2, C.IRON);
setVoxel(12, 6, 2, C.IRON);

// 6. Arrow-slit windows (just darken a voxel here and there on each wall face).
for (const z of [7, 10]) {
  for (const wallX of [9, 14]) {
    setVoxel(wallX, 6, z, C.IRON);
    setVoxel(wallX, 17, z, C.IRON);
    setVoxel(6, wallX, z, C.IRON);
    setVoxel(17, wallX, z, C.IRON);
  }
}

// 7. Crenellations — alternating stone teeth around the top edge.
const crenZ = 13;
for (let x = 6; x <= 17; x += 2) {
  setVoxel(x, 6, crenZ, C.STONE_L);
  setVoxel(x, 17, crenZ, C.STONE_L);
}
for (let y = 8; y <= 15; y += 2) {
  setVoxel(6, y, crenZ, C.STONE_L);
  setVoxel(17, y, crenZ, C.STONE_L);
}

// 8. Inner courtyard floor — wood planks just inside the walls.
fillBox(7, 7, 1, 16, 16, 1, C.WOOD_M);

// 9. Conical / pyramidal roof — 4 stepped tiers narrowing to a point.
// Tier 1 (broad base):
fillBox(7, 7, 13, 16, 16, 13, C.ROOF);
// Tier 2:
fillBox(8, 8, 14, 15, 15, 14, C.ROOF);
// Tier 3:
fillBox(9, 9, 15, 14, 14, 15, C.ROOF);
// Tier 4 (apex):
fillBox(10, 10, 16, 13, 13, 16, C.ROOF);
fillBox(11, 11, 17, 12, 12, 17, C.ROOF_D);

// 10. Banner pole + Bohemia flag at the top.
for (let z = 18; z <= 22; z++) setVoxel(11, 11, z, C.WOOD_D);
// Flag pennon (gold on top, blue on bottom).
setVoxel(12, 11, 21, C.GOLD);
setVoxel(13, 11, 21, C.GOLD);
setVoxel(14, 11, 21, C.GOLD);
setVoxel(12, 11, 20, C.BLUE);
setVoxel(13, 11, 20, C.BLUE);

// 11. Wooden roof edge trim (a single voxel band along the eaves).
for (let x = 7; x <= 16; x++) {
  setVoxel(x, 7, 13, C.WOOD_D);
  setVoxel(x, 16, 13, C.WOOD_D);
}
for (let y = 8; y <= 15; y++) {
  setVoxel(7, y, 13, C.WOOD_D);
  setVoxel(16, y, 13, C.WOOD_D);
}

console.log(`Built ${voxels.length} voxels.`);

// ────────────────────────────────────────────────────────────────────────────
// Encode as MagicaVoxel .vox
// ────────────────────────────────────────────────────────────────────────────

/** A RIFF-style chunk: id (4 bytes) | content size (4 le) | children size (4 le) | content | children */
function chunk(id, content, children = Buffer.alloc(0)) {
  const header = Buffer.alloc(12);
  header.write(id, 0, 4, 'ascii');
  header.writeInt32LE(content.length, 4);
  header.writeInt32LE(children.length, 8);
  return Buffer.concat([header, content, children]);
}

// SIZE chunk content: x, y, z dims (i32 each, little-endian).
const sizeContent = Buffer.alloc(12);
sizeContent.writeInt32LE(SIZE, 0);
sizeContent.writeInt32LE(SIZE, 4);
sizeContent.writeInt32LE(SIZE, 8);
const SIZE_chunk = chunk('SIZE', sizeContent);

// XYZI chunk content: count (i32) + (x, y, z, color_index) per voxel.
const xyziContent = Buffer.alloc(4 + voxels.length * 4);
xyziContent.writeInt32LE(voxels.length, 0);
voxels.forEach((v, i) => {
  const off = 4 + i * 4;
  xyziContent.writeUInt8(v.x, off);
  xyziContent.writeUInt8(v.y, off + 1);
  xyziContent.writeUInt8(v.z, off + 2);
  xyziContent.writeUInt8(v.c, off + 3);
});
const XYZI_chunk = chunk('XYZI', xyziContent);

// RGBA chunk: 256 entries × 4 bytes each. NOTE: index i in palette maps to
// material index (i+1) — spec quirk; we already account for this in C.* values.
const rgbaContent = Buffer.alloc(256 * 4);
for (let i = 0; i < 256; i++) {
  const [r, g, b, a] = PALETTE[i] ?? [0, 0, 0, 0];
  rgbaContent.writeUInt8(r, i * 4);
  rgbaContent.writeUInt8(g, i * 4 + 1);
  rgbaContent.writeUInt8(b, i * 4 + 2);
  rgbaContent.writeUInt8(a, i * 4 + 3);
}
const RGBA_chunk = chunk('RGBA', rgbaContent);

// MAIN chunk has NO content; the children are SIZE + XYZI + RGBA.
const children = Buffer.concat([SIZE_chunk, XYZI_chunk, RGBA_chunk]);
const MAIN_chunk = chunk('MAIN', Buffer.alloc(0), children);

// File header: "VOX " + version (matches MagicaVoxel 0.99.7 output: 200 / 0xC8).
const header = Buffer.alloc(8);
header.write('VOX ', 0, 4, 'ascii');
header.writeInt32LE(200, 4);

const out = Buffer.concat([header, MAIN_chunk]);
writeFileSync(OUTPUT_PATH, out);
console.log(`Wrote ${out.length} bytes to ${OUTPUT_PATH}`);
