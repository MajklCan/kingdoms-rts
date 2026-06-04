import { hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Owner,
  Position,
  ScoutCavalryTag,
} from './components';
import { BuildingDefId } from './defs';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import {
  LOCAL_PLAYER_ID,
  buildingQuery,
  createSimWorld,
  getPlayerVisibility,
  isEntityVisibleTo,
  isTileExploredBy,
  isTileVisibleTo,
  pruneHiddenSelectionForPlayer,
  selectedQuery,
  setSelected,
  step,
  unitQuery,
  updatePlayerVisibility,
  type SimWorld,
} from './world';

function findBuilding(world: SimWorld, playerId: number, defId: number): number {
  for (const eid of buildingQuery(world.ecs)) {
    if (Owner.player[eid] === playerId && Building.defId[eid] === defId) return eid;
  }
  throw new Error(`building not found: player=${playerId} def=${defId}`);
}

function findLocalScout(world: SimWorld): number {
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] === LOCAL_PLAYER_ID && hasComponent(world.ecs, ScoutCavalryTag, eid)) {
      return eid;
    }
  }
  throw new Error('local scout not found');
}

function findOwnedUnit(world: SimWorld, playerId: number): number {
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] === playerId) return eid;
  }
  throw new Error(`unit not found: player=${playerId}`);
}

describe('fog of war', () => {
  it('starts with the local base visible and the enemy base unexplored', () => {
    const world = createSimWorld(300);
    const localTc = findBuilding(world, LOCAL_PLAYER_ID, BuildingDefId.TOWN_CENTER);
    const enemyTc = findBuilding(world, 2, BuildingDefId.TOWN_CENTER);

    expect(isTileVisibleTo(world, LOCAL_PLAYER_ID, Position.x[localTc], Position.y[localTc])).toBe(true);
    expect(isTileExploredBy(world, LOCAL_PLAYER_ID, Position.x[localTc], Position.y[localTc])).toBe(true);
    expect(isEntityVisibleTo(world, LOCAL_PLAYER_ID, enemyTc)).toBe(false);
    expect(isTileExploredBy(world, LOCAL_PLAYER_ID, Position.x[enemyTc], Position.y[enemyTc])).toBe(false);
  });

  it('keeps last-seen enemy buildings in explored shadow after vision moves away', () => {
    const world = createSimWorld(301);
    const scout = findLocalScout(world);
    const enemyTc = findBuilding(world, 2, BuildingDefId.TOWN_CENTER);
    const home = world.map.spawns[LOCAL_PLAYER_ID];

    Position.x[scout] = Position.x[enemyTc] - 2;
    Position.y[scout] = Position.y[enemyTc];
    updatePlayerVisibility(world, LOCAL_PLAYER_ID);

    const seen = getPlayerVisibility(world, LOCAL_PLAYER_ID)?.lastSeenBuildings.get(enemyTc);
    expect(isEntityVisibleTo(world, LOCAL_PLAYER_ID, enemyTc)).toBe(true);
    expect(seen?.defId).toBe(BuildingDefId.TOWN_CENTER);

    Position.x[scout] = home.x;
    Position.y[scout] = home.y;
    updatePlayerVisibility(world, LOCAL_PLAYER_ID);

    const shadow = getPlayerVisibility(world, LOCAL_PLAYER_ID)?.lastSeenBuildings.get(enemyTc);
    expect(isTileExploredBy(world, LOCAL_PLAYER_ID, Position.x[enemyTc], Position.y[enemyTc])).toBe(true);
    expect(isEntityVisibleTo(world, LOCAL_PLAYER_ID, enemyTc)).toBe(false);
    expect(shadow?.owner).toBe(2);
  });

  it('round-trips explored tiles and last-seen building snapshots', () => {
    const source = createSimWorld(302);
    const scout = findLocalScout(source);
    const enemyTc = findBuilding(source, 2, BuildingDefId.TOWN_CENTER);
    const home = source.map.spawns[LOCAL_PLAYER_ID];

    Position.x[scout] = Position.x[enemyTc] - 2;
    Position.y[scout] = Position.y[enemyTc];
    updatePlayerVisibility(source, LOCAL_PLAYER_ID);
    Position.x[scout] = home.x;
    Position.y[scout] = home.y;
    updatePlayerVisibility(source, LOCAL_PLAYER_ID);

    const snapshot = serializeSimWorld(source, 'Fog Round Trip');
    const target = createSimWorld(303);
    loadSimWorldSnapshot(target, snapshot);

    const restoredTc = findBuilding(target, 2, BuildingDefId.TOWN_CENTER);
    const restoredSeen = Array.from(
      getPlayerVisibility(target, LOCAL_PLAYER_ID)?.lastSeenBuildings.values() ?? []
    ).find((snap) => snap.defId === BuildingDefId.TOWN_CENTER && snap.owner === 2);

    expect(isTileExploredBy(target, LOCAL_PLAYER_ID, Position.x[restoredTc], Position.y[restoredTc])).toBe(true);
    expect(isEntityVisibleTo(target, LOCAL_PLAYER_ID, restoredTc)).toBe(false);
    expect(restoredSeen?.x).toBe(Position.x[restoredTc]);
    expect(restoredSeen?.y).toBe(Position.y[restoredTc]);
  });

  it('does not let multi-human visibility ticks clear client-local selection', () => {
    const world = createSimWorld(304);
    const p2Unit = findOwnedUnit(world, 2);
    world.humanPlayers = new Set([1, 2]);
    world.paused = false;

    setSelected(world, p2Unit, true);
    step(world);

    expect(selectedQuery(world.ecs)).toContain(p2Unit);

    pruneHiddenSelectionForPlayer(world, 2);
    expect(selectedQuery(world.ecs)).toContain(p2Unit);

    pruneHiddenSelectionForPlayer(world, LOCAL_PLAYER_ID);
    expect(selectedQuery(world.ecs)).not.toContain(p2Unit);
  });
});
