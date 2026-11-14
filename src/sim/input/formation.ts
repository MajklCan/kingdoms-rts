/**
 * Formation shapes, facing and slot assignment for group orders.
 */

import { hasComponent } from 'bitecs';
import {
  ArcherTag,
  MachineGunTag,
  Position,
  ScoutCavalryTag,
  SpearmanTag,
  Speed,
  UnitStance,
  Velocity,
  VillagerTag,
} from '../components';
import type { GridPos } from '../pathfinding';
import {
  FORMATION_FACING_DEFAULT,
  FORMATION_MODE_DEFAULT,
  FORMATION_MODE_FREE,
  FORMATION_MODE_LINE,
  LOCAL_PLAYER_ID,
} from '../core/constants';
import { compareDeterministicEids } from '../core/entities';
import { canUnitOccupy } from '../core/grid';
import { findResourceAt } from '../core/lookup';
import { pathTo } from '../core/navigation';
import type { SimWorld } from '../core/types';
import { commandableSelection, ownedCommandableEids } from './apply-input';
import {
  applyFormationSpeedCap,
  clearCombatOrders,
  clearFormationSpeedCap,
  clearWorkOrders,
  setUnitHoldAnchor,
} from './unit-orders';

const FORMATION_MODE_COMPACT = 2;
const FORMATION_MODE_MIN = FORMATION_MODE_FREE;
const FORMATION_MODE_MAX = FORMATION_MODE_COMPACT;
const FORMATION_FACING_STEPS = 8;
const FORMATION_MAX_COLUMNS = 12;

/** SP convenience: reshape the local player's current selection. */
export function applyReformSelectedFormation(world: SimWorld): void {
  applyReformFormationCommand(world, LOCAL_PLAYER_ID, commandableSelection(world));
}

/**
 * Re-pack a player's selected military into their current formation shape,
 * centered on the group. Network-safe: operates only on the supplied eids that
 * the player actually owns, and reads that player's own formation mode/facing.
 */
export function applyReformFormationCommand(world: SimWorld, playerId: number, eids: number[]): void {
  const units = ownedCommandableEids(world, playerId, eids).filter(
    (eid) => hasComponent(world.ecs, UnitStance, eid) && isMovableEntity(world, eid)
  );
  if (units.length <= 1) return;
  const mode = playerFormationMode(world, playerId);
  if (!formationModeUsesSlots(mode)) {
    for (const eid of units) clearFormationSpeedCap(world, eid);
    return;
  }

  const center = formationCenter(units);
  const facing = formationFacingVector(playerFormationFacing(world, playerId));
  const ordered: number[] = [];
  for (const { eid, dest } of formationDestinations(world, units, center, mode, facing)) {
    if (!pathTo(world, eid, dest.x, dest.y)) continue;
    clearCombatOrders(world, eid);
    clearWorkOrders(world, eid);
    setUnitHoldAnchor(world, eid, dest.x, dest.y);
    ordered.push(eid);
  }
  applyFormationSpeedCap(world, ordered);
}

export function isMovableEntity(world: SimWorld, eid: number): boolean {
  return (
    hasComponent(world.ecs, Position, eid) &&
    hasComponent(world.ecs, Velocity, eid) &&
    hasComponent(world.ecs, Speed, eid)
  );
}

function formationCenter(units: number[]): GridPos {
  const center = units.reduce(
    (acc, eid) => {
      acc.x += Position.x[eid];
      acc.y += Position.y[eid];
      return acc;
    },
    { x: 0, y: 0 }
  );
  return {
    x: Math.round(center.x / units.length),
    y: Math.round(center.y / units.length),
  };
}

export function formationDestinations(
  world: SimWorld,
  units: number[],
  to: GridPos,
  formationMode = FORMATION_MODE_DEFAULT,
  facing?: { x: number; y: number }
): Array<{ eid: number; dest: GridPos }> {
  if (units.length <= 1) {
    return units.map((eid) => ({ eid, dest: to }));
  }

  const sorted = [...units].sort((a, b) => {
    const rank = formationRank(world, a) - formationRank(world, b);
    if (rank !== 0) return rank;
    // NetId order: raw eids differ between clients.
    return compareDeterministicEids(world, a, b);
  });

  const center = sorted.reduce(
    (acc, eid) => {
      acc.x += Position.x[eid];
      acc.y += Position.y[eid];
      return acc;
    },
    { x: 0, y: 0 }
  );
  center.x /= sorted.length;
  center.y /= sorted.length;

  let dirX = facing?.x ?? (to.x - center.x);
  let dirY = facing?.y ?? (to.y - center.y);
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 0.001) {
    const defaultFacing = formationFacingVector(FORMATION_FACING_DEFAULT);
    dirX = defaultFacing.x;
    dirY = defaultFacing.y;
  } else {
    dirX /= dirLen;
    dirY /= dirLen;
  }
  const sideX = -dirY;
  const sideY = dirX;
  const mode = clampFormationMode(formationMode);
  const spacing = formationSpacing(mode);
  const columns = formationColumnCount(sorted.length, mode);
  const rowCount = Math.ceil(sorted.length / columns);
  const reserved = new Set<string>();

  const out: Array<{ eid: number; dest: GridPos }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const eid = sorted[i];
    const row = Math.floor(i / columns);
    const col = i % columns;
    const rowStart = row * columns;
    const rowSize = Math.min(columns, sorted.length - rowStart);
    const sideOffset = (col - (rowSize - 1) / 2) * spacing;
    const forwardOffset = ((rowCount - 1) / 2 - row) * spacing;
    const desired = {
      x: Math.round(to.x + dirX * forwardOffset + sideX * sideOffset),
      y: Math.round(to.y + dirY * forwardOffset + sideY * sideOffset),
    };
    const dest = findFormationDestination(world, desired, reserved);
    if (dest) out.push({ eid, dest });
  }
  return out;
}

