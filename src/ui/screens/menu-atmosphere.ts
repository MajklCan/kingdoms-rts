/**
 * Title-screen atmosphere: drifting embers on a canvas and a candle-like
 * flicker on the hearth glow. Runs only while the menu is visible, pauses
 * when the tab is hidden and is skipped entirely under reduced motion.
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

let raf = 0;
let running = false;
let embers: Ember[] = [];
let lastT = 0;

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
  const target = Math.round((w * h) / 26000);
  while (embers.length < target) embers.push(spawn(w, h, embers.length < target / 2));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
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
    const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 4);
    g.addColorStop(0, `hsla(${e.hue}, 100%, 70%, ${alpha})`);
    g.addColorStop(1, `hsla(${e.hue}, 100%, 50%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 4, 0, Math.PI * 2);
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
  raf = requestAnimationFrame(frame);
}

export function stopAtmosphere(): void {
  running = false;
  cancelAnimationFrame(raf);
  embers = [];
  const canvas = byId<HTMLCanvasElement>('menu-dust');
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
