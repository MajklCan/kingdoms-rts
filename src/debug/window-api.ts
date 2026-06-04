/**
 * Expose a `window.__GAME__` object so agents and humans can drive / introspect the
 * sim from the browser console. This is the single most important "make the game
 * self-describing" affordance — read state without pixels, drive state without UI.
 */

import { hasComponent } from 'bitecs';
import {
  clearSelection,
  positionQuery,
  selectedQuery,
  setSelected,
} from '../sim/world';
import {
  AttackTarget,
  Building,
  ConstructionSite,
  Gatherer,
  GathererStateId,
  Health,
  MachineGunDeployment,
  NetId,
  Owner,
  PathTarget,
  Position,
  Producer,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  UnitKind,
  VillagerTag,
  WorksiteWorker,
} from '../sim/components';
import { BuildingDefId, UnitDefId, getBuildingDef, getUnitDef } from '../sim/defs';
import { techDef } from '../sim/tech-tree';
import type { SimInput, SimWorld } from '../sim/world';

export interface WindowGameApi {
  /** Returns a JSON-safe snapshot of the entire sim. */
  getState(): {
    tick: number;
    entities: Array<{
      eid: number;
      x: number;
      y: number;
      kind: number;
      player: number;
    }>;
  };
  /** Queue an input command to be applied on the next sim tick. */
  queueInput(input: SimInput): void;
  /** Force-advance the sim by N ticks (for replay scrubbing / testing). */
  tickN(n: number): void;
  /** Currently selected entity ids. */
  selected(): number[];
  /** Select all units (optionally filtered by player). */
  selectAll(playerId?: number): number[];
  /** Convenience: select then queue a moveSelected command to (x, y). */
  moveTo(x: number, y: number): void;
  /** Inspect an entity's components + path state. For debugging. */
  inspect(eid: number): Record<string, unknown>;
  /** Place a player-built building directly on the map. */
  placeBuilding(
    defName:
      | 'HOUSE'
      | 'FARM'
      | 'MILL'
      | 'LUMBER_CAMP'
      | 'GOLD_MINE'
      | 'STONE_QUARRY'
      | 'BARRACKS'
      | 'ARCHERY_RANGE'
      | 'STABLE'
      | 'DEFENSIVE_TOWER'
      | 'FOUNDRY',
    x: number,
    y: number
  ): void;
  /** Queue an advance to the next age (cost spent immediately). */
  advanceAge(playerId?: number): void;
  /** Deprecated no-op: villagers are spawned by specialist resource buildings. */
  trainVillager(): void;
  /** Train a unit def at the first selected producer that can make it. */
  trainUnit(defName: 'ARCHER' | 'SPEARMAN' | 'SCOUT_CAVALRY' | 'GUNMAN' | 'CANNON'): void;
  /** Player population state. */
  pop(playerId?: number): { current: number; cap: number };
  /** Player resource bank. */
  bank(playerId?: number): { food: number; wood: number; gold: number; stone: number };
  /** Compact diagnostic dump intended for console copy/paste bug reports. */
  debugDump(): Record<string, unknown>;
  /** Raw access to the SimWorld for power users. Avoid mutating directly. */
  raw(): SimWorld;
}

