/**
 * Unit production queues: enqueue, cancel, train and rally.
 */

import { hasComponent } from 'bitecs';
import { Building, Owner, Position, Producer, ResourceWorksite } from '../components';
import {
  BuildingDefId,
  UnitDefId,
  canAfford,
  getBuildingDef,
  getUnitDef,
  refund,
  spend,
} from '../defs';
import type { GridPos } from '../pathfinding';
import { isUnitUnlocked } from '../tech-tree';
import { sortedEids } from '../core/entities';
import { pushGameEvent, pushSoundCue } from '../core/events';
import { recordUnitTrained } from '../core/match-stats';
import { findSpawnSpot } from '../core/grid';
import { pathTo } from '../core/navigation';
import { countQueuedPopCost } from '../core/population';
import { producerQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnMilitaryUnitByDefId, spawnVillager } from '../factories/units';
import { isMovableEntity } from '../input/formation';
import {
  countQueuedWorksiteWorkers,
  countWorksiteWorkers,
  getWorksiteWorkerSlots,
  spawnWorksiteWorker,
} from './worksites';

export function applyTrainUnit(
  world: SimWorld,
  atEid: number,
  defId: number,
  count = 1
): void {
  const numericCount = Number.isFinite(count) ? count : 1;
  const requested = Math.max(1, Math.min(5, Math.trunc(numericCount)));
  for (let i = 0; i < requested; i++) {
    if (!applyTrainUnitOnce(world, atEid, defId)) return;
  }
}

function applyTrainUnitOnce(world: SimWorld, atEid: number, defId: number): boolean {
  if (!hasComponent(world.ecs, Producer, atEid)) return false;
  const unitDef = getUnitDef(defId);
  if (!unitDef) return false;
  if (!hasComponent(world.ecs, Building, atEid)) return false;
  const producerDef = getBuildingDef(Building.defId[atEid]);
  if (!producerDef) return false;
  const playerId = Owner.player[atEid];
  const bank = world.resources[playerId];
  if (!bank) return false;
  const queue = world.productionQueues.get(atEid) ?? [];
  const isWorksiteWorker =
    defId === UnitDefId.VILLAGER &&
    hasComponent(world.ecs, ResourceWorksite, atEid);

  if (isWorksiteWorker) {
    const slots = getWorksiteWorkerSlots(world, atEid);
    const occupied = countWorksiteWorkers(world, atEid) + countQueuedWorksiteWorkers(world, atEid);
    if (occupied >= slots) return false;
    if (queue.length >= 2) return false;
    if (!canAfford(bank, unitDef.cost)) return false;
    spend(bank, unitDef.cost);
    queue.push(defId);
    world.productionQueues.set(atEid, queue);
    return true;
  }

  if (!producerDef.trains.includes(unitDef.id)) return false;
  if (!isUnitUnlocked(world, playerId, defId)) return false;
  if (!canAfford(bank, unitDef.cost)) return false;

  const pop = world.population[playerId];
  // Will the spawned unit exceed cap? (Front-of-queue spawns immediately when ready.)
  // We allow queueing past current cap only if pop.cap can grow (Houses). For
  // simplicity, block queueing if even the existing queue + pop.current >= cap.
  if (pop.current + countQueuedPopCost(world, playerId) + unitDef.popCost > pop.cap) return false;

  spend(bank, unitDef.cost);
  queue.push(defId);
  world.productionQueues.set(atEid, queue);
  return true;
}

/**
 * Cancel one queue entry and refund its cost. `slot` 0 is the unit training
 * now; without a slot the most recently queued entry goes. Out-of-range or
 * non-integer slots are ignored (peers can send anything).
 */
export function applyCancelProduction(world: SimWorld, atEid: number, slot?: number): void {
  const queue = world.productionQueues.get(atEid);
  if (!queue || queue.length === 0) return;
  const index = slot === undefined ? queue.length - 1 : slot;
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
  const [cancelled] = queue.splice(index, 1);
  if (cancelled === undefined) return;
  // Cancelling the front entry restarts training for whatever moves up.
  if (index === 0 && hasComponent(world.ecs, Producer, atEid)) {
    Producer.currentProgress[atEid] = 0;
  }
  const def = getUnitDef(cancelled);
  if (!def) return;
  const playerId = Owner.player[atEid];
  const bank = world.resources[playerId];
  if (bank) refund(bank, def.cost);
}

