/**
 * Local selection helpers used by render and the debug API.
 */

import { addComponent, hasComponent, removeComponent } from 'bitecs';
import { Owner, Position, Selected, UnitKind } from '../components';
import { isEntityVisibleTo } from '../systems/visibility';
import { selectedQuery, unitQuery } from './queries';
import type { SimWorld } from './types';

export function pruneHiddenSelectionForPlayer(world: SimWorld, playerId: number): void {
  for (const eid of selectedQuery(world.ecs)) {
    if (!hasComponent(world.ecs, Owner, eid)) continue;
    if (Owner.player[eid] === playerId) continue;
    if (!isEntityVisibleTo(world, playerId, eid)) {
      removeComponent(world.ecs, Selected, eid);
    }
  }
}

export function setSelected(
  world: SimWorld,
  eid: number,
  selected: boolean
): void {
  if (selected) {
    addComponent(world.ecs, Selected, eid);
  } else {
    removeComponent(world.ecs, Selected, eid);
  }
}

export function clearSelection(world: SimWorld): void {
  const sel = selectedQuery(world.ecs);
  for (const eid of sel) {
    removeComponent(world.ecs, Selected, eid);
  }
}

export function selectUnitsOfSameKindInRadius(
  world: SimWorld,
  sourceEid: number,
  radius: number,
  playerId = Owner.player[sourceEid]
): number {
  if (!hasComponent(world.ecs, UnitKind, sourceEid)) return 0;
  if (Owner.player[sourceEid] !== playerId) return 0;

  const sourceKind = UnitKind.kind[sourceEid];
  const sourceX = Position.x[sourceEid];
  const sourceY = Position.y[sourceEid];
  clearSelection(world);

  let selectedCount = 0;
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (UnitKind.kind[eid] !== sourceKind) continue;
    const dist = Math.hypot(Position.x[eid] - sourceX, Position.y[eid] - sourceY);
    if (dist > radius) continue;
    setSelected(world, eid, true);
    selectedCount++;
  }

  return selectedCount;
}