export function installWindowApi(
  world: SimWorld,
  tickN: (n: number) => void,
  getSelected: () => number[]
): void {
  const api: WindowGameApi = {
    getState() {
      const ents = positionQuery(world.ecs);
      const entities: Array<{
        eid: number;
        x: number;
        y: number;
        kind: number;
        player: number;
      }> = [];
      for (const eid of ents) {
        entities.push({
          eid,
          x: Position.x[eid],
          y: Position.y[eid],
          kind: UnitKind.kind[eid],
          player: Owner.player[eid],
        });
      }
      return { tick: world.tick, entities };
    },
    queueInput(input) {
      world.inputs.push(input);
    },
    tickN(n) {
      tickN(n);
    },
    selected() {
      return getSelected();
    },
    selectAll(playerId) {
      // Only select actual units, not buildings or resources.
      clearSelection(world);
      const ents = positionQuery(world.ecs);
      const picked: number[] = [];
      for (const eid of ents) {
        if (!hasComponent(world.ecs, UnitKind, eid)) continue;
        if (playerId !== undefined && Owner.player[eid] !== playerId) continue;
        setSelected(world, eid, true);
        picked.push(eid);
      }
      return picked;
    },
    moveTo(x, y) {
      world.inputs.push({ type: 'moveSelected', to: { x, y } });
    },
    inspect(eid) {
      const path = world.paths.get(eid);
      return {
        eid,
        netId: hasComponent(world.ecs, NetId, eid) ? NetId.value[eid] : null,
        position: { x: Position.x[eid], y: Position.y[eid] },
        owner: Owner.player[eid],
        kind: UnitKind.kind[eid],
        machineGunDeployment: hasComponent(world.ecs, MachineGunDeployment, eid)
          ? {
            deployed: MachineGunDeployment.deployed[eid],
            setupTicks: MachineGunDeployment.setupTicks[eid],
          }
          : null,
        pathLength: path ? path.length : 0,
        nextWaypoint: path && path.length > 0 ? path[0] : null,
        queuedInputs: world.inputs.length,
        tick: world.tick,
      };
    },
    placeBuilding(defName, x, y) {
      const defId = BuildingDefId[defName];
      world.inputs.push({ type: 'placeBuilding', defId, x, y, playerId: 1 });
    },
    advanceAge(playerId = 1) {
      world.inputs.push({ type: 'advanceAge', playerId });
    },
    trainVillager() {
      // eslint-disable-next-line no-console
      console.warn('[Kingdoms] trainVillager(): villagers are spawned by specialist resource buildings.');
    },
    trainUnit(defName) {
      const defId = UnitDefId[defName];
      const sel = selectedQuery(world.ecs);
      for (const eid of sel) {
        if (!hasComponent(world.ecs, Producer, eid)) continue;
        world.inputs.push({
          type: 'trainUnit',
          atEid: eid,
          defId,
        });
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('[Kingdoms] trainUnit(): no producer selected');
    },
    pop(playerId = 1) {
      const p = world.population[playerId];
      // Return a snapshot (not the live ref) so JSON-serialized debug outputs
      // capture the value at the time of the call.
      return p ? { current: p.current, cap: p.cap } : { current: 0, cap: 0 };
    },
    bank(playerId = 1) {
      const b = world.resources[playerId];
      return {
        food: b?.[0] ?? 0,
        wood: b?.[1] ?? 0,
        gold: b?.[2] ?? 0,
        stone: b?.[3] ?? 0,
      };
    },
    debugDump() {
      const entities = positionQuery(world.ecs);
      const buildingCounts: Record<string, number> = {};
      const unitCounts: Record<string, number> = {};
      const buildings: Array<Record<string, unknown>> = [];
      const units: Array<Record<string, unknown>> = [];

      for (const eid of entities) {
        const owner = Owner.player[eid];
        if (hasComponent(world.ecs, Building, eid)) {
          const defId = Building.defId[eid];
          const name = getBuildingDef(defId)?.name ?? `Building ${defId}`;
          const key = `${owner}:${name}`;
          buildingCounts[key] = (buildingCounts[key] ?? 0) + 1;
          const queue = world.productionQueues.get(eid) ?? [];
          buildings.push({
            eid,
            netId: hasComponent(world.ecs, NetId, eid) ? NetId.value[eid] : null,
            owner,
            name,
            x: Number(Position.x[eid].toFixed(2)),
            y: Number(Position.y[eid].toFixed(2)),
            hp: hasComponent(world.ecs, Health, eid) ? Health.hp[eid] : null,
            completed: !hasComponent(world.ecs, ConstructionSite, eid),
            construction: hasComponent(world.ecs, ConstructionSite, eid)
              ? {
                progress: ConstructionSite.progress[eid],
                total: ConstructionSite.totalTicks[eid],
              }
              : null,
            queue: queue.map((unitDefId) => getUnitDef(unitDefId)?.name ?? `Unit ${unitDefId}`),
            producerProgress: hasComponent(world.ecs, Producer, eid)
              ? Producer.currentProgress[eid]
              : null,
            worksite: hasComponent(world.ecs, ResourceWorksite, eid)
              ? {
                kind: resourceName(ResourceWorksite.kind[eid]),
                assignedWorkers: ResourceWorksite.assignedWorkers[eid],
                freeWorkersSpawned: ResourceWorksite.freeWorkersSpawned[eid],
                progress: ResourceWorksite.progress[eid],
              }
              : null,
          });
          continue;
        }

        if (hasComponent(world.ecs, UnitKind, eid)) {
          const kind = UnitKind.kind[eid];
          const name = getUnitDef(kind)?.name ?? `Unit ${kind}`;
          const key = `${owner}:${name}`;
          unitCounts[key] = (unitCounts[key] ?? 0) + 1;
          const path = world.paths.get(eid);
          units.push({
            eid,
            netId: hasComponent(world.ecs, NetId, eid) ? NetId.value[eid] : null,
            owner,
            name,
            villager: hasComponent(world.ecs, VillagerTag, eid),
            x: Number(Position.x[eid].toFixed(2)),
            y: Number(Position.y[eid].toFixed(2)),
            hp: hasComponent(world.ecs, Health, eid) ? Health.hp[eid] : null,
            pathLength: path?.length ?? 0,
            nextWaypoint: path && path.length > 0 ? path[0] : null,
            pathTarget: hasComponent(world.ecs, PathTarget, eid)
              ? { x: PathTarget.x[eid], y: PathTarget.y[eid] }
              : null,
            worksiteWorker: hasComponent(world.ecs, WorksiteWorker, eid)
              ? { siteEid: WorksiteWorker.siteEid[eid] }
              : null,
            gatherer: hasComponent(world.ecs, Gatherer, eid)
              ? {
                state: gathererStateName(Gatherer.state[eid]),
                targetEid: Gatherer.targetEid[eid],
                cooldown: Gatherer.cooldown[eid],
              }
              : null,
            carry: hasComponent(world.ecs, ResourceCarry, eid)
              ? {
                kind: resourceName(ResourceCarry.kind[eid]),
                amount: ResourceCarry.amount[eid],
              }
              : null,
            machineGunDeployment: hasComponent(world.ecs, MachineGunDeployment, eid)
              ? {
                deployed: MachineGunDeployment.deployed[eid],
                setupTicks: MachineGunDeployment.setupTicks[eid],
              }
              : null,
            attackTarget: hasComponent(world.ecs, AttackTarget, eid)
              ? AttackTarget.targetEid[eid]
              : null,
            stuck: world.movementStuck.has(eid) ? world.movementStuck.get(eid) : null,
          });
        }
      }

      return {
        tick: world.tick,
        paused: world.paused,
        aiDifficulty: world.aiDifficulty,
        resources: world.resources.map((bank, playerId) => ({
          playerId,
          food: bank?.[ResourceKindId.FOOD] ?? 0,
          wood: bank?.[ResourceKindId.WOOD] ?? 0,
          gold: bank?.[ResourceKindId.GOLD] ?? 0,
          stone: bank?.[ResourceKindId.STONE] ?? 0,
        })),
        population: world.population.map((pop, playerId) => ({
          playerId,
          current: pop?.current ?? 0,
          cap: pop?.cap ?? 0,
        })),
        ages: world.ages.map((age, playerId) => ({
          playerId,
          current: age?.current ?? 0,
          progress: age?.progress ?? -1,
          totalTicks: age?.totalTicks ?? 0,
        })),
        researchedTechs: world.researchedTechs.map((set, playerId) => ({
          playerId,
          techs: [...set].map((techId) => techDef(techId)?.name ?? String(techId)),
        })),
        aiPlayers: world.aiPlayers,
        productionQueues: [...world.productionQueues.entries()].map(([eid, queue]) => ({
          eid,
          owner: Owner.player[eid],
          producer: hasComponent(world.ecs, Building, eid)
            ? getBuildingDef(Building.defId[eid])?.name ?? Building.defId[eid]
            : null,
          queue: queue.map((unitDefId) => getUnitDef(unitDefId)?.name ?? `Unit ${unitDefId}`),
        })),
        buildingCounts,
        unitCounts,
        buildings,
        units,
        stuckEntities: [...world.movementStuck.entries()].map(([eid, state]) => ({ eid, ...state })),
        pathCount: world.paths.size,
      };
    },
    raw() {
      return world;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__GAME__ = api;
  // eslint-disable-next-line no-console
  console.log(
    '[Kingdoms] window.__GAME__ ready. Try: __GAME__.selectAll(1); __GAME__.moveTo(20,10); __GAME__.tickN(40); __GAME__.getState()'
  );
}

function resourceName(kind: number): string {
  if (kind === ResourceKindId.FOOD) return 'food';
  if (kind === ResourceKindId.WOOD) return 'wood';
  if (kind === ResourceKindId.GOLD) return 'gold';
  if (kind === ResourceKindId.STONE) return 'stone';
  return `resource ${kind}`;
}

function gathererStateName(state: number): string {
  if (state === GathererStateId.IDLE) return 'idle';
  if (state === GathererStateId.WALKING_TO) return 'walking_to';
  if (state === GathererStateId.GATHERING) return 'gathering';
  if (state === GathererStateId.RETURNING) return 'returning';
  if (state === GathererStateId.DEPOSITING) return 'depositing';
  if (state === GathererStateId.WALKING_TO_BUILD) return 'walking_to_build';
  if (state === GathererStateId.BUILDING) return 'building';
  return `state ${state}`;
}
