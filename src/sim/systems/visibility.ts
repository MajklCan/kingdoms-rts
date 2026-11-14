/**
 * Fog of war: per-player visible/explored tiles and last-seen enemy buildings.
 */

import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  Building,
  ConstructionSite,
  Health,
  MachineGunTag,
  MortarTag,
  Owner,
  Position,
  ScoutCavalryTag,
  UnitKind,
} from '../components';
import { AgeId, BUILDING_TABLE, BuildingDefId } from '../defs';
import { LOCAL_PLAYER_ID, MAX_PLAYERS } from '../core/constants';
import { findBuildingAt } from '../core/lookup';
import { buildingQuery, positionQuery } from '../core/queries';
import type { LastSeenBuilding, PlayerVisibility, SimWorld } from '../core/types';

const DEFAULT_UNIT_LINE_OF_SIGHT = 6;
const SCOUT_LINE_OF_SIGHT = 10;
const BUILDING_LINE_OF_SIGHT = 7;
const TOWN_CENTER_LINE_OF_SIGHT = 10;
const TOWER_LINE_OF_SIGHT = 12;
const VISION_TILE_FOOTPRINT_RADIUS = 0.5;
const VISION_EDGE_SOFTENING_TILES = 1;
const MAP_W = MAP.WIDTH;
const MAP_H = MAP.HEIGHT;

export function createVisibilityState(): PlayerVisibility {
  const size = MAP.WIDTH * MAP.HEIGHT;
  return {
    explored: new Uint8Array(size),
    visible: new Uint8Array(size),
    lastSeenBuildings: new Map(),
  };
}

export function createVisibilityStates(): PlayerVisibility[] {
  return Array.from({ length: MAX_PLAYERS }, () => createVisibilityState());
}

export function tileVisibilityIndex(x: number, y: number): number {
  return y * MAP.WIDTH + x;
}

export function getPlayerVisibility(
  world: SimWorld,
  playerId: number
): PlayerVisibility | null {
  return world.visibility[playerId] ?? null;
}

export function isTileVisibleTo(
  world: SimWorld,
  playerId: number,
  x: number,
  y: number
): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!isTileInMap(tx, ty)) return false;
  return (world.visibility[playerId]?.visible[tileVisibilityIndex(tx, ty)] ?? 0) === 1;
}

export function isTileExploredBy(
  world: SimWorld,
  playerId: number,
  x: number,
  y: number
): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!isTileInMap(tx, ty)) return false;
  return (world.visibility[playerId]?.explored[tileVisibilityIndex(tx, ty)] ?? 0) === 1;
}

export function isEntityVisibleTo(
  world: SimWorld,
  playerId: number,
  eid: number
): boolean {
  if (!hasComponent(world.ecs, Position, eid)) return false;
  if (hasComponent(world.ecs, Owner, eid) && Owner.player[eid] === playerId) return true;
  if (hasComponent(world.ecs, Building, eid)) {
    return isBuildingVisibleTo(world, playerId, eid);
  }
  return isTileVisibleTo(world, playerId, Position.x[eid], Position.y[eid]);
}

export function isBuildingVisibleTo(
  world: SimWorld,
  playerId: number,
  eid: number
): boolean {
  if (!hasComponent(world.ecs, Building, eid)) {
    return isTileVisibleTo(world, playerId, Position.x[eid], Position.y[eid]);
  }
  return isBuildingFootprintVisibleTo(
    world,
    playerId,
    Building.defId[eid],
    Position.x[eid],
    Position.y[eid]
  );
}

export function isBuildingFootprintVisibleTo(
  world: SimWorld,
  playerId: number,
  defId: number,
  x: number,
  y: number
): boolean {
  let visible = false;
  forEachBuildingFootprintTile(defId, x, y, (tx, ty) => {
    if (isTileVisibleTo(world, playerId, tx, ty)) visible = true;
  });
  return visible;
}

export function updatePlayerVisibility(
  world: SimWorld,
  playerId = LOCAL_PLAYER_ID
): void {
  const vis = world.visibility[playerId];
  if (!vis) return;
  if (world.revealedMapPlayers[playerId]) {
    vis.visible.fill(1);
    vis.explored.fill(1);
    updateLastSeenBuildings(world, playerId, vis);
    return;
  }
  vis.visible.fill(0);

  for (const eid of positionQuery(world.ecs)) {
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] !== playerId) continue;
    if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
    if (!hasComponent(world.ecs, UnitKind, eid) && !hasComponent(world.ecs, Building, eid)) {
      continue;
    }
    revealCircle(vis, Position.x[eid], Position.y[eid], lineOfSightRadius(world, eid));
  }

  smoothVisibilityFrontier(vis);
  updateLastSeenBuildings(world, playerId, vis);
}

export function revealMapForPlayer(world: SimWorld, playerId = LOCAL_PLAYER_ID): void {
  if (!world.visibility[playerId]) return;
  world.revealedMapPlayers[playerId] = true;
  updatePlayerVisibility(world, playerId);
}

export function visibilitySystem(world: SimWorld): void {
  // Compute fog for every human player so each client can render its own
  // perspective. In single-player this is just LOCAL_PLAYER_ID.
  for (const playerId of world.humanPlayers) {
    updatePlayerVisibility(world, playerId);
  }
}

export function isTileInMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP.WIDTH && y < MAP.HEIGHT;
}

