/**
 * Minimap feed for the DOM HUD: explored tiles, visible entity dots,
 * remembered buildings and recent combat pings involving the perspective player.
 */

import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../../config';
import { Owner, Position, Resource, UnitKind, VillagerTag } from '@sim/components';
import {
  buildingQuery,
  getPlayerVisibility,
  isBuildingFootprintVisibleTo,
  resourceQuery,
  unitQuery,
  type CombatEvent,
} from '@sim/world';
import type { SceneContext } from '../scene-context';

/** How long a combat ping stays on the minimap. */
const ALERT_TICKS = SIM.TICK_HZ * 5;

export interface MinimapData {
  mapW: number;
  mapH: number;
  tiles: Uint8Array;
  entities: Array<{ x: number; y: number; player: number; kind: number }>;
  combatAlerts: Array<{ x: number; y: number; age: number }>;
}

interface Alert {
  x: number;
  y: number;
  tick: number;
}

export class MinimapAlerts {
  private alerts: Alert[] = [];

  constructor(private readonly ctx: SceneContext) {}

  /** Ping where the perspective player is hit (or is hitting). Windups skip. */
  record(event: CombatEvent): void {
    if (event.phase === 'windup') return;
    const me = this.ctx.perspectivePlayerId;
    const attackerPlayer = this.ctx.ownerOf(event.attackerEid);
    const targetPlayer = this.ctx.ownerOf(event.targetEid);
    if (attackerPlayer !== me && targetPlayer !== me) return;
    const x = targetPlayer === me ? event.toX : event.fromX;
    const y = targetPlayer === me ? event.toY : event.fromY;
    this.alerts.push({ x, y, tick: this.ctx.world.tick });
    this.prune();
  }

  /** Live pings with age 0 (fresh) .. 1 (about to expire). */
  snapshot(): MinimapData['combatAlerts'] {
    this.prune();
    const tick = this.ctx.world.tick;
    return this.alerts.map((alert) => ({
      x: alert.x,
      y: alert.y,
      age: Math.min(1, (tick - alert.tick) / ALERT_TICKS),
    }));
  }

  clear(): void {
    this.alerts = [];
  }

  private prune(): void {
    const cutoff = this.ctx.world.tick - ALERT_TICKS;
    this.alerts = this.alerts.filter((alert) => alert.tick >= cutoff);
  }
}

export function buildMinimapData(ctx: SceneContext, alerts: MinimapAlerts): MinimapData {
  const world = ctx.world;
  const playerId = ctx.perspectivePlayerId;
  const entities: MinimapData['entities'] = [];
  const combatAlerts = alerts.snapshot();

  const vis = getPlayerVisibility(world, playerId);
  const tiles = new Uint8Array(world.map.tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    tiles[i] = vis?.explored[i] === 1 ? world.map.tiles[i] : 255;
  }

  for (const eid of unitQuery(world.ecs)) {
    if (!ctx.isEntityVisible(eid)) continue;
    entities.push({
      x: Position.x[eid],
      y: Position.y[eid],
      player: Owner.player[eid],
      kind: hasComponent(world.ecs, VillagerTag, eid) ? 1 : 2 + UnitKind.kind[eid],
    });
  }
  for (const eid of buildingQuery(world.ecs)) {
    if (!ctx.isEntityVisible(eid)) continue;
    entities.push({ x: Position.x[eid], y: Position.y[eid], player: Owner.player[eid], kind: 3 });
  }
  for (const snap of vis?.lastSeenBuildings.values() ?? []) {
    if (!ctx.isTileExplored(snap.x, snap.y)) continue;
    if (isBuildingFootprintVisibleTo(world, playerId, snap.defId, snap.x, snap.y)) continue;
    entities.push({ x: snap.x, y: snap.y, player: snap.owner, kind: 3 });
  }
  for (const eid of resourceQuery(world.ecs)) {
    if (!ctx.isResourceExplored(eid)) continue;
    // Resources are kind >= 10.
    entities.push({ x: Position.x[eid], y: Position.y[eid], player: 0, kind: 10 + Resource.kind[eid] });
  }

  return { mapW: MAP.WIDTH, mapH: MAP.HEIGHT, tiles, entities, combatAlerts };
}
