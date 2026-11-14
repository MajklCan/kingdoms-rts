/**
 * Map previews for the skirmish list and the campaign briefing: the map's
 * terrain generated on the spot (a millisecond or two per map) and drawn as
 * the same isometric diamond the minimap uses, with each side's starting
 * position marked. Seeded maps are drawn from a fixed seed, so their
 * preview shows the character of the map rather than the exact match.
 */

import { generateMap, type MapIdValue } from '../../sim/map-gen';
import { Rng } from '../../sim/rng';
import { TILE_RGB } from '../hud/minimap';

const PREVIEW_SEED = 1;
const BLANK: [number, number, number] = [16, 11, 7];
const SPAWN_RGB: Record<number, string> = { 1: '#4aa0ff', 2: '#ff5a5a' };

const topDowns = new Map<string, { canvas: HTMLCanvasElement; spawns: Array<{ x: number; y: number }>; n: number }>();

function topDown(mapId: MapIdValue) {
  const cached = topDowns.get(mapId);
  if (cached) return cached;
  const map = generateMap(new Rng(PREVIEW_SEED), mapId);
  const n = Math.round(Math.sqrt(map.tiles.length));
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const rgb = TILE_RGB[map.tiles[i] ?? -1] ?? BLANK;
      img.data[i * 4] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const entry = { canvas, spawns: map.spawns, n };
  topDowns.set(mapId, entry);
  return entry;
}

/**
 * Paint `mapId` into `canvas`, sized to the canvas's CSS box. Campaign
 * missions place their own armies, so they leave the skirmish spawns out.
 */
export function paintMapPreview(canvas: HTMLCanvasElement, mapId: MapIdValue, markSpawns = true): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { canvas: src, spawns, n } = topDown(mapId);
  // The 2:1 diamond, as large as the box allows.
  const kx = Math.min(cw / (2 * n), ch / n);
  const ky = kx;
  const x0 = cw / 2;
  const y0 = (ch - n * ky) / 2;
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(kx, ky / 2, -kx, ky / 2, x0, y0);
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const at = (tx: number, ty: number): [number, number] => [x0 + (tx - ty) * kx, y0 + ((tx + ty) * ky) / 2];
  ctx.strokeStyle = 'rgba(201, 162, 39, 0.85)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(...at(0, 0));
  ctx.lineTo(...at(n, 0));
  ctx.lineTo(...at(n, n));
  ctx.lineTo(...at(0, n));
  ctx.closePath();
  ctx.stroke();
  if (!markSpawns) return;
  const r = Math.max(2, Math.round(2.5 * dpr));
  for (const id of [1, 2]) {
    const s = spawns[id];
    if (!s) continue;
    const [sx, sy] = at(s.x + 0.5, s.y + 0.5);
    ctx.fillStyle = '#0a0705';
    ctx.fillRect(Math.round(sx - r - dpr), Math.round(sy - r - dpr), 2 * r + 2 * dpr, 2 * r + 2 * dpr);
    ctx.fillStyle = SPAWN_RGB[id] ?? '#fff';
    ctx.fillRect(Math.round(sx - r), Math.round(sy - r), 2 * r, 2 * r);
  }
}