export function productionSystem(world: SimWorld): void {
  const ents = sortedEids(world, producerQuery(world.ecs));
  for (const eid of ents) {
    const queue = world.productionQueues.get(eid);
    if (!queue || queue.length === 0) {
      Producer.currentProgress[eid] = 0;
      continue;
    }
    const trainingDefId = queue[0];
    const def = getUnitDef(trainingDefId);
    if (!def) {
      queue.shift();
      continue;
    }
    Producer.currentProgress[eid] += 1;
    if (Producer.currentProgress[eid] >= def.trainTimeTicks) {
      if (
        trainingDefId === UnitDefId.VILLAGER &&
        hasComponent(world.ecs, ResourceWorksite, eid)
      ) {
        const slots = getWorksiteWorkerSlots(world, eid);
        const bank = world.resources[Owner.player[eid]];
        if (countWorksiteWorkers(world, eid) >= slots) {
          if (bank) refund(bank, def.cost);
          queue.shift();
          Producer.currentProgress[eid] = 0;
          continue;
        }
        const worker = spawnWorksiteWorker(world, eid);
        if (worker !== null) {
          queue.shift();
          Producer.currentProgress[eid] = 0;
          noteUnitTrained(world, Owner.player[eid], trainingDefId, worker);
        } else {
          Producer.currentProgress[eid] = def.trainTimeTicks;
        }
        continue;
      }

      // Spawn unit at rally point (south of the building for now).
      const px = Position.x[eid];
      const py = Position.y[eid];
      // Find a free tile near building.
      const candidates: GridPos[] = [
        { x: px + 1, y: py + 1 },
        { x: px - 1, y: py + 1 },
        { x: px + 1, y: py - 1 },
        { x: px - 1, y: py - 1 },
        { x: px, y: py + 2 },
        { x: px + 2, y: py },
      ];
      // Find a walkable spawn location near the producer. Spawning inside a
      // blocked tile (e.g. the producer's own 3×3 footprint) traps the new
      // unit at a blocked start, so pathfinding from it fails silently.
      let spawnedEid: number | null = null;
      for (const c of candidates) {
        const spot = findSpawnSpot(world, c.x, c.y, 4);
        if (!spot) continue;
        if (trainingDefId === UnitDefId.VILLAGER) {
          spawnedEid = spawnVillager(world, spot.x, spot.y, Owner.player[eid]);
          break;
        }
        const military = spawnMilitaryUnitByDefId(world, trainingDefId, spot.x, spot.y, Owner.player[eid]);
        if (military !== null) {
          spawnedEid = military;
          break;
        }
      }
      if (spawnedEid !== null) {
        pushSoundCue(world, 'unit_ready', Position.x[eid], Position.y[eid], Owner.player[eid]);
        noteUnitTrained(world, Owner.player[eid], trainingDefId, spawnedEid);
        issueProductionRallyOrder(world, eid, spawnedEid);
        queue.shift();
        Producer.currentProgress[eid] = 0;
      } else {
        // Pop blocked - try again next tick.
        Producer.currentProgress[eid] = def.trainTimeTicks; // pin at full
      }
    }
  }
}

function noteUnitTrained(world: SimWorld, playerId: number, unitDefId: number, unitEid: number): void {
  recordUnitTrained(world, playerId);
  pushGameEvent(world, {
    kind: 'unitTrained',
    playerId,
    unitDefId,
    eid: unitEid,
    x: Position.x[unitEid],
    y: Position.y[unitEid],
  });
}

function issueProductionRallyOrder(
  world: SimWorld,
  producerEid: number,
  unitEid: number
): void {
  if (!hasComponent(world.ecs, Building, producerEid)) return;
  if (!isArmyProducerDefId(Building.defId[producerEid])) return;
  const playerId = Owner.player[producerEid];
  const rally = world.armyRallyPoints[playerId];
  if (!rally) return;
  if (!isMovableEntity(world, unitEid)) return;
  pathTo(world, unitEid, rally.x, rally.y);
}

function isArmyProducerDefId(defId: number): boolean {
  return defId === BuildingDefId.BARRACKS ||
    defId === BuildingDefId.ARCHERY_RANGE ||
    defId === BuildingDefId.STABLE ||
    defId === BuildingDefId.FOUNDRY;
}
