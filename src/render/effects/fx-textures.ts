/**
 * Procedural sprite sheet for world VFX, drawn once into a canvas texture:
 * soft dots and puffs, sparks, chips, shards, flames, glows, glints, rings,
 * scorch marks, birds, butterflies, resource icons and a big soft cloud.
 * Shapes are white unless they carry their own colour, so particles tint
 * them per use. Everything shares one texture, so the pool batches.
 */

/** Texture key of the VFX sheet; frames are {@link FxFrame} names. */
export const FX_SHEET = 'fx-sheet';
/** Separate big soft blob for cloud shadows and mist banks. */
export const FX_CLOUD = 'fx-cloud';

export type FxFrame =
  | 'dot'
  | 'puff'
  | 'spark'
  | 'streak'
  | 'chip'
  | 'shard'
  | 'flame'
  | 'glow'
  | 'star'
  | 'ring'
  | 'scorch'
  | 'leaf'
  | 'bird0'
  | 'bird1'
  | 'fly0'
  | 'fly1'
  | 'icon-food'
  | 'icon-wood'
  | 'icon-gold'
  | 'icon-stone';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

const SHAPES: ReadonlyArray<readonly [FxFrame, number, number, Draw]> = [
  ['dot', 8, 8, (g) => radial(g, 4, 4, 4, [[0, 1], [0.45, 0.85], [1, 0]])],
  ['puff', 32, 32, drawPuff],
  ['spark', 6, 6, (g) => radial(g, 3, 3, 3, [[0, 1], [0.5, 0.9], [1, 0]])],
  ['streak', 14, 4, drawStreak],
  ['chip', 4, 4, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4); }],
  ['shard', 8, 6, drawShard],
  ['flame', 16, 26, drawFlame],
  ['glow', 32, 32, (g) => radial(g, 16, 16, 16, [[0, 1], [0.3, 0.6], [1, 0]])],
  ['star', 13, 13, drawStar],
  ['ring', 64, 32, drawRing],
  ['scorch', 64, 32, drawScorch],
  ['leaf', 6, 4, drawLeaf],
  ['bird0', 14, 7, (g) => drawBird(g, -0.55)],
  ['bird1', 14, 7, (g) => drawBird(g, 0.35)],
  ['fly0', 7, 6, (g) => drawButterfly(g, 1)],
  ['fly1', 7, 6, (g) => drawButterfly(g, 0.35)],
  ['icon-food', 14, 14, drawFoodIcon],
  ['icon-wood', 14, 14, drawWoodIcon],
  ['icon-gold', 14, 14, (g) => drawNuggetIcon(g, '#f6d04d', '#9a6a12')],
  ['icon-stone', 14, 14, (g) => drawNuggetIcon(g, '#c9ccd1', '#5d6168')],
];

const PAD = 2;
const SHEET_W = 256;

/** Build the VFX textures once per game (no-op when they exist). */
export function ensureFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX_SHEET)) buildSheet(scene);
  if (!scene.textures.exists(FX_CLOUD)) buildCloud(scene);
}

function buildSheet(scene: Phaser.Scene): void {
  // Shelf-pack the shapes into one canvas.
  const places: Array<{ name: FxFrame; x: number; y: number; w: number; h: number; draw: Draw }> = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const [name, w, h, draw] of SHAPES) {
    if (x + w + PAD > SHEET_W) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    places.push({ name, x, y, w, h, draw });
    x += w + PAD;
    rowH = Math.max(rowH, h);
  }
  const height = y + rowH + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return;
  for (const p of places) {
    g.save();
    g.translate(p.x, p.y);
    g.beginPath();
    g.rect(0, 0, p.w, p.h);
    g.clip();
    p.draw(g, p.w, p.h);
    g.restore();
  }
  const texture = scene.textures.addCanvas(FX_SHEET, canvas);
  if (!texture) return;
  for (const p of places) texture.add(p.name, 0, p.x, p.y, p.w, p.h);
  texture.setFilter(0 as Phaser.Textures.FilterMode); // LINEAR
}

