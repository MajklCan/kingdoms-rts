import { describe, expect, it } from 'vitest';
import { centreOn, clampView, MAX_ZOOM, minZoom, openZoom, panBy, reveal, zoomAt, type Extent } from './tech-tree-viewport';

const DESKTOP: Extent = { boardW: 1440, boardH: 1440, viewW: 1140, viewH: 500 };
const PHONE: Extent = { boardW: 1350, boardH: 1350, viewW: 720, viewH: 250 };

describe('chart viewport', () => {
  it('never zooms out below a readable size, nor in past the limit', () => {
    expect(minZoom(DESKTOP)).toBeCloseTo(500 / 1440, 5);
    expect(minZoom({ ...DESKTOP, viewW: 2000, viewH: 1200 })).toBeCloseTo(1200 / 1440, 5);
    expect(minZoom({ ...DESKTOP, viewW: 3000, viewH: 3000 })).toBe(1);
    expect(clampView({ zoom: 9, x: 0, y: 0 }, DESKTOP).zoom).toBe(MAX_ZOOM);
    expect(clampView({ zoom: 0.01, x: 0, y: 0 }, PHONE).zoom).toBeCloseTo(0.34, 5);
  });

  it('opens with the first ring in view on a desktop and at a touch-friendly size on a phone', () => {
    expect(openZoom(DESKTOP, 560)).toBeCloseTo(500 / 560, 5);
    expect(openZoom(PHONE, 560)).toBe(0.78);
    expect(openZoom({ ...DESKTOP, viewH: 900 }, 560)).toBe(1);
  });

  it('centres on a chart point and keeps the chart covering the window', () => {
    const v = centreOn(DESKTOP, 1, 720, 720);
    expect(v).toEqual({ zoom: 1, x: 1140 / 2 - 720, y: 250 - 720 });
    // A point near the corner cannot be centred: the chart stops at its edge.
    expect(centreOn(DESKTOP, 1, 10, 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(centreOn(DESKTOP, 1, 1430, 1430)).toEqual({ zoom: 1, x: 1140 - 1440, y: 500 - 1440 });
  });

  it('centres a chart that is smaller than the window', () => {
    const wide: Extent = { boardW: 1000, boardH: 1000, viewW: 2400, viewH: 1000 };
    expect(clampView({ zoom: 1, x: -300, y: -40 }, wide)).toEqual({ zoom: 1, x: 700, y: 0 });
  });

  it('pans within the chart', () => {
    const start = centreOn(DESKTOP, 1, 720, 720);
    expect(panBy(start, DESKTOP, -100, 50)).toEqual({ zoom: 1, x: start.x - 100, y: start.y + 50 });
    expect(panBy(start, DESKTOP, 5000, 5000)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('zooms about the pointer', () => {
    const start = centreOn(DESKTOP, 1, 720, 720);
    const px = 800;
    const py = 300;
    const under = { x: (px - start.x) / start.zoom, y: (py - start.y) / start.zoom };
    const v = zoomAt(start, DESKTOP, 1.25, px, py);
    expect(v.zoom).toBeCloseTo(1.25, 5);
    expect((px - v.x) / v.zoom).toBeCloseTo(under.x, 5);
    expect((py - v.y) / v.zoom).toBeCloseTo(under.y, 5);
    expect(zoomAt(start, DESKTOP, 100, px, py).zoom).toBe(MAX_ZOOM);
  });

  it('scrolls just far enough to show a seal that is out of view', () => {
    const start = centreOn(DESKTOP, 1, 720, 720);
    const inView = { x: 700, y: 700, w: 60, h: 60 };
    expect(reveal(start, DESKTOP, inView, 40)).toEqual(start);
    const below = { x: 700, y: 1100, w: 60, h: 60 };
    const v = reveal(start, DESKTOP, below, 40);
    expect(v.x).toBe(start.x);
    expect((below.y + below.h) * v.zoom + v.y).toBeCloseTo(DESKTOP.viewH - 40, 5);
    const left = { x: 20, y: 700, w: 60, h: 60 };
    expect(reveal(start, DESKTOP, left, 40).x).toBe(0);
  });
});