function revealCircle(
  vis: PlayerVisibility,
  x: number,
  y: number,
  radius: number
): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const effectiveRadius = radius + VISION_EDGE_SOFTENING_TILES;
  const r = Math.ceil(effectiveRadius + VISION_TILE_FOOTPRINT_RADIUS);
  const r2 = effectiveRadius * effectiveRadius;
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(MAP_W - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(MAP_H - 1, cy + r);
  const { visible, explored } = vis;
  for (let ty = y0; ty <= y1; ty++) {
    // Reveal if the vision circle touches the tile footprint, not only when
    // it reaches the tile centre. This removes one-tile notches around the
    // visible frontier without turning vision into a square.
    const dy = Math.max(0, Math.abs(ty - y) - VISION_TILE_FOOTPRINT_RADIUS);
    const dy2 = dy * dy;
    if (dy2 > r2) continue;
    const row = ty * MAP_W;
    for (let tx = x0; tx <= x1; tx++) {
      const dx = Math.max(0, Math.abs(tx - x) - VISION_TILE_FOOTPRINT_RADIUS);
      if (dx * dx + dy2 > r2) continue;
      visible[row + tx] = 1;
      explored[row + tx] = 1;
    }
  }
}

let frontierScratch = new Uint8Array(0);

/** Fill fog notches: a hidden tile with 5+ visible neighbours, or 3+ visible
 *  cardinal neighbours, becomes visible (judged on the pre-pass state). */
function smoothVisibilityFrontier(vis: PlayerVisibility): void {
  const { visible, explored } = vis;
  if (frontierScratch.length !== visible.length) frontierScratch = new Uint8Array(visible.length);
  const before = frontierScratch;
  before.set(visible);
  for (let y = 0; y < MAP_H; y++) {
    const row = y * MAP_W;
    const hasUp = y > 0;
    const hasDown = y < MAP_H - 1;
    for (let x = 0; x < MAP_W; x++) {
      const idx = row + x;
      if (before[idx] === 1) continue;
      const hasLeft = x > 0;
      const hasRight = x < MAP_W - 1;
      const cardinals =
        (hasLeft ? before[idx - 1] : 0) +
        (hasRight ? before[idx + 1] : 0) +
        (hasUp ? before[idx - MAP_W] : 0) +
        (hasDown ? before[idx + MAP_W] : 0);
      // Without a visible cardinal neighbour at most 4 diagonals can be.
      if (cardinals === 0) continue;
      if (cardinals < 3) {
        const diagonals =
          (hasUp && hasLeft ? before[idx - MAP_W - 1] : 0) +
          (hasUp && hasRight ? before[idx - MAP_W + 1] : 0) +
          (hasDown && hasLeft ? before[idx + MAP_W - 1] : 0) +
          (hasDown && hasRight ? before[idx + MAP_W + 1] : 0);
        if (cardinals + diagonals < 5) continue;
      }
      visible[idx] = 1;
      explored[idx] = 1;
    }
  }
}

function lineOfSightRadius(world: SimWorld, eid: number): number {
  if (hasComponent(world.ecs, Building, eid)) {
    const defId = Building.defId[eid];
    if (defId === BuildingDefId.TOWN_CENTER) return TOWN_CENTER_LINE_OF_SIGHT;
    if (defId === BuildingDefId.DEFENSIVE_TOWER) return TOWER_LINE_OF_SIGHT;
    return BUILDING_LINE_OF_SIGHT;
  }
  if (hasComponent(world.ecs, ScoutCavalryTag, eid)) return SCOUT_LINE_OF_SIGHT;
  if (hasComponent(world.ecs, MachineGunTag, eid)) return 8;
  // Indirect fire is useless without spotting - match LOS to the 10-tile range.
  if (hasComponent(world.ecs, MortarTag, eid)) return 10;
  return DEFAULT_UNIT_LINE_OF_SIGHT;
}

function updateLastSeenBuildings(
  world: SimWorld,
  playerId: number,
  vis: PlayerVisibility
): void {
  for (const eid of buildingQuery(world.ecs)) {
    if (!isVisibleEnemyBuilding(world, playerId, eid)) continue;
    vis.lastSeenBuildings.set(eid, snapshotBuilding(world, eid));
  }

  for (const [key, snap] of vis.lastSeenBuildings) {
    if (!isBuildingFootprintVisibleTo(world, playerId, snap.defId, snap.x, snap.y)) {
      continue;
    }
    const live = findBuildingAt(world, snap.x, snap.y, 0.01);
    if (
      live === null ||
      !hasComponent(world.ecs, Owner, live) ||
      Owner.player[live] !== snap.owner
    ) {
      vis.lastSeenBuildings.delete(key);
    }
  }
}

function isVisibleEnemyBuilding(world: SimWorld, playerId: number, eid: number): boolean {
  if (!hasComponent(world.ecs, Owner, eid)) return false;
  const owner = Owner.player[eid];
  if (owner === 0 || owner === playerId) return false;
  if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) return false;
  return isBuildingVisibleTo(world, playerId, eid);
}

function snapshotBuilding(world: SimWorld, eid: number): LastSeenBuilding {
  return {
    eid,
    owner: Owner.player[eid],
    defId: Building.defId[eid],
    age: world.ages[Owner.player[eid]]?.current ?? AgeId.DARK,
    x: Position.x[eid],
    y: Position.y[eid],
    hp: hasComponent(world.ecs, Health, eid) ? Health.hp[eid] : 0,
    hpMax: hasComponent(world.ecs, Health, eid) ? Health.hpMax[eid] : 0,
    isFoundation: hasComponent(world.ecs, ConstructionSite, eid),
  };
}

function forEachBuildingFootprintTile(
  defId: number,
  x: number,
  y: number,
  visit: (tx: number, ty: number) => void
): void {
  const def = BUILDING_TABLE[defId];
  if (!def) {
    visit(Math.round(x), Math.round(y));
    return;
  }
  const x0 = Math.round(x) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(y) - Math.floor(def.footprint.h / 2);
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (isTileInMap(tx, ty)) visit(tx, ty);
    }
  }
}
