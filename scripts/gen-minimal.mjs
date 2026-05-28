#!/usr/bin/env node
/**
 * Tiny minimal-cube .vox writer for debugging SpotVox compatibility.
 * Writes a solid 6×6×6 cube at the centre of a 16×16×16 box, using a single
 * paletted color. Nothing else.
 */
import { writeFileSync } from 'node:fs';

const SIZE = 16;
const voxels = [];
for (let z = 5; z <= 10; z++)
  for (let y = 5; y <= 10; y++)
    for (let x = 5; x <= 10; x++)
      voxels.push({ x, y, z, c: 79 }); // 79 = a nicely-saturated red in default palette

function chunk(id, content, children = Buffer.alloc(0)) {
  const header = Buffer.alloc(12);
  header.write(id, 0, 4, 'ascii');
  header.writeInt32LE(content.length, 4);
  header.writeInt32LE(children.length, 8);
  return Buffer.concat([header, content, children]);
}

const sizeContent = Buffer.alloc(12);
sizeContent.writeInt32LE(SIZE, 0);
sizeContent.writeInt32LE(SIZE, 4);
sizeContent.writeInt32LE(SIZE, 8);
const SIZE_chunk = chunk('SIZE', sizeContent);

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

// NO RGBA chunk — use SpotVox/MagicaVoxel default palette.
const children = Buffer.concat([SIZE_chunk, XYZI_chunk]);
const MAIN_chunk = chunk('MAIN', Buffer.alloc(0), children);

const header = Buffer.alloc(8);
header.write('VOX ', 0, 4, 'ascii');
header.writeInt32LE(150, 4); // version 150 — pre-scene-graph era

writeFileSync('art-source/voxel/dark/town-center/minimal.vox', Buffer.concat([header, MAIN_chunk]));
console.log('Wrote minimal.vox with', voxels.length, 'voxels.');
