/**
 * Update the DOM overlays (resource bar + debug panel). The agent / human can read
 * this as text via accessibility tree without needing pixel-perfect screenshots.
 */

export interface DebugOverlayData {
  fps: number;
  tick: number;
  entities: number;
  selected: string;
  gather: string;
  build: string;
  zoom?: number;
  speed?: number;
}

export interface ResourceBarData {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  popCurrent: number;
  popCap: number;
  age?: string;
  speed?: number;
}

const debugIds = {
  fps: 'dbg-fps',
  tick: 'dbg-tick',
  entities: 'dbg-entities',
  selected: 'dbg-selected',
  gather: 'dbg-gather',
  build: 'dbg-build',
  event: 'dbg-event',
  speed: 'dbg-speed',
};

const resIds = {
  food: 'res-food',
  wood: 'res-wood',
  gold: 'res-gold',
  stone: 'res-stone',
  pop: 'res-pop',
  age: 'res-age',
  speed: 'speed-toggle',
};

let lastEvent = '-';

export function setLastEvent(msg: string): void {
  lastEvent = msg;
}

export function updateDebugOverlay(data: DebugOverlayData): void {
  const fps = document.getElementById(debugIds.fps);
  const tick = document.getElementById(debugIds.tick);
  const ents = document.getElementById(debugIds.entities);
  const sel = document.getElementById(debugIds.selected);
  const gather = document.getElementById(debugIds.gather);
  const evt = document.getElementById(debugIds.event);
  if (fps) fps.textContent = data.fps.toFixed(0);
  if (tick) tick.textContent = data.tick.toString();
  if (ents) ents.textContent = data.entities.toString();
  if (sel) sel.textContent = data.selected;
  if (gather) gather.textContent = data.gather || '-';
  const build = document.getElementById(debugIds.build);
  if (build) build.textContent = data.build || '-';
  const zoom = document.getElementById('dbg-zoom');
  if (zoom) zoom.textContent = (data.zoom ?? 1).toFixed(2) + 'x';
  const speed = document.getElementById(debugIds.speed);
  if (speed) speed.textContent = (data.speed ?? 1).toFixed(0) + 'x';
  if (evt) evt.textContent = lastEvent;
}

export function updateResourceBar(data: ResourceBarData): void {
  const f = document.getElementById(resIds.food);
  const w = document.getElementById(resIds.wood);
  const g = document.getElementById(resIds.gold);
  const s = document.getElementById(resIds.stone);
  const p = document.getElementById(resIds.pop);
  const a = document.getElementById(resIds.age);
  const speed = document.getElementById(resIds.speed);
  if (f) f.textContent = data.food.toString();
  if (w) w.textContent = data.wood.toString();
  if (g) g.textContent = data.gold.toString();
  if (s) s.textContent = data.stone.toString();
  if (p) p.textContent = `${data.popCurrent}/${data.popCap}`;
  if (a && data.age) a.textContent = data.age;
  if (speed) {
    const value = data.speed ?? 1;
    speed.textContent = `${value.toFixed(0)}x`;
    speed.classList.toggle('active', value > 1);
    speed.setAttribute('aria-pressed', value > 1 ? 'true' : 'false');
  }
}
