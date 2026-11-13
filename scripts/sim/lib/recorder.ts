/**
 * Per-match recorder for headless runs: a per-player timeline sampled every N
 * ticks, the gameplay events of every tick (trained, built, destroyed,
 * researched, aged up), AI plan transitions, and stall heuristics. Reads the
 * world only; call afterStep() once per tick before the output buffers drain.
 */

import { hasComponent } from 'bitecs';
import {
  Building,
  ConstructionSite,
  Owner,
  Position,
  UnitKind,
  UnitKindId,
  VillagerTag,
  WorksiteWorker,
} from '@sim/components';
import { BUILDING_TABLE, UNIT_TABLE } from '@sim/defs';
import {
  buildingQuery,
  clonePlayerStats,
  isIdleVillager,
  unitQuery,
  type PlayerMatchStats,
  type SimWorld,
} from '@sim/world';

const UNIT_KIND_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(UnitKindId).map(([name, id]) => [id, name])
);

export interface PlayerSample {
  tick: number;
  pop: number;
  popCap: number;
  /** Free villagers (trained at the town center). */
  villagers: number;
  /** Worksite crews. */
  workers: number;
  idleVillagers: number;
  military: Record<string, number>;
  militaryTotal: number;
  /** Completed buildings by def id name. */
  buildings: Record<string, number>;
  foundations: number;
  bank: number[];
  gathered: number[];
  age: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsLost: number;
  buildingsRazed: number;
  plan: string | null;
  /** Units with a path that did not move since the previous sample. */
  stuckUnits: number;
}

export interface PlayerRecord {
  playerId: number;
  difficulty: string;
  ageUps: Array<{ age: number; tick: number }>;
  planTransitions: Array<{ tick: number; from: string; to: string }>;
  trained: Record<string, number>;
  built: Record<string, number>;
  lostUnits: Record<string, number>;
  lostBuildings: Record<string, number>;
  techs: Array<{ techId: string; tick: number }>;
  final: PlayerMatchStats;
  peakBank: number[];
}

export interface MatchRecord {
  /** Winning player id, 0 when the match hit the tick cap. */
  winner: number;
  endTick: number;
  timedOut: boolean;
  /** Indexed by player id; [0] (gaia) is unused. */
  players: PlayerRecord[];
  timeline: PlayerSample[][];
  /** Stall and anomaly heuristics, e.g. "timeout", "plan-stuck:p1:massing". */
  flags: string[];
  lastKillTick: number;
}