function clampFormationMode(mode: number): number {
  if (!Number.isFinite(mode)) return FORMATION_MODE_DEFAULT;
  return Math.max(
    FORMATION_MODE_MIN,
    Math.min(FORMATION_MODE_MAX, Math.trunc(mode))
  );
}

/** Current formation shape for a player (clamped, default-safe). */
export function playerFormationMode(world: SimWorld, playerId: number): number {
  return clampFormationMode(world.formationModes[playerId] ?? FORMATION_MODE_DEFAULT);
}

/** Current formation facing for a player (normalized, default-safe). */
export function playerFormationFacing(world: SimWorld, playerId: number): number {
  return normalizeFormationFacing(world.formationFacings[playerId] ?? FORMATION_FACING_DEFAULT);
}

export function formationModeUsesSlots(mode: number): boolean {
  return clampFormationMode(mode) !== FORMATION_MODE_FREE;
}

function normalizeFormationFacing(facing: number): number {
  if (!Number.isFinite(facing)) return FORMATION_FACING_DEFAULT;
  return ((Math.trunc(facing) % FORMATION_FACING_STEPS) + FORMATION_FACING_STEPS) %
    FORMATION_FACING_STEPS;
}

function formationFacingVector(facing: number): { x: number; y: number } {
  const angle = Math.PI / 2 + normalizeFormationFacing(facing) * (Math.PI * 2 / FORMATION_FACING_STEPS);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function formationColumnCount(count: number, mode: number): number {
  const maxColumns = Math.min(FORMATION_MAX_COLUMNS, count);
  if (count <= 2) return count;
  const lineColumns = Math.max(
    2,
    Math.min(maxColumns, count <= 10 ? count : Math.ceil(count / 2))
  );
  const squareColumns = Math.max(
    2,
    Math.min(maxColumns, Math.ceil(Math.sqrt(count)))
  );
  if (mode === FORMATION_MODE_COMPACT) return squareColumns;
  return lineColumns;
}

function formationSpacing(mode: number): number {
  switch (mode) {
    case FORMATION_MODE_LINE: return 1.45;
    case FORMATION_MODE_COMPACT: return 1.04;
    default: return 1.2;
  }
}

function formationRank(world: SimWorld, eid: number): number {
  if (hasComponent(world.ecs, ScoutCavalryTag, eid)) return 0;
  if (hasComponent(world.ecs, SpearmanTag, eid)) return 1;
  if (hasComponent(world.ecs, VillagerTag, eid)) return 2;
  if (hasComponent(world.ecs, ArcherTag, eid)) return 3;
  if (hasComponent(world.ecs, MachineGunTag, eid)) return 4;
  return 4;
}

function findFormationDestination(
  world: SimWorld,
  desired: GridPos,
  reserved: Set<string>
): GridPos | null {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = desired.x + dx;
        const y = desired.y + dy;
        const key = `${x},${y}`;
        if (reserved.has(key)) continue;
        if (!canUnitOccupy(world, x, y)) continue;
        if (findResourceAt(world, x, y, 0.6) !== null) continue;
        reserved.add(key);
        return { x, y };
      }
    }
  }
  return null;
}

/** SP convenience: nudge the local player's formation mode by delta. */
export function applyAdjustFormationMode(world: SimWorld, delta: number): void {
  applyAdjustFormationModeCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), delta);
}

export function applyAdjustFormationModeCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  delta: number
): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  applySetFormationModeCommand(world, playerId, eids, playerFormationMode(world, playerId) + delta);
}

/** SP convenience: set the local player's formation mode. */
export function applySetFormationMode(world: SimWorld, mode: number): void {
  applySetFormationModeCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), mode);
}

/** Network-safe: set a player's own formation mode, then re-pack their group. */
export function applySetFormationModeCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  mode: number
): void {
  world.formationModes[playerId] = clampFormationMode(mode);
  applyReformFormationCommand(world, playerId, eids);
}

/** SP convenience: rotate the local player's formation facing by delta. */
export function applyRotateSelectedFormation(world: SimWorld, delta: number): void {
  applyRotateFormationCommand(world, LOCAL_PLAYER_ID, commandableSelection(world), delta);
}

/** Network-safe: rotate a player's own formation facing, then re-pack. */
export function applyRotateFormationCommand(
  world: SimWorld,
  playerId: number,
  eids: number[],
  delta: number
): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  world.formationFacings[playerId] = normalizeFormationFacing(
    playerFormationFacing(world, playerId) + delta
  );
  applyReformFormationCommand(world, playerId, eids);
}
