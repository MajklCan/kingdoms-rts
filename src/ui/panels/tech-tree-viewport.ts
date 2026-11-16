/**
 * Pan and zoom over the ring chart. Pure math, no DOM.
 *
 * The chart is drawn at its own comfortable size and the dialog shows a
 * window onto it. A view is the zoom and where the chart's top left corner
 * sits inside the window, in px. All sizes here are px: the chart's at zoom
 * 1, and the window's.
 */

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export interface Extent {
  boardW: number;
  boardH: number;
  viewW: number;
  viewH: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_ZOOM = 1.5;
/** Never zoom out further than this, even if the whole chart would still not fit. */
const FLOOR_ZOOM = 0.34;
/** Zoom the chart opens at: the first ring fills the window's height, within these bounds. */
const OPEN_ZOOM_MIN = 0.78;
const OPEN_ZOOM_MAX = 1;

/** The furthest zoom out: the whole chart in the window, but never smaller than the floor. */
export function minZoom(e: Extent): number {
  const whole = Math.min(e.viewW / e.boardW, e.viewH / e.boardH);
  return Math.min(1, Math.max(FLOOR_ZOOM, whole));
}

/** The zoom the chart opens at, given the height (px at zoom 1) the window should show at least. */
export function openZoom(e: Extent, showH: number): number {
  return Math.min(OPEN_ZOOM_MAX, Math.max(OPEN_ZOOM_MIN, e.viewH / showH));
}

function clampAxis(pos: number, board: number, view: number): number {
  // A chart smaller than the window is centred; a larger one may not show a gap at either side.
  if (board <= view) return (view - board) / 2;
  return Math.min(0, Math.max(view - board, pos));
}

export function clampView(v: View, e: Extent): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(e), v.zoom));
  return { zoom, x: clampAxis(v.x, e.boardW * zoom, e.viewW), y: clampAxis(v.y, e.boardH * zoom, e.viewH) };
}

/** Zoom by `factor`, keeping the chart point under the window point (px, py) where it is. */
export function zoomAt(v: View, e: Extent, factor: number, px: number, py: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(e), v.zoom * factor));
  const k = zoom / v.zoom;
  return clampView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, e);
}

export function panBy(v: View, e: Extent, dx: number, dy: number): View {
  return clampView({ zoom: v.zoom, x: v.x + dx, y: v.y + dy }, e);
}

/** The view with the chart point (bx, by) in the middle of the window. */
export function centreOn(e: Extent, zoom: number, bx: number, by: number): View {
  return clampView({ zoom, x: e.viewW / 2 - bx * zoom, y: e.viewH / 2 - by * zoom }, e);
}

/** The nearest view that shows the chart rectangle `box` with `pad` px of window around it. */
export function reveal(v: View, e: Extent, box: Rect, pad: number): View {
  const axis = (pos: number, start: number, size: number, view: number): number => {
    const lo = start * v.zoom + pos;
    const hi = (start + size) * v.zoom + pos;
    const room = Math.min(pad, Math.max(0, (view - size * v.zoom) / 2));
    if (lo < room) return pos + (room - lo);
    if (hi > view - room) return pos - (hi - (view - room));
    return pos;
  };
  return clampView({ zoom: v.zoom, x: axis(v.x, box.x, box.w, e.viewW), y: axis(v.y, box.y, box.h, e.viewH) }, e);
}
