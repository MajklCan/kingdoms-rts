/**
 * Path following, terrain speed, stuck detection and recovery.
 */

import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../../config';
import {
  BuildOrder,
  Gatherer,
  GathererStateId,
  PathTarget,
  Position,
  PrevPosition,
  ScoutCavalryTag,
  Speed,
  Velocity,
} from '../components';
import { TileType } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { compareGridPos, sortedEids } from '../core/entities';
import { canUnitOccupyMovementTarget, canUnitSqueezeAlongDiagonalPath } from '../core/grid';
import { workerContactCrowdPenalty } from '../core/navigation';
import { movableQuery } from '../core/queries';
import type { MovementStuckState, SimWorld } from '../core/types';
import { clearFormationSpeedCap } from '../input/unit-orders';
import { isEconomicWorker, unitSeparationSystem } from './separation';
import { isTileInMap } from './visibility';

const SUDOMER_MUD_INFANTRY_SPEED_MULTIPLIER = 0.62;
const SUDOMER_MUD_CAVALRY_SPEED_MULTIPLIER = 0.34;
const ZBOROV_WIRE_SPEED_MULTIPLIER = 0.4;
const PATH_WAYPOINT_TOLERANCE = 0.12;
const PATH_CONTACT_FINAL_TOLERANCE = 0.06;
const PATH_FINAL_TOLERANCE = 0.28;
const STUCK_PROGRESS_EPSILON = 0.025;
const STUCK_PROGRESS_TICKS = Math.round(SIM.TICK_HZ * 2.5);
const STUCK_RECOVERY_COOLDOWN_TICKS = Math.round(SIM.TICK_HZ * 3);
const STUCK_REPATH_RADIUS = 4;

/**
 * Move entities toward their current path waypoint at Speed.value tiles/sec.
 */
export function movementSystem(world: SimWorld): void {
  const dt = 1 / SIM.TICK_HZ;
  const ents = sortedEids(world, movableQuery(world.ecs));
  for (const eid of ents) {
    // Snapshot pre-step position so the render layer can interpolate.
    if (hasComponent(world.ecs, PrevPosition, eid)) {
      PrevPosition.x[eid] = Position.x[eid];
      PrevPosition.y[eid] = Position.y[eid];
    }
    const path = world.paths.get(eid);
    if (!path || path.length === 0) {
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      world.movementStuck.delete(eid);
      clearFormationSpeedCap(world, eid);
      continue;
    }
    const waypoint = path[0];
    const px = Position.x[eid];
    const py = Position.y[eid];
    const dx = waypoint.x - px;
    const dy = waypoint.y - py;
    const dist = Math.hypot(dx, dy);
    const speedCap = world.formationSpeedCaps.get(eid);
    const baseSpeed = speedCap === undefined
      ? Speed.value[eid]
      : Math.min(Speed.value[eid], speedCap);
    const speed = baseSpeed * movementTerrainSpeedMultiplier(world, eid);
    const stepDist = speed * dt;
    const arrivalTolerance = pathArrivalTolerance(world, eid, path);

    if (dist <= stepDist || dist <= arrivalTolerance) {
      completeCurrentWaypoint(world, eid, path, waypoint, path.length > 1 || dist <= stepDist);
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      if (!tryMoveUnitStep(world, eid, nx, ny, stepDist, speed, waypoint)) {
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
      }
      updateMovementStuckState(world, eid, path);
    }
  }
  unitSeparationSystem(world);
}

function movementTerrainSpeedMultiplier(world: SimWorld, eid: number): number {
  const tx = Math.round(Position.x[eid]);
  const ty = Math.round(Position.y[eid]);
  if (!isTileInMap(tx, ty)) return 1;
  const tile = world.map.tiles[ty * MAP.WIDTH + tx];
  // Barbed wire bogs any unit to a crawl - the WW1 kill-zone in front of the
  // machine-gun nests.
  if (tile === TileType.BARBED_WIRE) return ZBOROV_WIRE_SPEED_MULTIPLIER;
  if (tile !== TileType.MUD) return 1;
  return hasComponent(world.ecs, ScoutCavalryTag, eid)
    ? SUDOMER_MUD_CAVALRY_SPEED_MULTIPLIER
    : SUDOMER_MUD_INFANTRY_SPEED_MULTIPLIER;
}

function pathArrivalTolerance(world: SimWorld, eid: number, path: GridPos[]): number {
  if (path.length > 1) return PATH_WAYPOINT_TOLERANCE;
  if (hasComponent(world.ecs, Gatherer, eid)) {
    const state = Gatherer.state[eid];
    if (
      state === GathererStateId.WALKING_TO ||
      state === GathererStateId.WALKING_TO_BUILD ||
      state === GathererStateId.RETURNING
    ) {
      return PATH_CONTACT_FINAL_TOLERANCE;
    }
  }
  if (hasComponent(world.ecs, BuildOrder, eid) && BuildOrder.targetEid[eid] >= 0) {
    return PATH_CONTACT_FINAL_TOLERANCE;
  }
  return PATH_FINAL_TOLERANCE;
}

function completeCurrentWaypoint(
  world: SimWorld,
  eid: number,
  path: GridPos[],
  waypoint: GridPos,
  snapToWaypoint: boolean
): void {
  if (snapToWaypoint && canUnitOccupyMovementTarget(world, eid, waypoint.x, waypoint.y)) {
    Position.x[eid] = waypoint.x;
    Position.y[eid] = waypoint.y;
  }
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  path.shift();
  if (path.length === 0) {
    world.paths.delete(eid);
    world.movementStuck.delete(eid);
    clearFormationSpeedCap(world, eid);
    return;
  }

  setPathHeadTarget(eid, path);
  updateMovementStuckState(world, eid, path);
}

