/**
 * Slow forest regrowth near existing trees.
 */

import { dhypot } from '../core/dmath';
import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Health, Position, Resource, ResourceKindId } from '../components';
import { TileType } from '../map-gen';
import { TREE_EDGE_BAND_TILES, TREE_REGEN_BUILDING_CLEARANCE } from '../core/constants';
import { scaleByMapArea } from '../core/map-size';
import { isResourceTerrainTile } from '../core/create-world';
import { distToBuildingEdge } from '../core/grid';
import { findResourceAt, hasMapFeatureAt } from '../core/lookup';
import { buildingQuery, resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnResource } from '../factories/buildings';

const REGENERATED_TREE_AMOUNT = 80;
const TREE_REGEN_INTERVAL_TICKS = SIM.TICK_HZ * 4;
const TREE_REGEN_CANDIDATES_PER_PASS = 32;
const TREE_REGEN_RADIUS = 4;
const TREE_REGEN_MAX_WOOD_NODES = 360;
const TREE_REGEN_BASE_CHANCE = 0.002;
const TREE_REGEN_CHANCE_PER_NEARBY_TREE = 0.006;
const TREE_REGEN_EDGE_PRESSURE_BONUS = 2.5;
const TREE_REGEN_MAX_CHANCE = 0.08;

export function edgeProximity01(world: SimWorld, x: number, y: number): number {
  const edgeDistance = Math.min(x, y, world.map.width - 1 - x, world.map.height - 1 - y);
  if (edgeDistance >= TREE_EDGE_BAND_TILES) return 0;
  return (TREE_EDGE_BAND_TILES - edgeDistance) / TREE_EDGE_BAND_TILES;
}

export function trySpawnTreeAt(
  world: SimWorld,
  x: number,
  y: number,
  amount: number,
  buildingClearance: number
): number | null {
  if (!canTreeGrowAt(world, x, y, buildingClearance)) return null;
  return spawnResource(world, ResourceKindId.WOOD, x, y, amount);
}

function canTreeGrowAt(
  world: SimWorld,
  x: number,
  y: number,
  buildingClearance: number
): boolean {
  if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) return false;
  if (world.map.walkability[y][x] !== 0) return false;
  const tile = world.map.tiles[y * world.map.width + x];
  if (!isResourceTerrainTile(tile)) return false;
  if (
    tile !== TileType.GRASS
    && tile !== TileType.FOREST
    && tile !== TileType.SNOW
    && tile !== TileType.SNOW_FOREST
  ) return false;
  if (hasMapFeatureAt(world, x, y, 0.6)) return false;
  if (findResourceAt(world, x, y, 0.6) !== null) return false;
  return !isNearBuilding(world, x, y, buildingClearance);
}

function isNearBuilding(
  world: SimWorld,
  x: number,
  y: number,
  clearance: number
): boolean {
  for (const eid of buildingQuery(world.ecs)) {
    if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
    if (distToBuildingEdge(world, x, y, eid) < clearance) return true;
  }
  return false;
}

function countWoodNodes(world: SimWorld): number {
  let count = 0;
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] === ResourceKindId.WOOD && Resource.amount[eid] > 0) count++;
  }
  return count;
}

function countNearbyTrees(
  world: SimWorld,
  x: number,
  y: number,
  radius: number
): number {
  let count = 0;
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] !== ResourceKindId.WOOD) continue;
    if (Resource.amount[eid] <= 0) continue;
    if (dhypot(Position.x[eid] - x, Position.y[eid] - y) <= radius) count++;
  }
  return count;
}

export function forestRegrowthSystem(world: SimWorld): void {
  if (world.tick === 0 || world.tick % TREE_REGEN_INTERVAL_TICKS !== 0) return;
  // A large map gets proportionally more trees and more growth attempts.
  const maxWoodNodes = scaleByMapArea(world.map, TREE_REGEN_MAX_WOOD_NODES);
  if (countWoodNodes(world) >= maxWoodNodes) return;

  const candidates = scaleByMapArea(world.map, TREE_REGEN_CANDIDATES_PER_PASS);
  for (let i = 0; i < candidates; i++) {
    if (countWoodNodes(world) >= maxWoodNodes) return;

    const x = world.rng.int(world.map.width);
    const y = world.rng.int(world.map.height);
    if (!canTreeGrowAt(world, x, y, TREE_REGEN_BUILDING_CLEARANCE)) continue;

    const nearbyTrees = countNearbyTrees(world, x, y, TREE_REGEN_RADIUS);
    const tile = world.map.tiles[y * world.map.width + x];
    const forestTileBonus = tile === TileType.FOREST || tile === TileType.SNOW_FOREST ? 1 : 0;
    const edgeBonus = edgeProximity01(world, x, y) * TREE_REGEN_EDGE_PRESSURE_BONUS;
    const growthPressure = nearbyTrees + forestTileBonus + edgeBonus;
    if (growthPressure <= 0) continue;

    const chance = Math.min(
      TREE_REGEN_MAX_CHANCE,
      TREE_REGEN_BASE_CHANCE + growthPressure * TREE_REGEN_CHANCE_PER_NEARBY_TREE
    );
    if (world.rng.next() < chance) {
      trySpawnTreeAt(
        world,
        x,
        y,
        REGENERATED_TREE_AMOUNT,
        TREE_REGEN_BUILDING_CLEARANCE
      );
    }
  }
}
