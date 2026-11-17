import { describe, expect, it } from 'vitest';
import { Position } from '@sim/components';
import { createSimWorld, spawnSpearman, type SimWorld } from '@sim/world';
import { planRoutes, routeLabels, routeMarkers, unitRoute, type UnitRoute } from './order-queue-route';

function world(): SimWorld {
  return createSimWorld(7);
}

const seesAll = (): boolean => true;

describe('unitRoute', () => {
  it('is null for a unit with nothing queued', () => {
    const w = world();
    const unit = spawnSpearman(w, 10, 10, 1);
    expect(unitRoute(w, unit, seesAll)).toBeNull();
  });

  it('lists the queued stops in order, after where the unit is headed now', () => {
    const w = world();
    const unit = spawnSpearman(w, 10, 10, 1);
    const enemy = spawnSpearman(w, 20, 12, 2);
    w.paths.set(unit, [{ x: 11, y: 10 }, { x: 14, y: 10 }]);
    w.orderQueues.set(unit, [
      { kind: 'move', x: 14, y: 16, speedCap: 0 },
      { kind: 'attack', targetEid: enemy },
      { kind: 'attackMove', x: 24, y: 16, speedCap: 0 },
    ]);
    expect(unitRoute(w, unit, seesAll)).toEqual({
      eid: unit,
      heading: { x: 14, y: 10 },
      queued: 3,
      stops: [
        { kind: 'move', x: 14, y: 16, index: 1 },
        { kind: 'attack', x: Position.x[enemy], y: Position.y[enemy], index: 2 },
        { kind: 'attackMove', x: 24, y: 16, index: 3 },
      ],
    });
  });

  it('leaves out an attack on a target that is out of sight, keeping the numbers of the rest', () => {
    const w = world();
    const unit = spawnSpearman(w, 10, 10, 1);
    const enemy = spawnSpearman(w, 20, 12, 2);
    w.orderQueues.set(unit, [
      { kind: 'attack', targetEid: enemy },
      { kind: 'move', x: 14, y: 16, speedCap: 0 },
    ]);
    const route = unitRoute(w, unit, () => false);
    expect(route?.heading).toBeNull();
    expect(route?.queued).toBe(2);
    expect(route?.stops).toEqual([{ kind: 'move', x: 14, y: 16, index: 2 }]);
  });
});

describe('routeMarkers / routeLabels', () => {
  const route = (eid: number, stops: UnitRoute['stops'], queued = stops.length): UnitRoute =>
    ({ eid, heading: null, queued, stops });

  it('folds units sent to the same spots into one marker each, numbered along the route', () => {
    const markers = routeMarkers([
      route(1, [{ kind: 'move', x: 5, y: 5, index: 1 }, { kind: 'move', x: 9, y: 5, index: 2 }]),
      route(2, [{ kind: 'move', x: 5, y: 5, index: 1 }, { kind: 'move', x: 9, y: 5, index: 2 }]),
    ]);
    expect(markers).toEqual([
      { kind: 'move', x: 5, y: 5, number: 1, units: 2 },
      { kind: 'move', x: 9, y: 5, number: 2, units: 2 },
    ]);
    expect(routeLabels(markers)).toEqual([
      { number: 1, kind: 'move', x: 5, y: 5 },
      { number: 2, kind: 'move', x: 9, y: 5 },
    ]);
  });

  it('a unit that is one order ahead of its group still shows the group numbers', () => {
    // Unit 3 has already started the first stop; its own queue is one shorter.
    const markers = routeMarkers([
      route(1, [
        { kind: 'move', x: 5, y: 5, index: 1 },
        { kind: 'move', x: 9, y: 5, index: 2 },
        { kind: 'move', x: 9, y: 9, index: 3 },
      ]),
      route(3, [{ kind: 'move', x: 9, y: 5, index: 1 }, { kind: 'move', x: 9, y: 9, index: 2 }]),
    ]);
    expect(markers).toEqual([
      { kind: 'move', x: 5, y: 5, number: 1, units: 1 },
      { kind: 'move', x: 9, y: 5, number: 2, units: 2 },
      { kind: 'move', x: 9, y: 9, number: 3, units: 2 },
    ]);
  });

  it('gives a formation one number at the middle of its slots, and a separate route its own numbers', () => {
    const markers = routeMarkers([
      route(1, [{ kind: 'move', x: 10, y: 10, index: 1 }, { kind: 'move', x: 20, y: 10, index: 2 }]),
      route(2, [{ kind: 'move', x: 11, y: 10, index: 1 }, { kind: 'move', x: 21, y: 10, index: 2 }]),
      route(3, [{ kind: 'move', x: 12, y: 10, index: 1 }, { kind: 'move', x: 22, y: 10, index: 2 }]),
      // Another unit's single order, across the map: numbered on its own, from 1.
      route(4, [{ kind: 'move', x: 40, y: 30, index: 1 }]),
    ]);
    expect(markers).toHaveLength(7);
    expect(routeLabels(markers)).toEqual([
      { number: 1, kind: 'move', x: 11, y: 10 },
      { number: 2, kind: 'move', x: 21, y: 10 },
      { number: 1, kind: 'move', x: 40, y: 30 },
    ]);
  });

  it('plans one line through the middle of a formation instead of one per slot', () => {
    const plan = planRoutes([
      route(1, [{ kind: 'move', x: 10, y: 10, index: 1 }, { kind: 'attackMove', x: 20, y: 10, index: 2 }]),
      route(2, [{ kind: 'move', x: 12, y: 10, index: 1 }, { kind: 'attackMove', x: 22, y: 10, index: 2 }]),
    ]);
    expect(plan.markers).toHaveLength(4);
    expect(plan.labels).toEqual([
      { number: 1, kind: 'move', x: 11, y: 10 },
      { number: 2, kind: 'attackMove', x: 21, y: 10 },
    ]);
    // Both units' lines run through the same two points.
    expect(plan.lines).toEqual([
      { eid: 1, heading: null, through: [0, 1] },
      { eid: 2, heading: null, through: [0, 1] },
    ]);
  });

  it('numbers by the place in the queue even when a hidden target left a gap', () => {
    // Order 1 (an attack on something out of sight) is not shown; the move is still number 2.
    const markers = routeMarkers([route(1, [{ kind: 'move', x: 14, y: 16, index: 2 }], 2)]);
    expect(markers).toEqual([{ kind: 'move', x: 14, y: 16, number: 2, units: 1 }]);
  });

  it('keeps the same tile apart when it is a different order or a different place in the queue', () => {
    const markers = routeMarkers([
      route(1, [{ kind: 'move', x: 5, y: 5, index: 1 }, { kind: 'attackMove', x: 5, y: 5, index: 2 }]),
    ]);
    expect(markers).toHaveLength(2);
    expect(routeLabels(markers)).toHaveLength(2);
  });
});