function setPathHeadTarget(eid: number, path: GridPos[]): void {
  const head = path[0];
  if (!head) return;
  PathTarget.x[eid] = Math.round(head.x);
  PathTarget.y[eid] = Math.round(head.y);
}

function tryMoveUnitStep(
  world: SimWorld,
  eid: number,
  dirX: number,
  dirY: number,
  stepDist: number,
  speed: number,
  waypoint: GridPos
): boolean {
  const len = Math.hypot(dirX, dirY);
  if (len < 0.001 || stepDist <= 0) return false;
  const nx = dirX / len;
  const ny = dirY / len;
  const tx = Position.x[eid] + nx * stepDist;
  const ty = Position.y[eid] + ny * stepDist;
  if (
    !canUnitOccupyMovementTarget(world, eid, tx, ty) &&
    !canUnitSqueezeAlongDiagonalPath(world, tx, ty, nx, ny, waypoint)
  ) {
    return false;
  }
  Position.x[eid] = tx;
  Position.y[eid] = ty;
  Velocity.x[eid] = nx * speed;
  Velocity.y[eid] = ny * speed;
  return true;
}

function updateMovementStuckState(world: SimWorld, eid: number, path: GridPos[]): void {
  const waypoint = path[0];
  if (!waypoint) {
    world.movementStuck.delete(eid);
    return;
  }

  const dist = Math.hypot(Position.x[eid] - waypoint.x, Position.y[eid] - waypoint.y);
  let state = world.movementStuck.get(eid);
  const waypointChanged =
    !state ||
    Math.hypot(state.waypointX - waypoint.x, state.waypointY - waypoint.y) > 0.05;
  if (waypointChanged) {
    state = {
      lastDist: dist,
      waypointX: waypoint.x,
      waypointY: waypoint.y,
      noProgressTicks: 0,
      cooldownTicks: 0,
      attempts: 0,
    };
    world.movementStuck.set(eid, state);
    return;
  }
  if (!state) return;

  if (state.cooldownTicks > 0) state.cooldownTicks -= 1;
  if (dist < state.lastDist - STUCK_PROGRESS_EPSILON || dist <= 0.18) {
    state.noProgressTicks = 0;
    state.attempts = 0;
  } else {
    state.noProgressTicks += 1;
  }

  state.lastDist = dist;
  state.waypointX = waypoint.x;
  state.waypointY = waypoint.y;

  if (state.noProgressTicks < STUCK_PROGRESS_TICKS || state.cooldownTicks > 0) return;

  state.noProgressTicks = 0;
  state.cooldownTicks = STUCK_RECOVERY_COOLDOWN_TICKS;
  const recovered = recoverStuckMovement(world, eid, path, state);
  state.attempts += 1;
  if (!recovered) return;

  const nextWaypoint = world.paths.get(eid)?.[0];
  if (!nextWaypoint) {
    world.movementStuck.delete(eid);
    return;
  }
  state.lastDist = Math.hypot(Position.x[eid] - nextWaypoint.x, Position.y[eid] - nextWaypoint.y);
  state.waypointX = nextWaypoint.x;
  state.waypointY = nextWaypoint.y;
}

function recoverStuckMovement(
  world: SimWorld,
  eid: number,
  path: GridPos[],
  _state: MovementStuckState
): boolean {
  return repathAroundStuckDestination(world, eid, path);
}

function repathAroundStuckDestination(
  world: SimWorld,
  eid: number,
  path: GridPos[]
): boolean {
  const destination = path[path.length - 1];
  if (!destination) return false;

  const from = {
    x: Math.round(Position.x[eid]),
    y: Math.round(Position.y[eid]),
  };
  const destX = Math.round(destination.x);
  const destY = Math.round(destination.y);
  const candidates: Array<{ tile: GridPos; score: number }> = [];
  const seen = new Set<string>();

  for (let r = 0; r <= STUCK_REPATH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = destX + dx;
        const y = destY + dy;
        if (!isTileInMap(x, y) || world.map.walkability[y][x] !== 0) continue;
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          tile: { x, y },
          score:
            Math.hypot(Position.x[eid] - x, Position.y[eid] - y) +
            Math.hypot(destination.x - x, destination.y - y) * 0.5 +
            (isEconomicWorker(world, eid) ? workerContactCrowdPenalty(world, eid, x, y) : 0),
        });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || compareGridPos(a.tile, b.tile));

  for (const candidate of candidates) {
    const nextPath = world.pathfinder.findPath(from, candidate.tile);
    if (nextPath === null) continue;
    if (nextPath.length === 0) {
      if (
        Math.hypot(Position.x[eid] - destination.x, Position.y[eid] - destination.y) >
        pathArrivalTolerance(world, eid, path)
      ) {
        continue;
      }
      world.paths.delete(eid);
      world.movementStuck.delete(eid);
      return true;
    }
    if (!pathHasUsableFirstStep(world, eid, nextPath)) continue;
    world.paths.set(eid, nextPath);
    setPathHeadTarget(eid, nextPath);
    return true;
  }
  return false;
}

function pathHasUsableFirstStep(world: SimWorld, eid: number, path: GridPos[]): boolean {
  const first = path[0];
  if (!first) return true;
  const dx = first.x - Position.x[eid];
  const dy = first.y - Position.y[eid];
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return true;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const stepDist = Math.min(Speed.value[eid] / SIM.TICK_HZ, dist);
  const nextX = Position.x[eid] + dirX * stepDist;
  const nextY = Position.y[eid] + dirY * stepDist;
  return (
    canUnitOccupyMovementTarget(world, eid, nextX, nextY) ||
    canUnitSqueezeAlongDiagonalPath(world, nextX, nextY, dirX, dirY, first)
  );
}