const PLAYERS = [1, 2];

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export class MatchRecorder {
  private readonly players: PlayerRecord[] = [];
  private readonly timeline: PlayerSample[][] = [[], [], []];
  private readonly lastPlan: Array<string | null> = [null, null, null];
  private readonly planSince: number[] = [0, 0, 0];
  private readonly longestPlan: Array<{ plan: string; ticks: number }> = [
    { plan: '', ticks: 0 },
    { plan: '', ticks: 0 },
    { plan: '', ticks: 0 },
  ];
  private lastPositions = new Map<number, { x: number; y: number }>();
  private readonly stuckStreak: number[] = [0, 0, 0];
  private readonly maxStuckStreak: number[] = [0, 0, 0];
  private lastKillTick = 0;

  constructor(world: SimWorld, private readonly sampleEvery: number) {
    for (let p = 0; p <= 2; p++) {
      this.players.push({
        playerId: p,
        difficulty: world.aiPlayers[p]?.difficulty ?? world.aiDifficulty,
        ageUps: [{ age: world.ages[p]?.current ?? 0, tick: 0 }],
        planTransitions: [],
        trained: {},
        built: {},
        lostUnits: {},
        lostBuildings: {},
        techs: [],
        final: clonePlayerStats(world.matchStats[p]),
        peakBank: [0, 0, 0, 0],
      });
    }
    this.sample(world);
  }

  afterStep(world: SimWorld): void {
    for (const event of world.gameEvents) {
      const p = 'playerId' in event ? event.playerId : -1;
      switch (event.kind) {
        case 'unitTrained':
          if (this.players[p]) bump(this.players[p].trained, UNIT_TABLE[event.unitDefId]?.id ?? String(event.unitDefId));
          break;
        case 'buildingCompleted':
          if (this.players[p]) bump(this.players[p].built, BUILDING_TABLE[event.buildingDefId]?.id ?? String(event.buildingDefId));
          break;
        case 'researchCompleted':
          if (this.players[p]) this.players[p].techs.push({ techId: event.techId, tick: event.tick });
          break;
        case 'ageAdvanced':
          if (this.players[p]) this.players[p].ageUps.push({ age: event.ageId, tick: event.tick });
          break;
        case 'entityDestroyed': {
          const owner = this.players[event.ownerId];
          if (!owner) break;
          if (event.killerOwnerId > 0 && event.killerOwnerId !== event.ownerId) this.lastKillTick = event.tick;
          if (event.isBuilding) bump(owner.lostBuildings, BUILDING_TABLE[event.defId]?.id ?? String(event.defId));
          else bump(owner.lostUnits, UNIT_TABLE[event.defId]?.id ?? String(event.defId));
          break;
        }
        default:
          break;
      }
    }
    for (const p of PLAYERS) {
      const plan = world.aiPlayers[p]?.plan ?? null;
      if (plan !== this.lastPlan[p]) {
        this.closePlanSpan(p, world.tick);
        if (this.lastPlan[p] !== null && plan !== null) {
          this.players[p].planTransitions.push({ tick: world.tick, from: this.lastPlan[p]!, to: plan });
        }
        this.lastPlan[p] = plan;
        this.planSince[p] = world.tick;
      }
      const bank = world.resources[p];
      for (let k = 0; k < 4; k++) this.players[p].peakBank[k] = Math.max(this.players[p].peakBank[k], bank[k]);
    }
    if (world.tick % this.sampleEvery === 0) this.sample(world);
  }

  finish(world: SimWorld): MatchRecord {
    this.sample(world);
    const flags: string[] = [];
    const winner = world.outcome.state === 'victory' ? world.outcome.winnerPlayerId : 0;
    if (winner === 0) flags.push('timeout');
    for (const p of PLAYERS) {
      this.closePlanSpan(p, world.tick);
      this.players[p].final = clonePlayerStats(world.matchStats[p]);
      const longest = this.longestPlan[p];
      if (longest.ticks >= 20 * 60 * 6 && longest.plan !== 'attacking') {
        flags.push(`plan-stuck:p${p}:${longest.plan}:${Math.round(longest.ticks / 20)}s`);
      }
      const samples = this.timeline[p];
      const idleHeavy = samples.filter((s) => s.idleVillagers >= 3).length;
      if (samples.length > 4 && idleHeavy / samples.length > 0.4) flags.push(`idle-villagers:p${p}`);
      if (this.maxStuckStreak[p] >= 3) flags.push(`stuck-units:p${p}:${this.maxStuckStreak[p]}`);
      const names = ['food', 'wood', 'gold', 'stone'];
      for (let k = 0; k < 4; k++) {
        const floating = samples.filter((s) => s.bank[k] >= 2000).length;
        if (samples.length > 4 && floating / samples.length > 0.3) flags.push(`float:p${p}:${names[k]}`);
      }
    }
    if (winner === 0 && world.tick - this.lastKillTick > 20 * 60 * 8) flags.push('no-kills-8min');
    return {
      winner,
      endTick: world.tick,
      timedOut: winner === 0,
      players: this.players,
      timeline: this.timeline,
      flags,
      lastKillTick: this.lastKillTick,
    };
  }

  private closePlanSpan(p: number, tick: number): void {
    const plan = this.lastPlan[p];
    if (plan === null) return;
    const span = tick - this.planSince[p];
    if (span > this.longestPlan[p].ticks) this.longestPlan[p] = { plan, ticks: span };
  }

  private sample(world: SimWorld): void {
    const per = PLAYERS.map(() => ({
      villagers: 0,
      workers: 0,
      idle: 0,
      military: {} as Record<string, number>,
      militaryTotal: 0,
      buildings: {} as Record<string, number>,
      foundations: 0,
      stuck: 0,
    }));
    const positions = new Map<number, { x: number; y: number }>();
    for (const eid of unitQuery(world.ecs)) {
      const owner = Owner.player[eid];
      const slot = per[owner - 1];
      if (!slot) continue;
      const x = Position.x[eid];
      const y = Position.y[eid];
      positions.set(eid, { x, y });
      const path = world.paths.get(eid);
      const last = this.lastPositions.get(eid);
      if (path && path.length > 0 && last && Math.hypot(last.x - x, last.y - y) < 0.05) slot.stuck++;
      if (hasComponent(world.ecs, VillagerTag, eid)) {
        if (hasComponent(world.ecs, WorksiteWorker, eid)) slot.workers++;
        else slot.villagers++;
        if (isIdleVillager(world, eid, owner)) slot.idle++;
        continue;
      }
      const kind = UNIT_KIND_NAMES[UnitKind.kind[eid]] ?? String(UnitKind.kind[eid]);
      bump(slot.military, kind);
      slot.militaryTotal++;
    }
    this.lastPositions = positions;
    for (const eid of buildingQuery(world.ecs)) {
      const slot = per[Owner.player[eid] - 1];
      if (!slot) continue;
      if (hasComponent(world.ecs, ConstructionSite, eid)) {
        slot.foundations++;
        continue;
      }
      const defId = BUILDING_TABLE[Building.defId[eid]]?.id ?? '?';
      bump(slot.buildings, defId);
    }
    for (const p of PLAYERS) {
      const s = per[p - 1];
      const stats = world.matchStats[p];
      if (s.stuck >= 3) this.stuckStreak[p]++;
      else this.stuckStreak[p] = 0;
      this.maxStuckStreak[p] = Math.max(this.maxStuckStreak[p], this.stuckStreak[p]);
      this.timeline[p].push({
        tick: world.tick,
        pop: world.population[p].current,
        popCap: world.population[p].cap,
        villagers: s.villagers,
        workers: s.workers,
        idleVillagers: s.idle,
        military: s.military,
        militaryTotal: s.militaryTotal,
        buildings: s.buildings,
        foundations: s.foundations,
        bank: Array.from(world.resources[p]),
        gathered: [...stats.gathered],
        age: world.ages[p].current,
        unitsLost: stats.unitsLost,
        unitsKilled: stats.unitsKilled,
        buildingsLost: stats.buildingsLost,
        buildingsRazed: stats.buildingsRazed,
        plan: world.aiPlayers[p]?.plan ?? null,
        stuckUnits: s.stuck,
      });
    }
  }
}
