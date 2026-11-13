/**
 * Helpers shared by several campaign missions.
 */

import { MAP } from '../../config';
import { Building, Owner, PopulationCost, Position } from '../components';
import { getBuildingDef } from '../defs';
import { TileType } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { AI_PLAYER_ID, LOCAL_PLAYER_ID } from '../core/constants';
import { removeSimEntity } from '../core/entities';
import { markFootprintBlocked } from '../core/grid';
import { recalculatePlayerPopCap } from '../core/population';
import { buildingQuery, unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { findPresetUnitSpot, spawnPresetUnitAt } from '../factories/late-game';
import { clearFormationSpeedCap, setUnitHoldAnchor } from '../input/unit-orders';

export function isWaterCampaignTile(tile: number): boolean {
  return tile === TileType.WATER || tile === TileType.WATER_SHALLOW;
}

export function clearPlayerBuildingsForCampaign(world: SimWorld, playerId: number): void {
  for (const eid of [...buildingQuery(world.ecs)]) {
    if (Owner.player[eid] !== playerId) continue;
    const def = getBuildingDef(Building.defId[eid]);
    if (def) {
      markFootprintBlocked(
        world,
        Position.x[eid],
        Position.y[eid],
        def.footprint.w,
        def.footprint.h,
        false
      );
    }
    world.productionQueues.delete(eid);
    removeSimEntity(world, eid);
  }
  recalculatePlayerPopCap(world, playerId);
}

export function clearBattlefieldForTownlessMission(world: SimWorld): void {
  for (const eid of [...unitQuery(world.ecs)]) {
    const playerId = Owner.player[eid];
    if (world.population[playerId]) {
      world.population[playerId].current = Math.max(
        0,
        world.population[playerId].current - PopulationCost.value[eid]
      );
    }
    world.paths.delete(eid);
    world.movementStuck.delete(eid);
    clearFormationSpeedCap(world, eid);
    removeSimEntity(world, eid);
  }

  for (const eid of [...buildingQuery(world.ecs)]) {
    const def = getBuildingDef(Building.defId[eid]);
    if (def) {
      markFootprintBlocked(
        world,
        Position.x[eid],
        Position.y[eid],
        def.footprint.w,
        def.footprint.h,
        false
      );
    }
    removeSimEntity(world, eid);
  }

  world.productionQueues.clear();
  world.armyRallyPoints[LOCAL_PLAYER_ID] = null;
  world.armyRallyPoints[AI_PLAYER_ID] = null;
  world.population[LOCAL_PLAYER_ID] = { current: 0, cap: 0 };
  world.population[AI_PLAYER_ID] = { current: 0, cap: 0 };
}

export function normalizeVector(x: number, y: number): GridPos {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

export function offsetBattlePoint(
  origin: GridPos,
  forward: GridPos,
  across: GridPos,
  forwardOffset: number,
  lateralOffset: number
): GridPos {
  return {
    x: Math.round(origin.x + forward.x * forwardOffset + across.x * lateralOffset),
    y: Math.round(origin.y + forward.y * forwardOffset + across.y * lateralOffset),
  };
}

export function clampBattlePoint(point: GridPos): GridPos {
  return {
    x: Math.max(2, Math.min(MAP.WIDTH - 3, Math.round(point.x))),
    y: Math.max(2, Math.min(MAP.HEIGHT - 3, Math.round(point.y))),
  };
}

export function spawnFormationRow(
  world: SimWorld,
  defId: number,
  anchor: GridPos,
  forward: GridPos,
  across: GridPos,
  forwardOffset: number,
  lateralOffset: number,
  playerId: number,
  count: number,
  spacing: number
): number[] {
  const spawned: number[] = [];
  const start = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const lateral = lateralOffset + start + i * spacing;
    const preferredX = anchor.x + forward.x * forwardOffset + across.x * lateral;
    const preferredY = anchor.y + forward.y * forwardOffset + across.y * lateral;
    const spot = findPresetUnitSpot(world, preferredX, preferredY, 3, playerId, 4);
    if (!spot) continue;
    const eid = spawnPresetUnitAt(world, defId, spot.x, spot.y, playerId);
    if (eid === null) continue;
    setUnitHoldAnchor(world, eid, spot.x, spot.y);
    spawned.push(eid);
  }
  return spawned;
}
