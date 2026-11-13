/**
 * Minimap: an isometric diamond that matches the camera projection, drawn
 * on a device-pixel-ratio canvas. Terrain is cached and only re-baked when
 * exploration changes; units, buildings, combat pings and the camera frame
 * redraw at ~12 fps. Click or drag pans the camera.
 */

import type { GameScene } from '../../render/game-scene';
import { TileType } from '../../sim/map-gen';
import { h } from '../dom';
import { getCameraTileQuad, getScene } from '../game-bridge';

const TILE_RGB: Record<number, [number, number, number]> = {
  [TileType.GRASS]: [84, 112, 52],
  [TileType.FOREST]: [43, 58, 24],
  [TileType.DIRT]: [126, 90, 50],
  [TileType.SAND]: [196, 171, 112],
  [TileType.WATER]: [31, 72, 112],
  [TileType.WATER_SHALLOW]: [52, 110, 152],
  [TileType.STONE]: [140, 138, 130],
  [TileType.BRIDGE]: [126, 90, 50],
  [TileType.MUD]: [85, 80, 45],
  [TileType.BARBED_WIRE]: [94, 74, 48],
  [TileType.SNOW]: [220, 236, 244],
  [TileType.SNOW_FOREST]: [159, 185, 198],
  [TileType.ICE]: [131, 191, 212],
  [TileType.PACKED_SNOW]: [203, 220, 230],
};
const UNEXPLORED: [number, number, number] = [16, 11, 7];

const TEAM_HEX: Record<number, string> = {
  0: '#b0a68a',
  1: '#4aa0ff',
  2: '#ff5a5a',
};

let canvas: HTMLCanvasElement | null = null;
let terrainCanvas: HTMLCanvasElement | null = null;
let topDown: HTMLCanvasElement | null = null;
let terrainSig = -1;
let lastDraw = 0;
let mapN = 64;
let dragging = false;

export function buildMinimap(): HTMLElement {
  canvas = h('canvas', {
    id: 'minimap-canvas',
    class: 'minimap-canvas',
    role: 'img',
    'aria-label': 'Minimap. Click to move the camera.',
  });
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    canvas!.setPointerCapture(ev.pointerId);
    panFromEvent(ev);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (dragging) panFromEvent(ev);
  });
  const stop = () => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  return h(
    'section',
    { class: 'console-minimap frame-wood', 'aria-label': 'Minimap' },
    h('div', { class: 'minimap-frame' }, canvas)
  );
}

function geometry(c: HTMLCanvasElement): { k: number; x0: number; y0: number; dpr: number } {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = c.width;
  const hgt = c.height;
  // Fit a 2:1 diamond of mapN x mapN tiles into the canvas.
  const k = Math.min(w / (2 * mapN), hgt / mapN);
  const x0 = w / 2;
  const y0 = (hgt - mapN * k) / 2;
  return { k, x0, y0, dpr };
}

function toMini(g: { k: number; x0: number; y0: number }, tx: number, ty: number): [number, number] {
  return [g.x0 + (tx - ty) * g.k, g.y0 + ((tx + ty) * g.k) / 2];
}

function panFromEvent(ev: PointerEvent): void {
  const scene = getScene();
  if (!scene || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const sx = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const sy = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  const g = geometry(canvas);
  const a = (sx - g.x0) / g.k; // tx - ty
  const b = (2 * (sy - g.y0)) / g.k; // tx + ty
  const tx = Math.max(0, Math.min(mapN - 1, (a + b) / 2));
  const ty = Math.max(0, Math.min(mapN - 1, (b - a) / 2));
  scene.panToTile(tx, ty);
}

function bakeTerrain(tiles: Uint8Array, w: number, hgt: number): void {
  if (!topDown) topDown = document.createElement('canvas');
  topDown.width = w;
  topDown.height = hgt;
  const tctx = topDown.getContext('2d');
  if (!tctx) return;
  const img = tctx.createImageData(w, hgt);
  for (let i = 0; i < w * hgt; i++) {
    const t = tiles[i] ?? 255;
    const rgb = t === 255 ? UNEXPLORED : (TILE_RGB[t] ?? UNEXPLORED);
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
}

export function renderMinimap(scene: GameScene, now: number): void {
  if (!canvas) return;
  if (now - lastDraw < 80) return;
  lastDraw = now;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
  let resized = false;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
    resized = true;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const data = scene.getMinimapData();
  mapN = Math.max(data.mapW, data.mapH);

  // Cheap exploration signature: weighted sum of tile values.
  let sig = data.mapW * 131 + data.mapH;
  for (let i = 0; i < data.tiles.length; i += 1) sig = (sig * 31 + (data.tiles[i] ?? 0)) | 0;
  if (sig !== terrainSig || resized || !terrainCanvas) {
    terrainSig = sig;
    bakeTerrain(data.tiles, data.mapW, data.mapH);
    if (!terrainCanvas) terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = cw;
    terrainCanvas.height = ch;
    const tc = terrainCanvas.getContext('2d');
    if (tc && topDown) {
      const g = geometry(canvas);
      tc.clearRect(0, 0, cw, ch);
      tc.imageSmoothingEnabled = false;
      tc.setTransform(g.k, g.k / 2, -g.k, g.k / 2, g.x0, g.y0);
      tc.drawImage(topDown, 0, 0);
      tc.setTransform(1, 0, 0, 1, 0, 0);
      // Gilded diamond rim.
      const [tx, ty] = toMini(g, 0, 0);
      const [rx, ry] = toMini(g, data.mapW, 0);
      const [bx, by] = toMini(g, data.mapW, data.mapH);
      const [lx, ly] = toMini(g, 0, data.mapH);
      tc.strokeStyle = 'rgba(201, 162, 39, 0.75)';
      tc.lineWidth = Math.max(1, dpr);
      tc.beginPath();
      tc.moveTo(tx, ty);
      tc.lineTo(rx, ry);
      tc.lineTo(bx, by);
      tc.lineTo(lx, ly);
      tc.closePath();
      tc.stroke();
    }
  }

  ctx.clearRect(0, 0, cw, ch);
  if (terrainCanvas) ctx.drawImage(terrainCanvas, 0, 0);
  const g = geometry(canvas);
  const unitR = Math.max(1.2, g.k * 0.55);
  for (const e of data.entities) {
    if (e.kind >= 10) continue;
    const [x, y] = toMini(g, e.x, e.y);
    ctx.fillStyle = TEAM_HEX[e.player] ?? '#fff';
    if (e.kind === 3) {
      const s = Math.max(2.5, g.k * 1.6);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = Math.max(0.75, dpr * 0.5);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, unitR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const alert of data.combatAlerts) {
    const [x, y] = toMini(g, alert.x, alert.y);
    const pulse = 1 - alert.age;
    ctx.strokeStyle = `rgba(255, 70, 60, ${0.3 + 0.6 * pulse})`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, (3 + 9 * pulse) * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
  const quad = getCameraTileQuad(scene);
  if (quad) {
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.95)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    quad.corners.forEach((c, i) => {
      const [x, y] = toMini(g, c.x, c.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

export function resetMinimap(): void {
  terrainSig = -1;
}
