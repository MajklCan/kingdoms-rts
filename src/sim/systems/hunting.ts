/**
 * Huntable game (deer, boar). An animal is a FOOD Resource node with a
 * GameAnimal component:
 *
 *   alive    wanders slowly inside WANDER_LEASH tiles of its home, pausing
 *            between steps; every choice is a world.rng draw in NetId order
 *   carcass  a hunter reached it: it lies still and is gathered by hand
 *            like a berry bush, then removed by resourceDepletionSystem
 *
 * No animal AI beyond wandering: game never flees or fights back.
 */

import { dhypot } from '../core/dmath';
import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../../config';
import {
  GameAnimal,
  GameAnimalStateId,
  GameSpeciesId,
  Owner,
  Position,
  PrevPosition,
  Resource,
} from '../components';
import { compareDeterministicEids, sortedEids } from '../core/entities';
import { pushSoundCue } from '../core/events';
import { gameAnimalQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { startGatheringResource } from './gathering';

/** Food in one animal. */
export const DEER_FOOD = 100;
export const BOAR_FOOD = 180;
/** Wander speed in tiles per second. */
const DEER_SPEED = 0.55;
const BOAR_SPEED = 0.4;
/** How far from home an animal wanders (tiles). */
export const WANDER_LEASH = 3;
const WANDER_PAUSE_MIN_TICKS = Math.round(SIM.TICK_HZ * 2);
const WANDER_PAUSE_SPREAD_TICKS = Math.round(SIM.TICK_HZ * 4);
/** Work time from reaching a live animal to the first bite of food. */
export const HUNT_KILL_TICKS = Math.round(SIM.TICK_HZ * 1.5);
/** An emptied carcass sends its hunter to the next animal this close (tiles). */
export const HERD_RETARGET_RADIUS = 10;

export function isGameAnimal(world: SimWorld, eid: number): boolean {
  return eid >= 0 && hasComponent(world.ecs, GameAnimal, eid) && hasComponent(world.ecs, Resource, eid);
}

export function isLiveGameAnimal(world: SimWorld, eid: number): boolean {
  return isGameAnimal(world, eid) && GameAnimal.state[eid] === GameAnimalStateId.ALIVE;
}

export function foodForSpecies(species: number): number {
  return species === GameSpeciesId.BOAR ? BOAR_FOOD : DEER_FOOD;
}

function speedForSpecies(species: number): number {
  return species === GameSpeciesId.BOAR ? BOAR_SPEED : DEER_SPEED;
}

/** Wander every live animal one tick. Runs before movement. */
export function gameAnimalSystem(world: SimWorld): void {
  const animals = gameAnimalQuery(world.ecs);
  if (animals.length === 0) return;
  const dt = 1 / SIM.TICK_HZ;
  for (const eid of sortedEids(world, animals)) {
    PrevPosition.x[eid] = Position.x[eid];
    PrevPosition.y[eid] = Position.y[eid];
    if (GameAnimal.state[eid] !== GameAnimalStateId.ALIVE) continue;
    if (GameAnimal.wait[eid] > 0) {
      GameAnimal.wait[eid] -= 1;
      if (GameAnimal.wait[eid] === 0) pickWanderTarget(world, eid);
      continue;
    }
    const dx = GameAnimal.targetX[eid] - Position.x[eid];
    const dy = GameAnimal.targetY[eid] - Position.y[eid];
    const dist = dhypot(dx, dy);
    const stepDist = speedForSpecies(GameAnimal.species[eid]) * dt;
    if (dist <= stepDist) {
      Position.x[eid] = GameAnimal.targetX[eid];
      Position.y[eid] = GameAnimal.targetY[eid];
      GameAnimal.wait[eid] = WANDER_PAUSE_MIN_TICKS + world.rng.int(WANDER_PAUSE_SPREAD_TICKS);
      continue;
    }
    const nx = Position.x[eid] + (dx / dist) * stepDist;
    const ny = Position.y[eid] + (dy / dist) * stepDist;
    if (!isWalkable(world, nx, ny)) {
      // A building went up in the way: stand and pick elsewhere later.
      GameAnimal.targetX[eid] = Position.x[eid];
      GameAnimal.targetY[eid] = Position.y[eid];
      GameAnimal.wait[eid] = WANDER_PAUSE_MIN_TICKS;
      continue;
    }
    Position.x[eid] = nx;
    Position.y[eid] = ny;
  }
}

function pickWanderTarget(world: SimWorld, eid: number): void {
  const x = GameAnimal.homeX[eid] + (world.rng.next() * 2 - 1) * WANDER_LEASH;
  const y = GameAnimal.homeY[eid] + (world.rng.next() * 2 - 1) * WANDER_LEASH;
  if (!isWalkable(world, x, y) || !isStraightWalkable(world, Position.x[eid], Position.y[eid], x, y)) {
    GameAnimal.wait[eid] = WANDER_PAUSE_MIN_TICKS;
    return;
  }
  GameAnimal.targetX[eid] = x;
  GameAnimal.targetY[eid] = y;
}

function isWalkable(world: SimWorld, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return false;
  return world.grid[ty][tx] === 0;
}

function isStraightWalkable(world: SimWorld, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = Math.ceil(dhypot(x1 - x0, y1 - y0) * 2);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

/**
 * A hunter reached `target`. A live animal is killed: it stops wandering and
 * becomes a carcass. Returns the work ticks before the first gather.
 */
export function huntArrivalCooldown(world: SimWorld, hunter: number, target: number, normal: number): number {
  if (!isLiveGameAnimal(world, target)) return normal;
  GameAnimal.state[target] = GameAnimalStateId.CARCASS;
  GameAnimal.targetX[target] = Position.x[target];
  GameAnimal.targetY[target] = Position.y[target];
  pushSoundCue(world, 'gather_food', Position.x[hunter], Position.y[hunter], Owner.player[hunter]);
  return HUNT_KILL_TICKS;
}

/**
 * Send `eid` to the nearest animal with food left within `radius` of (x, y),
 * carcasses first (they are already open). False when none is reachable.
 */
export function routeToNearestGame(
  world: SimWorld,
  eid: number,
  x: number,
  y: number,
  radius: number,
  skip = -1
): boolean {
  const candidates = gameAnimalQuery(world.ecs)
    .filter((animal) => animal !== skip && Resource.amount[animal] > 0)
    .map((animal) => ({
      animal,
      carcass: GameAnimal.state[animal] === GameAnimalStateId.CARCASS ? 0 : 1,
      dist: dhypot(Position.x[animal] - x, Position.y[animal] - y),
    }))
    .filter((c) => c.dist <= radius)
    .sort((a, b) => a.carcass - b.carcass || a.dist - b.dist || compareDeterministicEids(world, a.animal, b.animal));
  for (const { animal } of candidates) {
    if (startGatheringResource(world, eid, animal)) return true;
  }
  return false;
}
