/**
 * Huntable game: spawning one animal, and placing the skirmish herds.
 *
 * Herds are point-mirrored across the map centre on every map (the same
 * mirror the local patches use), so both sides get the same game at the same
 * distance. All draws come from world.rng and run after every other
 * creation-time draw (see createSimWorld), so existing layouts are unchanged.
 */

import { dhypot } from '../core/dmath';
import { addComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  GameAnimal,
  GameAnimalStateId,
  GameSpeciesId,
  Position,
  PrevPosition,
  Resource,
  ResourceKindId,
} from '../components';
import { addSimEntity } from '../core/entities';
import type { SimWorld } from '../core/types';
import type { GridPos } from '../pathfinding';
import { foodForSpecies } from '../systems/hunting';

/** Herds per side (each one also placed mirrored for the other side). */
export const HERDS_PER_SIDE = 3;
/** Herds stay at least this far from every town center (tiles). */
export const HERD_MIN_SPAWN_DISTANCE = 15;
/** A herd and its mirror stay this far apart, so the middle gets no double herd. */
const HERD_MIN_MIRROR_DISTANCE = 10;
/** Tries per herd. The mirrored stone and gold fields leave fewer open
 *  spots on some maps (the flooded basin), so a herd gets many tries. */
const HERD_PLACEMENT_ATTEMPTS = 40;
/** Member offsets from the herd centre; a herd uses the first `size`. */
const HERD_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export function spawnGameAnimal(world: SimWorld, species: number, x: number, y: number): number {
  const eid = addSimEntity(world);
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, PrevPosition, eid);
  addComponent(world.ecs, Resource, eid);
  addComponent(world.ecs, GameAnimal, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  PrevPosition.x[eid] = x;
  PrevPosition.y[eid] = y;
  Resource.kind[eid] = ResourceKindId.FOOD;
  Resource.amount[eid] = foodForSpecies(species);
  GameAnimal.species[eid] = species;
  GameAnimal.state[eid] = GameAnimalStateId.ALIVE;
  GameAnimal.homeX[eid] = x;
  GameAnimal.homeY[eid] = y;
  GameAnimal.targetX[eid] = x;
  GameAnimal.targetY[eid] = y;
  // Stagger the first wander so a herd does not move in lockstep.
  GameAnimal.wait[eid] = 1 + world.rng.int(60);
  return eid;
}

/**
 * Place HERDS_PER_SIDE mirrored herd pairs away from `spawns`. `canPlace`
 * says whether a tile may hold a resource node (land, free, not a building).
 */
export function placeGameHerds(
  world: SimWorld,
  spawns: readonly GridPos[],
  canPlace: (x: number, y: number) => boolean
): void {
  const mirror = (p: GridPos): GridPos => ({ x: MAP.WIDTH - 1 - p.x, y: MAP.HEIGHT - 1 - p.y });
  const farFromSpawns = (p: GridPos) =>
    spawns.every((s) => dhypot(s.x - p.x, s.y - p.y) >= HERD_MIN_SPAWN_DISTANCE);

  for (let herd = 0; herd < HERDS_PER_SIDE; herd++) {
    for (let attempt = 0; attempt < HERD_PLACEMENT_ATTEMPTS; attempt++) {
      const center = { x: world.rng.int(MAP.WIDTH), y: world.rng.int(MAP.HEIGHT) };
      const species = world.rng.next() < 0.34 ? GameSpeciesId.BOAR : GameSpeciesId.DEER;
      const size = species === GameSpeciesId.BOAR ? 2 : 3 + world.rng.int(2);
      const other = mirror(center);
      if (!farFromSpawns(center) || !farFromSpawns(other)) continue;
      if (dhypot(center.x - other.x, center.y - other.y) < HERD_MIN_MIRROR_DISTANCE) continue;
      if (!canPlace(center.x, center.y) || !canPlace(other.x, other.y)) continue;
      for (const [dx, dy] of HERD_OFFSETS.slice(0, size)) {
        const a = { x: center.x + dx, y: center.y + dy };
        const b = mirror(a);
        // Both sides get the member or neither does.
        if (!canPlace(a.x, a.y) || !canPlace(b.x, b.y)) continue;
        spawnGameAnimal(world, species, a.x, a.y);
        spawnGameAnimal(world, species, b.x, b.y);
      }
      break;
    }
  }
}
