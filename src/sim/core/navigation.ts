/**
 * Path planning toward tiles, resource nodes and building contact points.
 */

import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  Building,
  Gatherer,
  GathererStateId,
  Health,
  Owner,
  PathTarget,
  Position,
  VillagerTag,
} from '../components';
import { BUILDING_TABLE, BuildingDefId } from '../defs';
import type { GridPos } from '../pathfinding';
import { deterministicPairAngle } from '../systems/separation';
import { isTileInMap } from '../systems/visibility';
import { RESOURCE_GATHER_DISTANCE } from './constants';
import { clamp, compareGridPos, sortedEids } from './entities';
import { buildingFootprintRect } from './grid';
import { findResourceAt } from './lookup';
import { unitQuery } from './queries';
import type { SimWorld } from './types';

const BUILDING_CONTACT_EDGE_GAP = 0.16;
const WORKER_RESOURCE_CONTACT_GAP = 0.52;
const WORKER_RESOURCE_CONTACT_SLOT_RADIUS = 0.46;
const WORKER_RESOURCE_CONTACT_SLOT_UNIT_PENALTY = 18;
const WORKER_RESOURCE_CONTACT_SLOT_PATH_PENALTY = 12;
const WORKER_CONTACT_CROWD_RADIUS = 0.72;
const WORKER_CONTACT_UNIT_PENALTY = 8;
const WORKER_CONTACT_PATH_PENALTY = 5;

/** Plan a path for `eid` to (tx, ty) and stash it in world.paths.
 *  Returns `true` if a non-trivial path was produced (caller can safely commit
 *  state transitions). Returns `false` if the destination is unreachable -
 *  caller should leave the unit's previous state alone. */
export function pathTo(world: SimWorld, eid: number, tx: number, ty: number): boolean {
  const from = {
    x: Math.round(Position.x[eid]),
    y: Math.round(Position.y[eid]),
  };
  const to = { x: Math.round(tx), y: Math.round(ty) };
  const path = world.pathfinder.findPath(from, to);
  if (path === null) return false;
  if (path.length === 0) {
    // Same tile - treat as success but no path needed.
    world.paths.delete(eid);
    return true;
  }
  world.paths.set(eid, path);
  PathTarget.x[eid] = path[0].x;
  PathTarget.y[eid] = path[0].y;
  return true;
}

/**
 * Path toward something to attack. A wall tile sits inside a line, so the
 * plain "first free tile around a blocked goal" can be on the far side of
 * the wall and unreachable; walls are approached through the free tile next
 * to them that is nearest the attacker instead.
 */
export function pathToAttackTarget(world: SimWorld, eid: number, target: number): boolean {
  if (hasComponent(world.ecs, Building, target) && Building.defId[target] === BuildingDefId.WALL) {
    return pathToBuildingContact(world, eid, target);
  }
  return pathTo(world, eid, Position.x[target], Position.y[target]);
}

export function pathToResourceContact(world: SimWorld, eid: number, target: number): boolean {
  const from = {
    x: Math.round(Position.x[eid]),
    y: Math.round(Position.y[eid]),
  };
  for (const candidate of resourceApproachCandidates(world, eid, target)) {
    const path = world.pathfinder.findPath(from, candidate.tile);
    if (path === null) continue;

    const nextPath: GridPos[] = [...path];
    const final = nextPath[nextPath.length - 1];
    if (
      Math.hypot(Position.x[eid] - Position.x[target], Position.y[eid] - Position.y[target]) >
        RESOURCE_GATHER_DISTANCE &&
      (!final || Math.hypot(final.x - candidate.point.x, final.y - candidate.point.y) > 0.01)
    ) {
      nextPath.push(candidate.point);
    }

    if (nextPath.length === 0) {
      world.paths.delete(eid);
      return true;
    }
    world.paths.set(eid, nextPath);
    PathTarget.x[eid] = Math.round(nextPath[0].x);
    PathTarget.y[eid] = Math.round(nextPath[0].y);
    return true;
  }
  return false;
}