/** A lumpy soft cloud: a few overlapping radial blobs. */
function buildCloud(scene: Phaser.Scene): void {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return;
  const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
    [128, 66, 70, 0.55],
    [80, 72, 50, 0.5],
    [176, 60, 56, 0.5],
    [112, 50, 44, 0.45],
    [152, 80, 46, 0.45],
    [54, 62, 32, 0.35],
    [206, 74, 34, 0.35],
  ];
  for (const [cx, cy, r, a] of blobs) {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.6, `rgba(255,255,255,${a * 0.55})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  scene.textures.addCanvas(FX_CLOUD, canvas)?.setFilter(0 as Phaser.Textures.FilterMode);
}

// ── Shapes ──────────────────────────────────────────────────────────────────

function radial(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  stops: ReadonlyArray<readonly [number, number]>
): void {
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function drawPuff(g: CanvasRenderingContext2D): void {
  const lobes: ReadonlyArray<readonly [number, number, number]> = [
    [16, 17, 13],
    [11, 14, 8],
    [21, 13, 8],
    [15, 10, 7],
    [20, 20, 8],
  ];
  for (const [cx, cy, r] of lobes) {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
}

function drawStreak(g: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  g.fill();
}

function drawShard(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(1, 2);
  g.lineTo(5, 0);
  g.lineTo(8, 3);
  g.lineTo(6, 6);
  g.lineTo(2, 5);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(2, 4, 4, 2);
}

function drawFlame(g: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = g.createRadialGradient(w / 2, h * 0.7, 0, w / 2, h * 0.62, h * 0.55);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(w / 2, 0);
  g.bezierCurveTo(w * 0.95, h * 0.45, w, h * 0.85, w / 2, h);
  g.bezierCurveTo(0, h * 0.85, w * 0.05, h * 0.45, w / 2, 0);
  g.fill();
}

function drawStar(g: CanvasRenderingContext2D, w: number, h: number): void {
  const c = w / 2;
  radial(g, c, c, 3.5, [[0, 1], [1, 0]]);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.moveTo(c, 0);
  g.lineTo(c + 1, c - 1);
  g.lineTo(w, c);
  g.lineTo(c + 1, c + 1);
  g.lineTo(c, h);
  g.lineTo(c - 1, c + 1);
  g.lineTo(0, c);
  g.lineTo(c - 1, c - 1);
  g.closePath();
  g.fill();
}

function drawRing(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2 - 3, h / 2 - 3, 0, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 6;
  g.stroke();
}

function drawScorch(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.save();
  g.scale(1, h / w);
  const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
  g.restore();
}

function drawLeaf(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#fff';
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2, h / 2 - 0.5, 0.3, 0, Math.PI * 2);
  g.fill();
}

function drawBird(g: CanvasRenderingContext2D, wing: number): void {
  g.strokeStyle = '#1d1a17';
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(1, 3.5 + wing * 3);
  g.quadraticCurveTo(4, 3.5 - wing * 1.5, 7, 4);
  g.quadraticCurveTo(10, 3.5 - wing * 1.5, 13, 3.5 + wing * 3);
  g.stroke();
}

function drawButterfly(g: CanvasRenderingContext2D, open: number): void {
  g.fillStyle = '#fff';
  g.beginPath();
  g.ellipse(3.5 - 1.6 * open, 2.5, 1.6 * open + 0.4, 2, 0, 0, Math.PI * 2);
  g.ellipse(3.5 + 1.6 * open, 2.5, 1.6 * open + 0.4, 2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a2420';
  g.fillRect(3, 1, 1, 4);
}

function iconBadge(g: CanvasRenderingContext2D): void {
  g.fillStyle = 'rgba(20,16,12,0.55)';
  g.beginPath();
  g.arc(7, 7, 6.8, 0, Math.PI * 2);
  g.fill();
}

function drawFoodIcon(g: CanvasRenderingContext2D): void {
  iconBadge(g);
  g.fillStyle = '#d63a2a';
  for (const [x, y] of [[5, 8], [9, 8], [7, 5]] as const) {
    g.beginPath();
    g.arc(x, y, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(4, 7, 1, 1);
  g.fillRect(8, 7, 1, 1);
  g.fillRect(6, 4, 1, 1);
}

function drawWoodIcon(g: CanvasRenderingContext2D): void {
  iconBadge(g);
  g.fillStyle = '#8a5a2b';
  g.fillRect(3, 6, 8, 4);
  g.fillStyle = '#c99a5b';
  g.beginPath();
  g.ellipse(11, 8, 1.6, 2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6b4220';
  g.fillRect(3, 6, 8, 1);
}

function drawNuggetIcon(g: CanvasRenderingContext2D, fill: string, edge: string): void {
  iconBadge(g);
  g.fillStyle = edge;
  g.beginPath();
  g.moveTo(3, 9);
  g.lineTo(5, 4);
  g.lineTo(10, 4);
  g.lineTo(12, 9);
  g.lineTo(9, 11);
  g.lineTo(5, 11);
  g.closePath();
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(4, 9);
  g.lineTo(5.5, 5);
  g.lineTo(9.5, 5);
  g.lineTo(11, 8.5);
  g.lineTo(8.5, 10);
  g.lineTo(5.5, 10);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(6, 6, 2, 1);
}
