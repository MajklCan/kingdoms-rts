/**
 * Title-screen atmosphere: drifting embers and slow dust motes on a canvas,
 * a candle-like flicker on the hearth glow and a gentle parallax that leans
 * the painted map, the glow and the dust apart as the pointer moves. Runs
 * only while the menu is visible, pauses when the tab is hidden and is
 * skipped entirely under reduced motion.
 */

import { byId, prefersReducedMotion } from '../dom';

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  hue: number;
}

interface Mote {
  x: number;
  y: number;
  /** Depth 0.3 (far, slow, faint) .. 1 (near). */
  z: number;
  phase: number;
}

let raf = 0;
let running = false;
let embers: Ember[] = [];
let motes: Mote[] = [];
let lastT = 0;
/** Pointer offset from the centre, -1..1, and its eased follower. */
const aim = { x: 0, y: 0 };
const lean = { x: 0, y: 0 };

function spawn(w: number, h: number, initial: boolean): Ember {
  const max = 6 + Math.random() * 8;
  return {
    x: w * (0.15 + Math.random() * 0.7),
    y: initial ? Math.random() * h : h + 10,
    vx: (Math.random() - 0.5) * 12,
    vy: -(12 + Math.random() * 26),
    r: 0.6 + Math.random() * 1.6,
    life: initial ? Math.random() * max : 0,
    max,
    hue: 26 + Math.random() * 18,
  };
}

function spawnMote(w: number, h: number): Mote {
  return { x: Math.random() * w, y: Math.random() * h, z: 0.3 + Math.random() * 0.7, phase: Math.random() * Math.PI * 2 };
}

function onPointer(ev: PointerEvent): void {
  aim.x = Math.max(-1, Math.min(1, (ev.clientX / window.innerWidth) * 2 - 1));
  aim.y = Math.max(-1, Math.min(1, (ev.clientY / window.innerHeight) * 2 - 1));
}

function frame(t: number): void {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  if (document.hidden) {
    lastT = t;
    return;
  }
  const canvas = byId<HTMLCanvasElement>('menu-dust');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
  lastT = t;

  // Parallax: ease toward the pointer, then lean each layer by its depth.
  const ease = 1 - Math.pow(0.04, dt);
  lean.x += (aim.x - lean.x) * ease;
  lean.y += (aim.y - lean.y) * ease;
  const bg = byId('menu-bg');
  if (bg) bg.style.translate = `${(-lean.x * 0.9).toFixed(3)}% ${(-lean.y * 0.7).toFixed(3)}%`;
  const hall = byId('menu-glow-hall');
  if (hall) hall.style.translate = `${(lean.x * 0.8).toFixed(3)}rem ${(lean.y * 0.4).toFixed(3)}rem`;

  const target = Math.round((w * h) / 26000);
  while (embers.length < target) embers.push(spawn(w, h, embers.length < target / 2));
  const moteTarget = Math.round((w * h) / 14000);
  while (motes.length < moteTarget) motes.push(spawnMote(w, h));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Dust motes: pale specks hanging in the hall light, nearer ones larger,
  // brighter and further moved by the parallax.
  for (const m of motes) {
    m.x += (6 + 10 * m.z) * dt;
    m.y += Math.sin(t / 2400 + m.phase) * 4 * m.z * dt;
    if (m.x > w + 8) {
      m.x = -8;
      m.y = Math.random() * h;
    }
    const px = Math.round(m.x + lean.x * 18 * m.z);
    const py = Math.round(m.y + lean.y * 12 * m.z);
    const size = m.z > 0.75 ? 2 : 1;
    const alpha = (0.1 + 0.25 * m.z) * (0.6 + 0.4 * Math.sin(t / 900 + m.phase));
    ctx.fillStyle = `rgba(255, 232, 186, ${alpha.toFixed(3)})`;
    ctx.fillRect(px, py, size, size);
  }

  ctx.globalCompositeOperation = 'lighter';
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i]!;
    e.life += dt;
    e.x += (e.vx + Math.sin((t / 1000 + i) * 0.9) * 6) * dt;
    e.y += e.vy * dt;
    if (e.life > e.max || e.y < -10) {
      embers[i] = spawn(w, h, false);
      continue;
    }
    const k = e.life / e.max;
    const alpha = Math.sin(Math.PI * k) * 0.75;
    const ex = e.x + lean.x * 26;
    const ey = e.y + lean.y * 16;
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, e.r * 4);
    g.addColorStop(0, `hsla(${e.hue}, 100%, 70%, ${alpha})`);
    g.addColorStop(1, `hsla(${e.hue}, 100%, 50%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ex, ey, e.r * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const core = byId('menu-glow-core');
  if (core) {
    const flicker =
      0.82 + Math.sin(t / 310) * 0.06 + Math.sin(t / 97) * 0.04 + Math.sin(t / 1730) * 0.08;
    core.style.opacity = flicker.toFixed(3);
  }
}

export function startAtmosphere(): void {
  if (running || prefersReducedMotion()) return;
  running = true;
  lastT = 0;
  window.addEventListener('pointermove', onPointer, { passive: true });
  raf = requestAnimationFrame(frame);
}

export function stopAtmosphere(): void {
  running = false;
  cancelAnimationFrame(raf);
  window.removeEventListener('pointermove', onPointer);
  embers = [];
  motes = [];
  const canvas = byId<HTMLCanvasElement>('menu-dust');
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
