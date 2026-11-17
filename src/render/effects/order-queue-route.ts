/**
 * What the queued-waypoint display draws, worked out from the sim without
 * any Phaser: each selected unit's route (where it is headed now, then every
 * Shift-queued order) and, for a whole selection, the markers and number
 * labels with duplicates folded together.
 *
 * Read-only: nothing here writes to the sim.
 */

import { hasComponent } from 'bitecs';
import { Position } from '@sim/components';
import type { QueuedOrder, SimWorld } from '@sim/world';

export type RouteStopKind = QueuedOrder['kind'];

export interface RouteStop {
  kind: RouteStopKind;
  /** Tile coordinates. */
  x: number;
  y: number;
  /** 1-based place in the unit's queue. */
  index: number;
}

export interface UnitRoute {
  eid: number;
  /** Where the order in progress ends (the end of the unit's path), if it is walking. */
  heading: { x: number; y: number } | null;
  /** Orders in the unit's queue (stops may be fewer: hidden targets are left out). */
  queued: number;
  stops: RouteStop[];
}

export interface RouteMarker {
  kind: RouteStopKind;
  x: number;
  y: number;
  /**
   * The number shown: the stop's place on the group's route, 1 = next. Units
   * of a group get through their queues at different speeds, so a unit that
   * is one order ahead still shows the group's numbers, not its own.
   */
  number: number;
  /** Units of the selection sharing this marker. */
  units: number;
}

export interface RouteLabel {
  number: number;
  kind: RouteStopKind;
  /** Tile coordinates of the group of markers the number stands for. */
  x: number;
  y: number;
}

/** What to draw for a selection: markers, numbers, and each unit's line. */
export interface RoutePlan {
  markers: RouteMarker[];
  labels: RouteLabel[];
  /**
   * Per unit, the points its line runs through after the unit itself: where
   * it is headed now, then the middle of each queued stop's group (indices
   * into `labels`). A formation's slots are marked one by one, but its line
   * is drawn once, through the middle, not once per unit.
   */
  lines: Array<{ eid: number; heading: { x: number; y: number } | null; through: number[] }>;
}

/** Stops of one queued order further apart than this (tiles) belong to different groups. */
const LABEL_GROUP_RADIUS = 5;

/**
 * The route of one unit, or null when it has nothing queued. A queued attack
 * on something `isVisible` says is out of sight is left out (and the line
 * skips it), so the display never gives away where a hidden enemy is.
 */
export function unitRoute(
  world: SimWorld,
  eid: number,
  isVisible: (targetEid: number) => boolean
): UnitRoute | null {
  const queue = world.orderQueues.get(eid);
  if (!queue || queue.length === 0) return null;
  const stops: RouteStop[] = [];
  queue.forEach((order, i) => {
    if (!('targetEid' in order)) {
      stops.push({ kind: order.kind, x: order.x, y: order.y, index: i + 1 });
      return;
    }
    const target = order.targetEid;
    if (!hasComponent(world.ecs, Position, target)) return;
    if (order.kind === 'attack' && !isVisible(target)) return;
    stops.push({ kind: order.kind, x: Position.x[target], y: Position.y[target], index: i + 1 });
  });
  const path = world.paths.get(eid);
  const end = path?.[path.length - 1];
  return { eid, heading: end ? { x: end.x, y: end.y } : null, queued: queue.length, stops };
}

/**
 * The longest queue among the units travelling with each route. Units whose
 * last stops are the same order close together (one click for a group, or a
 * formation's slots) travel together; orders are queued for a group at once,
 * so its members' queues line up at the end even when some are further along.
 */
function groupQueueLengths(routes: readonly UnitRoute[]): number[] {
  const groups: Array<{ kind: RouteStopKind; x: number; y: number; longest: number; members: number[] }> = [];
  routes.forEach((route, i) => {
    const last = route.stops[route.stops.length - 1];
    if (!last) return;
    const group = groups.find((g) =>
      g.kind === last.kind && Math.hypot(g.x - last.x, g.y - last.y) <= LABEL_GROUP_RADIUS
    );
    if (group) {
      group.longest = Math.max(group.longest, route.queued);
      group.members.push(i);
    } else {
      groups.push({ kind: last.kind, x: last.x, y: last.y, longest: route.queued, members: [i] });
    }
  });
  const out = routes.map((route) => route.queued);
  for (const group of groups) {
    for (const i of group.members) out[i] = group.longest;
  }
  return out;
}

/** One marker per distinct stop (same order, same number, same tile). */
export function routeMarkers(routes: readonly UnitRoute[]): RouteMarker[] {
  const longest = groupQueueLengths(routes);
  const byKey = new Map<string, RouteMarker>();
  routes.forEach((route, i) => {
    for (const stop of route.stops) {
      const number = stopNumber(route, stop, longest[i]);
      const key = `${number}|${stop.kind}|${Math.round(stop.x * 4)}|${Math.round(stop.y * 4)}`;
      const marker = byKey.get(key);
      if (marker) marker.units++;
      else byKey.set(key, { kind: stop.kind, x: stop.x, y: stop.y, number, units: 1 });
    }
  });
  return [...byKey.values()];
}

/** Counted from the end of the queue, where a group's queues line up. */
function stopNumber(route: UnitRoute, stop: RouteStop, groupLongest: number): number {
  return groupLongest - (route.queued - stop.index);
}

/** Everything the display draws for the selected units' routes. */
export function planRoutes(routes: readonly UnitRoute[]): RoutePlan {
  const markers = routeMarkers(routes);
  const labels = routeLabels(markers);
  const longest = groupQueueLengths(routes);
  const lines = routes.map((route, i) => {
    const through: number[] = [];
    for (const stop of route.stops) {
      const number = stopNumber(route, stop, longest[i]);
      let best = -1;
      let bestDist = Infinity;
      labels.forEach((label, at) => {
        if (label.number !== number || label.kind !== stop.kind) return;
        const dist = Math.hypot(label.x - stop.x, label.y - stop.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = at;
        }
      });
      if (best >= 0) through.push(best);
    }
    return { eid: route.eid, heading: route.heading, through };
  });
  return { markers, labels, lines };
}

/**
 * One number per queued order of a group: markers with the same number that
 * lie close together (a formation's slots) share a label at their centre
 * instead of each repeating it.
 */
export function routeLabels(markers: readonly RouteMarker[]): RouteLabel[] {
  const groups: Array<{ number: number; kind: RouteStopKind; sumX: number; sumY: number; n: number }> = [];
  for (const marker of markers) {
    const group = groups.find((g) =>
      g.number === marker.number &&
      g.kind === marker.kind &&
      Math.hypot(g.sumX / g.n - marker.x, g.sumY / g.n - marker.y) <= LABEL_GROUP_RADIUS
    );
    if (group) {
      group.sumX += marker.x;
      group.sumY += marker.y;
      group.n++;
    } else {
      groups.push({ number: marker.number, kind: marker.kind, sumX: marker.x, sumY: marker.y, n: 1 });
    }
  }
  return groups.map((g) => ({ number: g.number, kind: g.kind, x: g.sumX / g.n, y: g.sumY / g.n }));
}
