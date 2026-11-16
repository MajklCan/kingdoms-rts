/**
 * Queued-waypoint display: while units with Shift-queued orders are
 * selected, a thin line runs from each unit through where it is headed now
 * and on through every queued order, with a small numbered ground marker at
 * each queued stop (colours as the click marker: green move, orange
 * attack-move, red attack, gold gather). The markers go as the orders are
 * carried out, because everything is read from the sim's queues each frame.
 *
 * Only the perspective player's own units are shown. Pure presentation.
 */

import { Owner, Position } from '@sim/components';
import { selectedQuery } from '@sim/world';
import type { UnitRenderer } from '../entities/unit-renderer';
import type { ScreenPos } from '../iso';
import { addLayerGraphics } from '../world-layers';
import type { FxHost } from './fx-host';
import { ORDER_MARKER_COLORS } from './order-marker';
import { planRoutes, unitRoute, type RoutePlan, type RouteStopKind, type UnitRoute } from './order-queue-route';

const COLORS: Record<RouteStopKind, number> = {
  move: ORDER_MARKER_COLORS.move,
  attackMove: ORDER_MARKER_COLORS['attack-move'],
  attack: ORDER_MARKER_COLORS.attack,
  gather: 0xfeca57,
};

/** Half extents of a waypoint diamond (iso 2:1), half the click marker's. */
const HALF_W = 9;
const HALF_H = 4.5;
const LINE_ALPHA = 0.85;
/** The leg the unit is walking now reads fainter than the queued ones. */
const HEADING_ALPHA = 0.5;
const HEADING_COLOR = 0xf3e9d2;
/** Dark line under the coloured one, so it reads on grass, sand and snow alike. */
const UNDERLAY = 0x1c130b;
const UNDERLAY_ALPHA = 0.4;
/** Beyond this many queued units the rest get markers but no line of their own. */
const MAX_LINED_UNITS = 40;

/** 3x5 pixel digits 1..8 (the queue holds at most 8 orders), one row per number. */
const DIGITS: Record<number, readonly string[]> = {
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '##.', '#.#', '.#.'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['.#.', '#.#', '.#.', '#.#', '.#.'],
};
const DIGIT_PX = 2;
const LABEL_BACK = 0x1c130b;

export class OrderQueueFx {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private drawn = false;

  constructor(
    private readonly host: FxHost,
    private readonly units: UnitRenderer
  ) {
    this.gfx = addLayerGraphics(host.ctx.scene, host.ctx.layers.overlay);
  }

  update(): void {
    const ctx = this.host.ctx;
    const world = ctx.world;
    if (world.orderQueues.size === 0) {
      this.clear();
      return;
    }
    const routes: UnitRoute[] = [];
    for (const eid of selectedQuery(world.ecs)) {
      if (!world.orderQueues.has(eid) || Owner.player[eid] !== ctx.perspectivePlayerId) continue;
      const route = unitRoute(world, eid, (target) => ctx.isEntityVisible(target));
      if (route) routes.push(route);
    }
    if (routes.length === 0) {
      this.clear();
      return;
    }
    const g = this.gfx;
    g.clear();
    this.drawn = true;
    const plan = planRoutes(routes);
    this.drawLines(plan);
    for (const marker of plan.markers) this.drawMarker(ctx.tileToScreen(marker.x, marker.y), marker.kind);
    for (const label of plan.labels) {
      this.drawLabel(ctx.tileToScreen(label.x, label.y), label.number, label.kind);
    }
  }

  clear(): void {
    if (!this.drawn) return;
    this.gfx.clear();
    this.drawn = false;
  }

  private drawLines(plan: RoutePlan): void {
    const g = this.gfx;
    const ctx = this.host.ctx;
    // Units of a group share their legs between stops: draw each leg once.
    const seen = new Set<string>();
    const leg = (from: ScreenPos, to: ScreenPos, color: number, alpha: number): void => {
      const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
      if (seen.has(key)) return;
      seen.add(key);
      // Stop short of the marker so the line does not run through it.
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len < HALF_W * 1.5) return;
      const trim = HALF_W * 0.8 / len;
      const ex = to.x - dx * trim;
      const ey = to.y - dy * trim;
      g.lineStyle(3.5, UNDERLAY, UNDERLAY_ALPHA * alpha);
      g.lineBetween(from.x, from.y, ex, ey);
      g.lineStyle(1.5, color, alpha);
      g.lineBetween(from.x, from.y, ex, ey);
    };
    for (const line of plan.lines.slice(0, MAX_LINED_UNITS)) {
      let at = this.units.anchorOf(line.eid) ?? ctx.tileToScreen(Position.x[line.eid], Position.y[line.eid]);
      if (line.heading) {
        const next = ctx.tileToScreen(line.heading.x, line.heading.y);
        leg(at, next, HEADING_COLOR, HEADING_ALPHA);
        at = next;
      }
      for (const index of line.through) {
        const label = plan.labels[index];
        const next = ctx.tileToScreen(label.x, label.y);
        leg(at, next, COLORS[label.kind], LINE_ALPHA);
        at = next;
      }
    }
  }

  private drawMarker(at: ScreenPos, kind: RouteStopKind): void {
    const g = this.gfx;
    const color = COLORS[kind];
    g.fillStyle(UNDERLAY, 0.45);
    g.lineStyle(1.5, color, 0.95);
    g.beginPath();
    g.moveTo(at.x, at.y - HALF_H);
    g.lineTo(at.x + HALF_W, at.y);
    g.lineTo(at.x, at.y + HALF_H);
    g.lineTo(at.x - HALF_W, at.y);
    g.closePath();
    g.fillPath();
    g.strokePath();
    if (kind === 'attack' || kind === 'attackMove') {
      // Crossed blades, as on the click marker: "fight here".
      g.lineBetween(at.x - HALF_W * 0.4, at.y - HALF_H * 0.4, at.x + HALF_W * 0.4, at.y + HALF_H * 0.4);
      g.lineBetween(at.x + HALF_W * 0.4, at.y - HALF_H * 0.4, at.x - HALF_W * 0.4, at.y + HALF_H * 0.4);
    } else {
      g.fillStyle(color, 0.95);
      g.fillCircle(at.x, at.y, 1.5);
    }
  }

  /** The order's place in the queue, on a dark plate just above its marker. */
  private drawLabel(at: ScreenPos, number: number, kind: RouteStopKind): void {
    const rows = DIGITS[number];
    if (!rows) return;
    const g = this.gfx;
    const w = 3 * DIGIT_PX;
    const h = 5 * DIGIT_PX;
    const x0 = Math.round(at.x - w / 2);
    const y0 = Math.round(at.y - HALF_H - 6 - h);
    g.fillStyle(LABEL_BACK, 0.78);
    g.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
    g.fillStyle(COLORS[kind], 1);
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '#') g.fillRect(x0 + rx * DIGIT_PX, y0 + ry * DIGIT_PX, DIGIT_PX, DIGIT_PX);
      }
    });
  }
}