function resourceApproachCandidates(
  world: SimWorld,
  eid: number,
  target: number
): Array<{ tile: GridPos; point: GridPos; score: number }> {
  const cx = Math.round(Position.x[target]);
  const cy = Math.round(Position.y[target]);
  const out: Array<{ tile: GridPos; point: GridPos; score: number }> = [];
  const seen = new Set<string>();
  const units = sortedEids(world, unitQuery(world.ecs));
  const crowd = workerContactCrowd(world, eid, units);
  const slotRivals = workerResourceContactSlotRivals(world, eid, target, units);

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (!isTileInMap(tx, ty)) continue;
      if (world.map.walkability[ty][tx] !== 0) continue;
      const key = `${tx},${ty}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let vx = tx - Position.x[target];
      let vy = ty - Position.y[target];
      let len = Math.hypot(vx, vy);
      if (len < 0.001) {
        const angle = deterministicPairAngle(world, eid, target);
        vx = Math.cos(angle);
        vy = Math.sin(angle);
        len = 1;
      }
      vx /= len;
      vy /= len;
      const point = {
        x: Position.x[target] + vx * WORKER_RESOURCE_CONTACT_GAP,
        y: Position.y[target] + vy * WORKER_RESOURCE_CONTACT_GAP,
      };
      out.push({
        tile: { x: tx, y: ty },
        point,
        score:
          Math.hypot(Position.x[eid] - point.x, Position.y[eid] - point.y) +
          crowdPenaltyAt(world, crowd, point.x, point.y) +
          slotPenaltyAt(world, slotRivals, point.x, point.y),
      });
    }
  }

  out.sort((a, b) => a.score - b.score || compareGridPos(a.tile, b.tile));
  return out;
}

/** Villagers of the same owner already working `target` (not hauling), in
 *  deterministic order: their spots and path ends crowd a contact slot. */
function workerResourceContactSlotRivals(
  world: SimWorld,
  eid: number,
  target: number,
  units: readonly number[]
): number[] {
  if (!hasComponent(world.ecs, VillagerTag, eid)) return [];
  const owner = hasComponent(world.ecs, Owner, eid) ? Owner.player[eid] : -1;
  const out: number[] = [];
  for (const other of units) {
    if (other === eid) continue;
    if (Health.hp[other] <= 0) continue;
    if (!hasComponent(world.ecs, VillagerTag, other)) continue;
    if (owner >= 0 && Owner.player[other] !== owner) continue;
    if (!hasComponent(world.ecs, Gatherer, other)) continue;
    if (Gatherer.targetEid[other] !== target) continue;
    if (
      Gatherer.state[other] === GathererStateId.RETURNING ||
      Gatherer.state[other] === GathererStateId.DEPOSITING
    ) {
      continue;
    }
    out.push(other);
  }
  return out;
}

function slotPenaltyAt(world: SimWorld, rivals: readonly number[], x: number, y: number): number {
  let penalty = 0;
  for (const other of rivals) {
    const dist = Math.hypot(Position.x[other] - x, Position.y[other] - y);
    if (dist < WORKER_RESOURCE_CONTACT_SLOT_RADIUS) {
      penalty += WORKER_RESOURCE_CONTACT_SLOT_UNIT_PENALTY *
        (1 - dist / WORKER_RESOURCE_CONTACT_SLOT_RADIUS);
    }

    const path = world.paths.get(other);
    const final = path?.[path.length - 1];
    if (!final) continue;
    const pathDist = Math.hypot(final.x - x, final.y - y);
    if (pathDist < WORKER_RESOURCE_CONTACT_SLOT_RADIUS) {
      penalty += WORKER_RESOURCE_CONTACT_SLOT_PATH_PENALTY *
        (1 - pathDist / WORKER_RESOURCE_CONTACT_SLOT_RADIUS);
    }
  }
  return penalty;
}

export function pathToBuildingContact(world: SimWorld, eid: number, buildingEid: number): boolean {
  const candidates = buildingApproachCandidates(world, eid, buildingEid);
  for (const candidate of candidates) {
    const from = {
      x: Math.round(Position.x[eid]),
      y: Math.round(Position.y[eid]),
    };
    const path = world.pathfinder.findPath(from, candidate.tile);
    if (path === null) continue;

    const nextPath: GridPos[] = [...path];
    const final = nextPath[nextPath.length - 1];
    if (
      !final ||
      Math.hypot(final.x - candidate.point.x, final.y - candidate.point.y) > 0.01
    ) {
      nextPath.push(candidate.point);
    }

    if (nextPath.length === 0) {
      world.paths.delete(eid);
      return true;
    }
    world.paths.set(eid, nextPath);
    PathTarget.x[eid] = Math.round(nextPath[0].x);
    PathTarget.y[eid] = Math.round(nextPath[0].y);
    return true;
  }
  return false;
}

export function buildingApproachCandidates(
  world: SimWorld,
  eid: number,
  buildingEid: number
): Array<{ tile: GridPos; point: GridPos; score: number; resourcePenalty: number }> {
  const def = BUILDING_TABLE[Building.defId[buildingEid]];
  if (!def) return [];
  const rect = buildingFootprintRect(buildingEid, def);
  const out: Array<{ tile: GridPos; point: GridPos; score: number; resourcePenalty: number }> = [];
  const crowd = workerContactCrowd(world, eid, sortedEids(world, unitQuery(world.ecs)));

  for (let ty = rect.tileY0 - 1; ty <= rect.tileY1 + 1; ty++) {
    for (let tx = rect.tileX0 - 1; tx <= rect.tileX1 + 1; tx++) {
      if (tx >= rect.tileX0 && tx <= rect.tileX1 && ty >= rect.tileY0 && ty <= rect.tileY1) {
        continue;
      }
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) continue;
      if (world.map.walkability[ty][tx] !== 0) continue;

      const edgeX = clamp(tx, rect.minX, rect.maxX);
      const edgeY = clamp(ty, rect.minY, rect.maxY);
      let vx = tx - edgeX;
      let vy = ty - edgeY;
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      const point = {
        x: edgeX + vx * BUILDING_CONTACT_EDGE_GAP,
        y: edgeY + vy * BUILDING_CONTACT_EDGE_GAP,
      };
      const resourcePenalty = findResourceAt(world, tx, ty, 0.35) === null ? 0 : 20;
      const crowdPenalty = crowdPenaltyAt(world, crowd, point.x, point.y);
      out.push({
        tile: { x: tx, y: ty },
        point,
        resourcePenalty,
        score:
          Math.hypot(Position.x[eid] - point.x, Position.y[eid] - point.y) +
          resourcePenalty +
          crowdPenalty,
      });
    }
  }

  out.sort((a, b) => a.score - b.score || compareGridPos(a.tile, b.tile));
  return out;
}

export function workerContactCrowdPenalty(world: SimWorld, eid: number, x: number, y: number): number {
  return crowdPenaltyAt(world, workerContactCrowd(world, eid, sortedEids(world, unitQuery(world.ecs))), x, y);
}

/** Units whose spot or path end crowds a contact point for `eid`, in
 *  deterministic order. Filtering once per candidate set (instead of once per
 *  candidate) keeps the same units in the same order, so the penalty sums are
 *  bit-identical. */
export function workerContactCrowd(world: SimWorld, eid: number, units: readonly number[]): number[] {
  const owner = hasComponent(world.ecs, Owner, eid) ? Owner.player[eid] : -1;
  const requesterIsVillager = hasComponent(world.ecs, VillagerTag, eid);
  const out: number[] = [];
  for (const other of units) {
    if (other === eid) continue;
    if (Health.hp[other] <= 0) continue;
    if (owner >= 0 && Owner.player[other] !== owner) continue;
    if (requesterIsVillager && hasComponent(world.ecs, VillagerTag, other)) continue;
    out.push(other);
  }
  return out;
}

export function crowdPenaltyAt(world: SimWorld, crowd: readonly number[], x: number, y: number): number {
  let penalty = 0;
  for (const other of crowd) {
    const dist = Math.hypot(Position.x[other] - x, Position.y[other] - y);
    if (dist < WORKER_CONTACT_CROWD_RADIUS) {
      penalty += WORKER_CONTACT_UNIT_PENALTY * (1 - dist / WORKER_CONTACT_CROWD_RADIUS);
    }

    const path = world.paths.get(other);
    const final = path?.[path.length - 1];
    if (!final) continue;
    const pathDist = Math.hypot(final.x - x, final.y - y);
    if (pathDist < WORKER_CONTACT_CROWD_RADIUS) {
      penalty += WORKER_CONTACT_PATH_PENALTY * (1 - pathDist / WORKER_CONTACT_CROWD_RADIUS);
    }
  }
  return penalty;
}
